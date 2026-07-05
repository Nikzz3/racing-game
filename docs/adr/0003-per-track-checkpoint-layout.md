# A Track may define its own checkpoint layout; Stormhaven gates every control point

Checkpoints are ordered gates that a lap must pass through in sequence
(`server/src/timing.ts`). They enforce lap *order* — you cannot skip a gate — but
they do nothing to enforce the racing *line*: any straight path between two
consecutive checkpoints is legal. On the Sunset Ridge Circuit, twelve evenly-spaced
gates suffice, because its corners don't fold back on themselves.

The Stormhaven Circuit's clustered "knotted infield" breaks that assumption. There,
the straight chord between two consecutive evenly-spaced checkpoints can cut 20–50%
of the road distance across the grass (worst case CP9→10: 160 m of road → an 80 m
cut). Because those infield sections are genuinely slow to drive on the road (~5.7 s
each on Medium), the shorter grass path competes with — and on Medium beats — the
racing line, despite the grass speed penalty. Cutting was fastest.

We decided that **a Track owns its own checkpoint layout** rather than every Track
sharing one global count and derivation, and that **Stormhaven places a checkpoint on
every control point** (29 gates). Since a Track's control points sit at its apexes and
inflections, apex-to-apex chords already trace the ideal racing line, so no cut saves
time (worst chord/arc ratio rises to 0.93, zero cuttable segments) and any apex-skipping
line now misses a gate and fails to complete a lap. Sunset Ridge keeps its even-twelve
derivation. The change is physics-neutral and confined to `shared/src/track.ts`.

## Considered Options

- **Strengthen the grass physics globally (rejected):** lower `grassMaxSpeed` / raise
  friction so any cut bleeds too much speed. A two-constant change, but global — it
  punishes every player's legitimate off-track recovery, alters the feel of Sunset Ridge,
  and shifts the AI Reference Lap and the Medium leaderboard baseline on *both* Tracks.
  The exploit lives on one Track's geometry, so the fix should too.
- **Raise the evenly-spaced checkpoint count (rejected):** measured and insufficient —
  even at 32 evenly-spaced gates a 0.59-ratio shortcut survives, because arc-even spacing
  keeps landing gates mid-swing on the switchbacks. Placement, not count, is what forces
  the line.
- **Physical barriers on the infield (rejected):** would make cutting *impossible* rather
  than merely *slower*; we deliberately want the grass to stay drivable and the racing line
  to win on merit.
- **A checkpoint on every control point (chosen):** physics-neutral, Stormhaven-only, and
  self-maintaining — reshaping the Track later moves the gates automatically.

## Consequences

- **Checkpoints are invisible** (no mesh, no HUD), so 29 gates versus 12 is imperceptible
  to players; the count carries no UX cost.
- **RL is unaffected.** `rl/env.py` rewards centerline arc-length progress minus an
  off-track penalty and never reads checkpoints, and training is Sunset-only — so no
  retraining is needed and no Stormhaven policy is invalidated.
- **Gross cuts become invalid, minor ones merely slower.** A line that skips an apex no
  longer completes a lap at all; a line that clips grass but stays within a gate's radius of
  every apex still counts and is simply slower. Honest racing lines always validate.
- **The void is surfaced, not silent.** Because a skipped gate would otherwise fail a lap
  with no feedback, the client shows a persistent "checkpoint missed" warning, detected from
  the invariant that a driver can never legitimately be arc-length past the checkpoint they
  still owe (`nextCheckpoint` from the server vs. the car's centerline index) — no server or
  protocol change. The HUD's `CP x/N` counter also becomes per-Track (Stormhaven has 29
  gates, not the global twelve).
- **Persisted Stormhaven leaderboard times are untouched** as historical records; only
  future laps are validated under the denser gates.
