# Pacers

A Pacer is a translucent, non-colliding car that plays back a recorded lap in the driver's Room. The driver arms it in Race Setup's Pacer picker. The choices are the AI Record (Sunset Ridge at Medium only, always the police car) or another driver's Replay on the same Track and Difficulty, with the Rival offered first as the `Next rival`. The Rival is the slowest Replay that is still faster than the driver. The Pacer waits hidden until the driver crosses the start line, then drives its lap alongside them, and the HUD compares the driver to it at each Checkpoint. After each of the driver's laps the Rival ladder moves on: beating the raced Rival swaps the Pacer up a rung, and a driver racing anyone else is offered the next Rival.

## Sub-features

- `pacer-picker` lists `No Pacer — race alone` plus every eligible lap on the race's Track and Difficulty, and is disabled when nothing is eligible.
- `pacer-ai-option` offers `⚑ AI Record — <time>` on Sunset Ridge at Medium only, never on Easy, Hard or another Track.
- `pacer-ai-room` arms the AI Record: the HUD `PACER` chip names `AI Record`, the car is police, hidden until the start line, then translucent and playing.
- `pacer-human-option` lists another driver's persisted lap (with a Replay) in the picker, live while the Lobby is open.
- `pacer-human-room` arms a human lap: the server sends that Replay, and the Pacer drives the Variant recorded with the lap.
- `pacer-delta` toasts `vs Pacer ±Nms` at each Checkpoint while the Pacer plays, and restarts the Pacer at every start-line crossing.
- `pacer-rival-picker` lists the Rival once, as `⚑ Next rival: <name> — <time>`, for the driver name in `Driver`: the slowest Replay faster than that driver's best (any Replay before their first lap).
- `pacer-rival-beaten` toasts `Rival beaten! Next up: <name> <time>` after a lap that beats the raced Rival, and swaps the Pacer to the next rung in place.
- `pacer-rival-offer` offers `NEXT RIVAL · <name> · <time>` with `Race rival` (`N`) after a lap raced against anyone but the Rival, and arms that Rival when accepted.
- `pacer-dismiss` removes the Pacer from the Room via the chip's `Dismiss Pacer` button.
- `pacer-persist-none` writes nothing for the AI Record: it never becomes a `replays` or `best_laps` row.

## How to get to it (user POV)

- Lobby → `Select car` → `Select track` → Race Setup tab `01 Race` → `Driver` → `Pacer` dropdown → choose an option → `Create & Race` (or `Join & Race`).
- Race Setup → `Change track` / `Difficulty` radios: the picker's options follow the race's Track and Difficulty.
- In a Room, after the driver's own lap → `Rival beaten!` toast (automatic), or the `NEXT RIVAL` toast → `Race rival` (or key `N`).
- In a Room → the HUD `PACER` chip → `Dismiss Pacer` (✕).

## Driving it with verify.sh

Preconditions:

- A **fresh** `verify.sh up`. The journey's first step fails if `replays` already holds rows, because earlier laps change the picker and the Rival ladder.
- Nothing is seeded. Three `drive` bots put the ladder on the board, and browser B drives its own two laps. The run takes about 3 minutes.

Journey: `scripts/verify.sh run pacers`. Real-build player `p` covers the picker. Seam player `c` covers the AI Record, and seam player `b` climbs the ladder. Bots `slow`, `alpha` and `ace` are the other drivers.

