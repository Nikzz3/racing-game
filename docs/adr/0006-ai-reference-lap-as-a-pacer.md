# The baked AI Reference Lap may drive as a Pacer in live Rooms

Partially supersedes ADR-0004.

ADR-0004 admitted persisted human **Replays** as **Pacers** in live Rooms and kept the AI
**Reference Lap** out — recording that exclusion as "a scoping choice, not a physics
constraint", and explicitly reserving the reopening: *"a later effort to run an AI Pacer can
reopen it cleanly by superseding this ADR, without relitigating physics."* This is that
effort, and this ADR replaces only that scope line. ADR-0004's human-Pacer decision stands.
ADR-0002, which governs the standalone Reference Lap viewer, stands untouched.

What PRD #7 and ADR-0002 rejected was AI decisions made *in the race loop* — running the
policy live as a Room bot, where variable browser `dt` diverges the driven lap from the
validated record. Pacer playback never does that: it is pose interpolation of a fixed
record, identical in kind to a human Replay's playback.

## Decision

The AI Reference Lap may be selected as a **Pacer** in a live Room, on Tracks with a trained
policy at the Difficulty that policy was trained at. It is armed from the lobby's Pacer
picker exactly as a human Replay is, and plays back through the same overlay.

The boundary: **no policy forward pass at race time.** The deterministic fixed-1/60s bake
(`runPolicyLap` → `ReplayFrame[]`) runs at *selection time* — specifically, when the lobby
board first renders in a context where the AI is eligible — and its output is memoized for
the page. In a running race, only pose interpolation of those baked frames occurs.

## Considered Options

- **Run the policy live in the Room (rejected):** what ADR-0002 rejected and PRD #7 excludes.
  Race-loop inference under variable `dt` produces a lap that is not the validated record.
- **Keep the AI to its viewer (rejected):** the status quo ADR-0004 recorded as scoping. It
  withholds the board's most useful benchmark from the one comparison a time-trial racer
  wants, for no mechanism reason.
- **Bake the lap and play it as a Pacer (chosen):** the AI lap is already the exact
  `ReplayFrame[]` shape the Pacer overlay consumes, so it slots into the shipped mechanism
  with no new authority and no server surface.

## Invariants

1. **No race-time inference.** The forward pass runs only as the deterministic fixed-1/60s
   bake at selection time; in a running race, only pose interpolation.
2. **Baked-pose only.** The AI Pacer plays exactly the `ReplayFrame[]` the validated record
   produces — identical every time, immune to frame rate.
3. **Never a leaderboard row.** The AI's lap renders *among* leaderboard rows but is
   synthesized client-side, is never a `LeaderboardEntry`, is never persisted, and is never
   sent by the server. ADR-0001's honest-human-records line stands: the AI Pacer writes
   nothing and ranks nothing, and consumes no rank number.
4. **Availability is a consequence, not a promise.** The AI is offered on Sunset Ridge at
   Medium only, because that is the only trained policy. Nothing here commits to widening it.

## Consequences

- **No server or protocol changes.** The frames are computed in the client from bundled
  policy weights; unlike a human Pacer, nothing is fetched.
- **The displayed time and the driven lap cannot diverge**, because both come from one
  memoized bake rather than a stored constant that a retrain could silently outdate.
- **The in-Room treatment is unchanged and pose-source-agnostic.** The overlay's `REPLAY`
  badge and the `vs Pacer ±Nms` delta name the mechanism, not the source; AI-ness is carried
  at selection time only.
- **ADR-0002 stands.** The standalone viewer is unaffected; this ADR governs entry into live
  Rooms, which 0002 never addressed for baked playback.
- **The Reference Lap's known obs-fidelity issues (#44, #46) are inherited, not introduced.**
  They affect the AI lap wherever it is shown and are tracked separately.
