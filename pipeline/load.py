"""Load and filter the INDEC EPH individual base into clean per-measure frames.

IPCF and ITF live in the individual base, so no household join is needed for v1.
The household join (CODUSU + NRO_HOGAR) is available if regional/household features are added.
"""

from __future__ import annotations

import zipfile

import pandas as pd

from . import config

# Columns we actually use (of the 235 in the base).
# CODUSU + NRO_HOGAR are kept as the household-join keys (see module docstring); CH04/NIVEL_ED/
# CAT_OCUP/PP04A drive the structural splits; the rest are income values, weights and deciles.
USECOLS = [
    "CODUSU",
    "NRO_HOGAR",
    "COMPONENTE",
    "REGION",
    "AGLOMERADO",
    "CH04",
    "NIVEL_ED",
    "CAT_OCUP",
    "PP04A",
    "P21",
    "P47T",
    "ITF",
    "IPCF",
    "PONDERA",
    "PONDII",
    "PONDIH",
    "PONDIIO",
    "DECCFR",
    "DECINDR",
    "DECOCUR",
    "DECIFR",
]
DECILE_COLS = ["DECCFR", "DECINDR", "DECOCUR", "DECIFR"]


def ensure_extracted() -> None:
    ind = config.RAW_DIR / config.INDIVIDUAL_FILE
    if ind.exists():
        return
    zip_path = config.RAW_DIR / config.ZIP_NAME
    if not zip_path.exists():
        raise FileNotFoundError(f"missing {zip_path} — run `make fetch` first")
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(config.RAW_DIR)


def load_individual() -> pd.DataFrame:
    """Read the individual base with only the columns we need; decile codes as strings."""
    ensure_extracted()
    path = config.RAW_DIR / config.INDIVIDUAL_FILE
    df = pd.read_csv(
        path,
        sep=config.CSV_SEP,
        encoding=config.CSV_ENCODING,
        usecols=USECOLS,
        dtype=dict.fromkeys(DECILE_COLS, "string"),
        na_values=config.NA_VALUES,
        decimal=",",  # IPCF/ITF are N(10,2) with comma decimals (e.g. "450000,00")
        low_memory=False,
    )
    # Normalize decile codes → nullable Int (00, 1..10, 12, 13). Blank → <NA>.
    for c in DECILE_COLS:
        df[c] = pd.to_numeric(df[c].str.strip(), errors="coerce").astype("Int64")
    return df


def universe(df: pd.DataFrame, measure: config.MeasureSpec) -> pd.DataFrame:
    """Return a clean (value, weight) frame for one measure, matching INDEC's universe.

    - Drop decile sentinels 12 (no respuesta) and 13 (entrevista no realizada) always.
    - individual (P47T): keep perceptores only (decile 1..10; excludes sin-ingresos code 0).
    - ipcf: keep the whole population (decile 0..10; sin-ingresos sit at the start of decile 1).
    - Require a finite value and a strictly positive weight.
    """
    val, wgt, dec = measure["value_col"], measure["weight_col"], measure["decile_col"]
    code = df[dec]
    keep = ~code.isin([config.DECILE_NONRESPONSE_I, config.DECILE_NO_INTERVIEW_I])
    if not measure["include_zero"]:
        keep &= code.ne(config.DECILE_NO_INCOME_I)
    # Treat blank/unknown decile codes as excluded for BOTH measures — the universe is defined by
    # the decile label. `isin()` returns False for <NA>, so without the explicit `code.notna()` a
    # blank-decile row would slip into the ipcf universe (it only gets dropped for `individual`,
    # where `code.ne(0)` happens to inject the <NA> that `fillna(False)` then clears).
    keep = keep.fillna(False) & code.notna()
    out = df.loc[keep, [val, wgt]].rename(columns={val: "value", wgt: "weight"})
    out = out.dropna(subset=["value", "weight"])
    out = out[out["weight"] > 0]
    # individual: strictly positive (perceptores); ipcf: allow the zero-income population.
    out = out[out["value"] >= 0] if measure["include_zero"] else out[out["value"] > 0]
    return out.reset_index(drop=True)
