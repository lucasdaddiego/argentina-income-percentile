"""Pinned configuration and verified INDEC reference data.

Every value here was confirmed against primary INDEC sources in June 2026. This module is the
single source of truth: variable names, the download URL, the poverty-line values, and the
official figures the pipeline must reproduce.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, NotRequired, TypedDict

# --------------------------------------------------------------------------------------
# Paths
# --------------------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
CHECKSUMS_FILE = DATA_DIR / "checksums.txt"
# The committed artifact lives in both data/ (provenance) and web/public/ (served by Vite).
ARTIFACT_PATHS = [DATA_DIR / "percentiles.v1.json", ROOT / "web" / "public" / "percentiles.v1.json"]

# --------------------------------------------------------------------------------------
# Pinned source — INDEC EPH, 4º trimestre 2025 (latest available as of June 2026).
# The site pins the latest 2º or 4º trimestre: unlike the 1º and 3º, those are NOT inflated by the
# aguinaldo, so they are the cleaner "typical income" base (pipeline.watch.USABLE_QUARTERS).
# Verified live: HTTP 200, last-modified 2026-04-24.
# --------------------------------------------------------------------------------------
QUARTER = "2025-T4"
QUARTER_LABEL = "EPH 4º trimestre 2025"
ZIP_URL = "https://www.indec.gob.ar/ftp/cuadros/menusuperior/eph/EPH_usu_4_Trim_2025_txt.zip"
ZIP_NAME = "EPH_usu_4_Trim_2025_txt.zip"
INDIVIDUAL_FILE = "usu_individual_T425.txt"
HOGAR_FILE = "usu_hogar_T425.txt"

ZIP_MAGIC = b"PK\x03\x04"  # a local-file header opens every real zip; INDEC's "not found" page is HTML

# File format (verified by unzip + byte scan).
CSV_SEP = ";"
CSV_ENCODING = "latin-1"  # Q4 2025 is pure ASCII; latin-1 is safe across quarters.
NA_VALUES = ["-9"]  # -9 = "no respuesta" for income amounts → treat as missing.


# --------------------------------------------------------------------------------------
# Measures. The headline ("hero") shown in the web app is household per-capita income
# (IPCF, weight PONDIH) — also the poverty base; individual total income (P47T, weight
# PONDII) is the secondary "as a person" lens. HERO_MEASURE (below) records that choice.
#
#   value_col      : income column to rank on
#   weight_col     : the matching non-response-corrected expansion factor (NEVER PONDERA)
#   decile_col     : INDEC's shipped decile label, used as an independent cross-check
#   include_zero   : whether persons with zero income belong in the distribution
#                    - IPCF: yes (INDEC places "sin ingresos" at the start of decile 1)
#                    - individual: no (the universe is "perceptores de ingresos")
# --------------------------------------------------------------------------------------
class MeasureSpec(TypedDict):
    key: str
    value_col: str  # income column to rank on
    weight_col: str  # matching non-response-corrected expansion factor (NEVER PONDERA)
    decile_col: str  # INDEC's shipped decile label, for the independent cross-check
    include_zero: bool  # whether zero-income persons belong in the distribution
    label: str
    short: str
    universe: str


MEASURES: dict[str, MeasureSpec] = {
    "individual": {
        "key": "individual",
        "value_col": "P47T",
        "weight_col": "PONDII",
        "decile_col": "DECINDR",
        "include_zero": False,
        "label": "Ingreso total individual",
        "short": "tu ingreso personal",
        "universe": "Personas con ingresos individuales (perceptores)",
    },
    "ipcf": {
        "key": "ipcf",
        "value_col": "IPCF",
        "weight_col": "PONDIH",
        "decile_col": "DECCFR",
        "include_zero": True,
        "label": "Ingreso per cápita familiar (IPCF)",
        "short": "el ingreso por persona de tu hogar",
        "universe": "Población total (incluye hogares sin ingresos)",
    },
}
HERO_MEASURE = "ipcf"

# Decile-label sentinel codes (apply to DECCFR / DECINDR / DECCFR family).
DECILE_NO_INCOME = "00"  # sin ingresos
DECILE_NONRESPONSE = "12"  # no respuesta de ingresos
DECILE_NO_INTERVIEW = "13"  # entrevista individual no realizada
# Integer forms (decile columns are parsed to nullable Int64 in load.py).
DECILE_NO_INCOME_I = 0
DECILE_NONRESPONSE_I = 12
DECILE_NO_INTERVIEW_I = 13

# Region codes (REGION N(2)) → display names.
REGION_COL = "REGION"
REGION_NAMES = {
    1: "Gran Buenos Aires",
    40: "Noroeste (NOA)",
    41: "Nordeste (NEA)",
    42: "Cuyo",
    43: "Pampeana",
    44: "Patagónica",
}

# EPH aglomerados (AGLOMERADO N(2)) → display names, for the city-level regional breakdown.
AGLOMERADO_COL = "AGLOMERADO"
AGLOMERADO_NAMES = {
    2: "Gran La Plata",
    3: "Bahía Blanca-Cerri",
    4: "Gran Rosario",
    5: "Gran Santa Fe",
    6: "Gran Paraná",
    7: "Posadas",
    8: "Gran Resistencia",
    9: "Comodoro Rivadavia-Rada Tilly",
    10: "Gran Mendoza",
    12: "Corrientes",
    13: "Gran Córdoba",
    14: "Concordia",
    15: "Formosa",
    17: "Neuquén-Plottier",
    18: "Santiago del Estero-La Banda",
    19: "Jujuy-Palpalá",
    20: "Río Gallegos",
    22: "Gran Catamarca",
    23: "Gran Salta",
    25: "La Rioja",
    26: "Gran San Luis",
    27: "Gran San Juan",
    29: "Gran Tucumán-Tafí Viejo",
    30: "Santa Rosa-Toay",
    31: "Ushuaia-Río Grande",
    32: "Ciudad de Buenos Aires",
    33: "Partidos del GBA",
    34: "Mar del Plata",
    36: "Río Cuarto",
    38: "San Nicolás-Villa Constitución",
    91: "Rawson-Trelew",
    93: "Viedma-Carmen de Patagones",
}

# Structural splits of the INDIVIDUAL-income universe (perceptores), for "El ingreso según
# quién sos". Each dim lists the codes to keep, in display order, with their labels. Groups
# below SPLIT_MIN_N unweighted cases are dropped (suppresses noisy cells). CAT_OCUP=0 (no
# ocupados: jubilaciones, rentas) is intentionally excluded from the job-category panel.
SPLIT_MIN_N = 200


class SplitSpec(TypedDict):
    col: str
    label: str
    groups: dict[int, str]
    where: NotRequired[dict[str, int]]  # narrow the perceptor base first: {column: required code}


SPLITS: dict[str, SplitSpec] = {
    "sexo": {"col": "CH04", "label": "Sexo", "groups": {1: "Varones", 2: "Mujeres"}},
    "educacion": {
        "col": "NIVEL_ED",
        "label": "Nivel educativo",
        "groups": {
            1: "Primaria incompleta",
            2: "Primaria completa",
            3: "Secundaria incompleta",
            4: "Secundaria completa",
            5: "Superior incompleta",
            6: "Superior completa",
        },
    },
    "cat_ocup": {
        "col": "CAT_OCUP",
        "label": "Categoría ocupacional",
        "groups": {1: "Patrón/a", 2: "Cuenta propia", 3: "Asalariado/a"},
    },
    # PP04A is asked of every ocupado, so without the CAT_OCUP=3 filter "Privado" would also hold
    # the patrones and cuentapropistas the label says it excludes.
    "sector": {
        "col": "PP04A",
        "label": "Sector (asalariados)",
        "groups": {1: "Estatal", 2: "Privado"},
        "where": {"CAT_OCUP": 3},
    },
}

# --------------------------------------------------------------------------------------
# Poverty lines — CBA (línea de indigencia) and CBT (línea de pobreza) per adulto
# equivalente. We pin OCTOBER 2025 so the poverty line matches the income vintage:
# EPH 4º trim. 2025 income references roughly October 2025 (for a 2º trim. pin, April), and
# comparing it to a later (inflation-bumped) canasta would wrongly understate real incomes.
# October 2025 values from INDEC "Valorización mensual de la CBA y CBT, Gran Buenos Aires"
# (publicado 12-nov-2025).
# --------------------------------------------------------------------------------------
POVERTY_LINES = {
    "period": "2025-10",
    "period_label": "octubre 2025",
    "source": "INDEC, Valorización mensual de la CBA y CBT — Gran Buenos Aires, octubre 2025",
    "cba_adulto_equiv": 176150.0,  # línea de indigencia, por adulto equivalente
    "cbt_adulto_equiv": 392815.0,  # línea de pobreza, por adulto equivalente
}


# --------------------------------------------------------------------------------------
# Monthly CPI, for the web app's "mes de tu ingreso" control: the distribution holds nominal
# pesos of the survey's reference month (POVERTY_LINES["period"], ~October 2025 for a 4º
# trimestre), so an income typed months later is brought back to that month with the IPC before
# the percentile lookup. Without it a May-2026 household at the then-median read "percentil 58".
# Index: INDEC IPC Nacional nivel general (datos.gob.ar serie 148.3_INIVELNAL_DICI_M_26) as
# spliced and rebased by lucasdaddiego/peso (series.v1.json, its vintage month = 100). Only the
# ratio between months is used, so the base does not matter. The months live in
# data/cpi_monthly.json, generated from peso's published artifact by pipeline/cpi_sync.py; the
# monthly `cpi-sync.yml` workflow rewrites the file whole when peso bumps its vintage (every value
# is rebased then). Never edit it by hand.
# --------------------------------------------------------------------------------------
CPI_MONTHLY_FILE = DATA_DIR / "cpi_monthly.json"


def _load_cpi_monthly() -> dict[str, Any]:
    """The block the artifact embeds: the generated months plus the survey's reference month."""
    doc = json.loads(CPI_MONTHLY_FILE.read_text(encoding="utf-8"))
    return {
        "reference_month": POVERTY_LINES["period"],
        "reference_label": POVERTY_LINES["period_label"],
        "source": doc["source"],
        "months": doc["months"],
    }


