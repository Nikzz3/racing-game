# Daily Challenge

Every UTC day has one Daily Challenge: a Track, a Difficulty, a Car and a Scene Preset that the date picks. The Garage screen shows it in the Daily banner with the driver's standing for today. `Race the Daily` puts every driver into the same Daily Room, where all cars are the Daily's car and the world renders its Scene Preset. A Plausible Lap there goes onto the Daily Board shown in the banner and onto the all-time board for that Track and Difficulty. `Share` copies a one-line result for the driver's best time today.

## Sub-features

- `daily-banner` shows `DAILY #<n>`, the Track name, then `Difficulty`, `Car` and `Scene`, the driver's name, and `No time yet today` until the driver has a lap today. `Share` is disabled until then.
- `daily-race` takes the driver from `Race the Daily` into the Daily Room. The HUD reads `Daily #<n>`, and the Room has the Daily's Track and Difficulty.
- `daily-shared-room` puts a second driver who clicks `Race the Daily` into the same Room. Both drivers appear in each other's standings, and both cars are the Daily's car whatever each driver picked.
- `daily-scene` renders the Daily Room in the Daily's Scene Preset. Every other Room renders Sunset.
- `daily-board` puts a Plausible Lap driven in the Daily Room on today's Daily Board. The driver's banner reads `P<place> of <n> · <time>`, and every banner's `Today's fastest` list includes the driver.
- `daily-all-time` also counts that lap on the all-time board for the Daily's Track and Difficulty, so it shows in the Records tab with a replay.
- `daily-share` copies `Sunset Ridge Daily #<n> · <m:ss.cc>`, plus a Medal emoji when the time earns one, and the button reads `Copied ✓`. Without clipboard access it reads `Copy failed`.
- `daily-rollover` switches to the next Daily at UTC midnight and closes that day's Daily Room.

## How to get to it (user POV)

