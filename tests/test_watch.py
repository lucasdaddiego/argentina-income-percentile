"""The data-watch helper: pure quarter math, issue/PR text, GitHub-output emission, the
network probes (urllib mocked), detect() across every status x health combo, read_zip_members,
apply_bump (not-available / success / missing-field / no-checksum) and main()/__main__."""

from __future__ import annotations

import io
import runpy
import urllib.error
import urllib.request
import zipfile

import pytest

from pipeline import config, watch

# runpy.run_module on an already-imported package warns harmlessly; ignore just that.
pytestmark = pytest.mark.filterwarnings("ignore:.*found in sys.modules:RuntimeWarning")


class _FakeHTTP:
    def __init__(self, status: int = 200, ctype: str | None = "application/zip", body: bytes = b""):
        self.status = status
        self.headers = {} if ctype is None else {"Content-Type": ctype}
        self._body = body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self) -> bytes:
        return self._body


def _zip_blob(names: list[str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for n in names:
            zf.writestr(n, b"x")
    return buf.getvalue()


def _next_url() -> str:
    return watch.quarter_files(*watch.next_quarter(*watch.parse_quarter(config.QUARTER)))["zip_url"]


# --- pure helpers ---


def test_parse_quarter():
    assert watch.parse_quarter("2025-T4") == (2025, 4)


def test_next_quarter_wraps_year_to_the_next_q2():
    # The site uses only Q2 and Q4 (INDEC: Q1 and Q3 include the aguinaldo).
    assert watch.next_quarter(2025, 4) == (2026, 2)


def test_next_quarter_skips_q1_and_q3():
    assert watch.next_quarter(2026, 1) == (2026, 2)
    assert watch.next_quarter(2026, 3) == (2026, 4)


def test_next_quarter_from_a_q2_pin_is_that_years_q4():
    assert watch.next_quarter(2026, 2) == (2026, 4)


def test_quarter_files():
    qf = watch.quarter_files(2026, 1)
    assert qf["quarter"] == "2026-T1"
    assert qf["zip_name"] == "EPH_usu_1_Trim_2026_txt.zip"
    assert qf["individual_file"] == "usu_individual_T126.txt"
    assert qf["hogar_file"] == "usu_hogar_T126.txt"
    assert qf["zip_url"].endswith(qf["zip_name"])


# --- is_available (mocked urllib) ---


@pytest.mark.parametrize(
    "status,ctype,expected",
    [
        (200, "application/zip", True),
        (206, "application/octet-stream", True),
        (200, "text/html; charset=utf-8", False),
        (200, None, False),
        (404, "text/html", False),
    ],
)
def test_is_available_responses(monkeypatch, status, ctype, expected):
    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout=0: _FakeHTTP(status, ctype))
    assert watch.is_available("http://x/file.zip") is expected


@pytest.mark.parametrize("exc", [urllib.error.URLError("down"), OSError("boom")])
def test_is_available_network_error(monkeypatch, exc):
    def _raise(req, timeout=0):
        raise exc

    monkeypatch.setattr(urllib.request, "urlopen", _raise)
    assert watch.is_available("http://x/file.zip") is False


# --- issue_title / issue_body / pr_body ---


def test_issue_title_all_statuses():
    nxt = watch.quarter_files(2026, 1)
    assert "is available" in watch.issue_title("new_quarter", nxt)
    assert "unreachable" in watch.issue_title("source_unreachable", nxt)
    assert "reproducibility check failed" in watch.issue_title("up_to_date", nxt)


def test_issue_body_new_quarter():
    nxt = watch.quarter_files(2026, 1)
    body = watch.issue_body("new_quarter", nxt, health_failed=False)
    assert nxt["label"] in body
    assert "validation gate" in body
    assert "reproducibility check" not in body  # no health section


def test_issue_body_source_unreachable_with_health():
    nxt = watch.quarter_files(2026, 1)
    body = watch.issue_body("source_unreachable", nxt, health_failed=True)
    assert config.QUARTER in body
    assert "did not respond" in body
    assert "reproducibility check" in body  # health section appended


def test_issue_body_up_to_date_health_only():
    nxt = watch.quarter_files(2026, 1)
    body = watch.issue_body("up_to_date", nxt, health_failed=False)
    assert body.strip() == ""  # no new_quarter, no source_unreachable, no health


def test_pr_body():
    nxt = watch.quarter_files(2026, 2)
    body = watch.pr_body(nxt, "usu_individual_T226.txt", "usu_hogar_T226.txt")
    assert nxt["label"] in body
    assert "usu_individual_T226.txt" in body
    assert "usu_hogar_T226.txt" in body


def test_pr_body_names_the_poverty_line_month_for_the_quarter():
    # POVERTY_LINES must match the month the quarter's incomes reference: April for a Q2 pin,
    # October for a Q4 pin.
    q2 = watch.pr_body(watch.quarter_files(2026, 2), "i.txt", "h.txt")
    q4 = watch.pr_body(watch.quarter_files(2026, 4), "i.txt", "h.txt")
    assert "CBA/CBT for **April 2026**" in q2
    assert "CBA/CBT for **October 2026**" in q4


# --- emit_outputs ---


def test_emit_outputs_no_env(monkeypatch):
    monkeypatch.delenv("GITHUB_OUTPUT", raising=False)
    watch.emit_outputs({"a": "1"})  # returns early, nothing to assert beyond no crash


def test_emit_outputs_writes(tmp_path, monkeypatch):
    gho = tmp_path / "out.txt"
    monkeypatch.setenv("GITHUB_OUTPUT", str(gho))
    watch.emit_outputs({"a": "1", "b": "two"})
    assert gho.read_text() == "a=1\nb=two\n"


# --- detect (status x health matrix) ---


def _run_detect(monkeypatch, tmp_path, *, current_ok, new_available, health=False):
    mapping = {config.ZIP_URL: current_ok, _next_url(): new_available}
    monkeypatch.setattr(watch, "is_available", lambda url: mapping.get(url, False))
    body = tmp_path / "body.md"
    gho = tmp_path / "gh.txt"
    monkeypatch.setenv("ISSUE_BODY_FILE", str(body))
    monkeypatch.setenv("GITHUB_OUTPUT", str(gho))
    if health:
        monkeypatch.setenv("HEALTH_OUTCOME", "failure")
    else:
        monkeypatch.delenv("HEALTH_OUTCOME", raising=False)
    rc = watch.detect()
    outputs = dict(line.split("=", 1) for line in gho.read_text().splitlines())
    return rc, outputs, body


def test_detect_new_quarter(monkeypatch, tmp_path):
    rc, out, body = _run_detect(monkeypatch, tmp_path, current_ok=True, new_available=True)
    assert rc == 0
    assert out["status"] == "new_quarter"
    assert out["needs_issue"] == "false"  # a PR handles the bump, not an issue
    assert not body.exists()


def test_detect_source_unreachable(monkeypatch, tmp_path):
    rc, out, body = _run_detect(monkeypatch, tmp_path, current_ok=False, new_available=False)
    assert rc == 0
    assert out["status"] == "source_unreachable"
    assert out["needs_issue"] == "true"
    assert body.exists() and config.QUARTER in body.read_text()


def test_detect_up_to_date(monkeypatch, tmp_path):
    rc, out, body = _run_detect(monkeypatch, tmp_path, current_ok=True, new_available=False)
    assert rc == 0
    assert out["status"] == "up_to_date"
    assert out["needs_issue"] == "false"
    assert not body.exists()


def test_detect_up_to_date_with_health_failure(monkeypatch, tmp_path):
    rc, out, body = _run_detect(monkeypatch, tmp_path, current_ok=True, new_available=False, health=True)
    assert rc == 0
    assert out["status"] == "up_to_date"
    assert out["needs_issue"] == "true"  # health failure still raises an issue
    assert body.exists() and "reproducibility check" in body.read_text()


def test_detect_new_quarter_with_health_failure(monkeypatch, tmp_path):
    """A pending quarter must not swallow a failed reproducibility check of the current pin: the
    bump PR does not report it and the health step is continue-on-error, so without an issue the
    monthly run is green and the failure is silent."""
    rc, out, body = _run_detect(monkeypatch, tmp_path, current_ok=True, new_available=True, health=True)
    assert rc == 0
    assert out["status"] == "new_quarter"  # the PR step still runs
    assert out["needs_issue"] == "true"
    assert "reproducibility check failed" in out["issue_title"]
    assert body.exists() and "reproducibility check" in body.read_text()


# --- read_zip_members ---


def test_read_zip_members_finds_both(monkeypatch):
    blob = _zip_blob(["usu_individual_T126.txt", "usu_hogar_T126.txt", "readme.md"])
    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout=0: _FakeHTTP(body=blob))
    members = watch.read_zip_members("http://x/eph.zip")
    assert members == {"individual": "usu_individual_T126.txt", "hogar": "usu_hogar_T126.txt"}


