"""diffs() recursion across every node type (dict add/remove, list len/element, bool eq/ne,
numeric in/out of tolerance, string eq/ne, the generated_at skip) and main() (arg count,
identical, drift, >50 truncation) plus __main__."""

from __future__ import annotations

import json
import runpy
import sys

import pytest

from pipeline import artifact_check as ac

# runpy.run_module on an already-imported package warns harmlessly; ignore just that.
pytestmark = pytest.mark.filterwarnings("ignore:.*found in sys.modules:RuntimeWarning")


def test_diffs_identical():
    obj = {"a": 1, "b": [1, 2, {"c": "x"}], "d": True}
    assert ac.diffs(obj, json.loads(json.dumps(obj))) == []


def test_diffs_covers_all_node_types():
    old = {
        "a": 1,
        "b": "x",
        "c": True,
        "d": [1, 2, 3],
        "e": {"n": 1},
        "removed": 1,
        "generated_at": "T1",
        "num_far": 1.0,
        "num_close": 1.000000001,
        "bool_ne": True,
        "str_ne": "foo",
        "list_len": [1, 2],
        "type_change": {"x": 1},
    }
    new = {
        "a": 1,
        "b": "x",
        "c": True,
        "d": [1, 2, 3],
        "e": {"n": 1},
        "added": 2,
        "generated_at": "T2",  # differs, but ignored
        "num_far": 999.0,
        "num_close": 1.0,
        "bool_ne": False,
        "str_ne": "bar",
        "list_len": [1],
        "type_change": [1],
    }
    found = ac.diffs(old, new)
    joined = "\n".join(found)
    assert "/removed: present in committed, missing in rebuilt" in found
    assert "/added: present in rebuilt, missing in committed" in found
    assert any("num_far" in d and "beyond tolerance" in d for d in found)
    assert "/bool_ne: True != False" in found
    assert "/str_ne: 'foo' != 'bar'" in found
    assert any("list_len" in d and "list length 2 != 1" in d for d in found)
    assert any("type_change" in d for d in found)
    # Ignored / within-tolerance / equal nodes contribute nothing.
    assert "generated_at" not in joined
    assert "num_close" not in joined


def test_fine_grained_keys_get_their_own_absolute_tolerance():
    # gini is 4-decimal: the 2-decimal ABS_TOL accepted a whole point of Gini (0.427 -> 0.437).
    assert ac.diffs({"gini": 0.427}, {"gini": 0.437}) == ["/gini: 0.427 != 0.437 (beyond tolerance)"]
    assert ac.diffs({"gini": 0.4271}, {"gini": 0.4272}) == []  # one 4-decimal rounding flip
    # lorenz points are 5-decimal and nested in lists: the key is the name before the [i][j].
    old = {"lorenz": [[0.5, 0.20123]]}
    assert ac.diffs(old, {"lorenz": [[0.5, 0.21]]}) == ["/lorenz[0][1]: 0.20123 != 0.21 (beyond tolerance)"]
    assert ac.diffs(old, {"lorenz": [[0.5, 0.20124]]}) == []
    # cap_quantile is a 3-decimal constant.
    assert ac.diffs({"cap_quantile": 0.999}, {"cap_quantile": 0.99}) != []
    assert ac.diffs({"cap_quantile": 0.999}, {"cap_quantile": 0.999}) == []
    # Money keeps the 2-decimal default.
    assert ac.diffs({"median": 450000.0}, {"median": 450000.01}) == []


def test_main_wrong_arg_count():
    assert ac.main(["prog"]) == 2
    assert ac.main(["prog", "only-one"]) == 2


def _write(tmp_path, name, obj):
    p = tmp_path / name
    p.write_text(json.dumps(obj), encoding="utf-8")
    return str(p)


def test_main_identical_returns_0(tmp_path, capsys):
    obj = {"x": 1, "generated_at": "whenever"}
    a = _write(tmp_path, "a.json", obj)
    b = _write(tmp_path, "b.json", {"x": 1, "generated_at": "different"})
    assert ac.main(["prog", a, b]) == 0
    assert "matches the committed version" in capsys.readouterr().out


def test_main_drift_returns_1(tmp_path, capsys):
    a = _write(tmp_path, "a.json", {"x": 1})
    b = _write(tmp_path, "b.json", {"x": 9999})
    assert ac.main(["prog", a, b]) == 1
    out = capsys.readouterr().out
    assert "Artifact drift vs the committed version (1 difference(s)):" in out
    assert "… and" not in out  # single diff -> no truncation line


def test_main_drift_truncates_over_50(tmp_path, capsys):
    a = _write(tmp_path, "a.json", {str(i): i for i in range(60)})
    b = _write(tmp_path, "b.json", {str(i): i + 1000 for i in range(60)})
    assert ac.main(["prog", a, b]) == 1
    assert "… and 10 more" in capsys.readouterr().out


def test_main_module(tmp_path, monkeypatch):
    obj = {"x": 1}
    a = _write(tmp_path, "a.json", obj)
    b = _write(tmp_path, "b.json", obj)
    monkeypatch.setattr(sys, "argv", ["prog", a, b])
    with pytest.raises(SystemExit) as exc:
        runpy.run_module("pipeline.artifact_check", run_name="__main__")
    assert exc.value.code == 0
