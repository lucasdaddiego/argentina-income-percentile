"""Reproducibility gate: pin the source zip by SHA-256 (trust-on-first-use).

First run records the checksum in data/checksums.txt; later runs fail if the source changes,
so the build is bit-reproducible against a known input.
"""

from __future__ import annotations

import hashlib
import sys

from . import config


def sha256(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _read_pinned() -> dict[str, str]:
    pinned: dict[str, str] = {}
    if config.CHECKSUMS_FILE.exists():
        for line in config.CHECKSUMS_FILE.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            digest, name = line.split(None, 1)
            pinned[name.strip()] = digest.strip()
    return pinned


def verify() -> str:
    zip_path = config.RAW_DIR / config.ZIP_NAME
    if not zip_path.exists():
        raise FileNotFoundError(f"missing {zip_path} — run `make fetch` first")
    digest = sha256(zip_path)
    pinned = _read_pinned()
    expected = pinned.get(config.ZIP_NAME)
    if expected is None:
        config.CHECKSUMS_FILE.write_text(
            f"# SHA-256 of pinned INDEC source files (trust-on-first-use).\n{digest}  {config.ZIP_NAME}\n"
        )
        print(f"[verify] pinned {config.ZIP_NAME} = {digest} (first use)")
    elif expected != digest:
        with open(zip_path, "rb") as f:
            head = f.read(len(config.ZIP_MAGIC))
        if head != config.ZIP_MAGIC:
            # INDEC answers 200 with an HTML page for a moved file. Re-pinning would pin that page
            # and zipfile would then die with an opaque BadZipFile.
            raise ValueError(
                f"[verify] CHECKSUM MISMATCH for {config.ZIP_NAME}: the file is NOT a zip (starts with {head!r}).\n"
                f"  pinned:   {expected}\n  computed: {digest}\n"
                f"Do not re-pin. Delete data/raw/{config.ZIP_NAME}, check ZIP_URL in pipeline/config.py "
                "and run `make data` again."
            )
        raise ValueError(
            f"[verify] CHECKSUM MISMATCH for {config.ZIP_NAME}\n"
            f"  pinned:   {expected}\n  computed: {digest}\n"
            "Source changed — delete data/checksums.txt to re-pin intentionally."
        )
    else:
        print(f"[verify] OK {config.ZIP_NAME} = {digest}")
    return digest


if __name__ == "__main__":
    try:
        verify()
    except Exception as exc:  # noqa: BLE001
        print(f"[verify] ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
