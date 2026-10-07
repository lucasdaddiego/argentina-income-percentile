"""Download the pinned INDEC EPH zip into data/raw/ (idempotent).

INDEC's server answers HTTP 200 with an HTML "not found" page for a moved file, so the body is
checked for the zip signature before anything is written: a saved HTML page would otherwise fail
later in verify.py as a bare "checksum mismatch" (whose advice, re-pinning, would pin the HTML).
"""

from __future__ import annotations

import sys
import urllib.request

from . import config


def fetch() -> None:
    config.RAW_DIR.mkdir(parents=True, exist_ok=True)
    dest = config.RAW_DIR / config.ZIP_NAME
    if dest.exists() and dest.stat().st_size > 0:
        print(f"[fetch] already present: {dest} ({dest.stat().st_size:,} bytes)")
        return
    print(f"[fetch] downloading {config.ZIP_URL}")
    req = urllib.request.Request(config.ZIP_URL, headers={"User-Agent": "Mozilla/5.0 (data pipeline)"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        blob = resp.read()
        ctype = resp.headers.get("Content-Type", "")
    if not blob.startswith(config.ZIP_MAGIC):
        raise ValueError(
            f"{config.ZIP_URL} did not return a zip (Content-Type {ctype!r}, body starts with {blob[:24]!r}). "
            "INDEC answers 200 with an HTML page for a moved file: check ZIP_URL in pipeline/config.py."
        )
    dest.write_bytes(blob)
    print(f"[fetch] saved {dest} ({dest.stat().st_size:,} bytes)")


if __name__ == "__main__":
    try:
        fetch()
    except Exception as exc:  # noqa: BLE001
        print(f"[fetch] ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
