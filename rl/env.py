"""
Gymnasium time-trial environment over the physics port, for any registered Track.

Observation (7-dim, clipped to [-3, 3]):
  [0] signed lateral offset from centerline  / ROAD_HALF_WIDTH
  [1] heading error vs. track direction       / pi
  [2] current speed                           / max_speed
  [3-6] curvature lookahead at +5/+10/+20/+40 samples ahead / pi

Action (2-dim, [-1, 1]): [steer, longitudinal] with +1 = full throttle, -1 = full brake.

Reward: arc-length progress per step - wall_penalty - offtrack_penalty
        (+ an optional bounded Gaussian bonus for hugging an oracle racing line).

Episodes truncate at max_steps and terminate early when stuck at a wall for
_STUCK_THRESHOLD steps or reversing (net backward progress over a sliding window).
Training resets are randomised; eval_mode spawns at the fixed harness.ts sample.
"""

import json
import math
import os
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
SPAWN_SAMPLE = TRACK_DIVISIONS - 14  # mirrors harness.ts
DT = 1 / 60
LOOKAHEADS = (5, 10, 20, 40)

_STUCK_THRESHOLD = 60
_REVERSE_WINDOW = 60
_REVERSE_NET_THRESHOLD = 3  # net backward samples within the window

# Wall penalty scales with approach speed²: a fast slam is costly, a gentle
# low-speed correction against the barrier is nearly free. This avoids the
# wall-grinding / freezing local optimum a flat penalty induces (kinetic-energy
# wall penalty from GT Sport, Fuchs et al. 2020, c_w≈5e-4). At Medium top speed
# (90) this is ≈-4.05; at a 30-unit correction ≈-0.45. Uses the pre-step speed,
# since physics.step already damps speed by 0.45 on first contact.
WALL_PENALTY_COEF = 5e-4


def _arc_length_stats(samples):
    """(average, total) arc length per centerline sample over the loop."""
    n = len(samples)
    seg_lengths = [
        math.hypot(
            samples[(i + 1) % n]["x"] - samples[i]["x"],
            samples[(i + 1) % n]["z"] - samples[i]["z"],
        )
        for i in range(n)
    ]
    return sum(seg_lengths) / n, sum(seg_lengths)


AVG_ARC_LENGTH, TOTAL_TRACK_LENGTH = _arc_length_stats(TRACK_SAMPLES)


def _normalize_angle(a):
    while a > math.pi:
        a -= 2.0 * math.pi
    while a < -math.pi:
        a += 2.0 * math.pi
    return a


def _track_heading(s):
    return math.atan2(s["dirX"], s["dirZ"])


def _signed_lateral(state, s):
    """Metres left (positive) of the track direction, the same cross-product
    convention as spawn_at_sample's left-pointing normal."""
    dx = state.x - s["x"]
    dz = state.z - s["z"]
    return s["dirX"] * dz - s["dirZ"] * dx