CPI_MONTHLY = _load_cpi_monthly()


# --------------------------------------------------------------------------------------
# Validation anchors — INDEC "Evolución de la distribución del ingreso (EPH), 4º trim. 2025"
# (Informes técnicos Vol. 10 nº 82, pub. 2026-04-06). The pipeline MUST reproduce these
# for IPCF (the measure INDEC publishes), or the build fails.
# --------------------------------------------------------------------------------------
class IndecDecile(TypedDict):
    decile: int
    hasta: int | None  # per-decile upper limit ("hasta"); None for the open-ended top decile
    mean: int
    share: float


class IndecRef(TypedDict):
    gini: float
    mean: int
    median: int
    population: int
    d10_d1_median_gap: int
    deciles: list[IndecDecile]


INDEC_IPCF_Q4_2025: IndecRef = {
    "gini": 0.427,
    "mean": 635996,
    "median": 450000,
    "population": 30032540,
    "d10_d1_median_gap": 13,
    # Cuadro 1: per-decile upper limit ("hasta"), weighted mean, income share (%).
    "deciles": [
        {"decile": 1, "hasta": 177800, "mean": 117129, "share": 1.8},
        {"decile": 2, "hasta": 250000, "mean": 215534, "share": 3.4},
        {"decile": 3, "hasta": 315667, "mean": 283306, "share": 4.5},
        {"decile": 4, "hasta": 390000, "mean": 350498, "share": 5.5},
        {"decile": 5, "hasta": 450000, "mean": 416399, "share": 6.5},
        {"decile": 6, "hasta": 560000, "mean": 503025, "share": 7.9},
        {"decile": 7, "hasta": 670000, "mean": 612765, "share": 9.6},
        {"decile": 8, "hasta": 880000, "mean": 763182, "share": 12.0},
        {"decile": 9, "hasta": 1250000, "mean": 1042459, "share": 16.4},
        {"decile": 10, "hasta": None, "mean": 2055992, "share": 32.3},
    ],
}

