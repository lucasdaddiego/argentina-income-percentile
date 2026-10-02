"""Survey-weighted statistics, hand-rolled on numpy for transparency.

Weighted quantiles use the inverted weighted empirical CDF (type-1 / no interpolation):
    P(Y <= t) = (1/sum w_i) * sum_i w_i * 1[x_i <= t]
which is exactly numpy's only weighted method, np.quantile(method='inverted_cdf', weights=...).
Gini is derived from the same weighted Lorenz ordinates (trapezoidal), never fitted.

Callers must pass a non-empty population with positive total weight (and, for Gini,
positive total income); these hold for any real EPH universe. Empty input raises.
"""

from __future__ import annotations

from collections.abc import Iterable

import numpy as np
import numpy.typing as npt


def _sorted(values: npt.ArrayLike, weights: npt.ArrayLike) -> tuple[np.ndarray, np.ndarray]:
    v = np.asarray(values, dtype=float)
    w = np.asarray(weights, dtype=float)
    if v.size == 0:
        raise ValueError("weighted statistics require a non-empty input")
    order = np.argsort(v, kind="mergesort")
    return v[order], w[order]


def weighted_quantile(values: npt.ArrayLike, weights: npt.ArrayLike, q) -> float | np.ndarray:
    """Inverted weighted empirical CDF. `q` scalar or array-like in [0, 1]."""
    v, w = _sorted(values, weights)
    cw = np.cumsum(w)
    frac = cw / cw[-1]
    qa = np.atleast_1d(np.asarray(q, dtype=float))
    idx = np.searchsorted(frac, qa, side="left")
    idx = np.clip(idx, 0, len(v) - 1)
    out = v[idx]
    return float(out[0]) if out.size == 1 else out


def weighted_mean(values: npt.ArrayLike, weights: npt.ArrayLike) -> float:
    v = np.asarray(values, float)
    w = np.asarray(weights, float)
    return float(np.sum(v * w) / np.sum(w))


def lorenz_and_gini(
    values: npt.ArrayLike, weights: npt.ArrayLike, n_points: int = 101
) -> tuple[list[list[float]], float]:
    """Return (lorenz_points, gini). lorenz_points = [[pop_share, income_share], ...]."""
    v, w = _sorted(values, weights)
    v = np.clip(v, 0, None)  # negative incomes (rare) clamped for a monotone Lorenz
    cw = np.cumsum(w)
    cvw = np.cumsum(v * w)
    if cvw[-1] == 0:
        raise ValueError("lorenz_and_gini requires positive total income")
    pop = np.concatenate([[0.0], cw / cw[-1]])
    inc = np.concatenate([[0.0], cvw / cvw[-1]])
    # Gini = 1 - sum of trapezoid areas under the Lorenz curve, times 2 (i.e. 1 - 2*B).
    gini = 1.0 - float(np.sum((pop[1:] - pop[:-1]) * (inc[1:] + inc[:-1])))
    # Downsample to evenly spaced population shares for plotting.
    grid = np.linspace(0.0, 1.0, n_points)
    inc_grid = np.interp(grid, pop, inc)
    points = [[round(float(p), 5), round(float(i), 5)] for p, i in zip(grid, inc_grid, strict=True)]
    return points, gini


def decile_table(values: npt.ArrayLike, weights: npt.ArrayLike) -> list[dict]:
    """Per-decile upper limit ('hasta'), weighted mean, income share (%), weighted pop.

    Like INDEC's Cuadro 1, every decile holds 10% of the weighted population: people are ordered
    by income and the cumulative weight is cut at each 10%. A weight that straddles a cut (people
    tied at the cutoff income, or one heavy weight) is split between the two deciles in proportion.
    Assigning by "income <= hasta" instead put every person tied at a cutoff in the lower decile,
    which moved whole points of income share wherever many incomes sit on a round number.
    'hasta' is the weighted quantile at the cut.
    """
    v, w = _sorted(values, weights)
    cutoffs = np.atleast_1d(weighted_quantile(v, w, [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]))
    cw = np.concatenate([[0.0], np.cumsum(w)])
    total_w = float(cw[-1])
    total_vw = float(np.sum(v * w))
    rows = []
    for d in range(1, 11):
        lo, hi = total_w * (d - 1) / 10, total_w * d / 10
        # The part of each person's weight that falls inside [lo, hi).
        part = np.clip(np.minimum(cw[1:], hi) - np.maximum(cw[:-1], lo), 0.0, None)
        wd = float(np.sum(part))
        vwd = float(np.sum(v * part))
        rows.append(
            {
                "decile": d,
                "hasta": None if d == 10 else round(float(cutoffs[d - 1]), 2),
                "mean": round(vwd / wd, 2),
                "share": round(100.0 * vwd / total_vw, 2) if total_vw else 0.0,
                "population": round(wd),
            }
        )
    return rows


def weighted_histogram(values: npt.ArrayLike, weights: npt.ArrayLike, n_bins: int = 40, cap_q: float = 0.99) -> dict:
    """Weighted histogram from 0 to the cap_q quantile; the long tail folds into the top bin."""
    v = np.asarray(values, float)
    w = np.asarray(weights, float)
    cap = float(weighted_quantile(v, w, cap_q))
    edges = np.linspace(0.0, cap, n_bins + 1)
    clipped = np.clip(v, 0.0, cap)
    counts, _ = np.histogram(clipped, bins=edges, weights=w)
    return {
        "edges": [round(float(e), 2) for e in edges],
        "counts": [round(float(c)) for c in counts],
        "cap_quantile": cap_q,
        "note": f"El último intervalo agrupa la cola superior (ingresos por encima del percentil {cap_q * 100:g}).",
    }


def percentiles(values: npt.ArrayLike, weights: npt.ArrayLike, ps: Iterable[float] | None = None) -> dict[str, float]:
    ps = list(range(1, 100)) if ps is None else list(ps)
    v = np.asarray(values, float)
    w = np.asarray(weights, float)
    qs = [p / 100.0 for p in ps]
    vals = np.atleast_1d(weighted_quantile(v, w, qs))
    return {str(p): round(float(val), 2) for p, val in zip(ps, vals, strict=True)}
