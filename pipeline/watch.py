"""Data-maintenance helper, run monthly by .github/workflows/data-update.yml.

The site uses only the 2º and 4º trimestre (see USABLE_QUARTERS), so "the next quarter" is the
next Q2 or Q4 after the pin: Q4 2025 -> Q2 2026 -> Q4 2026.

Two modes:
  (default)  detect — is the next usable EPH quarter published, and is the pinned source reachable?
             Probes URLs only (no microdata download) and emits GitHub step outputs.
  --apply    bump   — perform the *mechanical* half of moving to the next quarter:
             rewrite the pinned fields in config.py (using the real filenames read from
             the new zip) and drop data/checksums.txt so it re-pins.

The bump is intentionally only mechanical: it can NOT supply the INDEC validation anchors
(Gini/median/deciles), which are in INDEC's distribution report (a PDF), not in the zip. INDEC
publishes that report before the microdata, so it already exists when the watch finds the zip.
The workflow opens a *draft* PR; a human fills the anchors and runs `make data` until the
validation gate passes before it can merge.
"""

from __future__ import annotations

import argparse
import io
import os
import re
import sys
import urllib.error
import urllib.request
import zipfile
from collections.abc import Callable

from . import config

UA = "Mozilla/5.0 (argentina-income-percentile data-watch)"
TIMEOUT = 60
DOWNLOAD_TIMEOUT = 300
PINNED_FIELDS = ("QUARTER", "QUARTER_LABEL", "ZIP_URL", "ZIP_NAME", "INDIVIDUAL_FILE", "HOGAR_FILE")
# A member name read out of a downloaded zip is remote input that ends up inside a Python string
# literal in config.py. Only a plain .txt path is usable; anything else falls back to the name we
# derived ourselves (see safe_member).
#
# Must stay at least as permissive as read_zip_members.pick(), which selects on a case-insensitive
# `.txt` suffix: a member this rejects is silently replaced by our derived name, so being stricter
# than the selector would pin a filename that is not in the zip. INDEC has shipped `.TXT` before,
# hence IGNORECASE, and spaces are allowed for the same reason. What stays excluded is what would
# break the generated literal — quotes, backslashes and newlines.
MEMBER_RE = re.compile(r"[\w .\-/]+\.txt", re.IGNORECASE)
# INDEC captures the aguinaldo in the month it is paid, so the 1º and 3º trimestre include it and
# the 2º and 4º do not (INDEC, "Evolución de la distribución del ingreso (EPH)", note above cuadro 2.1).
# The site compares a typical monthly income, so it pins only these.
USABLE_QUARTERS = (2, 4)
# The month whose CBA/CBT matches a quarter's incomes, the rule in config.POVERTY_LINES: a 4º
# trimestre's incomes reference October, so a 2º trimestre's reference April.
POVERTY_LINE_MONTH = {2: "April", 4: "October"}


def parse_quarter(q: str) -> tuple[int, int]:
    """'2025-T4' -> (2025, 4)."""
    year, qtr = q.split("-T")
    return int(year), int(qtr)


def next_quarter(year: int, qtr: int) -> tuple[int, int]:
    """The next usable (2º or 4º) quarter after (year, qtr): Q1 -> Q2, Q2/Q3 -> Q4, Q4 -> next Q2."""
    year, qtr = (year + 1, 1) if qtr >= 4 else (year, qtr + 1)
    while qtr not in USABLE_QUARTERS:
        year, qtr = (year + 1, 1) if qtr >= 4 else (year, qtr + 1)
    return year, qtr


def quarter_files(year: int, qtr: int) -> dict[str, str]:
    """Derive the URL + filenames for a quarter from the pinned naming pattern."""
    base = config.ZIP_URL.rsplit("/", 1)[0]
    zip_name = f"EPH_usu_{qtr}_Trim_{year}_txt.zip"
    yy = year % 100
    return {
        "quarter": f"{year}-T{qtr}",
        "label": f"EPH {qtr}º trimestre {year}",
        "zip_name": zip_name,
        "zip_url": f"{base}/{zip_name}",
        "individual_file": f"usu_individual_T{qtr}{yy:02d}.txt",
        "hogar_file": f"usu_hogar_T{qtr}{yy:02d}.txt",
    }


