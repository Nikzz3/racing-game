# Tracks are drawn in Blender, stored as JSON, and shipped as their own files

A Track used to live in three places that had to agree by hand: control points typed into
`shared/src/track.ts`, a copy of them in `rl/physics.py`, and road meshes baked into the
67 MB `assets/blender/sunset-ridge.blend` by a generator script that was later deleted.
Every Blender save rewrote the whole library in git (`.git` reached 1.2 GB after 13 saves),
so adding Tracks one by one would have grown history by roughly 110 MB per Track (`.blend`
plus GLB).

## Decision

- **One source per Track: `shared/src/tracks/<slug>.json`** (name, description, checkpoint
  layout, control points). `track.ts` builds every `Track` from these files and lists them in
  `TRACKS`; `rl/physics.py` reads the same files, and the existing golden tests keep the two
  samplers equal.
- **New Tracks are drawn in their own `assets/blender/tracks/<slug>.blend`**, as one closed
  `centerline` poly curve. Its points are the control points. `assets/blender/track_tools.py`
  rebuilds the road, curbs, start line and lobby diorama from the same Catmull-Rom samples the
  game drives on (it imports the golden-tested Python sampler), and writes both the JSON and
  `client/public/models/tracks/<slug>.glb`. The `.blend` links its materials and preview trees
  from the library, so it is a few hundred KB; the GLB carries no textures and is under 1 MB.
- **The client swaps in the library's textured materials by name.** `models.ts` loads a track
  file for every Track the library lacks, and a material registered under a name is reused by
  every later file. Sunset Ridge and Stormhaven stay in the library until they are next
  edited.
- **A Track owns its checkpoint count** (extending ADR-0003): `checkpoints` is either a number
  of evenly spaced gates or `"control-points"`. The global twelve-gate constant is gone;
  Sunset Ridge keeps twelve, and Arrowhead uses 24 because twelve gates over its 2.3 km lap
  straddle the hairpin.
- **Drivability is checked by a tidy driver, not by eye.** `runRacingLineLap` brakes on Jev's
  speed check and steers for the racing line with no model in the loop (ADR-0011's
  arithmetic). CI holds every Track to the game's invariants (barrier clearance, gates on the
  road in order, chord/arc ≥ 0.8, a lap on every Difficulty); `npm run track:check` adds the
  bar for new Tracks (≤ 5% off-road on every Difficulty) and the "long straights, easy
  corners" design targets, with a map and speed trace for a reviewer.

## Considered Options

- **Keep adding Tracks to the library (rejected):** zero loader change, but every Track costs
  a full library commit and enlarges the startup download for every player.
- **Author in Blender, read meshes back for gameplay (rejected):** the game needs the
  centerline, not a mesh; a curve whose points are the control points keeps one source and
  makes "the road you see is the road you drive" true by construction.
- **The existing autopilot as the drivability gate (rejected):** it never brakes for corners,
  so any Track with a long straight into a hairpin fails it while being easy for a person.

## Consequences

- Adding a Track means: sketch, `track:new`, shape in Blender, `track:export`, `track:check`,
  then one import line in `track.ts`. CI fails if a JSON exists but is not registered.
- Stormhaven passes CI but not the new-Track bar: its tightest hairpin (4.9 m radius) is below
  the car's minimum turning radius (~9.4 m), so even a tidy driver leaves the tarmac there.
- RL is unaffected: `physics.TRACKS` gains every new Track automatically; only Sunset Ridge
  has a trained policy.
