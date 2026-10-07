"""The CPI sync helper: month enumeration, the artifact fetch (urllib mocked), render() and every
rejection, the committed-file round trip, detect() across the four statuses, apply(), main() and
__main__."""

from __future__ import annotations

import json
import runpy
import urllib.error
from typing import Any

import pytest

from pipeline import cpi_sync

# runpy.run_module on an already-imported package warns harmlessly; ignore just that.
pytestmark = pytest.mark.filterwarnings("ignore:.*found in sys.modules:RuntimeWarning")

REF = "2025-10"


def _artifact(vintage: str = "2025-12", **extra: Any) -> dict[str, Any]:
    months = cpi_sync.enumerate_months("2025-09", vintage)
    rows = [{"m": m, "cpi": 80.0 + i, "src": "nacional"} for i, m in enumerate(months)]
    art: dict[str, Any] = {"schema_version": 1, "vintage": vintage, "vintage_label": "diciembre 2025", "series": rows}
    art.update(extra)
    return art


class _FakeHTTP:
    def __init__(self, body: bytes):
        self._body = body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self) -> bytes:
        return self._body


def _online(monkeypatch, body: Any) -> None:
    """urlopen returns `body` (a dict is JSON-encoded, bytes go as is, an exception is raised)."""

    def fake(req, timeout):
        if isinstance(body, Exception):
            raise body
        raw = body if isinstance(body, bytes) else json.dumps(body).encode()
        return _FakeHTTP(raw)

    monkeypatch.setattr(cpi_sync.urllib.request, "urlopen", fake)


@pytest.fixture
def cpi_file(tmp_path, monkeypatch):
    p = tmp_path / "cpi_monthly.json"
    monkeypatch.setattr(cpi_sync, "CPI_FILE", p)
    return p


@pytest.fixture
def gh_env(tmp_path, monkeypatch):
    out = tmp_path / "gh_output"
    body = tmp_path / "issue-body.md"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    monkeypatch.setenv("ISSUE_BODY_FILE", str(body))
    return out, body


def _outputs(path) -> dict[str, str]:
    return dict(line.split("=", 1) for line in path.read_text().splitlines())


# --- pure helpers ---


def test_enumerate_months_crosses_the_year_end():
    assert cpi_sync.enumerate_months("2025-11", "2026-02") == ["2025-11", "2025-12", "2026-01", "2026-02"]


def test_enumerate_months_empty_when_end_precedes_start():
    assert cpi_sync.enumerate_months("2026-03", "2026-02") == []


# --- fetch ---


def test_fetch_artifact_returns_the_dict(monkeypatch):
    _online(monkeypatch, {"schema_version": 1})
    assert cpi_sync.fetch_artifact() == {"schema_version": 1}


@pytest.mark.parametrize(
    "body",
    [urllib.error.URLError("down"), OSError("timeout"), b"not json", b"[1, 2]"],
)
def test_fetch_artifact_unreadable_is_none(monkeypatch, body):
    _online(monkeypatch, body)
    assert cpi_sync.fetch_artifact() is None


# --- render ---


def test_render_takes_the_months_from_the_reference_month_to_the_vintage():
    doc = cpi_sync.render(_artifact(), REF)
    assert [m["period"] for m in doc["months"]] == ["2025-10", "2025-11", "2025-12"]
    assert doc["months"][0] == {"period": "2025-10", "index": 81.0}
    assert doc["peso_vintage"] == "2025-12"
    assert doc["peso_vintage_label"] == "diciembre 2025"
    assert doc["source"].endswith("vintage 2025-12")
    assert cpi_sync.IPC_SERIES_ID in doc["source"]
    assert doc["schema_version"] == 1


def test_render_skips_malformed_rows_and_takes_integer_cpi():
    art = _artifact()
    art["series"] = ["junk", {"m": 5, "cpi": 1.0}, {"m": "2025-11", "cpi": "x"}, *art["series"]]
    art["series"].append({"m": "2025-12", "cpi": 90})  # a later duplicate wins, as an int
    doc = cpi_sync.render(art, REF)
    assert doc["months"][-1] == {"period": "2025-12", "index": 90.0}


@pytest.mark.parametrize(
    ("art", "message"),
    [
        (_artifact(schema_version=2), "schema_version"),
        (_artifact(vintage="2025-13"), "bad vintage"),
        ({**_artifact(), "vintage": None}, "bad vintage"),
        (_artifact(series={"m": "2025-10"}), "series is not a list"),
        (_artifact(vintage="2025-09"), "before the reference month"),
        ({**_artifact(), "series": [r for r in _artifact()["series"] if r["m"] != "2025-11"]}, "missing"),
    ],
)
def test_render_rejects_a_bad_artifact(art, message):
    with pytest.raises(ValueError, match=message):
        cpi_sync.render(art, REF)


