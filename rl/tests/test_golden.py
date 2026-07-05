"""
Golden fidelity tests: replay Node-generated reference trajectories through the
Python physics port and assert position/heading/speed match within tolerance.

Coverage:
  - straight_throttle_medium  basic acceleration, drag, speed cap
  - wall_collision_medium     barrier clamp + one-time speed penalty discontinuity
  - off_track_grass_medium    grass friction and grassMaxSpeed cap
  - reverse_medium            negative-speed (brake from rest)
  - straight_throttle_easy    easy difficulty constants
  - straight_throttle_hard    hard difficulty constants

The reference trajectories are generated fresh from the TypeScript CarPhysics via
  npx tsx rl/gen_golden.ts
so any drift between the TypeScript source and this Python port fails the suite.
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest

# --- repo root so 'npx' resolves the workspace node_modules ---
REPO_ROOT = Path(__file__).resolve().parents[2]
GEN_GOLDEN = REPO_ROOT / "rl" / "gen_golden.ts"
GEN_STORMHAVEN = REPO_ROOT / "rl" / "gen_stormhaven_samples.ts"


# Numerical tolerance: both JS and Python use IEEE 754 float64; the same
# arithmetic should agree to ~15 significant figures.  We allow 1e-9 to
# accommodate platform-level sin/cos differences.
POS_TOL = 1e-9
SPD_TOL = 1e-9
HDG_TOL = 1e-9


@pytest.fixture(scope="module")
def golden_scenarios() -> list[dict]:
    """Run gen_golden.ts once per test module; cache result in memory."""
    result = subprocess.run(
        ["npx", "tsx", str(GEN_GOLDEN)],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(result.stdout)


def _find_scenario(scenarios: list[dict], name: str) -> dict:
    for s in scenarios:
        if s["name"] == name:
            return s
    pytest.fail(f"Scenario '{name}' not found in golden output")


def _replay_python(inputs: list[dict], difficulty: str) -> list[dict]:
    """Replay inputs through the Python physics port; return trajectory."""
    sys.path.insert(0, str(REPO_ROOT / "rl"))
    from physics import spawn_at_sample, step  # noqa: PLC0415

    SPAWN_SAMPLE = 512 - 14  # matches harness.ts SPAWN_SAMPLE

    state = spawn_at_sample(SPAWN_SAMPLE, 0.0)
    trajectory = []
    for inp in inputs:
        state = step(state, inp, 1 / 60, difficulty)
        trajectory.append(
            {"x": state.x, "z": state.z, "heading": state.heading, "speed": state.speed}
        )
    return trajectory


def _assert_trajectories_match(ref: list[dict], got: list[dict], scenario_name: str) -> None:
    assert len(ref) == len(got), (
        f"{scenario_name}: trajectory length mismatch: ref={len(ref)}, got={len(got)}"
    )
    for i, (r, g) in enumerate(zip(ref, got)):
        for key, tol in (("x", POS_TOL), ("z", POS_TOL), ("speed", SPD_TOL), ("heading", HDG_TOL)):
            diff = abs(r[key] - g[key])
            assert diff <= tol, (
                f"{scenario_name} step {i} key '{key}': "
                f"ref={r[key]:.15g}, got={g[key]:.15g}, diff={diff:.3e} > tol={tol:.0e}"
            )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestStraightThrottleMedium:
    """Basic physics: acceleration, drag, and medium speed cap."""

    def test_trajectory_matches_reference(self, golden_scenarios):
        scenario = _find_scenario(golden_scenarios, "straight_throttle_medium")
        ref = scenario["trajectory"]
        got = _replay_python(scenario["inputs"], "medium")
        _assert_trajectories_match(ref, got, "straight_throttle_medium")


class TestWallCollisionMedium:
    """Wall contact clamp + one-time 0.45× speed penalty discontinuity."""

    def test_trajectory_matches_reference(self, golden_scenarios):
        scenario = _find_scenario(golden_scenarios, "wall_collision_medium")
        ref = scenario["trajectory"]
        got = _replay_python(scenario["inputs"], "medium")
        _assert_trajectories_match(ref, got, "wall_collision_medium")

    def test_wall_hit_occurs(self, golden_scenarios):
        """Verify the reference contains an actual wall-contact speed drop."""
        scenario = _find_scenario(golden_scenarios, "wall_collision_medium")
        ref = scenario["trajectory"]
        speeds = [step["speed"] for step in ref]
        drops = [
            i for i in range(1, len(speeds))
            if speeds[i] < speeds[i - 1] * 0.5 and speeds[i - 1] > 5
        ]
        assert len(drops) > 0, "wall_collision scenario never hit the barrier"


class TestOffTrackGrassMedium:
    """Grass friction cap and grassFriction deceleration."""

    def test_trajectory_matches_reference(self, golden_scenarios):
        scenario = _find_scenario(golden_scenarios, "off_track_grass_medium")
        ref = scenario["trajectory"]
        got = _replay_python(scenario["inputs"], "medium")
        _assert_trajectories_match(ref, got, "off_track_grass_medium")

    def test_grass_speed_cap_applies(self, golden_scenarios):
        """Verify some steps in the reference have speed ≤ grassMaxSpeed (9 m/s)."""
        scenario = _find_scenario(golden_scenarios, "off_track_grass_medium")
        capped = [s for s in scenario["trajectory"] if s["speed"] <= 9.01]
        assert len(capped) > 0, "off_track scenario never reached grass speed cap"


class TestReverseMedium:
    """Reverse: braking from rest drives speed to −REVERSE_MAX_SPEED (−14)."""

    def test_trajectory_matches_reference(self, golden_scenarios):
        scenario = _find_scenario(golden_scenarios, "reverse_medium")
        ref = scenario["trajectory"]
        got = _replay_python(scenario["inputs"], "medium")
        _assert_trajectories_match(ref, got, "reverse_medium")

    def test_reverse_speed_clamp(self, golden_scenarios):
        """Speed must not go below −14 m/s."""
        scenario = _find_scenario(golden_scenarios, "reverse_medium")
        min_speed = min(s["speed"] for s in scenario["trajectory"])
        assert min_speed >= -14.001, f"speed went below reverse limit: {min_speed}"


class TestDifficultyVariants:
    """All three difficulties are selectable and reproduce correct constants."""

    def test_easy_trajectory_matches(self, golden_scenarios):
        scenario = _find_scenario(golden_scenarios, "straight_throttle_easy")
        ref = scenario["trajectory"]
        got = _replay_python(scenario["inputs"], "easy")
        _assert_trajectories_match(ref, got, "straight_throttle_easy")

    def test_hard_trajectory_matches(self, golden_scenarios):
        scenario = _find_scenario(golden_scenarios, "straight_throttle_hard")
        ref = scenario["trajectory"]
        got = _replay_python(scenario["inputs"], "hard")
        _assert_trajectories_match(ref, got, "straight_throttle_hard")

    def test_difficulties_produce_distinct_speeds(self, golden_scenarios):
        """Easy, medium, hard must produce different max speeds after 120 throttle steps."""
        speeds = {}
        for diff in ("easy", "medium", "hard"):
            s = _find_scenario(golden_scenarios, f"straight_throttle_{diff}")
            speeds[diff] = max(step["speed"] for step in s["trajectory"])
        assert speeds["easy"] < speeds["medium"] < speeds["hard"], (
            f"Expected easy < medium < hard max speed; got {speeds}"
        )


# ---------------------------------------------------------------------------
# Stormhaven Circuit TS↔Python sample parity
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def stormhaven_ts_samples() -> list[dict]:
    """Run gen_stormhaven_samples.ts once; cache in memory."""
    result = subprocess.run(
        ["npx", "tsx", str(GEN_STORMHAVEN)],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(result.stdout)


class TestStormhavenSampleParity:
    """TS and Python must derive identical Stormhaven Circuit samples from the same control points."""

    def test_sample_count_matches(self, stormhaven_ts_samples):
        sys.path.insert(0, str(REPO_ROOT / "rl"))
        from physics import STORMHAVEN_SAMPLES  # noqa: PLC0415

        assert len(stormhaven_ts_samples) == len(STORMHAVEN_SAMPLES), (
            f"TS produced {len(stormhaven_ts_samples)} samples; "
            f"Python produced {len(STORMHAVEN_SAMPLES)} samples"
        )

    def test_all_samples_match(self, stormhaven_ts_samples):
        sys.path.insert(0, str(REPO_ROOT / "rl"))
        from physics import STORMHAVEN_SAMPLES  # noqa: PLC0415

        ref = stormhaven_ts_samples
        got = STORMHAVEN_SAMPLES
        for i, (r, g) in enumerate(zip(ref, got)):
            for key in ("x", "z", "dirX", "dirZ"):
                diff = abs(r[key] - g[key])
                assert diff <= POS_TOL, (
                    f"Stormhaven sample {i} key '{key}': "
                    f"TS={r[key]:.15g}, Python={g[key]:.15g}, diff={diff:.3e} > tol={POS_TOL:.0e}"
                )

    def test_stormhaven_has_512_samples(self, stormhaven_ts_samples):
        assert len(stormhaven_ts_samples) == 512
