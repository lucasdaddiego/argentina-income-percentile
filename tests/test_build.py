"""The per-section builders (measure/regions/aglomerados/splits) run directly on the synthetic
df, then build() end-to-end offline (verify -> load -> write artifacts), plus __main__."""

from __future__ import annotations

import json
import runpy

import pytest

from pipeline import build, config, load, verify

# runpy.run_module on an already-imported package warns harmlessly; ignore just that.
pytestmark = pytest.mark.filterwarnings("ignore:.*found in sys.modules:RuntimeWarning")


def test_build_measure_ipcf(loaded_df):
    m = build.build_measure(loaded_df, config.MEASURES["ipcf"])
    assert m["key"] == "ipcf"
    assert m["weight"] == "PONDIH"
    assert m["population"] > 0
    assert m["n_unweighted"] == len(load.universe(loaded_df, config.MEASURES["ipcf"]))
    assert 0.0 <= m["gini"] <= 1.0
    assert len(m["deciles"]) == 10
    assert len(m["lorenz"]) == 101
    # Percentiles include the finer upper tail.
    assert {"99.5", "99.9", "99.99"} <= set(m["percentiles"])
    assert m["cap"] > 0


def test_build_measure_individual(loaded_df):
    m = build.build_measure(loaded_df, config.MEASURES["individual"])
    assert m["key"] == "individual"
    assert m["value_col"] == "P47T"
    assert m["median"] > 0


def test_build_regions(loaded_df):
    regions = build.build_regions(loaded_df)
    codes = {r["code"] for r in regions}
    # Only the regions present in the data appear (others hit the len==0 continue).
    assert codes == {1, 43, 44}
    assert codes.isdisjoint({40, 41, 42})
    # Sorted by descending median.
    medians = [r["median"] for r in regions]
    assert medians == sorted(medians, reverse=True)
    assert all(set(r) == {"code", "name", "median", "mean", "population", "n_unweighted"} for r in regions)
    # Same universe as the headline IPCF measure — the fixture's blank-decile person is outside
    # both, so the regional rows partition it exactly (records and expanded population).
    u = load.universe(loaded_df, config.MEASURES["ipcf"])
    assert sum(r["n_unweighted"] for r in regions) == len(u)
    assert sum(r["population"] for r in regions) == round(float(u["weight"].sum()))


def test_build_aglomerados(loaded_df):
    aglos = build.build_aglomerados(loaded_df)
    codes = {a["code"] for a in aglos}
    assert codes == {32, 33, 2}
    assert all("p25" in a and "p75" in a for a in aglos)
    medians = [a["median"] for a in aglos]
    assert medians == sorted(medians, reverse=True)
    u = load.universe(loaded_df, config.MEASURES["ipcf"])
    assert sum(a["n_unweighted"] for a in aglos) == len(u)
    assert sum(a["population"] for a in aglos) == round(float(u["weight"].sum()))


def test_build_splits(loaded_df, monkeypatch):
    monkeypatch.setattr(config, "SPLIT_MIN_N", 2)
    splits = build.build_splits(loaded_df)
    assert set(splits) == {"sexo", "educacion", "cat_ocup", "sector"}
    # sexo: both sexes survive the n>=2 threshold.
    sexo_keys = {g["key"] for g in splits["sexo"]["groups"]}
    assert sexo_keys == {"1", "2"}
    # sector: PP04A=1 has a single perceptor (< SPLIT_MIN_N) -> dropped; PP04A=2 kept.
    sector_keys = {g["key"] for g in splits["sector"]["groups"]}
    assert sector_keys == {"2"}
    for g in splits["sexo"]["groups"]:
        assert g["n"] >= 2
        assert len(g["percentiles"]) == 99


def test_build_splits_sector_counts_asalariados_only(loaded_df, monkeypatch):
    """PP04A is answered by every ocupado. The panel is labeled "Sector (asalariados)", so its
    "Privado" group must not pick up the patrones / cuentapropistas (CAT_OCUP 1/2) or the
    CAT_OCUP=0 perceptor that also carry PP04A=2 in the fixture."""
    monkeypatch.setattr(config, "SPLIT_MIN_N", 2)
    privado = next(g for g in build.build_splits(loaded_df)["sector"]["groups"] if g["key"] == "2")
    perceptores = loaded_df[loaded_df["DECINDR"].between(1, 10).fillna(False)]
    perceptores = perceptores[(perceptores["PONDII"] > 0) & (perceptores["P47T"] > 0)]
    asalariados = perceptores[(perceptores["PP04A"] == 2) & (perceptores["CAT_OCUP"] == 3)]
    assert len(perceptores[perceptores["PP04A"] == 2]) > len(asalariados)  # the fixture mixes categories
    assert privado["n"] == len(asalariados)


def test_build_splits_high_threshold_drops_everything(loaded_df, monkeypatch):
    # With the real SPLIT_MIN_N=200 our tiny base yields no surviving groups (all dropped).
    monkeypatch.setattr(config, "SPLIT_MIN_N", 200)
    splits = build.build_splits(loaded_df)
    assert all(s["groups"] == [] for s in splits.values())


def _patch_artifacts(tmp_path, monkeypatch):
    paths = [tmp_path / "data" / "percentiles.v1.json", tmp_path / "web" / "public" / "percentiles.v1.json"]
    monkeypatch.setattr(config, "ARTIFACT_PATHS", paths)
    monkeypatch.setattr(config, "SPLIT_MIN_N", 2)
    return paths


def test_build_end_to_end(eph_raw, tmp_path, monkeypatch):
    paths = _patch_artifacts(tmp_path, monkeypatch)
    artifact = build.build()
    expected_keys = {
        "schema_version",
        "generated_at",
        "currency",
        "hero_measure",
        "source",
        "measures",
        "regions",
        "aglomerados",
        "splits",
        "poverty_lines",
        "indec_reference_ipcf",
        "history",
        "cpi_monthly",
        "cost_of_living",
        "citation",
    }
    assert set(artifact) == expected_keys
    assert set(artifact["measures"]) == {"individual", "ipcf"}
    assert artifact["source"]["sha256"] == verify.sha256(eph_raw / config.ZIP_NAME)
    # Both artifact copies were written and are valid, identical JSON.
    for p in paths:
        assert p.exists()
        assert json.loads(p.read_text(encoding="utf-8"))["schema_version"] == build.SCHEMA_VERSION


def test_build_main_success(tmp_path, monkeypatch, loaded_df):
    # Stub the I/O-heavy deps so __main__ exercises the try-block without re-reading the zip.
    _patch_artifacts(tmp_path, monkeypatch)
    monkeypatch.setattr(verify, "verify", lambda: "deadbeef")
    monkeypatch.setattr(load, "load_individual", lambda: loaded_df)
    runpy.run_module("pipeline.build", run_name="__main__")
    assert config.ARTIFACT_PATHS[0].exists()


def test_build_main_error_reraises(tmp_path, monkeypatch):
    def _raise():
        raise RuntimeError("boom")

    monkeypatch.setattr(verify, "verify", _raise)
    with pytest.raises(RuntimeError, match="boom"):
        runpy.run_module("pipeline.build", run_name="__main__")
