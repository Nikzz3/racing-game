# Records and replays

Race Setup's `02 Records` tab shows the Track Records for a `(Track, Difficulty)` the driver browses, with that pair's Medal targets. Each human lap with a Replay has a ▶ button that opens a full-screen viewer: one car on a chase camera, a `REPLAY` panel with the driver's name and a running `elapsed / lap` clock, and `Exit replay` back to the Lobby. On Sunset Ridge at Medium the tab also offers the AI Record (the Reference Lap, computed in the browser) and the bundled Jev Lap, which plays with Jev's decisions in a panel alongside.

## Sub-features

- `records-empty` shows `No laps yet on <Track>, <Difficulty>.` when the board has no laps.
- `records-browse` switches the board's Difficulty and Track without changing the race selection, with a `Browsing only.` note and a `Use these settings` button.
- `records-live` lists a new Track Record as soon as any driver sets it, without a reload, and keeps it after a reload.
- `replay-human` plays a human Replay fetched from the server, with the board's lap time as the viewer's total.
- `replay-ai` plays the AI Record (Sunset Ridge, Medium only), with nothing fetched or stored.
- `replay-jev` plays the Jev Lap with the `Jev's decisions` panel (state, pedal and steer cards, decision count).
- `replay-exit` returns from any viewer to the Lobby with the Records tab still open.
- `replay-loop` shows `Lap complete` at the end of a lap, then plays the lap again from the start.

## How to get to it (user POV)

- Lobby → `Select car` → `Select track` → Race Setup tab `02 Records`.
- Records → `Records difficulty` radios (`Easy`, `Medium`, `Hard`) and the `Records track` menu to browse another board.
- Records → a row's `Watch <driver> replay` button (▶).
- Records (Sunset Ridge, Medium) → `▶ Watch AI Record` or `▶ Watch Jev Lap · m:ss.mmm`.
- In a viewer → `Exit replay`.

## Driving it with verify.sh

Preconditions:

- A fresh `up` on the slot. The journey asserts the empty board and a Track Record on Sunset Ridge, Medium, so no other journey may have put a lap there since `up`.
- The lap on the board comes from a `drive` bot (SKILL.md, "Bot"), not a browser. Nothing in this feature proves the browser's own driving.

Journey: `scripts/verify.sh run records-and-replays` (player `r` on the real build browses and watches, `drive` bot `d` sets the Track Record; about 1 minute).

- **Empty board** (`records-empty`). R opens `[data-setup-tab="records"]`. Handles: `getByRole("tab", { name: /Records/ })` has `aria-selected="true"`, `.lb-empty` reads `No laps yet on Sunset Ridge Circuit, Medium.`, no `.lb-list li`. Proof: `01-records-empty.png` and `.aria.yml` show the Medal targets and both Watch buttons; `best_laps` is empty. Then the bot starts: `j.bot("d", ["--name", D, "--variant", "suv", "--create", room, "--mode", "drive"])` drives its lap while R browses and watches the AI viewers.
- **Browse** (`records-browse`). R clicks `radio "Hard"` in `radiogroup "Records difficulty"`, then picks another Track from `button "Records track"` → `listbox "Records track"`. Result: the empty copy names that board, `.board-note` reads `Browsing only. Your race is still Sunset Ridge Circuit, Medium.`, and `▶ Watch AI Record` is hidden. Proof: `02-records-browse-hard.png`, `02b-records-browse-track.png`.
- **AI Record** (`replay-ai`, `replay-exit`). R clicks `button "▶ Watch AI Record"`. Result: `.replay-hud .replay-name` is `AI Record` and the `.replay-time` clock advances. Proof: `03a-early.png` and `03b-later.png` show the car at two points of the lap; R received no `replay` message and `replays` holds no row but the bot's. `Exit replay` brings the Lobby back.
- **Jev Lap** (`replay-jev`). R clicks `button[data-jev-lap]`. Result: the name is `Jev`, `region "Jev's decisions"` is visible, `[data-jev-decisions]` climbs, and the pedal and steer cards each light one option. Proof: `04a-early.png`, `04b-later.png`, `04-jev-panel.aria.yml`.
- **Track Record set.** The journey awaits the bot's `lap` event. Proof: `d-lap-event.json` (`isTrackRecord: true`), `db-best-laps.json` (one `sunset-ridge`/`medium` row with `variant = suv`), `db-replays.json` (one row with frames), `bot-d.jsonl`.
- **Live row** (`records-live`). R's Records tab, never reloaded, lists D's row with `button "Watch <D> replay"`, after a `leaderboard` server message naming D. Proof: `06-records-live-row.png` and `.aria.yml` (the bot's lap also shows a Silver badge). R then reloads and the row is still there.
- **Human Replay** (`replay-human`). R clicks `Watch <D> replay`. Result: R receives one `replay` message (`j.received("r", "replay")`) naming D on `sunset-ridge` in the `suv`, `.replay-name` is D, and `.replay-time` ends in the board's lap time. Proof: `07a-early.png`, `07b-later.png` (the SUV on the chase camera), `r-replay-message.json`, then `08-back-in-lobby.png` after `Exit replay`.
- **Lap complete and loop** (`replay-loop`). **Not yet automated.** It needs a whole lap of playback (24 s for the AI Record, about 28 s for the bot's lap) just to reach `.replay-finished`.
- **Use these settings** (`records-browse`). **Not yet automated.** It changes the race selection, which belongs to the Race tab and [Garage and circuits](./garage-and-circuits.md).

## Gotchas

- Start the bot only after the empty-board check: it is in a Room within a second and its lap lands about 30 s later. Starting it earlier races the `records-empty` assertions.
- The bot's lap can land while R is inside a viewer. The Lobby still takes the `leaderboard` update behind the viewer, so the live-row check holds without a reload.
- `j.received` only returns server→client messages. A `replay` arriving right after the click is the proof R asked for it.
- The AI Record is computed in the browser on first use, which can take seconds under software WebGL. Wait on `.replay-name`, never sleep.
- The `.replay-time` clock follows the wall clock, not frames, so it is a reliable progress signal even at a few frames per second. A viewer screenshot needs at least 2 s of playback between the two shots to show motion.
- Only Plausible Laps reach the board, and only `--mode drive` drives one. A `warp` bot's lap counts in its Room but never reaches Records. If the `lap` event arrives without `isTrackRecord`, read `bot-d.jsonl` and the server log before rerunning once.
- The Records filters belong to browsing only: they start at the race selection and never change it. A browsed Track or Difficulty other than Sunset Ridge, Medium hides both AI buttons.
- Prove the Records tab and viewers on the real build. The seam build skips the Lobby's WebGL stages, and this journey needs no seam player.
