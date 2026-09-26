# Jev drives only as a recorded Jev Lap

Partially supersedes ADR-0009.

ADR-0009 had Jev drive two ways: the recorded **Jev Lap**, and the **Jev Live Run**, where
the client simulated the car and asked the server for each decision over the WebSocket
through a budgeted TypeSafe proxy. The Jev Live Run is removed. Jev now drives only as the
Jev Lap.

## Decision

- The Jev Lap is recorded offline by a developer with `npm run jev:record`, which drives
  Sunset Ridge at Medium headlessly against the real `CarPhysics` and writes the bundled
  `client/src/game/jev-lap.json`. Players replay it from the Records panel with Jev's
  decisions alongside, at no API cost, offline and in the desktop app.
- `TYPESAFE_API_KEY` only ever lives in the recording developer's `.env`. `JEV_STUB=1` is
  the recorder's dry run. The server no longer talks to TypeSafe: no `jevDrive` /
  `jevDecision` / `jevUnavailable` messages, no `welcome.jev`, no proxy, no per-connection or
  daily spend budget, and no `jev_usage` table.

ADR-0009's description of how Jev is asked (the plain-English state, two Choice questions,
code owning the pedals) and its invariants 3 and 4 (never a leaderboard row; Medium, Sunset
Ridge) still hold for the Jev Lap.

## Consequences

- Fewer moving parts: nothing in the running game or server depends on TypeSafe, a key, or
  its availability.
- Every Jev lap a player sees is the same one; it changes only when someone re-records it
  (after changing the physics tuning or `JEV_QUESTIONS`).
- The TypeSafe driver and its stub (`server/src/jev.ts`) stay, used only by the recorder.