def test_read_zip_members_missing_hogar(monkeypatch):
    blob = _zip_blob(["usu_individual_T126.txt"])  # no hogar member -> pick returns None
    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout=0: _FakeHTTP(body=blob))
    members = watch.read_zip_members("http://x/eph.zip")
    assert members["individual"] == "usu_individual_T126.txt"
    assert members["hogar"] is None


# --- apply_bump ---

_CONFIG_TEMPLATE = """\
QUARTER = "2025-T4"
QUARTER_LABEL = "EPH 4º trimestre 2025"
ZIP_URL = "https://www.indec.gob.ar/ftp/x/EPH_usu_4_Trim_2025_txt.zip"
ZIP_NAME = "EPH_usu_4_Trim_2025_txt.zip"
INDIVIDUAL_FILE = "usu_individual_T425.txt"
HOGAR_FILE = "usu_hogar_T425.txt"
"""


def _fake_config_root(tmp_path, template=_CONFIG_TEMPLATE):
    root = tmp_path / "root"
    (root / "pipeline").mkdir(parents=True)
    (root / "pipeline" / "config.py").write_text(template, encoding="utf-8")
    return root


def test_apply_bump_not_available(monkeypatch, capsys):
    monkeypatch.setattr(watch, "is_available", lambda url: False)
    assert watch.apply_bump() == 1
    assert "not available yet" in capsys.readouterr().err


