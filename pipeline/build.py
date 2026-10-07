"""Compute weighted statistics for each measure and emit the versioned JSON artifact."""

from __future__ import annotations

import json
import sys
from datetime import UTC, datetime
from typing import TypedDict

import pandas as pd

from . import config, load, verify, weighted

SCHEMA_VERSION = 1


class RegionRow(TypedDict):
    code: int
    name: str
    median: float
    mean: float
    population: int
    n_unweighted: int


class AglomeradoRow(TypedDict):
    code: int
    name: str
    median: float
    mean: float
    p25: float
    p75: float
    population: int
    n_unweighted: int


def build_measure(df: pd.DataFrame, measure: config.MeasureSpec) -> dict:
    """Weighted distribution for one measure: mean/median/gini, percentiles, deciles,
    histogram and Lorenz ordinates, packaged as the measure dict the artifact ships."""
    u = load.universe(df, measure)
    v = u["value"].to_numpy(dtype=float)
    w = u["weight"].to_numpy(dtype=float)

    lorenz, gini = weighted.lorenz_and_gini(v, w)
    # Percentiles 1..99 plus a finer upper tail so the charts can extend past p99.
    pct_list = [*range(1, 100), 99.5, 99.9, 99.99]
    # Default chart ceiling: p99.9 (much higher than p99, still excludes the extreme outliers).
    cap = round(float(weighted.weighted_quantile(v, w, 0.999)), 2)
    return {
        "key": measure["key"],
        "label": measure["label"],
        "short": measure["short"],
        "universe": measure["universe"],
        "value_col": measure["value_col"],
        "weight": measure["weight_col"],
        "n_unweighted": len(u),
        "population": round(float(w.sum())),
        "mean": round(weighted.weighted_mean(v, w), 2),
        "median": round(float(weighted.weighted_quantile(v, w, 0.5)), 2),
        "gini": round(gini, 4),
        "cap": cap,
        "percentiles": weighted.percentiles(v, w, pct_list),
        "deciles": weighted.decile_table(v, w),
        "histogram": weighted.weighted_histogram(v, w, n_bins=48, cap_q=0.999),
        "lorenz": lorenz,
    }


def build_regions(df: pd.DataFrame) -> list[RegionRow]:
    """Per-region IPCF median/mean/population, weighted by PONDIH (same universe as the IPCF measure)."""
    m = config.MEASURES["ipcf"]
    val, wgt, dec = m["value_col"], m["weight_col"], m["decile_col"]
    # Exactly load.universe()'s IPCF filter: sentinels 12/13 out, and blank decile codes out too
    # (`isin()` is False for <NA>, so `notna()` is what actually drops them). Without it the
    # regional populations would not sum to measures.ipcf.population.
    keep = ~df[dec].isin([config.DECILE_NONRESPONSE_I, config.DECILE_NO_INTERVIEW_I]) & df[dec].notna()
    sub = df.loc[keep, [config.REGION_COL, val, wgt]].dropna(subset=[val, wgt])
    sub = sub[(sub[wgt] > 0) & (sub[val] >= 0)]
    out: list[RegionRow] = []
    for code, name in config.REGION_NAMES.items():
        r = sub[sub[config.REGION_COL] == code]
        if len(r) == 0:
            continue
        v = r[val].to_numpy(dtype=float)
        w = r[wgt].to_numpy(dtype=float)
        out.append(
            {
                "code": int(code),
                "name": name,
                "median": round(float(weighted.weighted_quantile(v, w, 0.5)), 2),
                "mean": round(weighted.weighted_mean(v, w), 2),
                "population": round(float(w.sum())),
                "n_unweighted": len(r),
            }
        )
    out.sort(key=lambda x: -x["median"])
    return out


