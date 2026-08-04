"""Shared fixtures + a tiny synthetic EPH individual base.

Everything here is offline and deterministic: we hand-build ~40 person records that span
every code path the pipeline cares about (zero-income population, perceptores across deciles
1..10, the 12/13 sentinels, a blank decile, a zero-weight row, two regions, several
aglomerados, both sexes and a spread of NIVEL_ED/CAT_OCUP/PP04A), write them as a real
semicolon/comma-decimal/latin-1 .txt (and zip), and feed that through the real loaders.
No network, no data/raw/, never the real ~20 MB microdata.
"""

from __future__ import annotations

import sys
import zipfile
from pathlib import Path

# The app sets [tool.uv] package = false, so `pipeline` is never installed. Put the repo root
# (this file's grandparent) on sys.path so the suite imports the in-tree package, like the
# Makefile's `python -m pipeline.*` invocations do.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pandas as pd
import pytest

from pipeline import config, load

USECOLS = load.USECOLS
DECILE_COLS = load.DECILE_COLS
INCOME_COLS = ("P21", "P47T", "ITF", "IPCF")


def _income_str(x: float) -> str:
    """Comma-decimal like the real EPH file: 100000.0 -> '100000,00'."""
    return f"{float(x):.2f}".replace(".", ",")


def build_rows() -> list[dict]:
    """A synthetic EPH individual base as a list of column->value dicts (None == blank)."""
    rows: list[dict] = []
    cu = 1000

    def add(**kw):
        nonlocal cu
        cu += 1
        base = {
            "CODUSU": f"T{cu:020d}", "NRO_HOGAR": 1, "COMPONENTE": 1,
            "REGION": 1, "AGLOMERADO": 32, "CH04": 1, "NIVEL_ED": 1, "CAT_OCUP": 3, "PP04A": 2,
            "P21": 0.0, "P47T": 0.0, "ITF": 0.0, "IPCF": 0.0,
            "PONDERA": 100, "PONDII": 100, "PONDIH": 100, "PONDIIO": 100,
            "DECCFR": None, "DECINDR": None, "DECOCUR": None, "DECIFR": None,
        }
        base.update(kw)
        rows.append(base)
        return base

    # 1. Zero-income population: included by IPCF (include_zero), excluded by individual.
    for i in range(4):
        add(
            REGION=[1, 43, 44, 1][i], AGLOMERADO=[32, 33, 2, 32][i], CH04=1 + (i % 2),
            IPCF=0.0, P47T=0.0, ITF=0.0,
            DECCFR=0, DECINDR=0, DECOCUR=0, DECIFR=0, PONDIH=120 + i, PONDII=120 + i,
        )

    # 2. Perceptores across deciles 1..10 (3 rows each), spread over regions/aglos/splits.
    regions, aglos = [1, 43, 44], [32, 33, 2]
    gi = 0
    for d in range(1, 11):
        for j in range(3):
            ipcf = d * 100000.0 + j * 1000
            p47t = d * 120000.0 + j * 1500
            add(
                REGION=regions[gi % 3], AGLOMERADO=aglos[gi % 3], CH04=1 + (gi % 2),
                NIVEL_ED=1 + (gi % 6), CAT_OCUP=[1, 2, 3][gi % 3], PP04A=2,
                IPCF=ipcf, P47T=p47t, ITF=ipcf * 2, P21=p47t,
                DECCFR=d, DECINDR=d, DECOCUR=d, DECIFR=d,
                PONDIH=100 + d, PONDII=100 + d, PONDIIO=100 + d,
            )
            gi += 1
    # Exactly one perceptor with PP04A=1 -> its sector group has n=1 (< SPLIT_MIN_N=2) -> dropped.
    perceptores = [r for r in rows if r["DECINDR"] in range(1, 11)]
    perceptores[0]["PP04A"] = 1
    # And one perceptor in the excluded CAT_OCUP=0 bucket (jubilaciones/rentas).
    perceptores[1]["CAT_OCUP"] = 0

    # 3. Sentinels 12 (no respuesta) / 13 (entrevista no realizada) -> dropped everywhere.
    add(DECCFR=12, DECINDR=12, DECOCUR=12, DECIFR=12, IPCF=5e5, P47T=5e5, ITF=1e6)
    add(DECCFR=13, DECINDR=13, DECOCUR=13, DECIFR=13, IPCF=6e5, P47T=6e5, ITF=1.2e6)

    # 4. Blank/NA decile code -> exercises universe's keep.fillna(False) path.
    add(DECCFR=None, DECINDR=None, DECOCUR=None, DECIFR=None, IPCF=4.5e5, P47T=4.5e5, ITF=9e5)

    # 5. Zero-weight row -> dropped by the weight>0 filter.
    add(DECCFR=5, DECINDR=5, DECOCUR=5, DECIFR=5, IPCF=4e5, P47T=4e5, PONDIH=0, PONDII=0)

    return rows


def txt_content(rows: list[dict]) -> str:
    """Render rows as the semicolon/comma-decimal text the real loader parses."""
    lines = [";".join(USECOLS)]
    for r in rows:
        cells = []
        for col in USECOLS:
            v = r[col]
            if v is None:
                cells.append("")
            elif col in INCOME_COLS:
                cells.append(_income_str(v))
            elif col in DECILE_COLS:
                cells.append(str(int(v)))
            else:
                cells.append(str(v))
        lines.append(";".join(cells))
    return "\n".join(lines) + "\n"


def write_eph_txt(path, rows: list[dict]) -> None:
    path.write_bytes(txt_content(rows).encode(config.CSV_ENCODING))


def make_eph_zip(zip_path, rows: list[dict], member: str | None = None) -> None:
    """Write the synthetic individual base into a zip (member defaults to INDIVIDUAL_FILE)."""
    member = member or config.INDIVIDUAL_FILE
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr(member, txt_content(rows).encode(config.CSV_ENCODING))


@pytest.fixture(scope="session")
def synthetic_rows() -> list[dict]:
    return build_rows()


@pytest.fixture(scope="session")
def loaded_df(tmp_path_factory, synthetic_rows) -> pd.DataFrame:
    """The synthetic base run through the REAL load.load_individual() (so dtypes match exactly)."""
    raw = tmp_path_factory.mktemp("rawload")
    write_eph_txt(raw / config.INDIVIDUAL_FILE, synthetic_rows)
    old = config.RAW_DIR
    config.RAW_DIR = raw
    try:
        return load.load_individual()
    finally:
        config.RAW_DIR = old


@pytest.fixture
def eph_raw(tmp_path, monkeypatch, synthetic_rows):
    """A tmp data/raw with the synthetic zip in place; config paths monkeypatched to tmp.

    Returns the raw dir. verify()/load()/build() can all run against it offline.
    """
    raw = tmp_path / "raw"
    raw.mkdir()
    make_eph_zip(raw / config.ZIP_NAME, synthetic_rows)
    monkeypatch.setattr(config, "RAW_DIR", raw)
    monkeypatch.setattr(config, "CHECKSUMS_FILE", tmp_path / "checksums.txt")
    return raw