def test_apply_bump_success(tmp_path, monkeypatch):
    root = _fake_config_root(tmp_path)
    checks = tmp_path / "checksums.txt"
    checks.write_text("abc  EPH.zip\n")
    monkeypatch.setattr(watch, "is_available", lambda url: True)
    monkeypatch.setattr(watch, "read_zip_members", lambda url: {"individual": "ind.txt", "hogar": "hog.txt"})
    monkeypatch.setattr(config, "ROOT", root)
    monkeypatch.setattr(config, "CHECKSUMS_FILE", checks)
    monkeypatch.setenv("PR_BODY_FILE", str(tmp_path / "pr.md"))

    assert watch.apply_bump() == 0
    rewritten = (root / "pipeline" / "config.py").read_text()
    assert 'QUARTER = "2026-T2"' in rewritten
    assert 'INDIVIDUAL_FILE = "ind.txt"' in rewritten
    assert 'HOGAR_FILE = "hog.txt"' in rewritten
    assert not checks.exists()  # checksum pin dropped (existed -> unlinked)
    assert (tmp_path / "pr.md").read_text()


def test_apply_bump_no_checksum_and_member_fallback(tmp_path, monkeypatch):
    root = _fake_config_root(tmp_path)
    monkeypatch.setattr(watch, "is_available", lambda url: True)
    # Members come back None -> fall back to the derived filenames.
    monkeypatch.setattr(watch, "read_zip_members", lambda url: {"individual": None, "hogar": None})
    monkeypatch.setattr(config, "ROOT", root)
    monkeypatch.setattr(config, "CHECKSUMS_FILE", tmp_path / "absent.txt")  # does NOT exist
    monkeypatch.setenv("PR_BODY_FILE", str(tmp_path / "pr.md"))

    assert watch.apply_bump() == 0
    rewritten = (root / "pipeline" / "config.py").read_text()
    assert 'INDIVIDUAL_FILE = "usu_individual_T226.txt"' in rewritten
    assert 'HOGAR_FILE = "usu_hogar_T226.txt"' in rewritten


