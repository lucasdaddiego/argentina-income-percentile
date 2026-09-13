# Argentina Income Percentile

[![Live demo](https://img.shields.io/badge/demo-live-F38020?logo=cloudflare&logoColor=white)](https://argentina-income-analyzer.pages.dev)
[![CI (web)](https://github.com/lucasdaddiego/argentina-income-percentile/actions/workflows/ci.yml/badge.svg)](https://github.com/lucasdaddiego/argentina-income-percentile/actions/workflows/ci.yml)
[![Python checks](https://github.com/lucasdaddiego/argentina-income-percentile/actions/workflows/python.yml/badge.svg)](https://github.com/lucasdaddiego/argentina-income-percentile/actions/workflows/python.yml)
[![Data reproduces INDEC](https://github.com/lucasdaddiego/argentina-income-percentile/actions/workflows/data.yml/badge.svg)](https://github.com/lucasdaddiego/argentina-income-percentile/actions/workflows/data.yml)

[![Coverage 100%](https://img.shields.io/badge/coverage-100%25-brightgreen)](https://github.com/lucasdaddiego/argentina-income-percentile/actions)
[![Python 3.14](https://img.shields.io/badge/python-3.14-3776AB?logo=python&logoColor=white)](pyproject.toml)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](web/tsconfig.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Where do you stand in Argentina's income distribution? This tool answers that **from the real
INDEC EPH microdata** — it downloads the household survey, applies the official sample weights, and
computes the weighted income distribution itself. No eyeballed deciles, no decorative curves.

**▶ Try it live: [argentina-income-analyzer.pages.dev](https://argentina-income-analyzer.pages.dev)**

> **Validated against INDEC** (Evolución de la distribución del ingreso, 4º trim. 2025):
> Gini IPCF **0.427 ✓**, mediana **$450.000 ✓**, media **$635.996 ✓**, población **30.032.540 ✓**,
> and every published decile cutoff reproduced to the peso.

It has two parts:

1. **`pipeline/`** — an offline, reproducible Python pipeline (uv + pandas + numpy) that turns the
   raw EPH base into one small, provenance-stamped JSON artifact.
2. **`web/`** — a static Vite + TypeScript site that reads that JSON and renders honest graphics
   (empirical CDF, weighted histogram, Lorenz curve + data-derived Gini) plus a poverty-line check.

## What makes it "real"

- **Right weights.** Individual income (`P47T`) is weighted by `PONDII`; household per-capita income
  (`IPCF`) by `PONDIH` — INDEC's non-response-corrected factors, never the plain `PONDERA`.
- **Computed, not assumed.** Percentiles come from the weighted empirical CDF; the Gini from the
  data's own Lorenz curve.
- **Honest charts.** The distribution you see *is* the data — a step CDF, real weighted bins, a real
  Lorenz curve. Nothing is smoothed into a pretty shape.
- **Two distinct measures.** "Tu ingreso personal" (P47T) and "ingreso por persona del hogar" (IPCF)
  answer different questions and are labeled as such. The poverty overlay uses IPCF, as INDEC does.
- **Provenance.** The source zip is pinned by SHA-256; the artifact embeds the period, checksum, and
  sample size. A validation gate fails the build if it stops matching INDEC's published figures.

## Quickstart

```bash
make setup        # uv sync (python deps) + npm install (web deps)
make data         # fetch → verify(sha256) → build(JSON) → validate(vs INDEC)
make test         # python + web unit tests, each gated at 100% coverage
make lint         # ruff + mypy + tsc
make up           # vite dev server  →  http://localhost:5179
make build        # static bundle in web/dist/
make deploy       # publish web/dist/ to Cloudflare Pages (needs wrangler auth)
```

`make` (or `make help`) lists every target. `make data` downloads
`EPH_usu_4_Trim_2025_txt.zip` (~2.9 MB, public INDEC data), computes the statistics, writes
`data/percentiles.v1.json` and `web/public/percentiles.v1.json`, and asserts the reproduction of
INDEC's official numbers. The pipeline steps can also be run one at a time with
`uv run python -m pipeline.{fetch,verify,build,validate}`.

## How it works

```
EPH microdata (T425, ;-delimited, comma decimals)
   └─ pipeline/  fetch → verify → load → weighted stats → validate → emit
        └─ web/public/percentiles.v1.json   (versioned, provenance-stamped)
             └─ web/  Vite + TS + Observable Plot  (lookups + honest charts only)
```

The frontend does **no statistics** — only lookups and trivial interpolation against the precomputed
artifact. Everything quantitative is computed once, offline, and validated.

## Methodology (short)

- **Universe.** IPCF: the whole population (zero-income persons sit at the start of decile 1, per
  INDEC). Individual income: perceptores only. Income non-response (`-9`, decile codes 12/13) is excluded.
- **Weighted quantiles.** Inverted weighted empirical CDF (type-1), cross-checked against
  `numpy.quantile(method='inverted_cdf', weights=...)`.
- **Gini.** Trapezoidal area between the 45° line and the weighted Lorenz curve.
- **Poverty.** Per-person household income vs the Canasta Básica (CBA/CBT per adulto equivalente,
  **October 2025** — matched to the income vintage so inflation doesn't skew the comparison). The UI
  counts each household member as one adult; INDEC's full age/sex equivalence scale would set a
  somewhat lower threshold for households with children.
- Full notes: [`docs/metodologia.md`](docs/metodologia.md), and the "Metodología" section in the app.

## Project structure

```
pipeline/   config (pinned facts) · fetch · verify · load · weighted · build · validate · artifact_check · watch
tests/      pytest suite for pipeline/ — offline, synthetic fixture, 100% statement+branch coverage
data/       checksums.txt · percentiles.v1.json   (raw/ is gitignored)
web/        index.html · src/{main,charts,stats,format,usd,types}.ts · styles.css · test/ (vitest, 100%)
docs/       metodologia.md
```

## Tests & CI

Both layers are gated at **100% coverage** — statements **and** branches:

- **`pipeline/`** — `pytest` against a tiny synthetic EPH fixture (no network, no real microdata), 93 tests.
- **`web/src/`** — `vitest` + `jsdom`, every render path exercised against the committed artifact, 144 tests.

`make test` runs both; `make lint` runs `ruff` + `mypy` + `tsc`. Five GitHub Actions run on every
push/PR, path-filtered so a web-only change never reaches for INDEC:

| Workflow | What it checks |
| --- | --- |
| `ci.yml` | web typecheck + `vitest` 100% gate + production build |
| `deploy.yml` | web build + Cloudflare Pages deploy (production on `master`, preview per PR) |
| `python.yml` | `ruff` + `mypy` + `pytest` 100% gate (offline, fast) |
| `data.yml` | the pipeline still reproduces INDEC, and the committed artifact matches the rebuild |
| `data-update.yml` | monthly watch — opens a draft PR when a newer EPH quarter is published |

## Reproducibility

The exact source file is pinned by SHA-256 in `data/checksums.txt` (trust-on-first-use). The verify
step (part of `make data`, or `uv run python -m pipeline.verify`) fails if the input ever changes, so
the build is reproducible against a known input. To update to a newer quarter, edit `pipeline/config.py`
(`ZIP_URL`, `*_FILE`, `QUARTER`) and delete `data/checksums.txt`.
The monthly poverty lines live in their own `POVERTY_LINES` block (they update more often than the EPH).

## Deploy

Static bundle + one JSON → ideal for **Cloudflare Pages** (`web/dist/`). Long cache on the
content artifact, short cache on `index.html`. Live at
**[argentina-income-analyzer.pages.dev](https://argentina-income-analyzer.pages.dev)**. `deploy.yml`
publishes it from CI: every push to `master` that touches `web/` goes to production and PRs get a
per-branch preview (needs the `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` secrets; without them
the job still builds and just skips the deploy). `make deploy` does the same by hand.

## Two tiers of data (important)

The app deliberately separates two kinds of figures:

1. **Rigorous core — computed from INDEC EPH microdata.** The IPCF distribution
   (percentiles/deciles, Gini, Lorenz) is validated to INDEC's published Q4-2025 figures, and the
   individual-income deciles are cross-checked against INDEC's own `DECINDR` labels. The regional,
   aglomerado and structural-split breakdowns (`build_regions`, `build_aglomerados`, `build_splits`)
   are computed from the same microdata and weights, but INDEC doesn't publish matching per-cell
   figures to anchor them against — treat them as derived, not separately validated. This is the
   trustworthy spine.
2. **Reference layer — external sourced estimates** (clearly flagged as such in the UI), stored as
   dated, cited blocks in `pipeline/config.py`:
   - `HISTORY` — Gini (quarterly) + poverty/indigence (semestral) + nominal median, from INDEC press reports.
   - `POVERTY_LINES` — CBA/CBT per adulto equivalente (period-matched to the income vintage).
   - `COST_OF_LIVING` — rent, utilities, food, transport, internet, health + SMVM/jubilación, gathered
     mid-2026 from Zonaprop, IIEP-UBA/CONICET, AySA, telco comparators and press. These vary widely by
     case and are labeled in the app as estimates, **not** microdata.

To refresh any reference block, edit its dict in `config.py` and run `make data` (which rebuilds the
JSON artifact). Note `make build` builds the *web* bundle, not the data.

## License

**Code:** [MIT](LICENSE). · **Data:** see [`NOTICE`](NOTICE).

**Data:** Source: **Encuesta Permanente de Hogares (EPH), INDEC** — public _base usuaria_ microdata.
INDEC permits republishing aggregate/derived statistics with attribution; individual records are never
shipped (only aggregates), satisfying the *secreto estadístico* (Ley 17.622). The cost-of-living layer
cites its own external sources inline.

> Elaboración propia en base a microdatos de la Encuesta Permanente de Hogares (EPH), INDEC.
> Fuente: INDEC, www.indec.gob.ar.
