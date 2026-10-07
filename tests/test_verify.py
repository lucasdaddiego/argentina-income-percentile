"""sha256, _read_pinned (comment/blank skipping, missing file), verify (first-use pin, OK,
mismatch, missing zip) and the __main__ success + error->exit(1) paths."""

from __future__ import annotations

import hashlib
import runpy

import pytest

from pipeline import config, verify

# runpy.run_module on an already-imported package warns harmlessly; ignore just that.
pytestmark = pytest.mark.filterwarnings("ignore:.*found in sys.modules:RuntimeWarning")


def _write_zip(raw, content=b"PK\x03\x04fake-zip-bytes"):
    raw.mkdir(exist_ok=True)
    (raw / config.ZIP_NAME).write_bytes(content)


def test_sha256_matches_hashlib(tmp_path):
    p = tmp_path / "blob.bin"
    p.write_bytes(b"hello world" * 1000)
    assert verify.sha256(p) == hashlib.sha256(b"hello world" * 1000).hexdigest()


def test_read_pinned_missing_file(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CHECKSUMS_FILE", tmp_path / "nope.txt")
    assert verify._read_pinned() == {}


def test_read_pinned_skips_comments_and_blanks(tmp_path, monkeypatch):
    f = tmp_path / "checksums.txt"
    f.write_text("# a comment\n\n  \nabc123  EPH.zip\ndef456  other.zip\n")
    monkeypatch.setattr(config, "CHECKSUMS_FILE", f)
    pinned = verify._read_pinned()
    assert pinned == {"EPH.zip": "abc123", "other.zip": "def456"}


def test_verify_first_use_pins(tmp_path, monkeypatch, capsys):
    raw = tmp_path / "raw"
    _write_zip(raw)
    monkeypatch.setattr(config, "RAW_DIR", raw)
    monkeypatch.setattr(config, "CHECKSUMS_FILE", tmp_path / "checksums.txt")
    digest = verify.verify()
    assert config.CHECKSUMS_FILE.exists()
    assert digest in config.CHECKSUMS_FILE.read_text()
    assert "first use" in capsys.readouterr().out


def test_verify_ok_on_match(tmp_path, monkeypatch, capsys):
    raw = tmp_path / "raw"
    _write_zip(raw)
    digest = verify.sha256(raw / config.ZIP_NAME)
    checks = tmp_path / "checksums.txt"
    checks.write_text(f"{digest}  {config.ZIP_NAME}\n")
    monkeypatch.setattr(config, "RAW_DIR", raw)
    monkeypatch.setattr(config, "CHECKSUMS_FILE", checks)
    assert verify.verify() == digest
    assert "OK" in capsys.readouterr().out


def test_verify_mismatch_raises(tmp_path, monkeypatch):
    raw = tmp_path / "raw"
    _write_zip(raw)
    checks = tmp_path / "checksums.txt"
    checks.write_text(f"{'0' * 64}  {config.ZIP_NAME}\n")
    monkeypatch.setattr(config, "RAW_DIR", raw)
    monkeypatch.setattr(config, "CHECKSUMS_FILE", checks)
    with pytest.raises(ValueError, match="CHECKSUM MISMATCH") as exc:
        verify.verify()
    assert "re-pin intentionally" in str(exc.value)
    assert "NOT a zip" not in str(exc.value)


def test_verify_mismatch_on_a_non_zip_says_so(tmp_path, monkeypatch):
    # A saved HTML page (INDEC's 200 "not found") must not be mistaken for a changed source: the
    # usual advice, re-pinning, would pin the page.
    raw = tmp_path / "raw"
    _write_zip(raw, content=b"<!DOCTYPE html><html>No encontrado</html>")
    checks = tmp_path / "checksums.txt"
    checks.write_text(f"{'0' * 64}  {config.ZIP_NAME}\n")
    monkeypatch.setattr(config, "RAW_DIR", raw)
    monkeypatch.setattr(config, "CHECKSUMS_FILE", checks)
    with pytest.raises(ValueError, match="NOT a zip") as exc:
        verify.verify()
    assert "Do not re-pin" in str(exc.value)
    assert "check ZIP_URL" in str(exc.value)


def test_verify_missing_zip_raises(tmp_path, monkeypatch):
    raw = tmp_path / "raw"
    raw.mkdir()
    monkeypatch.setattr(config, "RAW_DIR", raw)
    with pytest.raises(FileNotFoundError, match="make fetch"):
        verify.verify()


def test_main_success(tmp_path, monkeypatch):
    raw = tmp_path / "raw"
    _write_zip(raw)
    monkeypatch.setattr(config, "RAW_DIR", raw)
    monkeypatch.setattr(config, "CHECKSUMS_FILE", tmp_path / "checksums.txt")
    runpy.run_module("pipeline.verify", run_name="__main__")  # try: verify() succeeds


def test_main_error_exits_1(tmp_path, monkeypatch, capsys):
    raw = tmp_path / "raw"
    raw.mkdir()  # no zip -> verify() raises -> except -> sys.exit(1)
    monkeypatch.setattr(config, "RAW_DIR", raw)
    with pytest.raises(SystemExit) as exc:
        runpy.run_module("pipeline.verify", run_name="__main__")
    assert exc.value.code == 1
    assert "ERROR" in capsys.readouterr().err
