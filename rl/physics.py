"""
Python port of the car physics and track math, mirrored exactly from
shared/src/track.ts (control points, Catmull-Rom sampling, nearest_centerline)
and client/src/game/physics.ts (CarPhysics.update, difficulty tuning, wall clamp).
rl/tests/test_golden.py replays Node-generated trajectories through this port,
so keep the arithmetic order identical to the TypeScript.

Track-taking functions accept a `samples` centerline and default to Sunset Ridge.
"""

import math
from dataclasses import dataclass

ROAD_HALF_WIDTH = 7
BARRIER_OFFSET = 6
TRACK_DIVISIONS = 512

_SUNSET_RIDGE_CONTROL_POINTS = [
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

# "Serpent's Coil": an apex at every control point (ADR 0003).
_STORMHAVEN_CONTROL_POINTS = [
    (232, 30), (228, -60), (218, -150), (188, -202), (110, -220), (25, -220),
    (-65, -208), (-150, -188), (-198, -150), (-190, -102), (-150, -72),
    (-110, -100), (-70, -73), (-30, -100), (10, -70), (45, -94), (95, -70),
    (135, -20), (140, 40), (110, 80), (60, 95), (0, 80), (-70, 112),
    (-140, 150), (-95, 172), (-40, 178), (90, 175), (185, 140), (225, 90),
]


def _catmull_rom(p0, p1, p2, p3, t):
    t2 = t * t
    t3 = t2 * t
    return 0.5 * (
        2 * p1
        + (-p0 + p2) * t
        + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
        + (-p0 + 3 * p1 - 3 * p2 + p3) * t3
    )


def _sample_track(control_points, divisions=TRACK_DIVISIONS):
    n = len(control_points)
    pts = []
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

    samples = []
    for idx, (x, z) in enumerate(pts):
        nx, nz = pts[(idx + 1) % divisions]
        dx = nx - x
        dz = nz - z
        length = math.hypot(dx, dz) or 1.0
        samples.append({"x": x, "z": z, "dirX": dx / length, "dirZ": dz / length})
    return samples


TRACK_SAMPLES = _sample_track(_SUNSET_RIDGE_CONTROL_POINTS)
STORMHAVEN_SAMPLES = _sample_track(_STORMHAVEN_CONTROL_POINTS)
TRACKS = {"sunset-ridge": TRACK_SAMPLES, "stormhaven": STORMHAVEN_SAMPLES}


def nearest_centerline(x, z, samples=TRACK_SAMPLES):
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


DIFFICULTY_PHYSICS = {
    "easy":   {"max_speed": 52,  "engine_accel": 38, "grass_max_speed": 24, "grass_friction": 1.5},
    "medium": {"max_speed": 90,  "engine_accel": 65, "grass_max_speed": 9,  "grass_friction": 6},
    "hard":   {"max_speed": 110, "engine_accel": 80, "grass_max_speed": 5,  "grass_friction": 10},
}

BRAKE_DECEL = 38
REVERSE_MAX_SPEED = 14
COAST_DECEL = 5
DRAG = 0.01
GRASS_DECEL = 110
STEER_RATE = 1.8
WALL_DIST = ROAD_HALF_WIDTH + BARRIER_OFFSET - 1.2


@dataclass
class PhysicsState:
    x: float
    z: float
    heading: float
    speed: float
    on_track: bool = True
    center_index: int = 0
    touching_wall: bool = False


def spawn_at_sample(index, lateral_offset, samples=TRACK_SAMPLES):
    """Offset along the left-pointing normal of the direction of travel."""
    s = samples[index]
    return PhysicsState(
        x=s["x"] + -s["dirZ"] * lateral_offset,
        z=s["z"] + s["dirX"] * lateral_offset,
        heading=math.atan2(s["dirX"], s["dirZ"]),
        speed=0.0,
        center_index=index,
    )


def step(state, action, dt, difficulty="medium", samples=TRACK_SAMPLES):
    """One fixed step of CarPhysics.update; returns a new state. action: throttle/brake in 0..1, steer in -1..1."""
    tuning = DIFFICULTY_PHYSICS[difficulty]
    throttle = action["throttle"]
    brake = action["brake"]
    steer = action["steer"]

    x = state.x
    z = state.z
    heading = state.heading
    speed = state.speed
    touching_wall = state.touching_wall

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

    # No grip at standstill, reduced authority at high speed.
    grip = min(abs(speed) / 14, 1.0) / (1.0 + abs(speed) * 0.015)
    # JS: Math.sign(this.speed || 1) treats 0 as positive.
    speed_sign = 1.0 if speed >= 0.0 else -1.0
    heading += steer * STEER_RATE * grip * speed_sign * dt

    x += math.sin(heading) * speed * dt
    z += math.cos(heading) * speed * dt

    # Barrier: clamp to the wall, one-time speed penalty on first contact.
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

    return PhysicsState(x, z, heading, speed, on_track, center_index, touching_wall)
