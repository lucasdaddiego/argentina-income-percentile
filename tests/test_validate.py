"""Gate.check (rel/absolute, pass/fail) and validate() against a hand-built artifact: the
HARD-gate PASS path, the FAIL -> sys.exit(1) path, and the __main__ entry. Offline (the
cross-check's load_individual is monkeypatched to the synthetic df)."""

from __future__ import annotations

import json
import runpy

import pytest

from pipeline import config, load, validate

# runpy.run_module on an already-imported package warns harmlessly; ignore just that.
pytestmark = pytest.mark.filterwarnings("ignore:.*found in sys.modules:RuntimeWarning")


def _ipcf_deciles():
    return [
        {"decile": d, "hasta": (None if d == 10 else d * 100000), "mean": d * 100000, "share": 10.0}
        for d in range(1, 11)
    ]


def _artifact():
    return {
        "measures": {
            "ipcf": {
                "gini": 0.42,
                "mean": 600000.0,
                "median": 450000.0,
                "population": 30000000,
                "deciles": _ipcf_deciles(),
            },
            "individual": {"deciles": [{"decile": d, "mean": d * 120000} for d in range(1, 11)]},
        },
    }


def _ref(mean=600000):
    return {
        "gini": 0.42,
        "mean": mean,
        "median": 450000,
        "population": 30000000,
        "d10_d1_median_gap": 13,
        "deciles": _ipcf_deciles(),
    }


def _setup(tmp_path, monkeypatch, loaded_df, *, ref):
    art_path = tmp_path / "art.json"
    art_path.write_text(json.dumps(_artifact()), encoding="utf-8")
    monkeypatch.setattr(config, "ARTIFACT_PATHS", [art_path])
    monkeypatch.setattr(config, "INDEC_IPCF_Q4_2025", ref)
    monkeypatch.setattr(load, "load_individual", lambda: loaded_df)


# --- Gate.check unit coverage (rel/absolute x pass/fail, and rel with expected==0) ---


def test_gate_absolute_pass_and_fail(capsys):
    g = validate.Gate()
    assert g.check("a", 1.0, 1.0, 0.5) is True
    assert g.check("b", 10.0, 1.0, 0.5) is False
    assert g.failures == 1
    out = capsys.readouterr().out
    assert "PASS" in out and "FAIL" in out


def test_gate_relative_pass_and_zero_expected(capsys):
    g = validate.Gate()
    assert g.check("a", 1.01, 1.0, 0.05, rel=True) is True
    # expected == 0 short-circuits to a failure (no division).
    assert g.check("b", 5.0, 0.0, 0.05, rel=True) is False
    assert g.failures == 1


# --- validate() integration ---


def test_validate_passes(tmp_path, monkeypatch, loaded_df, capsys):
    _setup(tmp_path, monkeypatch, loaded_df, ref=_ref())
    validate.validate()  # g.failures == 0 -> no exit
    assert "VALIDATION PASSED" in capsys.readouterr().out


def test_validate_fails_exits_1(tmp_path, monkeypatch, loaded_df, capsys):
    # Anchor the INDEC mean 10x off -> the HARD mean check fails -> sys.exit(1).
    _setup(tmp_path, monkeypatch, loaded_df, ref=_ref(mean=6_000_000))
    with pytest.raises(SystemExit) as exc:
        validate.validate()
    assert exc.value.code == 1
    assert "VALIDATION FAILED" in capsys.readouterr().out


def test_validate_main(tmp_path, monkeypatch, loaded_df):
    _setup(tmp_path, monkeypatch, loaded_df, ref=_ref())
    runpy.run_module("pipeline.validate", run_name="__main__")  # PASS path, no exit