# Historical INDEC series for the trend charts. Seeded with verified anchors; expanded by the
# research pass. Gini de IPCF (trimestral) and pobreza/indigencia de personas (semestral).
HISTORY = {
    # Gini del IPCF (personas, total 31 aglomerados), trimestral — INDEC "Evolución de la
    # distribución del ingreso (EPH)". Verificado contra los informes oficiales.
    "gini_quarterly": [
        {"period": "2023-T1", "gini": 0.446},
        {"period": "2023-T2", "gini": 0.417},
        {"period": "2023-T3", "gini": 0.434},
        {"period": "2023-T4", "gini": 0.435},
        {"period": "2024-T1", "gini": 0.467},
        {"period": "2024-T2", "gini": 0.436},
        {"period": "2024-T3", "gini": 0.435},
        {"period": "2024-T4", "gini": 0.430},
        {"period": "2025-T1", "gini": 0.435},
        {"period": "2025-T2", "gini": 0.424},
        {"period": "2025-T3", "gini": 0.431},
        {"period": "2025-T4", "gini": 0.427},
    ],
    # Pobreza e indigencia (% de personas), semestral — INDEC "Incidencia de la pobreza y la
    # indigencia en 31 aglomerados urbanos".
    "poverty_semestral": [
        {"period": "2022-S1", "poverty_pct": 36.5, "indigence_pct": 8.8},
        {"period": "2022-S2", "poverty_pct": 39.2, "indigence_pct": 8.1},
        {"period": "2023-S1", "poverty_pct": 40.1, "indigence_pct": 9.3},
        {"period": "2023-S2", "poverty_pct": 41.7, "indigence_pct": 11.9},
        {"period": "2024-S1", "poverty_pct": 52.9, "indigence_pct": 18.1},
        {"period": "2024-S2", "poverty_pct": 38.1, "indigence_pct": 8.2},
        {"period": "2025-S1", "poverty_pct": 31.6, "indigence_pct": 6.9},
        {"period": "2025-S2", "poverty_pct": 28.2, "indigence_pct": 6.3},
    ],
    # Mediana del IPCF nominal, trimestral (refleja sobre todo la inflación). INDEC Cuadro 1.
    "median_ipcf_quarterly": [
        {"period": "2024-T1", "median": 155000},
        {"period": "2024-T2", "median": 205000},
        {"period": "2024-T3", "median": 300000},
        {"period": "2024-T4", "median": 320000},
        {"period": "2025-T1", "median": 397500},
        {"period": "2025-T2", "median": 392000},
        {"period": "2025-T3", "median": 463333},
        {"period": "2025-T4", "median": 450000},
    ],
    # IPC nivel general nacional (INDEC, base dic-2016), promedio trimestral, reexpresado con
    # 4º trim. 2025 = 100. Sirve para deflactar la mediana nominal a "pesos de hoy".
    # Fuente: INDEC vía datos.gob.ar, serie 145.3_INGNACUAL_DICI_M_38 (variación mensual empalmada).
    "cpi_quarterly": [
        {"period": "2024-T1", "index": 48.84},
        {"period": "2024-T2", "index": 61.74},
        {"period": "2024-T3", "index": 69.72},
        {"period": "2024-T4", "index": 76.10},
        {"period": "2025-T1", "index": 82.09},
        {"period": "2025-T2", "index": 88.46},
        {"period": "2025-T3", "index": 93.35},
        {"period": "2025-T4", "index": 100.0},
    ],
    "cpi_base_label": "4º trimestre 2025",
    # Salario Mínimo Vital y Móvil (jornada completa), promedio trimestral de los valores
    # mensuales fijados por el Consejo del Salario. Fuente: Min. Trabajo / Consejo del Salario
    # (boletín oficial), consolidado por estudiodelamo.com. Muestra que el piso legal perdió
    # contra la inflación mientras la mediana se recuperaba.
    "smvm_quarterly": [
        {"period": "2024-T1", "smvm": 187600},
        {"period": "2024-T2", "smvm": 229894},
        {"period": "2024-T3", "smvm": 261574},
        {"period": "2024-T4", "smvm": 274287},
        {"period": "2025-T1", "smvm": 291996},
        {"period": "2025-T2", "smvm": 308067},
        {"period": "2025-T3", "smvm": 320600},
        {"period": "2025-T4", "smvm": 328400},
    ],
}

