"""Sketch a Track as straights and arcs and write its control points.

    npm run track:sketch -- <slug> <layout.json>

The layout names every piece of the lap in order, starting on the main straight:

    {
      "name": "Arrowhead Raceway",
      "description": "One or two sentences on the layout's character.",
      "checkpoints": 24,
      "startAfter": 150,
      "segments": [["S", "?"], ["L", 120, 60], ["S", 30], ["R", 90, 25], ...]
    }

`["S", metres]` is a straight, `["L" | "R", radius, degrees]` a left or right arc
(left turns anticlockwise on the lobby map). Exactly two straights are `"?"`: their
lengths are solved so the loop closes, so the turns must add up to one full left
lap (net +360 degrees). The start line sits `startAfter` metres into the first
segment. Control points are spaced evenly (~25 m), which the game's uniform
Catmull-Rom spline needs to hold each arc's radius; the layout is centred on the
origin. Writes shared/src/tracks/<slug>.json; refine it in Blender afterwards
(npm run track:new).
"""

import json
import math
import sys
from pathlib import Path

SPACING = 25.0
TRACKS = Path(__file__).resolve().parents[1] / "shared/src/tracks"


def walk(segments):
    """Points every ~SPACING metres along the layout, starting east at the origin."""
    x = z = heading = 0.0
    points = [(x, z)]
    for kind, *args in segments:
        if kind == "S":
            steps = max(1, round(args[0] / SPACING))
            for _ in range(steps):
                x += math.cos(heading) * args[0] / steps
                z -= math.sin(heading) * args[0] / steps
                points.append((x, z))
            continue
        radius, degrees = args
        side = 1 if kind == "L" else -1
        steps = max(1, math.ceil(radius * math.radians(degrees) / SPACING))
        cx, cz = x - math.sin(heading) * radius * side, z - math.cos(heading) * radius * side
        for _ in range(steps):
            heading += math.radians(degrees) / steps * side
            x = cx + math.sin(heading) * radius * side
            z = cz + math.cos(heading) * radius * side
            points.append((x, z))
    return points, math.degrees(heading)


def close(segments):
    """Solve the two "?" straights so the lap ends where it started."""
    open_slots = [i for i, seg in enumerate(segments) if seg == ["S", "?"]]
    if len(open_slots) != 2:
        raise SystemExit('Mark exactly two straights as ["S", "?"]: their lengths close the loop.')

    def end(a, b):
        filled = [["S", a] if i == open_slots[0] else ["S", b] if i == open_slots[1] else s
                  for i, s in enumerate(segments)]
        return walk(filled)[0][-1], filled

    (x0, z0), _ = end(0, 0)
    (xa, za), _ = end(1, 0)
    (xb, zb), _ = end(0, 1)
    ua, ub = (xa - x0, za - z0), (xb - x0, zb - z0)
    det = ua[0] * ub[1] - ua[1] * ub[0]
    if abs(det) < 1e-9:
        raise SystemExit("The two open straights are parallel, so they cannot close the loop.")
    a = (-x0 * ub[1] + z0 * ub[0]) / det
    b = (-ua[0] * z0 + ua[1] * x0) / det
    if a <= 0 or b <= 0:
        raise SystemExit(f"Closing needs straights of {a:.0f} m and {b:.0f} m; reshape the turns.")
    return end(a, b)[1], (a, b)


def main():
    slug, layout_path = sys.argv[1], sys.argv[2]
    layout = json.loads(Path(layout_path).read_text())
    segments = [list(s) for s in layout["segments"]]
    filled, lengths = close(segments)
    points, heading = walk(filled)
    if abs(heading - 360) > 1e-6:
        raise SystemExit(f"The turns add up to {heading:.0f} degrees; a lap needs +360.")
    points = points[:-1]
    shift = round(layout.get("startAfter", 0) / SPACING)
    points = points[shift:] + points[:shift]
    xs, zs = [p[0] for p in points], [p[1] for p in points]
    ox, oz = (max(xs) + min(xs)) / 2, (max(zs) + min(zs)) / 2
    rows = ",\n".join(f"    [{round(x - ox, 1):g}, {round(z - oz, 1):g}]" for x, z in points)
    path = TRACKS / f"{slug}.json"
    path.write_text(
        "{\n"
        f'  "id": "{slug}",\n'
        f'  "name": {json.dumps(layout["name"])},\n'
        f'  "description": {json.dumps(layout["description"])},\n'
        f'  "checkpoints": {json.dumps(layout.get("checkpoints", 12))},\n'
        f'  "controlPoints": [\n{rows}\n  ]\n'
        "}\n"
    )
    print(
        f"Wrote {path.relative_to(TRACKS.parents[2])}: {len(points)} points, open straights "
        f"{lengths[0]:.0f} m and {lengths[1]:.0f} m, extent ±{max(max(xs) - ox, max(zs) - oz):.0f} m"
    )


if __name__ == "__main__":
    main()
