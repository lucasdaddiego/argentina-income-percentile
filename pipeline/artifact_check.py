"""Compare two artifact JSONs within a numeric tolerance (ignoring `generated_at`).

CI uses this instead of an exact `git diff` so the committed artifact is checked against the
pipeline output without tripping on last-decimal float differences across platforms — while
still catching real drift (a hand-edited number, a changed string, a structural change).

    uv run python -m pipeline.artifact_check OLD.json NEW.json

Numbers must match within REL_TOL and the absolute tolerance for their key (ABS_TOL_BY_KEY, else
ABS_TOL); everything else (strings, structure, null) must match exactly. Each absolute tolerance
is just over that key's rounding quantum, so a boundary rounding flip is tolerated but a genuine
edit is not.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

REL_TOL = 1e-6
# > one 2-decimal rounding quantum (0.01): pesos (percentiles, mean, median, p25/p75, deciles,
# histogram edges, cap), shares and percentages, CPI index points. Integer keys (population,
# counts, n) use it too.
ABS_TOL = 0.011
# Keys rounded finer than 2 decimals need their own floor: next to a value below 1.0, the blanket
# 0.011 accepts a real change (Gini 0.427 -> 0.437 passed). Each entry is just over the key's own
# rounding quantum:
#   gini          round(gini, 4) in build.py (the INDEC and history copies have 3 decimals)
#   lorenz        round(x, 5) in weighted.lorenz_and_gini, a list of [pop_share, income_share]
#   cap_quantile  the 0.999 histogram cap, 3 decimals
# Keyed on the last path segment without its list indices: "/measures/ipcf/lorenz[3][1]" -> "lorenz".
ABS_TOL_BY_KEY = {"gini": 1.1e-4, "lorenz": 1.1e-5, "cap_quantile": 1.1e-3}
IGNORE_KEYS = {"generated_at"}


def diffs(old, new, path: str = "") -> list[str]:
    if isinstance(old, dict) and isinstance(new, dict):
        out: list[str] = []
        for k in old.keys() - new.keys():
            out.append(f"{path}/{k}: present in committed, missing in rebuilt")
        for k in new.keys() - old.keys():
            out.append(f"{path}/{k}: present in rebuilt, missing in committed")
        for k in old.keys() & new.keys():
            if k not in IGNORE_KEYS:
                out += diffs(old[k], new[k], f"{path}/{k}")
        return out
    if isinstance(old, list) and isinstance(new, list):
        if len(old) != len(new):
            return [f"{path}: list length {len(old)} != {len(new)}"]
        return [d for i, (a, b) in enumerate(zip(old, new, strict=True)) for d in diffs(a, b, f"{path}[{i}]")]
    # bool is a subclass of int — compare it exactly, before the numeric branch.
    if isinstance(old, bool) or isinstance(new, bool):
        return [] if old is new else [f"{path}: {old!r} != {new!r}"]
    if isinstance(old, (int, float)) and isinstance(new, (int, float)):
        abs_tol = ABS_TOL_BY_KEY.get(path.rsplit("/", 1)[-1].split("[", 1)[0], ABS_TOL)
        if math.isclose(old, new, rel_tol=REL_TOL, abs_tol=abs_tol):
            return []
        return [f"{path}: {old} != {new} (beyond tolerance)"]
    return [] if old == new else [f"{path}: {old!r} != {new!r}"]


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("usage: python -m pipeline.artifact_check OLD.json NEW.json", file=sys.stderr)
        return 2
    old = json.loads(Path(argv[1]).read_text(encoding="utf-8"))
    new = json.loads(Path(argv[2]).read_text(encoding="utf-8"))
    found = diffs(old, new)
    if found:
        print(f"Artifact drift vs the committed version ({len(found)} difference(s)):")
        for d in found[:50]:
            print(f"  {d}")
        if len(found) > 50:
            print(f"  … and {len(found) - 50} more")
        print("Run `make data` and commit the regenerated artifact.")
        return 1
    print(f"OK — {argv[2]} matches the committed version (within tolerance).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
