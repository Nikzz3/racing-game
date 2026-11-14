# Laps and leaderboard

In a Room the driver laps the Track freely. The HUD's lap clock starts when the car crosses the start line, the `CP n/12` counter follows each Checkpoint in order, and crossing the line again completes the lap: `LAP 1`, a `LAST` and `BEST` time, a toast, and the driver's place in the HUD's `BEST LAPS` panel. A Plausible Lap is also written to the all-time leaderboard with its Replay, so every other player sees the driver ranked in the Lobby's Records tab. `Respawn` puts the car back at the start and abandons the lap in progress, keeping completed laps and the session best.

## Sub-features

- `lap-timer` keeps the HUD lap clock at `--:--.---` until the car crosses the start line, then runs it.
- `lap-checkpoints` advances `CP n/12` through every Checkpoint in order and fills the bar under it.
- `lap-complete` shows `LAP 1`, `LAST` and `BEST` times and a `Lap 1 / <time>` toast when the lap ends.
- `lap-best-laps` ranks the Room's drivers by session best in the HUD `BEST LAPS` panel, with their lap count.
- `lap-persist` stores a Plausible Lap as the driver's best on the `(Track, Difficulty)` board and keeps its Replay.
- `lap-leaderboard` shows every player the persisted board in Race Setup → `Records`, with a Watch-replay button.
- `lap-respawn` returns the car to the start, abandons the lap in progress, and keeps `LAP n` and `BEST`.
- `lap-penalty` flashes `CHECKPOINT MISSED +2s penalty` and adds 2 s per skipped Checkpoint to the lap.
- `lap-implausible` keeps an implausible lap in the Room session but never on the board (silent to the driver).

## How to get to it (user POV)

- Lobby → Race Setup tab `01 Race` → `Create & Race` (or `Join & Race`) → drive across the start line and round the Track.
- In a Room → `Respawn` button (bottom-left HUD), or the `R` key, or a gamepad's respawn button.
- Lobby → `Select car` → `Select track` → Race Setup tab `02 Records` → pick difficulty (`Records difficulty` radiogroup) and Track (`Records track`).

## Driving it with verify.sh

Preconditions:

- The slot is up and healthy. No lap is needed beforehand: the journey drives its own. Names come from `uid()`.

Journey: `scripts/verify.sh run laps-and-leaderboard` (driver `a` on the seam build, second player `b` on the real build, about 2 minutes).

- **Wait at the start.** A creates a Room on the seam build. Handles: `.hud-lap`, `.hud-cp`, `.hud-cur-lap`, `.hud-last`, `.hud-best`. Result: `LAP 0`, `CP 0/12`, and `--:--.---` in all three clocks. Proof: `01-a-at-start.png`.
- **Clock starts at the line** (`lap-timer`). A's recorded lap is injected with `driveInputs(page, lapInputs())`. Result: `.hud-cur-lap` starts running only once `.hud-cp` reads `CP 1/12`. Proof: `02-a-timer-running.png`, and `hud-progress-log.json` (every HUD change, timestamped) shows the clock idle until the crossing and running within a second of it.
- **Checkpoints in order** (`lap-checkpoints`). Proof: `03-a-mid-lap.png` shows `CP 6/12` or later, and `hud-progress-log.json` reads `CP 0` → `1` … `11` → `0` → `1` with no gaps.
- **Lap complete** (`lap-complete`). Result: `LAP 1`, and `LAST` and `BEST` show a time. Proof: `04-a-lap-complete.png` shows both times and the `Lap 1 / …` toast.
- **HUD standings** (`lap-best-laps`). Handle: `.hud-standings tbody tr.me`. Result: rank `1`, A's name, a time, `L1`. Proof: `05-a-best-laps.aria.yml`.
- **Server** (`lap-persist`). Proof: `lap-messages.json` holds exactly one `lap` for A with `laps: 1`, `penaltyMs: 0`, `isPersonalBest: true`, and `leaderboard-message.json` lists A on `sunset-ridge`/`medium` with `hasReplay: true`.
- **Database** (`lap-persist`). Proof: `db-best-laps.json` and `db-replays.json` each hold one row for A on `sunset-ridge`/`medium`, the Replay with more than one frame.
- **Respawn** (`lap-respawn`). A clicks `getByRole("button", { name: "Respawn" })` while the next lap's clock runs. Result: `--:--.---`, `CP 0/12`, `LAP 1`, `BEST` unchanged, `L1` in the standings, no second `lap` message. Proof: `06-a-respawned.png` shows the car back at the start gantry; `respawn-position.json` holds its position before the lap and after Respawn (under 1 m apart).
- **Second player** (`lap-leaderboard`). B opens the real Lobby, waits for `.game-loading` to go, and opens `[data-setup-tab="records"]`. Result: `.lb-list .lb-name` lists A in the same order as the board B received on connect, and `getByRole("button", { name: "Watch <A> replay" })` is visible. Proof: `07-b-records.png`, `07-b-records.aria.yml`, `b-welcome-board.json`.
- **Checkpoint Penalty** (`lap-penalty`). **Not yet automated.** The recorded lap passes every Checkpoint, and skipping one needs a hand-built input recording. Expect `.cp-miss-warn` visible with `+2s penalty` and a non-zero `penaltyMs` in the `lap` message.
- **Implausible lap** (`lap-implausible`). **Not yet automated.** Producing one needs a faster-than-real-time drive. Server tests cover it.

## Gotchas

- The lap takes about 40 s of real time and cannot be sped up. On a loaded host the seam drops frames, so the lap runs slower, never faster. If the server rejects the lap (no `lap` message or no `best_laps` row), rerun once before suspecting the game.
- Seam inputs stop exactly at the finish line. The car rolls on into lap 2, which is why `CP 1/12` and a running clock show right after the lap, and why Respawn has a lap in progress to abandon.
- The seam skips drawing the scene while inputs are injected, so `02` and `03` show a frozen scene behind a live HUD. Only the HUD is evidence mid-lap.
- `BEST LAPS` on the HUD is the Room's session board, not the persisted one. Prove persistence through the `Records` tab, the `leaderboard` message, or the database.
- On a fresh slot the first lap is a Track Record, so the toast reads `TRACK RECORD!`. Do not assert it: a second run against the same database is no longer a record.
- The server keeps 16 characters of a driver name. Keep `uid()`-suffixed names short or the database rows will not match.
- On the real build, `Loading your garage` covers the Lobby and swallows clicks until the 3D garage loads, which takes tens of seconds under load. Wait for `.game-loading` to detach before clicking.
- Never assert lap times. They come from the server's wall clock and vary run to run.