- Lobby, Garage screen (first screen) → Daily banner (region `Daily Challenge`) → `Race the Daily`.
- Lobby → Garage → Daily banner → `Share` (enabled after a lap in today's Daily Room).
- Lobby → Race Setup → `02 Records` → Daily's Difficulty and Track → the all-time board.
- The Daily Room never appears in the Race Setup Room list. `Race the Daily` is the only way in.

## Driving it with verify.sh

Preconditions:

- The slot is up and healthy. Driver names come from `uid()`, so earlier runs' laps in the same slot do not collide.

Journey: `scripts/verify.sh run daily-challenge` (about 70 s). Player `a` is on the real build with clipboard permissions. Driver B is a `--daily --mode drive` bot (`j.bot("b", ...)`, see SKILL.md "Bot").

- **Banner** (`daily-banner`). A loads `/`. Handle: `getByRole("region", { name: "Daily Challenge" })`, which contains `.daily-number`, the `.daily-track` heading, and `.daily-specs` with `Difficulty`, `Car` and `Scene` terms. Result: the journey reads today's Daily from the banner and checks it against the server's `welcome` message. `.daily-result` is `No time yet today`, and `Share` is disabled. Proof: `01-daily-banner.png`, `01-daily-banner.aria.yml`, `banner-today.json` and `welcome-daily.json`.
- **Name the driver.** In Race Setup, fill `getByLabel("Driver", { exact: true })`, then click the visible `Change car` button to go back to the Garage. Result: `.daily-driver` shows the name.
- **Race the Daily** (`daily-race`, `daily-scene`). A clicks `getByRole("button", { name: "Race the Daily" })`. Result: `.hud-room` reads `Daily #<n>`, and the `joined` message has a `daily` field with the Daily's Scene Preset and Variant. Proof: `02-a-in-daily-room.png` shows the Daily's Track (minimap label) in the Daily's Scene Preset, and `a-joined.json`.
- **Second driver, same Room** (`daily-shared-room`). The bot runs `--name <B> --daily --mode drive`. Result: the bot's `joined` event has A's `roomId`, Track and Difficulty and today's Daily number, and A's `.hud-standings tbody` lists B. No `rooms` row exists for the Daily Room. Proof: `03-a-sees-b-in-daily-room.png` shows B's car as the Daily's car next to A's, with a `B` name tag, and `bot-b.jsonl`.
- **Plausible Lap** (`daily-board`). The bot drives one lap of today's Track and exits `0`. Result: A receives a `lap` message for B and a `daily` broadcast listing B, and `daily_laps` has one row for B on today's date. Proof: `04-a-sees-b-lap.png`, `a-sees-b-lap.json`, `daily-messages.json` and `db-daily-laps.json`.
- **All-time board** (`daily-all-time`). Result: `best_laps` has B on the Daily's Track and Difficulty with the Daily's Variant. A's Records tab (`[data-board-diff]`, `[data-board-track-toggle]`, `[data-board-track]`) lists B, with `Watch <B> replay`. Proof: `db-best-laps.json` and `06-records-all-time.png`.
- **Board on another driver's banner.** A clicks `Leave race`. Result: `getByRole("list", { name: "Today's fastest" })` contains B, and A's own `.daily-result` still reads `No time yet today`. Proof: `05-a-banner-board.png` and `05-a-banner-board.aria.yml`.
- **Driver's own time** (`daily-board`). In Race Setup, the browser renames its driver to B and goes back to the Garage. Result: `.daily-result` matches `P<n> of <n> · m:ss.mmm`, and `Share` is enabled. Proof: `07-b-banner-with-time.png`.
- **Share** (`daily-share`). Click `Share`. Result: the button reads `Copied ✓`, and `navigator.clipboard.readText()` matches `Sunset Ridge Daily #<n> · m:ss.cc` with an optional Medal emoji. Proof: `08-share-copied.png` and `share-clipboard.json`.
- **Copy failed** (`daily-share` fallback). **Not yet automated.** It needs a browser context without clipboard permission. Expect the button to read `Copy failed`, then `Share` again.
- **Daily Variant rendered** (`daily-shared-room`). **Not asserted.** The real build has no handle for which model a car renders as. `03-a-sees-b-in-daily-room.png` shows it, and `best_laps.variant` proves the server forced it. `e2e/specs/daily.spec.ts` asserts it on the seam build.
- **Rollover** (`daily-rollover`). **Not yet automated.** It needs the clock to cross UTC midnight, and the journey cannot move the server's clock.

## Gotchas

- The Daily changes with the UTC date. Read it off the banner. Never hardcode a Track, Difficulty, car or Scene. `e2e/lap-inputs.json` fits only Sunset Ridge at Medium, so seam-browser laps fail on most days. Use the `--daily` bot, which drives whatever Track the server gives it.
- The bot's lap takes real time: about 30 to 47 s depending on the Track (Stormhaven Easy is about 45 s). If no `lap` event arrives, look for `Implausible lap rejected` in `reports/verify/.run/slot<N>/server.log`, then rerun once.
- The banner and `Share` find a driver's standing by driver name. The game has no accounts, so a name is the driver's identity on every device. Renaming the browser's driver to the bot's name is therefore the same driver opening the game on another device, and it honestly proves what that driver sees and shares. It does not prove that a lap driven in that browser updates its banner. Laps and leaderboard covers browser driving.
- Name the driver in Race Setup before going back to the Garage. `Race the Daily` uses the name saved there, and a fresh context gets `Racer<NNN>`.
- Two buttons are named `Change car` (on the Circuit screen and in Race Setup). Click the visible one.
- `Share` needs the Clipboard API, which exists only on secure origins. `127.0.0.1` counts as secure, but reading back what was copied needs `clipboard-read` permission on the player's context.
- Daily Rooms are not persisted. A `rooms` row for one is a bug, and its absence is not.
- Re-running in the same slot leaves earlier runs' drivers on today's board. The journey's `P<n> of <n>` check allows for that, but `Today's fastest` shows only the top 3, so after a few runs B can drop off it. Run `down` and `up` to get an empty board.
