# Sunset Ridge Racing verification map

This directory is the maintained source for verifying the player-facing behavior of Sunset Ridge Racing. Read this index before driving the game, then use the matching feature file as the recipe. Domain words (Room, Track, Variant, Pacer, Plausible Lap, Daily Challenge, ...) are defined in [CONTEXT.md](../../../../CONTEXT.md).

## Baseline preconditions

- A slot is up: `scripts/verify.sh up` printed `verify: ready slot <N>`, and `scripts/verify.sh doctor` reports `healthy`.
- The slot database starts empty at `up`. No Rooms, laps, Replays or Daily laps exist until a journey or bot creates them through the game.
- Every player is a fresh browser context: empty `localStorage`, a generated `Racer<NNN>` driver name, the first free Variant, Sunset Ridge Circuit, Medium.
- The Daily Challenge is whatever today's UTC date derives. Journeys read it off the Daily banner and never assume a Track.
- Never drive an instance this run did not start: not the user's `npm run dev`, not another agent's slot.

## Driving conventions

- Run journeys with `scripts/verify.sh run <journey>` from the repo root, with the sandbox disabled (see SKILL.md).
- Default to the real build (`j.player(id)`). Use the seam build (`j.player(id, { build: "seam" })`) only to drive a lap with `driveInputs`. Never use it to prove Lobby visuals.
- Prefer ARIA roles and names, then `data-*` attributes, then classes. The stable handles are listed in each feature file.
- Make every Room and driver name unique per run with `uid()`, because journeys may share a slot and its database.
- `records-and-replays`, `races` and `pacers` assert an empty board, so each needs a fresh `up`: run it first after `up`, or give it its own slot. They fail in their first step otherwise. The other journeys run in any order on a used slot.
- Wait for observable state (`expect(...).toContainText`, `expect.poll`), never a fixed sleep. Under software WebGL one click can take seconds, and on a GPU a transient state lasts moments, so a journey must hold at both speeds.
- Reach states with bots, not browsers (SKILL.md, "Bot"). A lap on the board, a Rival, a Grid Pacer or a Daily time is a `drive` bot (~30 s, no CPU). A finished Race, Knockout results or lap counts are `warp` bots (seconds). Another driver in the Room is an `idle` bot. Drive in a browser only when that browser's own driving is what you are proving.
- A Plausible Lap costs real time (~28 s by bot, ~40 s by seam browser) because the server times it on its own clock. Fold assertions into one lap, and run independent bots in parallel.
- `lapInputs()` (the seam's recorded lap) is slower than Bronze, so it earns no Medal. A `drive` bot's lap earns Silver on Sunset Ridge Medium.

## Proof and skip reporting

- Proof is the evidence directory a `run` writes: `journal.md`, `result.json`, screenshots, ARIA snapshots, the WebSocket and console logs, and database rows.
- Capture the player's action and the resulting state at each step, not only the final screen.
- Prove persistence from a second view: a `verify.sh sql` / `j.sql` read, a second player, or a reload.
- Never assert numeric server lap times (wall-clock based). Assert positions, names, presence and counts.
- Report an unreachable entry point with the attempted command and the unmet precondition. Do not report it as verified through another path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the player-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every player entry point.
3. `Driving it with verify.sh` starts with `Preconditions:`, names the journey (`verify.sh run <journey>`), and uses labeled bullets that pair each player action with its handle and observable result. Sub-features the journey does not cover are marked **Not yet automated** with the reason.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only player paths, stable handles, required state, commands and observable proof.

## Features

- [Garage and circuits](./garage-and-circuits.md) covers car and circuit carousels, car persistence, locked cars, progress steps, and the chosen circuit reaching the Room. Journey: `garage-and-circuits`.
- [Rooms](./rooms.md) covers creating, listing, joining and leaving a Room, seeing other drivers, and reconnecting. Journey: `rooms`.
- [Laps and leaderboard](./laps-and-leaderboard.md) covers driving a Plausible Lap, lap timing and Checkpoints on the HUD, Respawn, Track Records in Postgres, and the leaderboard. Journey: `laps-and-leaderboard`.
- [Medals and unlocks](./medals-and-unlocks.md) covers medal targets, earning a Medal from a lap, and Variants unlocking by Medal tier. Journey: `medals-and-unlocks`.
- [Records and replays](./records-and-replays.md) covers the Records tab, watching a human Replay, the AI Record, and the Jev Lap viewer. Journey: `records-and-replays`.
- [Pacers](./pacers.md) covers arming a human or AI Pacer in the Lobby, the in-Room Pacer car, and the Rival ladder. Journey: `pacers`.
- [Races](./races.md) covers calling a Race or Knockout, the countdown, the Grid, live positions, results, and Spectators. Journey: `races`.
- [Daily Challenge](./daily-challenge.md) covers the Daily banner, Race the Daily, the Daily Room, sharing, and the Daily Board. Journey: `daily-challenge`.
- [Controls and sound](./controls-and-sound.md) covers keyboard, touch and gamepad driving, plus mute and volume. Journey: `controls-and-sound`.
- [Desktop app](./desktop-app.md) covers the Electron build of the same client. Journey: `desktop-app`, or the gap reported there.
