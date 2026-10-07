"""fetch(): the already-present short-circuit and the download branch (urlopen mocked), plus
the __main__ success path and the error->exit(1) path. Never touches the network."""

from __future__ import annotations

import runpy
import urllib.error
import urllib.request

import pytest

from pipeline import config, fetch

# runpy.run_module on an already-imported package warns harmlessly; ignore just that.
pytestmark = pytest.mark.filterwarnings("ignore:.*found in sys.modules:RuntimeWarning")


ZIP = b"PK\x03\x04" + b"rest-of-a-zip"


class _FakeResp:
    """Minimal stand-in for the urlopen context manager."""

    def __init__(self, data: bytes, ctype: str = "application/zip"):
        self._data = data
        self.headers = {"Content-Type": ctype}

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self) -> bytes:
        return self._data


def test_fetch_already_present(tmp_path, monkeypatch, capsys):
    raw = tmp_path / "raw"
    raw.mkdir()
    (raw / config.ZIP_NAME).write_bytes(b"already here")
    monkeypatch.setattr(config, "RAW_DIR", raw)
    # If this tried to download it would crash (no network); it must short-circuit.
    monkeypatch.setattr(urllib.request, "urlopen", _boom)
    fetch.fetch()
    assert "already present" in capsys.readouterr().out


def _boom(*a, **k):
    raise AssertionError("urlopen must not be called")


def test_fetch_downloads(tmp_path, monkeypatch, capsys):
    raw = tmp_path / "raw"  # does not exist yet -> mkdir(parents=True) path
    monkeypatch.setattr(config, "RAW_DIR", raw)
    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout=0: _FakeResp(ZIP))
    fetch.fetch()
    dest = raw / config.ZIP_NAME
    assert dest.read_bytes() == ZIP
    assert "saved" in capsys.readouterr().out


def test_fetch_rejects_a_non_zip_body(tmp_path, monkeypatch):
    # INDEC answers HTTP 200 with an HTML "not found" page for a moved file. Saving it would make
    # verify.py report a bare checksum mismatch whose advice (re-pin) pins the HTML page.
    raw = tmp_path / "raw"
    monkeypatch.setattr(config, "RAW_DIR", raw)
    html = b"<!DOCTYPE html><html><body>No encontrado</body></html>"
    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout=0: _FakeResp(html, "text/html; charset=utf-8"))
    with pytest.raises(ValueError, match=r"did not return a zip.*text/html.*check ZIP_URL"):
        fetch.fetch()
    assert not (raw / config.ZIP_NAME).exists()  # nothing written


def test_fetch_redownloads_empty_file(tmp_path, monkeypatch):
    # dest exists but is 0 bytes -> the `st_size > 0` half is False -> still downloads.
    raw = tmp_path / "raw"
    raw.mkdir()
    (raw / config.ZIP_NAME).write_bytes(b"")
    monkeypatch.setattr(config, "RAW_DIR", raw)
    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout=0: _FakeResp(ZIP))
    fetch.fetch()
    assert (raw / config.ZIP_NAME).read_bytes() == ZIP


def test_main_success(tmp_path, monkeypatch):
    raw = tmp_path / "raw"
    raw.mkdir()
    (raw / config.ZIP_NAME).write_bytes(b"present")
    monkeypatch.setattr(config, "RAW_DIR", raw)
    runpy.run_module("pipeline.fetch", run_name="__main__")  # try: fetch() returns cleanly


def test_main_error_exits_1(tmp_path, monkeypatch, capsys):
    raw = tmp_path / "raw"
    monkeypatch.setattr(config, "RAW_DIR", raw)

    def _raise(*a, **k):
        raise urllib.error.URLError("offline")

    monkeypatch.setattr(urllib.request, "urlopen", _raise)
    with pytest.raises(SystemExit) as exc:
        runpy.run_module("pipeline.fetch", run_name="__main__")
    assert exc.value.code == 1
    assert "ERROR" in capsys.readouterr().err