def build_aglomerados(df: pd.DataFrame) -> list[AglomeradoRow]:
    """Per-aglomerado IPCF median/mean/quartiles (the 31 EPH urban agglomerates + CABA)."""
    m = config.MEASURES["ipcf"]
    val, wgt, dec = m["value_col"], m["weight_col"], m["decile_col"]
    keep = ~df[dec].isin([config.DECILE_NONRESPONSE_I, config.DECILE_NO_INTERVIEW_I]) & df[dec].notna()
    sub = df.loc[keep, [config.AGLOMERADO_COL, val, wgt]].dropna(subset=[val, wgt])
    sub = sub[(sub[wgt] > 0) & (sub[val] >= 0)]
    out: list[AglomeradoRow] = []
    for code, name in config.AGLOMERADO_NAMES.items():
        r = sub[sub[config.AGLOMERADO_COL] == code]
        if len(r) == 0:
            continue
        v = r[val].to_numpy(dtype=float)
        w = r[wgt].to_numpy(dtype=float)
        out.append(
            {
                "code": int(code),
                "name": name,
                "median": round(float(weighted.weighted_quantile(v, w, 0.5)), 2),
                "mean": round(weighted.weighted_mean(v, w), 2),
                "p25": round(float(weighted.weighted_quantile(v, w, 0.25)), 2),
                "p75": round(float(weighted.weighted_quantile(v, w, 0.75)), 2),
                "population": round(float(w.sum())),
                "n_unweighted": len(r),
            }
        )
    out.sort(key=lambda x: -x["median"])
    return out


def build_splits(df: pd.DataFrame) -> dict:
    """Median/mean/quartiles + percentile curve of individual income (P47T, PONDII) for each
    structural group (sex, education, occupation category, sector). Low-n groups are dropped."""
    m = config.MEASURES["individual"]
    val, wgt, dec = m["value_col"], m["weight_col"], m["decile_col"]
    keep = df[dec].between(1, 10).fillna(False)  # perceptores; unknown decile codes excluded
    base = df.loc[keep].dropna(subset=[val, wgt])
    base = base[(base[wgt] > 0) & (base[val] > 0)]
    pct_list = list(range(1, 100))
    out = {}
    for key, spec in config.SPLITS.items():
        sub = base
        for col, required in spec.get("where", {}).items():
            sub = sub[pd.to_numeric(sub[col], errors="coerce") == required]
        codes = pd.to_numeric(sub[spec["col"]], errors="coerce")
        groups = []
        for code, label in spec["groups"].items():
            g = sub[codes == code]
            if len(g) < config.SPLIT_MIN_N:
                continue
            v = g[val].to_numpy(dtype=float)
            w = g[wgt].to_numpy(dtype=float)
            groups.append(
                {
                    "key": str(code),
                    "label": label,
                    "median": round(float(weighted.weighted_quantile(v, w, 0.5)), 2),
                    "mean": round(weighted.weighted_mean(v, w), 2),
                    "p25": round(float(weighted.weighted_quantile(v, w, 0.25)), 2),
                    "p75": round(float(weighted.weighted_quantile(v, w, 0.75)), 2),
                    "n": len(g),
                    "population": round(float(w.sum())),
                    "percentiles": weighted.percentiles(v, w, pct_list),
                }
            )
        out[key] = {"label": spec["label"], "groups": groups}
    return out


def build() -> dict:
    digest = verify.verify()
    print("[build] loading individual base …")
    df = load.load_individual()
    print(f"[build] {len(df):,} person records read")

    measures = {}
    for key, m in config.MEASURES.items():
        print(f"[build] computing measure '{key}' ({m['value_col']} × {m['weight_col']}) …")
        measures[key] = build_measure(df, m)
        mm = measures[key]
        print(
            f"        n={mm['n_unweighted']:,}  pop={mm['population']:,}  "
            f"median=${mm['median']:,.0f}  gini={mm['gini']}"
        )

    artifact = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "currency": "ARS",
        "hero_measure": config.HERO_MEASURE,
        "source": {
            "survey": "EPH",
            "period": config.QUARTER,
            "period_label": config.QUARTER_LABEL,
            "file": config.INDIVIDUAL_FILE,
            "sha256": digest,
            "url": config.ZIP_URL,
        },
        "measures": measures,
        "regions": build_regions(df),
        "aglomerados": build_aglomerados(df),
        "splits": build_splits(df),
        "poverty_lines": config.POVERTY_LINES,
        "indec_reference_ipcf": config.INDEC_IPCF_Q4_2025,
        "history": config.HISTORY,
        "cpi_monthly": config.CPI_MONTHLY,
        "cost_of_living": config.COST_OF_LIVING,
        "citation": config.CITATION,
    }

    payload = json.dumps(artifact, ensure_ascii=False, indent=2)
    for path in config.ARTIFACT_PATHS:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(payload, encoding="utf-8")
        print(f"[build] wrote {path} ({len(payload):,} bytes)")
    return artifact


if __name__ == "__main__":
    try:
        build()
    except Exception as exc:
        print(f"[build] ERROR: {exc}", file=sys.stderr)
        raise
