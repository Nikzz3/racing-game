# AI Reference Lap is a client-only Medium benchmark, off the leaderboard

PRD #7 built a trained RL policy whose record is validated headlessly in Node and
explicitly listed "any in-browser inference" and "integrating the trained agent into the
live game" as out of scope. We nonetheless want players to _watch_ the policy's fastest
lap. We reconcile this by defining a **Reference Lap** (see `CONTEXT.md`): the single
deterministic fastest lap the policy drives against the real physics, computed live in the
browser via `runPolicyLap`, converted to `ReplayFrame[]`, and shown through the existing
`ReplayViewer` — labelled **"AI Record"**. It is a _viewer_, not a driver in a Room, which
is what keeps it inside the PRD's boundary.

## Considered Options

- **Seed it into the leaderboard DB (rejected):** reuse the human ▶ replay path by
  inserting the AI lap as a `(name, difficulty)` best-lap row. Rejected because ADR-0001
  defines the leaderboard as _honest human records_; an unbeatable machine entry corrupts
  that ranking and blurs "Track Record" (human) with the AI benchmark.
- **Run the policy live as a Room bot / ghost (rejected):** the PRD explicitly excludes
  in-game inference and bot opponents; the browser loop also feeds variable dt, which would
  diverge from the fixed-1/60s validated record.
- **Client-only standalone Reference Lap viewer (chosen):** computed on demand from the
  bundled `policy.json`, never persisted, launched from a lobby button. Playback
  interpolates baked poses by wall-clock time, so it is immune to frame-rate variation and
  reproduces the exact validated lap.

## Consequences

- **Medium only.** The policy hardcodes `MEDIUM_MAX_SPEED` for observation normalization and
  was trained/validated on Medium alone. The viewer is scoped to Medium and surfaced only on
  the Medium leaderboard tab; a per-difficulty Reference Lap would require training Easy/Hard
  policies (PRD-excluded).
- **Self-updating, no drift.** The displayed lap time is derived live from the `runPolicyLap`
  result rather than hardcoded, and `rl/policy.json` is imported directly (single source of
  truth). Retraining to a faster policy — e.g. the SAC fallback the PRD reserves — and
  rebuilding the client automatically refreshes the Reference Lap and its time.
- **Reintroduces in-browser policy inference**, but confined to a self-contained viewer with
  no server, DB, or Room involvement — so the PRD's validation-of-record path (Node against
  real `CarPhysics`) remains the sole authority for the record itself.