def test_apply_bump_rejects_unusable_member_names(tmp_path, monkeypatch):
    # Member names come straight off a remotely downloaded zip. A backslash-bearing one used to
    # abort the bump (re.subn read `\u` as an escape) and `a\g<0>b.txt` spliced the old line back
    # into config.py. Both must be rejected in favour of the filename we derived ourselves.
    root = _fake_config_root(tmp_path)
    monkeypatch.setattr(watch, "is_available", lambda url: True)
    monkeypatch.setattr(
        watch,
        "read_zip_members",
        lambda url: {"individual": "dir\\usu_individual_T226.txt", "hogar": "a\\g<0>b.txt"},
    )
    monkeypatch.setattr(config, "ROOT", root)
    monkeypatch.setattr(config, "CHECKSUMS_FILE", tmp_path / "absent.txt")
    monkeypatch.setenv("PR_BODY_FILE", str(tmp_path / "pr.md"))

    assert watch.apply_bump() == 0
    rewritten = (root / "pipeline" / "config.py").read_text()
    assert 'INDIVIDUAL_FILE = "usu_individual_T226.txt"' in rewritten
    assert 'HOGAR_FILE = "usu_hogar_T226.txt"' in rewritten
    assert "\\" not in rewritten
    compile(rewritten, "config.py", "exec")  # and it's still importable Python


def test_apply_bump_keeps_real_member_names_the_selector_accepts(tmp_path, monkeypatch):
    # The validator must not be stricter than read_zip_members.pick(), which selects on a
    # case-insensitive ".txt". Rejecting a name pick() legitimately chose silently pins our
    # derived lowercase name instead — a file that is not in the zip, so `make data` then dies
    # with FileNotFoundError on a case-sensitive filesystem (Linux CI) after extraction.
    root = _fake_config_root(tmp_path)
    monkeypatch.setattr(watch, "is_available", lambda url: True)
    monkeypatch.setattr(
        watch,
        "read_zip_members",
        lambda url: {"individual": "usu_individual_T226.TXT", "hogar": "usu hogar T226.Txt"},
    )
    monkeypatch.setattr(config, "ROOT", root)
    monkeypatch.setattr(config, "CHECKSUMS_FILE", tmp_path / "absent.txt")
    monkeypatch.setenv("PR_BODY_FILE", str(tmp_path / "pr.md"))

    assert watch.apply_bump() == 0
    rewritten = (root / "pipeline" / "config.py").read_text()
    assert 'INDIVIDUAL_FILE = "usu_individual_T226.TXT"' in rewritten  # casing preserved
    assert 'HOGAR_FILE = "usu hogar T226.Txt"' in rewritten  # spaces preserved
    compile(rewritten, "config.py", "exec")


def test_apply_bump_missing_field_returns_2(tmp_path, monkeypatch, capsys):
    # Template missing the HOGAR_FILE line -> re.subn matches 0 -> guard returns 2.
    template = _CONFIG_TEMPLATE.replace('HOGAR_FILE = "usu_hogar_T425.txt"\n', "")
    root = _fake_config_root(tmp_path, template)
    monkeypatch.setattr(watch, "is_available", lambda url: True)
    monkeypatch.setattr(watch, "read_zip_members", lambda url: {"individual": "ind.txt", "hogar": "hog.txt"})
    monkeypatch.setattr(config, "ROOT", root)
    monkeypatch.setenv("PR_BODY_FILE", str(tmp_path / "pr.md"))

    assert watch.apply_bump() == 2
    assert "expected exactly one 'HOGAR_FILE" in capsys.readouterr().err


# --- main() dispatch + __main__ ---


def test_main_detect(monkeypatch):
    monkeypatch.setattr("sys.argv", ["watch"])
    monkeypatch.setattr(watch, "detect", lambda: 0)
    monkeypatch.setattr(watch, "apply_bump", lambda: pytest.fail("apply_bump must not run"))
    assert watch.main() == 0


def test_main_apply(monkeypatch):
    monkeypatch.setattr("sys.argv", ["watch", "--apply"])
    monkeypatch.setattr(watch, "apply_bump", lambda: 7)
    monkeypatch.setattr(watch, "detect", lambda: pytest.fail("detect must not run"))
    assert watch.main() == 7


def test_dunder_main_runs_detect(monkeypatch, tmp_path):
    # __main__ -> main() -> detect(); keep it offline by mocking urlopen (zip everywhere ->
    # new_quarter -> no issue body written) and unsetting GITHUB_OUTPUT.
    monkeypatch.setattr("sys.argv", ["watch"])
    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout=0: _FakeHTTP(body=b""))
    monkeypatch.delenv("GITHUB_OUTPUT", raising=False)
    monkeypatch.delenv("HEALTH_OUTCOME", raising=False)
    monkeypatch.setenv("ISSUE_BODY_FILE", str(tmp_path / "body.md"))
    with pytest.raises(SystemExit) as exc:
        runpy.run_module("pipeline.watch", run_name="__main__")
    assert exc.value.code == 0