def test_render_without_vintage_label_leaves_it_empty():
    art = _artifact()
    del art["vintage_label"]
    assert cpi_sync.render(art, REF)["peso_vintage_label"] == ""


# --- committed file ---


def test_current_is_none_without_a_file(cpi_file):
    assert cpi_sync.current() is None


def test_write_then_current_round_trips(cpi_file):
    doc = cpi_sync.render(_artifact(), REF)
    cpi_sync.write(doc)
    assert cpi_sync.current() == doc
    assert cpi_file.read_text().endswith("}\n")


# --- issue text ---


def test_issue_title_and_body_per_status():
    assert "unreachable" in cpi_sync.issue_title("source_unreachable")
    assert "no longer fits" in cpi_sync.issue_title("invalid")
    assert cpi_sync.PESO_ARTIFACT_URL in cpi_sync.issue_body("source_unreachable", cpi_sync.PESO_ARTIFACT_URL)
    assert "schema" in cpi_sync.issue_body("invalid", "unexpected schema_version 2")


# --- detect ---


def test_detect_unchanged(monkeypatch, cpi_file, gh_env):
    out, body = gh_env
    _online(monkeypatch, _artifact())
    cpi_sync.write(cpi_sync.render(_artifact(), REF))
    assert cpi_sync.detect() == 0
    o = _outputs(out)
    assert o["status"] == "unchanged"
    assert o["needs_issue"] == "false"
    assert o["peso_vintage"] == "2025-12"
    assert o["peso_vintage_label"] == "diciembre 2025"
    assert not body.exists()


def test_detect_changed_when_the_file_is_missing(monkeypatch, cpi_file, gh_env):
    out, _ = gh_env
    _online(monkeypatch, _artifact())
    assert cpi_sync.detect() == 0
    assert _outputs(out)["status"] == "changed"
    assert not cpi_file.exists()  # detect never writes the file


def test_detect_source_unreachable_writes_the_issue_body(monkeypatch, cpi_file, gh_env):
    out, body = gh_env
    _online(monkeypatch, urllib.error.URLError("down"))
    assert cpi_sync.detect() == 0
    o = _outputs(out)
    assert o["status"] == "source_unreachable"
    assert o["needs_issue"] == "true"
    assert o["issue_body_file"] == str(body)
    assert o["peso_vintage"] == ""
    assert cpi_sync.PESO_ARTIFACT_URL in body.read_text()


def test_detect_invalid_artifact_writes_the_issue_body(monkeypatch, cpi_file, gh_env):
    out, body = gh_env
    _online(monkeypatch, _artifact(schema_version=2))
    assert cpi_sync.detect() == 0
    o = _outputs(out)
    assert o["status"] == "invalid"
    assert o["needs_issue"] == "true"
    assert o["issue_title"] == cpi_sync.issue_title("invalid")
    assert "schema_version" in body.read_text()


# --- apply ---


def test_apply_writes_the_file(monkeypatch, cpi_file, capsys):
    _online(monkeypatch, _artifact())
    assert cpi_sync.apply() == 0
    assert cpi_sync.current() == cpi_sync.render(_artifact(), REF)
    assert "3 months through 2025-12 (changed)" in capsys.readouterr().out


def test_apply_unreachable_returns_1(monkeypatch, cpi_file, capsys):
    _online(monkeypatch, OSError("down"))
    assert cpi_sync.apply() == 1
    assert not cpi_file.exists()
    assert "source_unreachable" in capsys.readouterr().err


def test_apply_invalid_returns_2(monkeypatch, cpi_file, capsys):
    _online(monkeypatch, _artifact(vintage="2025-09"))
    assert cpi_sync.apply() == 2
    assert "invalid" in capsys.readouterr().err


# --- main / __main__ ---


def test_main_detect(monkeypatch):
    monkeypatch.setattr("sys.argv", ["cpi_sync"])
    monkeypatch.setattr(cpi_sync, "detect", lambda: 7)
    assert cpi_sync.main() == 7


def test_main_apply(monkeypatch):
    monkeypatch.setattr("sys.argv", ["cpi_sync", "--apply"])
    monkeypatch.setattr(cpi_sync, "apply", lambda: 8)
    assert cpi_sync.main() == 8


def test_dunder_main_runs_detect(monkeypatch, gh_env):
    out, body = gh_env
    monkeypatch.setattr("sys.argv", ["cpi_sync"])
    _online(monkeypatch, urllib.error.URLError("down"))
    with pytest.raises(SystemExit) as exc:
        runpy.run_module("pipeline.cpi_sync", run_name="__main__")
    assert exc.value.code == 0
    assert _outputs(out)["status"] == "source_unreachable"
    assert body.exists()
