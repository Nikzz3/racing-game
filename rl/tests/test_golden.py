"""
Golden fidelity tests: replay Node-generated reference trajectories through the
Python physics port and assert position/heading/speed match to 1e-9.

The references are generated fresh from the TypeScript CarPhysics via
`npx tsx rl/gen_golden.ts`, so any drift between the TypeScript source and this
port fails the suite.
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "rl"))

from physics import STORMHAVEN_SAMPLES, spawn_at_sample, step  # noqa: E402

# Both JS and Python use IEEE 754 float64, so the same arithmetic agrees to ~15
# significant figures; 1e-9 accommodates platform-level sin/cos differences.
TOL = 1e-9
SPAWN_SAMPLE = 512 - 14  # matches harness.ts

TRAJECTORY_SCENARIOS = [
    ("straight_throttle_medium", "medium"),
    ("wall_collision_medium", "medium"),
    ("off_track_grass_medium", "medium"),
    ("reverse_medium", "medium"),
    ("straight_throttle_easy", "easy"),
    ("straight_throttle_hard", "hard"),
]


def _run_generator(script):
    result = subprocess.run(
        ["npx", "tsx", str(REPO_ROOT / "rl" / script)],
        cwd=str(REPO_ROOT), capture_output=True, text=True, check=True,
    )
    return json.loads(result.stdout)


@pytest.fixture(scope="module")
def golden_scenarios():
    return {s["name"]: s for s in _run_generator("gen_golden.ts")}


@pytest.fixture(scope="module")
def stormhaven_ts_samples():
    return _run_generator("gen_stormhaven_samples.ts")


def _replay_python(inputs, difficulty):
    state = spawn_at_sample(SPAWN_SAMPLE, 0.0)
    trajectory = []
    for inp in inputs:
        state = step(state, inp, 1 / 60, difficulty)
        trajectory.append({"x": state.x, "z": state.z, "heading": state.heading, "speed": state.speed})
    return trajectory


@pytest.mark.parametrize("name,difficulty", TRAJECTORY_SCENARIOS)
def test_trajectory_matches_reference(golden_scenarios, name, difficulty):
    ref = golden_scenarios[name]["trajectory"]
    got = _replay_python(golden_scenarios[name]["inputs"], difficulty)
    assert len(ref) == len(got), f"{name}: trajectory length mismatch: ref={len(ref)}, got={len(got)}"
    for i, (r, g) in enumerate(zip(ref, got)):
        for key in ("x", "z", "speed", "heading"):
            diff = abs(r[key] - g[key])
            assert diff <= TOL, (
                f"{name} step {i} key '{key}': ref={r[key]:.15g}, got={g[key]:.15g}, diff={diff:.3e}"
            )


def test_wall_collision_scenario_hits_the_barrier(golden_scenarios):
    """The reference contains the one-time 0.45x speed drop of a wall contact."""
    speeds = [s["speed"] for s in golden_scenarios["wall_collision_medium"]["trajectory"]]
    drops = [i for i in range(1, len(speeds)) if speeds[i] < speeds[i - 1] * 0.5 and speeds[i - 1] > 5]
    assert drops, "wall_collision scenario never hit the barrier"


def test_grass_scenario_reaches_the_grass_speed_cap(golden_scenarios):
    trajectory = golden_scenarios["off_track_grass_medium"]["trajectory"]
    assert any(s["speed"] <= 9.01 for s in trajectory), "off_track scenario never reached grass speed cap"


def test_reverse_scenario_respects_the_reverse_speed_clamp(golden_scenarios):
    min_speed = min(s["speed"] for s in golden_scenarios["reverse_medium"]["trajectory"])
    assert min_speed >= -14.001, f"speed went below reverse limit: {min_speed}"


def test_difficulties_produce_distinct_top_speeds(golden_scenarios):
    speeds = {
        diff: max(s["speed"] for s in golden_scenarios[f"straight_throttle_{diff}"]["trajectory"])
        for diff in ("easy", "medium", "hard")
    }
    assert speeds["easy"] < speeds["medium"] < speeds["hard"], speeds


def test_stormhaven_samples_match_typescript(stormhaven_ts_samples):
    """TS and Python derive identical Stormhaven samples from the same control points (ADR 0003)."""
    assert len(stormhaven_ts_samples) == len(STORMHAVEN_SAMPLES) == 512
    for i, (r, g) in enumerate(zip(stormhaven_ts_samples, STORMHAVEN_SAMPLES)):
        for key in ("x", "z", "dirX", "dirZ"):
            diff = abs(r[key] - g[key])
            assert diff <= TOL, f"Stormhaven sample {i} key '{key}': TS={r[key]:.15g}, Python={g[key]:.15g}"
