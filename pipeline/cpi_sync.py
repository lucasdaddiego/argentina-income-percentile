"""Keep the monthly CPI block equal to peso's published artifact. Run monthly by
.github/workflows/cpi-sync.yml.

The web app brings a typed income back to the survey's reference month with INDEC's monthly IPC.
Those months come from lucasdaddiego/peso: its spliced, vintage-pinned `series.v1.json`, which its
own watch bumps every month. This module regenerates `data/cpi_monthly.json` from that artifact,
from the reference month (POVERTY_LINES["period"]) to peso's vintage. peso rebases the whole series
on every bump (its vintage month = 100), so the file is rewritten whole, never appended.

Two modes:
  (default)  detect — fetch the artifact, render the block, compare it with the committed file and
             emit GitHub step outputs: status = unchanged | changed | source_unreachable | invalid.
             The last two also write an issue body (ISSUE_BODY_FILE) for a tracking issue.
  --apply    write the rendered block to data/cpi_monthly.json. The workflow then runs `make data`
             (which embeds the block in the percentiles artifact) and the tests, and pushes.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from typing import Any

from . import config
from .watch import emit_outputs

PESO_ARTIFACT_URL = "https://peso.daddiego.com.ar/series.v1.json"
IPC_SERIES_ID = "148.3_INIVELNAL_DICI_M_26"  # INDEC IPC Nacional nivel general, datos.gob.ar
SOURCE_TEMPLATE = (
    "INDEC IPC Nacional (serie {series_id} vía datos.gob.ar), "
    "empalme de lucasdaddiego/peso series.v1.json, vintage {vintage}"
)
UA = "Mozilla/5.0 (argentina-income-percentile cpi-sync)"
TIMEOUT = 60
MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
CPI_FILE = config.CPI_MONTHLY_FILE
REFERENCE_MONTH = str(config.POVERTY_LINES["period"])  # the month the survey's incomes refer to


def enumerate_months(start: str, end: str) -> list[str]:
    """'2025-11', '2026-02' -> ['2025-11', '2025-12', '2026-01', '2026-02'] (empty when end < start)."""
    y, m = int(start[:4]), int(start[5:7])
    out: list[str] = []
    while (cur := f"{y:04d}-{m:02d}") <= end:
        out.append(cur)
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def fetch_artifact(url: str = PESO_ARTIFACT_URL) -> dict[str, Any] | None:
    """peso's artifact as a dict, or None when it cannot be fetched or parsed."""
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            payload = json.loads(resp.read())
    except urllib.error.URLError, OSError, ValueError:
        return None
    return payload if isinstance(payload, dict) else None


def render(art: dict[str, Any], reference_month: str) -> dict[str, Any]:
    """The cpi_monthly.json document for `art`; ValueError names what is wrong with the artifact."""
    if art.get("schema_version") != 1:
        raise ValueError(f"unexpected schema_version {art.get('schema_version')!r}")
    vintage = art.get("vintage")
    if not isinstance(vintage, str) or not MONTH_RE.match(vintage):
        raise ValueError(f"bad vintage {vintage!r}")
    rows = art.get("series")
    if not isinstance(rows, list):
        raise ValueError("series is not a list")
    by_month: dict[str, float] = {}
    for row in rows:
        if isinstance(row, dict) and isinstance(row.get("m"), str) and isinstance(row.get("cpi"), int | float):
            by_month[row["m"]] = float(row["cpi"])
    months = enumerate_months(reference_month, vintage)
    if not months:
        raise ValueError(f"vintage {vintage} is before the reference month {reference_month}")
    missing = [m for m in months if m not in by_month]
    if missing:
        raise ValueError(f"months missing from the series: {', '.join(missing)}")
    return {
        "schema_version": 1,
        "peso_vintage": vintage,
        "peso_vintage_label": str(art.get("vintage_label", "")),
        "source": SOURCE_TEMPLATE.format(series_id=IPC_SERIES_ID, vintage=vintage),
        "months": [{"period": m, "index": by_month[m]} for m in months],
    }


def current() -> dict[str, Any] | None:
    """The committed cpi_monthly.json, or None when there is none yet."""
    try:
        doc: dict[str, Any] = json.loads(CPI_FILE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    return doc


def write(doc: dict[str, Any]) -> None:
    CPI_FILE.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def resolve(reference_month: str = REFERENCE_MONTH) -> tuple[str, dict[str, Any] | None, str]:
    """(status, rendered document or None, detail): the one decision both modes share."""
    art = fetch_artifact()
    if art is None:
        return "source_unreachable", None, PESO_ARTIFACT_URL
    try:
        doc = render(art, reference_month)
    except ValueError as exc:
        return "invalid", None, str(exc)
    status = "unchanged" if current() == doc else "changed"
    return status, doc, doc["peso_vintage"]


def issue_title(status: str) -> str:
    if status == "source_unreachable":
        return "Data: peso's series.v1.json is unreachable (CPI sync)"
    return "Data: peso's series.v1.json no longer fits the CPI sync"


def issue_body(status: str, detail: str) -> str:
    if status == "source_unreachable":
        return (
            "The CPI sync could not fetch or parse peso's published artifact:\n\n"
            f"```\n{detail}\n```\n\n"
            "The site may be down or the file moved. Check https://github.com/lucasdaddiego/peso "
            "(`web/public/series.v1.json`) and `PESO_ARTIFACT_URL` in `pipeline/cpi_sync.py`.\n"
        )
    return (
        "peso's `series.v1.json` was fetched, but the CPI sync could not render the block from it:\n\n"
        f"```\n{detail}\n```\n\n"
        "Its schema may have changed, or a month between the survey's reference month and its "
        "vintage is missing. Adjust `pipeline/cpi_sync.py` (or the artifact) and re-run the sync.\n"
    )


def detect() -> int:
    status, doc, detail = resolve()
    needs_issue = doc is None
    body_file = os.environ.get("ISSUE_BODY_FILE", "cpi-sync-body.md")
    if needs_issue:
        with open(body_file, "w", encoding="utf-8") as f:
            f.write(issue_body(status, detail))
    emit_outputs(
        {
            "status": status,
            "needs_issue": str(needs_issue).lower(),
            "issue_title": issue_title(status),
            "issue_body_file": body_file,
            "peso_vintage": doc["peso_vintage"] if doc else "",
            "peso_vintage_label": doc["peso_vintage_label"] if doc else "",
        }
    )
    print(f"[cpi-sync] artifact       : {PESO_ARTIFACT_URL}")
    print(f"[cpi-sync] peso vintage   : {doc['peso_vintage'] if doc else 'n/a'}")
    print(f"[cpi-sync] status         : {status}  (issue={needs_issue}; {detail})")
    return 0


def apply() -> int:
    """Write data/cpi_monthly.json from the artifact: 0 written, 1 unreachable, 2 invalid."""
    status, doc, detail = resolve()
    if doc is None:
        print(f"[apply] {status}: {detail}", file=sys.stderr)
        return 1 if status == "source_unreachable" else 2
    write(doc)
    print(f"[apply] wrote {CPI_FILE.name}: {len(doc['months'])} months through {doc['peso_vintage']} ({status})")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="CPI block sync from peso's published artifact")
    parser.add_argument("--apply", action="store_true", help="write data/cpi_monthly.json from the artifact")
    args = parser.parse_args()
    return apply() if args.apply else detect()


if __name__ == "__main__":
    raise SystemExit(main())