class TimeTrialEnv(gym.Env):
    metadata = {"render_modes": []}

    def __init__(
        self,
        track="sunset-ridge",
        difficulty="medium",
        eval_mode=False,
        max_steps=3600,
        line_reward_coef=0.0,
        line_reward_sigma=3.0,
    ):
        super().__init__()
        if track not in TRACKS:
            raise ValueError(f"Unknown track {track!r}; valid: {sorted(TRACKS)}")
        self.track = track
        self.difficulty = difficulty
        self.eval_mode = eval_mode
        self.max_steps = max_steps
        self.line_reward_coef = line_reward_coef
        self._line_sigma = line_reward_sigma
        self._tuning = DIFFICULTY_PHYSICS[difficulty]
        self._samples = TRACKS[track]
        self._track_divisions = len(self._samples)
        self._avg_arc_length, self._total_track_length = _arc_length_stats(self._samples)
        self._spawn_sample = self._track_divisions - 14  # mirrors harness.ts

        # Target signed lateral offset (metres) per center_index for the oracle
        # racing line. Loaded only when the bonus is enabled, so environments
        # without the reference file behave exactly as before.
        self._line_target = None
        if line_reward_coef > 0.0:
            line_path = os.path.join(os.path.dirname(__file__), "experiments", "racing_line.json")
            with open(line_path) as f:
                alpha = np.asarray(json.load(f)["alpha"], dtype=np.float64)
            if alpha.shape[0] != self._track_divisions:
                raise ValueError(
                    f"racing_line.json alpha length {alpha.shape[0]} != "
                    f"track_divisions {self._track_divisions}"
                )
            self._line_target = alpha

        self.observation_space = spaces.Box(low=-3.0, high=3.0, shape=(OBS_DIM,), dtype=np.float32)
        self.action_space = spaces.Box(low=-1.0, high=1.0, shape=(ACTION_DIM,), dtype=np.float32)

        self._state = None
        self._step_count = 0
        self._stuck_steps = 0
        self._progress_window = deque(maxlen=_REVERSE_WINDOW)
        self._total_progress = 0.0

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
        approach_speed = self._state.speed

        self._state = _physics_step(
            self._state,
            {"throttle": throttle, "brake": brake, "steer": steer},
            DT,
            self.difficulty,
            self._samples,
        )
        self._step_count += 1

        # Signed sample delta, wrapped around the loop.
        delta = (self._state.center_index - prev_index) % self._track_divisions
        if delta > self._track_divisions // 2:
            delta -= self._track_divisions
        progress = delta * self._avg_arc_length
        self._total_progress += progress

        wall_penalty = (
            -WALL_PENALTY_COEF * approach_speed * approach_speed
            if self._state.touching_wall else 0.0
        )
        offtrack_penalty = -0.5 if not self._state.on_track else 0.0

        # Bounded Gaussian in the signed lateral error: +coef exactly on the oracle
        # line, decaying to 0 within a few sigma. Non-negative and bounded by coef,
        # so unlike an unbounded quadratic penalty it cannot swamp the progress
        # signal or punish early exploration into net-negative (cf. arXiv:2306.07003).
        line_bonus = 0.0
        if self._line_target is not None:
            s = self._samples[self._state.center_index]
            error = _signed_lateral(self._state, s) - self._line_target[self._state.center_index]
            line_bonus = self.line_reward_coef * math.exp(
                -(error * error) / (self._line_sigma * self._line_sigma)
            )

        reward = float(progress + wall_penalty + offtrack_penalty + line_bonus)

        self._stuck_steps = self._stuck_steps + 1 if self._state.touching_wall else 0
        self._progress_window.append(delta)
        reversing = (
            len(self._progress_window) >= _REVERSE_WINDOW
            and sum(self._progress_window) < -_REVERSE_NET_THRESHOLD
        )
        terminated = bool(self._stuck_steps >= _STUCK_THRESHOLD or reversing)
        truncated = bool(self._step_count >= self.max_steps)

        info = {
            "progress": self._total_progress,
            "touching_wall": self._state.touching_wall,
            "on_track": self._state.on_track,
            "center_index": self._state.center_index,
            "speed": self._state.speed,
        }
        return self._compute_obs(), reward, terminated, truncated, info

    def _compute_obs(self):
        state = self._state
        s = self._samples[state.center_index]
        lateral = _signed_lateral(state, s) / ROAD_HALF_WIDTH
        track_heading = _track_heading(s)
        heading_err = _normalize_angle(state.heading - track_heading) / math.pi
        speed_norm = state.speed / self._tuning["max_speed"]
        curvatures = [
            _normalize_angle(
                _track_heading(self._samples[(state.center_index + offset) % self._track_divisions])
                - track_heading
            ) / math.pi
            for offset in LOOKAHEADS
        ]
        obs = np.array([lateral, heading_err, speed_norm, *curvatures], dtype=np.float32)
        return np.clip(obs, -3.0, 3.0)