# --------------------------------------------------------------------------------------
# Cost of living — REFERENCE ESTIMATES from external sources (mid-2026), NOT microdata.
# Gathered + cross-checked from Zonaprop, IIEP-UBA/CONICET, AySA, telco comparators, press.
# Each line: scope "hogar" (once per household) or "persona" (× nº de integrantes).
# --------------------------------------------------------------------------------------
COST_OF_LIVING = {
    "period_label": "mediados de 2026 (mayo–junio 2026)",
    "lines": [
        {
            "key": "alquiler",
            "label": "Alquiler",
            "amount": 668000,
            "scope": "hogar",
            "detail": "Cambia según la región (elegí abajo). Promedios 2026 de Zonaprop/Reporte Inmobiliario vía La Nación; precio de oferta, el contrato real suele ser algo menor.",
            "source": "Zonaprop / Reporte Inmobiliario / La Nación",
            "confidence": "high",
        },
        {
            "key": "expensas",
            "label": "Expensas",
            "amount": 80000,
            "scope": "hogar",
            "detail": "Depto estándar sin amenities ($60.000–$100.000). Con amenities, mucho más.",
            "source": "ConsorcioAbierto / Roomix",
            "confidence": "medium",
        },
        {
            "key": "luz",
            "label": "Electricidad",
            "amount": 52811,
            "scope": "hogar",
            "detail": "Hogar AMBA sin subsidio (tarifa plena). Con subsidio se paga menos.",
            "source": "IIEP UBA-CONICET",
            "confidence": "high",
        },
        {
            "key": "gas",
            "label": "Gas natural (prom. anual)",
            "amount": 37000,
            "scope": "hogar",
            "detail": "Promedio anual estimado: invierno ~$50.000, verano ~$24.500. Hogar AMBA sin subsidio.",
            "source": "IIEP UBA-CONICET",
            "confidence": "medium",
        },
        {
            "key": "agua",
            "label": "Agua",
            "amount": 36612,
            "scope": "hogar",
            "detail": "AySA, hogar AMBA sin subsidio.",
            "source": "IIEP UBA-CONICET",
            "confidence": "high",
        },
        {
            "key": "internet",
            "label": "Internet",
            "amount": 23000,
            "scope": "hogar",
            "detail": "Plan hogareño ~100–300 Mbps.",
            "source": "Comparadores de telco",
            "confidence": "medium",
        },
        {
            "key": "alimentos",
            "label": "Alimentos (gasto típico)",
            "amount": 350000,
            "scope": "hogar",
            "detail": "Estimación ~1,5–1,7× la Canasta Básica Alimentaria. El piso de indigencia (solo comer) es $220.468 por adulto.",
            "source": "Estimación s/ INDEC",
            "confidence": "medium",
        },
        {
            "key": "transporte",
            "label": "Transporte",
            "amount": 30000,
            "scope": "hogar",
            "detail": "~44 viajes/mes en colectivo (SUBE, con descuentos progresivos). En subte ~$52.000.",
            "source": "SUBE / Gobierno",
            "confidence": "medium",
        },
        {
            "key": "celular",
            "label": "Celular",
            "amount": 28000,
            "scope": "hogar",
            "detail": "Plan individual con datos.",
            "source": "Comparadores de telco",
            "confidence": "medium",
        },
        {
            "key": "salud",
            "label": "Salud (prepaga / obra social)",
            "amount": 170000,
            "scope": "hogar",
            "detail": "Cuota individual de gama media; gran dispersión ($90.000 a >$1.000.000). Con salud pública, $0.",
            "source": "Prensa (Infobae)",
            "confidence": "medium",
        },
    ],
    # 2-ambientes monthly rent by INDEC region (2026, Zonaprop/Reporte Inmobiliario via La Nación).
    "rent_by_region": {
        "GBA": 668000,
        "CABA": 848509,
        "Pampeana": 640000,
        "Cuyo": 720000,
        "NOA": 600000,
        "NEA": 600000,
        "Patagonica": 880000,
    },
    "floor": {
        "label": "Piso de indigencia (solo alimentos)",
        "amount": 220468,
        "detail": "CBA por adulto equivalente, may-2026 — el mínimo para no ser indigente.",
        "source": "INDEC",
        "confidence": "high",
    },
    "reference_incomes": {
        "smvm": 367800,
        "jubilacion_minima": 403318,
        "notes": "Salario Mínimo Vital y Móvil (jun-2026, Res. 9/2025) y jubilación mínima bruta (jun-2026, ANSES). "
        "Con bono, el piso del jubilado llega a ~$473.318.",
    },
    # Everyday goods, for the "poder de compra" section — sourced reference prices, mid-2026.
    # All approximate and volatile; vary by brand, place and moment. Each carries its source.
    "goods": [
        {
            "key": "nafta",
            "label": "litros de nafta súper",
            "unit": "L",
            "price": 2100,
            "source": "YPF / indicadores.ar, may-2026",
            "confidence": "media",
        },
        {
            "key": "asado",
            "label": "kilos de asado",
            "unit": "kg",
            "price": 18000,
            "source": "IPCVA / prensa, may-2026",
            "confidence": "media",
        },
        {
            "key": "cafe",
            "label": "cafés en un bar",
            "unit": "café",
            "price": 2000,
            "source": "prensa (La Nación, Cronista), 2026",
            "confidence": "baja",
        },
        {
            "key": "bigmac",
            "label": "Big Macs",
            "unit": "Big Mac",
            "price": 7300,
            "source": "The Economist, Big Mac Index 2026",
            "confidence": "alta",
        },
    ],
    "caveats": [
        "Son estimados de referencia de fuentes externas (Zonaprop, IIEP-UBA, AySA, prensa), no microdatos: "
        "varían mucho según zona, vivienda, consumo, plan y edad.",
        "El alquiler se elige por región (GBA, CABA, Pampeana, Cuyo, NOA, NEA, Patagonia). Son promedios de oferta 2026; el interior tiene datos más finos y dispersos. Editá el valor a tu caso.",
        "Luz, gas y agua son de un hogar SIN subsidio; con subsidio se paga bastante menos, y el gas es más caro en invierno.",
        "La prepaga es opcional (con salud pública, $0) y muy dispersa; los alimentos son una estimación por encima del piso de indigencia.",
    ],
}

CITATION = (
    "Elaboración propia en base a microdatos de la Encuesta Permanente de Hogares (EPH), "
    "INDEC. Fuente: INDEC, www.indec.gob.ar."
)
