"""
Python port of the Sunset Ridge car physics and track math.

Sources mirrored exactly:
  shared/src/track.ts  — CONTROL_POINTS, catmull_rom, sample_track, nearest_centerline
  client/src/game/physics.ts — CarPhysics.update, difficulty constants, wall clamp

Public API:
  TRACK_SAMPLES              list[dict]  512 {x, z, dirX, dirZ} samples
  nearest_centerline(x, z)  -> {index, dist}
  spawn_at_sample(index, lateral_offset)            -> PhysicsState
  step(state, action, dt, difficulty)               -> PhysicsState
"""

import math
from dataclasses import dataclass

# ---------------------------------------------------------------------------
# Track constants  (shared/src/track.ts)
# ---------------------------------------------------------------------------

ROAD_HALF_WIDTH: float = 7
BARRIER_OFFSET: float = 6
TRACK_DIVISIONS: int = 512

# Control points [x, z] of the Sunset Ridge centerline.
_CONTROL_POINTS: list[tuple[float, float]] = [
    (-40, -210), (40, -213), (110, -205),
    (175, -180), (215, -120),
    (196, -58), (157, -20), (178, 32),
    (225, 85), (235, 150),
    (195, 200), (125, 185),
    (70, 215), (5, 185), (-60, 215), (-130, 205),
    (-185, 155),
    (-150, 95), (-100, 60), (-105, -5),
    (-160, -35), (-205, -80),
    (-195, -150), (-130, -195),
]


def _catmull_rom(p0: float, p1: float, p2: float, p3: float, t: float) -> float:
    t2 = t * t
    t3 = t2 * t
    return 0.5 * (
        2 * p1
        + (-p0 + p2) * t
        + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
        + (-p0 + 3 * p1 - 3 * p2 + p3) * t3
    )


def _sample_track(
    control_points: list[tuple[float, float]],
    divisions: int = TRACK_DIVISIONS,
) -> list[dict]:
    n = len(control_points)
    pts: list[tuple[float, float]] = []
    for s in range(divisions):
        u = (s / divisions) * n
        i = int(u)
        t = u - i
        p0 = control_points[(i - 1) % n]
        p1 = control_points[i % n]
        p2 = control_points[(i + 1) % n]
        p3 = control_points[(i + 2) % n]
        x = _catmull_rom(p0[0], p1[0], p2[0], p3[0], t)
        z = _catmull_rom(p0[1], p1[1], p2[1], p3[1], t)
        pts.append((x, z))

    samples: list[dict] = []
    for idx, (x, z) in enumerate(pts):
        nx, nz = pts[(idx + 1) % divisions]
        dx = nx - x
        dz = nz - z
        length = math.hypot(dx, dz) or 1.0
        samples.append({"x": x, "z": z, "dirX": dx / length, "dirZ": dz / length})
    return samples


TRACK_SAMPLES: list[dict] = _sample_track(_CONTROL_POINTS)

# ---------------------------------------------------------------------------
# Stormhaven Circuit  (shared/src/track.ts — STORMHAVEN_CONTROL_POINTS)
# ---------------------------------------------------------------------------

_STORMHAVEN_CONTROL_POINTS: list[tuple[float, float]] = [
    (15, -220), (80, -220), (150, -205),
    (205, -158), (232, -82),
    (220, 0), (210, 80),
    (228, 160), (198, 215),
    (118, 232), (38, 215),
    (-38, 232), (-108, 210), (-172, 232),
    (-215, 182), (-232, 102), (-215, 28),
    (-232, -52), (-200, -118),
    (-220, -170), (-195, -202), (-155, -218),
    (-100, -222), (-45, -220),
]

STORMHAVEN_SAMPLES: list[dict] = _sample_track(_STORMHAVEN_CONTROL_POINTS)


TRACKS: dict[str, list[dict]] = {
    "sunset-ridge": TRACK_SAMPLES,
    "stormhaven": STORMHAVEN_SAMPLES,
}


def nearest_centerline(x: float, z: float, samples: list[dict] = TRACK_SAMPLES) -> dict:
    """Full linear scan — mirrors the TypeScript implementation exactly."""
    best = 0
    best_d2 = float("inf")
    for i, s in enumerate(samples):
        dx = x - s["x"]
        dz = z - s["z"]
        d2 = dx * dx + dz * dz
        if d2 < best_d2:
            best_d2 = d2
            best = i
    return {"index": best, "dist": math.sqrt(best_d2)}


# ---------------------------------------------------------------------------
# Physics constants  (client/src/game/physics.ts)
# ---------------------------------------------------------------------------

