"""
Gymnasium environment wrapping the racing car physics for any registered Track.

Observation (7-dim, normalized to [-3, 3]):
  [0] signed lateral offset from centerline  / ROAD_HALF_WIDTH
  [1] heading error vs. track direction       / pi
  [2] current speed                           / max_speed
  [3-6] curvature lookahead at +5/+10/+20/+40 samples ahead / pi

Action (2-dim, continuous [-1, 1]):
  [0] steer         (-1 = full left, +1 = full right)
  [1] longitudinal  (+1 = full throttle, -1 = full brake)

Reward: arc-length progress per step - wall_penalty - offtrack_penalty

Episode:
  - Capped at max_steps (truncation)
  - Early terminated when stuck at wall ≥60 steps, or reversing (net
    backward progress over a 60-step sliding window)
  - Randomized reset for training; fixed spawn (_spawn_sample) for eval
"""

import math
from collections import deque

import numpy as np
import gymnasium as gym
from gymnasium import spaces

from physics import (
    PhysicsState,
    step as _physics_step,
    spawn_at_sample,
    TRACKS,
    TRACK_SAMPLES,
    TRACK_DIVISIONS,
    ROAD_HALF_WIDTH,
    DIFFICULTY_PHYSICS,
)

OBS_DIM = 7
ACTION_DIM = 2
SPAWN_SAMPLE = TRACK_DIVISIONS - 14  # mirrors harness.ts (Sunset Ridge default)
DT = 1 / 60
LOOKAHEADS = (5, 10, 20, 40)


def _arc_length_stats(samples: list[dict]) -> tuple[float, float]:
    """Return (average, total) arc-length per centerline sample over the loop."""
    n = len(samples)
    seg_lengths = [
        math.hypot(
            samples[(i + 1) % n]["x"] - samples[i]["x"],
            samples[(i + 1) % n]["z"] - samples[i]["z"],
        )
        for i in range(n)
    ]
    return sum(seg_lengths) / n, sum(seg_lengths)


# Module-level defaults (Sunset Ridge) kept for backward compatibility
AVG_ARC_LENGTH, TOTAL_TRACK_LENGTH = _arc_length_stats(TRACK_SAMPLES)

# Termination thresholds
_STUCK_THRESHOLD = 60       # consecutive wall-contact steps → terminate
_REVERSE_WINDOW = 60        # step window for reverse detection
_REVERSE_NET_THRESHOLD = 3  # net backward samples within window → terminate


def _normalize_angle(a: float) -> float:
    while a > math.pi:
        a -= 2.0 * math.pi
    while a < -math.pi:
        a += 2.0 * math.pi
    return a


class TimeTrialEnv(gym.Env):
    """Single-car time-trial on a configurable Track."""

    metadata: dict = {"render_modes": []}

    def __init__(
        self,
        track: str = "sunset-ridge",
        difficulty: str = "medium",
        eval_mode: bool = False,
        max_steps: int = 3600,
    ) -> None:
        super().__init__()
        if track not in TRACKS:
            raise ValueError(f"Unknown track {track!r}; valid: {sorted(TRACKS)}")
        self.track = track
        self.difficulty = difficulty
        self.eval_mode = eval_mode
        self.max_steps = max_steps
        self._tuning = DIFFICULTY_PHYSICS[difficulty]
        self._samples = TRACKS[track]
        self._track_divisions = len(self._samples)
        self._avg_arc_length, self._total_track_length = _arc_length_stats(self._samples)
        self._spawn_sample: int = self._track_divisions - 14  # mirrors harness.ts

        self.observation_space = spaces.Box(
            low=-3.0, high=3.0, shape=(OBS_DIM,), dtype=np.float32
        )
        self.action_space = spaces.Box(
            low=-1.0, high=1.0, shape=(ACTION_DIM,), dtype=np.float32
        )

        self._state: PhysicsState | None = None
        self._step_count: int = 0
        self._stuck_steps: int = 0
        self._progress_window: deque[int] = deque(maxlen=_REVERSE_WINDOW)
        self._total_progress: float = 0.0

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        if self.eval_mode:
            idx = self._spawn_sample
            lateral = 0.0
        else:
            idx = int(self.np_random.integers(0, self._track_divisions))
            lateral = float(self.np_random.uniform(-2.0, 2.0))

        self._state = spawn_at_sample(idx, lateral, self._samples)
        self._step_count = 0
        self._stuck_steps = 0
        self._progress_window = deque(maxlen=_REVERSE_WINDOW)
        self._total_progress = 0.0

        return self._compute_obs(), {}

    def step(self, action):
        steer = float(np.clip(action[0], -1.0, 1.0))
        longitudinal = float(np.clip(action[1], -1.0, 1.0))
        throttle = max(0.0, longitudinal)
        brake = max(0.0, -longitudinal)

        prev_index = self._state.center_index

        self._state = _physics_step(
            self._state,
            {"throttle": throttle, "brake": brake, "steer": steer},
            DT,
            self.difficulty,
            self._samples,
        )
        self._step_count += 1

        # Signed arc-length progress this step
        delta = (self._state.center_index - prev_index) % self._track_divisions
        if delta > self._track_divisions // 2:
            delta -= self._track_divisions
        progress = delta * self._avg_arc_length
        self._total_progress += progress

        # Reward
        wall_penalty = -2.0 if self._state.touching_wall else 0.0
        offtrack_penalty = -0.5 if not self._state.on_track else 0.0
        reward = float(progress + wall_penalty + offtrack_penalty)

        # Stuck counter: any wall contact persisting (regardless of speed)
        if self._state.touching_wall:
            self._stuck_steps += 1
        else:
            self._stuck_steps = 0

        # Reverse detection: sliding window of signed sample deltas
        self._progress_window.append(delta)
        window_net = sum(self._progress_window)
        reverse_terminated = (
            len(self._progress_window) >= _REVERSE_WINDOW
            and window_net < -_REVERSE_NET_THRESHOLD
        )

        terminated = bool(
            self._stuck_steps >= _STUCK_THRESHOLD or reverse_terminated
        )
        truncated = bool(self._step_count >= self.max_steps)

        info = {
            "progress": self._total_progress,
            "touching_wall": self._state.touching_wall,
            "on_track": self._state.on_track,
            "center_index": self._state.center_index,
            "speed": self._state.speed,
        }
        return self._compute_obs(), reward, terminated, truncated, info

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _compute_obs(self) -> np.ndarray:
        state = self._state
        s = self._samples[state.center_index]

        dx = state.x - s["x"]
        dz = state.z - s["z"]
        # Signed lateral: dirX*dz - dirZ*dx > 0 ⟹ car is LEFT of track direction
        # (same cross-product convention as spawnAtSample's left-pointing normal)
        lateral = (s["dirX"] * dz - s["dirZ"] * dx) / ROAD_HALF_WIDTH

        track_heading = math.atan2(s["dirX"], s["dirZ"])
        heading_err = _normalize_angle(state.heading - track_heading) / math.pi

        speed_norm = state.speed / self._tuning["max_speed"]

        curvatures: list[float] = []
        for offset in LOOKAHEADS:
            ahead_idx = (state.center_index + offset) % self._track_divisions
            ahead_s = self._samples[ahead_idx]
            ahead_heading = math.atan2(ahead_s["dirX"], ahead_s["dirZ"])
            curvatures.append(
                _normalize_angle(ahead_heading - track_heading) / math.pi
            )

        obs = np.array(
            [lateral, heading_err, speed_norm, *curvatures], dtype=np.float32
        )
        return np.clip(obs, -3.0, 3.0)
