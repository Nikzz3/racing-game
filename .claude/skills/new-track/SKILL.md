---
name: new-track
description: Design, build and ship a new Track (map, circuit) — sketch, Blender, drivability check, critique, integration. Use when adding a Track or reshaping one drawn with track_tools.py.
---

# New Track

A Track goes from brief to release through one loop: **sketch → check → critique**, repeated until the critic is satisfied, then **Blender → export → integrate**. Tool reference (commands, what the generator builds, file layout): the Tracks section of `assets/blender/README.md`. Why it works this way: ADR-0012.

Run `npm run track:*` and headless Blender outside the sandbox: Blender crashes on Metal detection and `tsx` needs an IPC pipe.

## 1. Brief

Pin down the intent with the user: character (fast, technical, flowing), difficulty, anything that must feature. Research real circuits and racing-game design for ideas when the brief invites it. Open each existing Track's `track-reports/<slug>/map.png` (run `track:check` on it first) so the new silhouette is _unique_ against every one. Done when you can state the Track in one sentence; that sentence becomes its `description`.

## 2. Sketch and check

Write a layout of straights and arcs in `$TMPDIR/<slug>-layout.json` (format: `scripts/sketch_track.py`), then:

```
npm run track:sketch -- <slug> $TMPDIR/<slug>-layout.json
npm run track:check -- <slug>
```

Read `report.md`, `map.png` and `speed.png`. Done when every hard rule passes and every design target is met or consciously waived with the user. Levers:

- Car physics fix the corner speeds: full lock holds a 50 m radius at ~185 km/h, and Medium is flat out above ~118 m. Below ~10 m the car cannot turn on the tarmac at all.
- Lengthening a link straight on one side lengthens the two solved straights; shorten links to shrink a layout past the ±360 m scenery limit.
- A failing chord/arc ratio means a hairpin sits between two gates: raise `checkpoints`.

## 3. Critique

Be the _critic_ the user cannot be from numbers alone: judge `map.png` and `speed.png` for flow (each section leads into the next), rhythm (the speed trace alternates flat-out runs with distinct braking or lifting moments, not a monotone or a saw-tooth), at least one heavy braking zone after a long straight (the overtaking spot), variety of corner speeds, uniqueness against the other maps, and lap length close to the other Tracks. Show the user the map, the speed trace and your critique; iterate on step 2 until they approve the shape.

## 4. Blender

```
npm run track:new -- <slug> "<Name>"
```

Shape the details in `assets/blender/tracks/<slug>.blend`: move `centerline` points, keeping ~25 m spacing, and rebuild with `track_tools.py`. Prefer headless renders or the user's own Blender over loading files through Blender MCP, whose server stops when a different file is opened. Then:

```
npm run track:export -- <slug>
npm run track:check -- <slug>
```

Done when the export round-trips (re-exporting changes nothing in the JSON) and the check still passes.

## 5. Integrate

- Import the JSON in `shared/src/track.ts` `with { type: "json" }` (Playwright and the Railway server load it through plain Node) and append the Track to `TRACKS` (lobby order).
- Name the Track in `CONTEXT.md`'s Track entry and the player-facing `README.md` line.
- `npm test`, `npm run typecheck`, `npm run lint`, `npx oxfmt --check`: the asset and layout tests cover every Track automatically.
- `npm run test:e2e -- specs/track-start.spec.ts`: in the real client and server, crossing the start line starts the lap timer and the server counts the gates after it. Done when the new Track's test is green.
- Drive it in the running app when one serves this checkout: the timer starts at the line and the `CP x/N` counter climbs.
- Shipping touches `client/` and `shared/`, so cut the desktop release as `AGENTS.md` describes.