- **Picker on a fresh DB** (`pacer-picker`, `pacer-ai-option`). `p` opens Race Setup. Handle: `getByRole("combobox", { name: "Pacer" })`. Result: exactly `No Pacer — race alone` and `⚑ AI Record — <time>`, value `-1`. Proof: `01-picker-sunset-medium.aria.yml` / `.png`. The AI Record is baked when the picker first paints, so the option can take 10–20 s.
- **Other Difficulties and Tracks** (`pacer-ai-option`). `p` clicks `getByRole("radiogroup", { name: "Difficulty" })` → `radio "Easy"` / `"Hard"`, then `Medium` → `Change track` → `.track-card[data-track="stormhaven"]` → `Select track`. Result: only `No Pacer — race alone`, combobox `[disabled]`. Back on Sunset Ridge the AI Record returns. Proof: `02-picker-sunset-hard.aria.yml`, `03-picker-stormhaven-medium.png`.
- **The ladder** (bots, started after the fresh-DB checks, in parallel). `j.bot` with `--mode drive` starts three drivers: `Slow` (`--pace 0.4 --variant van`, ~56 s), `Alpha` (`--pace 0.8 --variant taxi`, ~31 s) and `Ace` (`--pace 1 --variant suv`, ~28 s). Result: each bot's `lap` and `standings` events, `Slow` > `Alpha` > `Ace` in lap time, and `best_laps` + `replays` rows with those Variants. Proof: `bot-*.jsonl`, `bot-laps.json`, `db-board-after-bots.json`.
- **AI Record in a Room** (`pacer-ai-room`; runs while the bots drive). C selects option `ai`, `Create & Race`. Result: `.pacer-chip-name` is `AI Record`, seam `pacerVariant` is `police`, and seam `pacer` is `{ frameCount > 0, playing: false, visible: false }`. Proof: `04-c-ai-pacer-armed.png`, `c-pacer-before-start.json`.
- **AI Pacer plays from the line** (`pacer-ai-room`). C holds `KeyW` (a real key press) until the Pacer plays, then brakes. Result: seam `pacer` `{ playing: true, visible: true, opacity: 0.35 }`, and seam `checkpoint` ≥ 1. Proof: `c-pacer-playing.json`, plus `05-c-ai-pacer-playing.png` and `06-c-ai-pacer-ahead.png`, where the police car is a small car far ahead on the straight.
- **Laps reach open Lobbies** (`pacer-human-option`). Without a reload, `p`'s picker gains `⚑ Slow …`, `⚑ Alpha …` and `⚑ Ace …`. Proof: `07-picker-live-board.aria.yml`.
- **Rival in the picker** (`pacer-rival-picker`). `p` types a new `Driver` name and tabs out. Result, in order: `No Pacer`, `⚑ Next rival: Slow <id> — <time>`, `⚑ AI Record`, `⚑ Ace`, `⚑ Alpha`. The Rival is listed once, and the rest follow fastest first. Proof: `08-picker-next-rival.aria.yml` / `.png` (real build).
- **Human Pacer** (`pacer-human-room`, `pacer-delta`). B names itself, selects `rival` (Slow) and `Create & Race`. Result: the chip shows `Slow <id>`, B receives `replay` for Slow with `variant: "van"`, seam `pacerVariant` is `van` (B drives the default `hatchback-sports`), and `frameCount` equals the Replay's frames. During B's lap the Pacer plays translucent, and `vs Pacer` toasts. Proof: `09-b-picker-rival-armed.aria.yml`, `b-replay-slow.json`, `b-variants.json`, `10-b-slow-pacer-armed.png`, `b-pacer-playing.json`.
- **Rival beaten** (`pacer-rival-beaten`). B drives `lapInputs()` (~39 s, faster than Slow). Result: `.toast` `Rival beaten! Next up: Alpha <id> <time>`, the chip switches to `Alpha <id>`, B receives Alpha's `replay`, `pacerVariant` becomes `taxi`, and the server's after-lap `standings` names Alpha as B's Rival. Proof: `11-b-rival-beaten.png`, `b-standings-after-lap1.json`.
- **Dismiss** (`pacer-dismiss`). B clicks `getByRole("button", { name: "Dismiss Pacer" })`. Result: `.pacer-chip` loses `visible`, and seam `pacer` is `null`. Proof: `12-b-pacer-dismissed.png`.
- **Rival offered** (`pacer-rival-offer`). B clicks `Leave race`. The Lobby picker now reads `Next rival: Alpha`. B creates a new Room with option `-1` (No Pacer) and drives `lapInputs()` again. Result: `.rival-prompt` shows `NEXT RIVAL · Alpha <id> · <time>`, then `Race rival` sets the chip to Alpha and `pacerVariant` to `taxi`. Proof: `13-b-next-rival-offered.png`, `14-b-racing-alpha.png`, `b-standings-after-lap2.json`.
- **AI writes nothing** (`pacer-persist-none`). Result: `replays` holds exactly Slow, Alpha, Ace and B. Proof: `db-replays-final.json`.

Why B's laps are browser laps and not bots: `Rival beaten!` and the `NEXT RIVAL` prompt are computed by the driver's own game when the server answers that driver's own lap. Only the connection that drove the lap receives the after-lap `standings`. A bot under B's name would move B's Standing in the database, but B's browser would never see a ladder step, so it would prove nothing about the in-Room ladder. The two seam laps are the browser's own driving, and the bots supply every other driver. The bottom rung uses `--pace 0.4` (~56 s) so that the seam lap (~39 s) beats it by a wide margin. `Alpha` (~31 s) stays clearly faster than B, which keeps both ladder steps deterministic.

Not yet automated: none of the sub-features above. The prompt's `N` shortcut is not pressed (the journey clicks `Race rival`), and `Rival beaten!` at the top of the ladder (`no faster replay on this board`) is not driven.

## Gotchas

- The bottom rung must be slower than a seam lap: `lapInputs()` takes ~39 s, slower than a `--pace 0.8` bot (~31 s). A `--pace 0.8` bottom rung would make `Rival beaten!` unreachable, so the journey uses `--pace 0.4`.
- The picker's fresh-DB checks must finish before any bot lap persists (~28 s after the bots start). The journey starts the bots only after those checks.
- The seam build skips the 3D draw while it injects inputs, so a screenshot taken mid-lap shows a frozen scene under a live HUD. Screenshots taken after the lap, or while driving with the keyboard, render normally.
- A keyboard driver crosses the line at about the recorded lap's speed, so a Pacer overlaps the driver's car at first. Brake right after it starts playing to see it pull ahead. Even then the AI Record is soon a small car far ahead.
- The seam's `checkpoint` comes from server snapshots and lags the client. The Pacer can be `playing` while `checkpoint` still reads 0, so poll it.
- Standings are fetched per driver name when the `Driver` field commits (`change`), so tab out after `fill`. The Rival appears only after that, while plain board entries arrive by push.
- After B leaves the beaten Room, the Lobby still has Slow armed (it is still eligible). Pick `-1` explicitly for the No Pacer lap.
- The AI Record option's time comes from the bundled policy. Assert its shape, not the number.
- A Lobby-armed Pacer is put away during a Race. Grid Pacers belong to [Races](./races.md).