DIFFICULTY_PHYSICS: dict[str, dict] = {
    "easy":   {"max_speed": 52,  "engine_accel": 38, "grass_max_speed": 24, "grass_friction": 1.5},
    "medium": {"max_speed": 90,  "engine_accel": 65, "grass_max_speed": 9,  "grass_friction": 6},
    "hard":   {"max_speed": 110, "engine_accel": 80, "grass_max_speed": 5,  "grass_friction": 10},
}

BRAKE_DECEL: float = 38
REVERSE_MAX_SPEED: float = 14
COAST_DECEL: float = 5
DRAG: float = 0.01
GRASS_DECEL: float = 110
STEER_RATE: float = 1.8
WALL_DIST: float = ROAD_HALF_WIDTH + BARRIER_OFFSET - 1.2  # 11.8


@dataclass
class PhysicsState:
    x: float
    z: float
    heading: float
    speed: float
    on_track: bool = True
    center_index: int = 0
    touching_wall: bool = False


def spawn_at_sample(
    index: int,
    lateral_offset: float,
    samples: list[dict] = TRACK_SAMPLES,
) -> PhysicsState:
    """
    Mirror of CarPhysics.spawnAtSample.
    Left-pointing normal of the direction of travel offsets the spawn position.
    """
    s = samples[index]
    nx = -s["dirZ"]
    nz = s["dirX"]
    return PhysicsState(
        x=s["x"] + nx * lateral_offset,
        z=s["z"] + nz * lateral_offset,
        heading=math.atan2(s["dirX"], s["dirZ"]),
        speed=0.0,
        on_track=True,
        center_index=index,
        touching_wall=False,
    )


def step(
    state: PhysicsState,
    action: dict,
    dt: float,
    difficulty: str = "medium",
    samples: list[dict] = TRACK_SAMPLES,
) -> PhysicsState:
    """
    Pure stepping function mirroring CarPhysics.update.
    Returns a new PhysicsState; the input state is not mutated.

    action keys: throttle (0–1), brake (0–1), steer (−1 to 1).
    """
    tuning = DIFFICULTY_PHYSICS[difficulty]

    throttle: float = action["throttle"]
    brake: float = action["brake"]
    steer: float = action["steer"]

    x = state.x
    z = state.z
    heading = state.heading
    speed = state.speed
    touching_wall = state.touching_wall

    # --- Throttle / brake / coast ---
    if throttle > 0:
        speed += tuning["engine_accel"] * throttle * dt
    if brake > 0:
        speed -= BRAKE_DECEL * brake * dt
    if throttle == 0 and brake == 0:
        c = COAST_DECEL * dt
        if abs(speed) <= c:
            speed = 0.0
        else:
            speed -= math.copysign(c, speed)
    speed -= speed * abs(speed) * DRAG * dt

    # --- Surface limits ---
    before = nearest_centerline(x, z, samples)
    on_track = before["dist"] <= ROAD_HALF_WIDTH + 0.6
    limit = tuning["max_speed"] if on_track else tuning["grass_max_speed"]
    if speed > limit:
        speed = max(limit, speed - GRASS_DECEL * dt)
    if not on_track and speed != 0:
        f = tuning["grass_friction"] * dt
        if abs(speed) <= f:
            speed = 0.0
        else:
            speed -= math.copysign(f, speed)
    if speed < -REVERSE_MAX_SPEED:
        speed = -REVERSE_MAX_SPEED

    # --- Steering: no grip at standstill, reduced authority at high speed ---
    grip = min(abs(speed) / 14, 1.0) / (1.0 + abs(speed) * 0.015)
    # JS: Math.sign(this.speed || 1) — treats 0 as positive (falsy → 1)
    speed_sign = 1.0 if speed >= 0.0 else -1.0
    heading += steer * STEER_RATE * grip * speed_sign * dt

    # --- Integrate position ---
    x += math.sin(heading) * speed * dt
    z += math.cos(heading) * speed * dt

    # --- Barrier collision: clamp to wall, one-time speed penalty on contact ---
    after = nearest_centerline(x, z, samples)
    center_index = after["index"]
    if after["dist"] > WALL_DIST:
        s = samples[after["index"]]
        inv = 1.0 / after["dist"]
        x = s["x"] + (x - s["x"]) * inv * WALL_DIST
        z = s["z"] + (z - s["z"]) * inv * WALL_DIST
        if not touching_wall:
            speed *= 0.45
            touching_wall = True
    elif after["dist"] < WALL_DIST - 0.5:
        touching_wall = False

    return PhysicsState(
        x=x,
        z=z,
        heading=heading,
        speed=speed,
        on_track=on_track,
        center_index=center_index,
        touching_wall=touching_wall,
    )
