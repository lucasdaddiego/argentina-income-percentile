"""Validation gate: assert the pipeline reproduces INDEC's published figures.

HARD checks (build fails if any miss) compare our IPCF output to INDEC "Evolución de la
distribución del ingreso (EPH), 4º trim. 2025": Gini, mean, median, population, every closed
decile's upper limit to the peso, and each decile's income share and mean. A soft cross-check
compares our individual-income (P47T) deciles against INDEC's own shipped decile labels (DECINDR)
in the microdata.
"""

from __future__ import annotations

import json
import sys

from . import config, load, weighted

RESET, RED, GREEN, DIM = "\033[0m", "\033[31m", "\033[32m", "\033[2m"


class Gate:
    def __init__(self):
        self.failures = 0

    def check(self, name, got, expected, tol, *, rel=False, unit=""):
        if rel:
            ok = expected != 0 and abs(got - expected) / abs(expected) <= tol
            tol_s = f"±{tol:.0%}"
        else:
            ok = abs(got - expected) <= tol
            tol_s = f"±{tol}{unit}"
        tag = f"{GREEN}PASS{RESET}" if ok else f"{RED}FAIL{RESET}"
        print(f"  [{tag}] {name:<34} got={got:>14,.2f}  indec={expected:>14,.2f}  ({tol_s})")
        if not ok:
            self.failures += 1
        return ok


def validate() -> None:
    art = json.loads(config.ARTIFACT_PATHS[0].read_text(encoding="utf-8"))
    ref = config.INDEC_IPCF_Q4_2025
    ipcf = art["measures"]["ipcf"]
    g = Gate()

    print("\n=== HARD GATE: IPCF vs INDEC 'Evolución de la distribución del ingreso, 4º trim. 2025' ===")
    g.check("Gini IPCF", ipcf["gini"], ref["gini"], 0.01)
    g.check("Media IPCF", ipcf["mean"], ref["mean"], 0.02, rel=True)
    g.check("Mediana IPCF", ipcf["median"], ref["median"], 0.02, rel=True)
    g.check("Población (ponderada)", ipcf["population"], ref["population"], 0.01, rel=True)

    print("\n  Decil: participación del ingreso (% — tol ±0.5pp) y media (tol ±5%)")
    by_d = {r["decile"]: r for r in ipcf["deciles"]}
    for rd in ref["deciles"]:
        d = rd["decile"]
        got = by_d[d]
        # The published upper limit ("hasta") of every closed decile, to the peso: share ±0.5 pp
        # and mean ±5% absorb a weighting regression that moves a cutoff by thousands.
        if rd["hasta"] is not None:
            g.check(f"D{d} hasta", got["hasta"], rd["hasta"], 1.0)
        share_ok = abs(got["share"] - rd["share"]) <= 0.5
        mean_ok = abs(got["mean"] - rd["mean"]) / rd["mean"] <= 0.05
        st = f"{GREEN}ok{RESET}" if share_ok else f"{RED}XX{RESET}"
        mt = f"{GREEN}ok{RESET}" if mean_ok else f"{RED}XX{RESET}"
        hasta_got = "—" if got["hasta"] is None else f"{got['hasta']:,.0f}"
        hasta_ref = "—" if rd["hasta"] is None else f"{rd['hasta']:,.0f}"
        print(
            f"    D{d:<2} share {got['share']:>5.1f} vs {rd['share']:>5.1f} [{st}]   "
            f"media {got['mean']:>12,.0f} vs {rd['mean']:>12,.0f} [{mt}]   "
            f"{DIM}hasta {hasta_got:>12} vs {hasta_ref:>12}{RESET}"
        )
        g.failures += (not share_ok) + (not mean_ok)

    # Soft cross-check: our P47T deciles vs INDEC's shipped DECINDR labels.
    print("\n=== CROSS-CHECK: individual income (P47T) vs INDEC's shipped DECINDR labels ===")
    df = load.load_individual()
    sub = df[df["DECINDR"].between(1, 10).fillna(False)].dropna(subset=["P47T", "PONDII"])
    sub = sub[(sub["PONDII"] > 0) & (sub["P47T"] > 0)]
    ind = art["measures"]["individual"]
    by_di = {r["decile"]: r for r in ind["deciles"]}
    worst = 0.0
    for d in range(1, 11):
        rows = sub[sub["DECINDR"] == d]
        official_mean = weighted.weighted_mean(rows["P47T"].to_numpy(float), rows["PONDII"].to_numpy(float))
        ours = by_di[d]["mean"]
        diff = abs(ours - official_mean) / official_mean if official_mean else 0.0
        worst = max(worst, diff)
        flag = f"{GREEN}ok{RESET}" if diff <= 0.05 else f"{RED}>5%{RESET}"
        print(f"    D{d:<2} ours {ours:>12,.0f}  vs DECINDR {official_mean:>12,.0f}  ({diff:5.1%}) [{flag}]")
    print(f"  worst per-decile divergence: {worst:.1%}")

    print()
    if g.failures:
        print(f"{RED}VALIDATION FAILED — {g.failures} hard check(s) missed.{RESET}")
        sys.exit(1)
    print(f"{GREEN}VALIDATION PASSED — pipeline reproduces INDEC's official Q4-2025 figures.{RESET}")


if __name__ == "__main__":
    validate()