def is_available(url: str) -> bool:
    """True only if the URL actually serves the zip.

    INDEC's server returns HTTP 200 with an HTML "not found" page for missing files, so a
    status-only check false-positives. We require a zip-like Content-Type. A tiny ranged GET
    keeps the transfer to one byte for files that do exist.
    """
    req = urllib.request.Request(url, method="GET", headers={"User-Agent": UA, "Range": "bytes=0-0"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            if not 200 <= resp.status < 300:
                return False
            ctype = (resp.headers.get("Content-Type") or "").lower()
            return "zip" in ctype or "octet-stream" in ctype
    except urllib.error.URLError, OSError:
        return False


def issue_title(status: str, nxt: dict[str, str]) -> str:
    if status == "new_quarter":
        return f"Data: {nxt['label']} is available — bump the pin"
    if status == "source_unreachable":
        return f"Data: pinned EPH source ({config.QUARTER}) is unreachable"
    return f"Data: monthly reproducibility check failed ({config.QUARTER})"


def issue_body(status: str, nxt: dict[str, str], health_failed: bool) -> str:
    parts: list[str] = []
    if status == "new_quarter":
        parts.append(
            f"A newer EPH quarter appears to be published: **{nxt['label']}**.\n\n"
            f"```\n{nxt['zip_url']}\n```\n\n"
            "### To update (validated bump)\n"
            "1. Edit `pipeline/config.py`:\n"
            f'   - `QUARTER = "{nxt["quarter"]}"`\n'
            f'   - `QUARTER_LABEL = "{nxt["label"]}"`\n'
            f'   - `ZIP_URL = "{nxt["zip_url"]}"`\n'
            f'   - `ZIP_NAME = "{nxt["zip_name"]}"`\n'
            f'   - `INDIVIDUAL_FILE = "{nxt["individual_file"]}"`\n'
            f'   - `HOGAR_FILE = "{nxt["hogar_file"]}"`\n'
            "2. Delete `data/checksums.txt` (re-pins the new file on the next `make data`).\n"
            "3. Refresh the INDEC validation anchors (`INDEC_IPCF_*`) and the reference blocks "
            "(`POVERTY_LINES`, `HISTORY`, `COST_OF_LIVING`) from INDEC's published figures.\n"
            "4. Run `make data` — the validation gate must pass before committing.\n\n"
            "> The validation anchors come from INDEC's *\"Evolución de la distribución del "
            'ingreso"* report, which INDEC publishes **before** the microdata (1º trim. 2026: '
            "report 2026-06-25, microdata 2026-08-03; 2º trim. 2026: report 2026-10-01, microdata "
            "2026-11-04), so the report for this quarter is already out."
        )
    elif status == "source_unreachable":
        parts.append(
            f"The pinned source for **{config.QUARTER}** did not respond:\n\n"
            f"```\n{config.ZIP_URL}\n```\n\n"
            "INDEC may have moved or removed the file. Verify `ZIP_URL` in `pipeline/config.py`."
        )

    if health_failed:
        parts.append(
            "---\n"
            "⚠️ The monthly reproducibility check (`make data`) **failed** for the current pin — "
            "the build no longer validates against INDEC, or the download/SHA changed. "
            "See the workflow run log for details."
        )
    return "\n\n".join(parts) + "\n"


def emit_outputs(outputs: dict[str, str]) -> None:
    gh_out = os.environ.get("GITHUB_OUTPUT")
    if not gh_out:
        return
    with open(gh_out, "a", encoding="utf-8") as f:
        for key, value in outputs.items():
            f.write(f"{key}={value}\n")


def detect() -> int:
    year, qtr = parse_quarter(config.QUARTER)
    current_ok = is_available(config.ZIP_URL)
    nxt = quarter_files(*next_quarter(year, qtr))
    new_available = is_available(nxt["zip_url"])
    health_failed = os.environ.get("HEALTH_OUTCOME", "") == "failure"

    if new_available:
        status = "new_quarter"
    elif not current_ok:
        status = "source_unreachable"
    else:
        status = "up_to_date"

    # PRs handle new quarters; issues are only for "go investigate" cases. A failed reproducibility
    # check is one of those even while a new quarter is pending: the bump PR does not report it, and
    # the health step is continue-on-error, so the run would otherwise stay green.
    needs_issue_only = status == "source_unreachable" or health_failed
    issue_status = "health_failed" if status == "new_quarter" else status
    body_file = os.environ.get("ISSUE_BODY_FILE", "eph-watch-body.md")
    if needs_issue_only:
        with open(body_file, "w", encoding="utf-8") as f:
            f.write(issue_body(issue_status, nxt, health_failed))

    emit_outputs(
        {
            "status": status,
            "needs_issue": str(needs_issue_only).lower(),
            "issue_title": issue_title(issue_status, nxt),
            "issue_body_file": body_file,
            "current_quarter": config.QUARTER,
            "current_ok": str(current_ok).lower(),
            "next_quarter": nxt["quarter"],
            "next_label": nxt["label"],
        }
    )

    print(f"[watch] pinned quarter : {config.QUARTER} ({'reachable' if current_ok else 'UNREACHABLE'})")
    print(f"[watch] next quarter   : {nxt['quarter']} ({'available' if new_available else 'not yet'})")
    print(f"[watch]   candidate URL: {nxt['zip_url']}")
    print(f"[watch] health check   : {'failed' if health_failed else 'ok / n-a'}")
    print(f"[watch] status         : {status}  (issue={needs_issue_only})")
    return 0


def read_zip_members(url: str) -> dict[str, str | None]:
    """Download the zip and return the real individual/hogar member filenames."""
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=DOWNLOAD_TIMEOUT) as resp:
        blob = resp.read()
    names = zipfile.ZipFile(io.BytesIO(blob)).namelist()

    def pick(kind: str) -> str | None:
        return next((n for n in names if kind in n.lower() and n.lower().endswith(".txt")), None)

    return {"individual": pick("individual"), "hogar": pick("hogar")}


def safe_member(name: str | None, fallback: str) -> str:
    """The zip's own member name if it's a plain .txt path, else the filename we derived."""
    return name if name and MEMBER_RE.fullmatch(name) else fallback


def literal(replacement: str) -> Callable[[re.Match[str]], str]:
    """An re.sub replacement *callable*, which inserts `replacement` verbatim.

    A replacement string would re-read its backslash escapes instead: `\\u` raises, and `\\g<0>`
    splices the matched text back in. These values include a filename read from a remote zip.
    """
    return lambda _m: replacement


def pr_body(nxt: dict[str, str], individual: str, hogar: str) -> str:
    year, qtr = parse_quarter(nxt["quarter"])
    month = f"{POVERTY_LINE_MONTH[qtr]} {year}"
    return (
        f"Mechanical bump to **{nxt['label']}**, applied automatically. **Draft until validated.**\n\n"
        "### Done by this PR\n"
        "- `pipeline/config.py`: `QUARTER`, `QUARTER_LABEL`, `ZIP_URL`, `ZIP_NAME`, "
        f"`INDIVIDUAL_FILE` (`{individual}`), `HOGAR_FILE` (`{hogar}`)\n"
        "- removed `data/checksums.txt` (re-pins the new file on the next `make data`)\n\n"
        "### Before merging (human)\n"
        "- [ ] Refresh the INDEC validation anchors (`INDEC_IPCF_*`) from INDEC's "
        f'*"Evolución de la distribución del ingreso, {nxt["label"]}"* report\n'
        f"- [ ] Update `POVERTY_LINES` to INDEC's CBA/CBT for **{month}** (a 2º trimestre's incomes "
        "reference April, a 4º trimestre's October; see `POVERTY_LINES` in `config.py`) and `HISTORY`\n"
        "- [ ] Run `make data` — the validation gate **must pass**\n"
        "- [ ] Commit the regenerated `data/percentiles.v1.json`, "
        "`web/public/percentiles.v1.json` and `data/checksums.txt`\n\n"
        "> The anchors come from INDEC's distribution report, which INDEC publishes **before** the "
        "microdata (1º trim. 2026: report 2026-06-25, microdata 2026-08-03; 2º trim. 2026: report "
        "2026-10-01, microdata 2026-11-04), so the report for this quarter is already out."
    )


def apply_bump() -> int:
    """Rewrite config.py's pinned fields for the next quarter and drop the checksum pin."""
    nxt = quarter_files(*next_quarter(*parse_quarter(config.QUARTER)))
    if not is_available(nxt["zip_url"]):
        print(f"[apply] {nxt['quarter']} is not available yet — nothing to do.", file=sys.stderr)
        return 1

    members = read_zip_members(nxt["zip_url"])
    individual = safe_member(members["individual"], nxt["individual_file"])
    hogar = safe_member(members["hogar"], nxt["hogar_file"])
    values = {
        "QUARTER": nxt["quarter"],
        "QUARTER_LABEL": nxt["label"],
        "ZIP_URL": nxt["zip_url"],
        "ZIP_NAME": nxt["zip_name"],
        "INDIVIDUAL_FILE": individual,
        "HOGAR_FILE": hogar,
    }

    cfg_path = config.ROOT / "pipeline" / "config.py"
    text = cfg_path.read_text(encoding="utf-8")
    for name in PINNED_FIELDS:
        text, n = re.subn(rf'(?m)^{name} = ".*"$', literal(f'{name} = "{values[name]}"'), text)
        if n != 1:
            print(f"[apply] ERROR: expected exactly one '{name} = ...' line, found {n}.", file=sys.stderr)
            return 2
    cfg_path.write_text(text, encoding="utf-8")

    if config.CHECKSUMS_FILE.exists():
        config.CHECKSUMS_FILE.unlink()

    body_file = os.environ.get("PR_BODY_FILE", "eph-bump-pr-body.md")
    with open(body_file, "w", encoding="utf-8") as f:
        f.write(pr_body(nxt, individual, hogar))

    for name in PINNED_FIELDS:
        print(f"[apply] {name} = {values[name]!r}")
    print(f"[apply] removed {config.CHECKSUMS_FILE.name}; wrote PR body to {body_file}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="EPH data-maintenance watcher / bump helper")
    parser.add_argument("--apply", action="store_true", help="apply the mechanical bump to the next quarter")
    args = parser.parse_args()
    return apply_bump() if args.apply else detect()


if __name__ == "__main__":
    raise SystemExit(main())
