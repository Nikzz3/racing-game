# Medals and unlocks

A driver's best Plausible Lap on a `(Track, Difficulty)` earns a Medal: Bronze, Silver, Gold or Author, each a target lap time. Race Setup lists the four targets with the next one marked, and the HUD chip in a Room names the next target. A lap that earns a better Medal shows a medal award, which names any cars it unlocked. Four Variants stay locked in the Garage until the driver's best Medal on any board reaches their tier. Medals belong to the driver name, so they come back after a reload and on another device under the same name.

## Sub-features

- `medal-targets` Race Setup's `Medal targets` list shows Bronze, Silver, Gold and Author with their times. The easiest unearned tier is marked `Next`, earned tiers are marked `earned`, and `Your best` shows the driver's best lap (`No lap yet` before the first one) and its Medal.
- `medal-hud-chip` the HUD chip in a Room reads `NEXT · <TIER> <target time>`, with the earned Medal's badge once there is one.
- `medal-earn` a Plausible Lap at or under a target earns that tier on the Room's board. A faster lap later moves the driver up a tier.
- `medal-award` only the driver who drove the lap sees, right after it, a `<Tier> medal` award with the lap time and `New car(s) unlocked: …`. It fades after about 4 s.
- `medal-persist` the Lobby shows the earned Medal for that driver name after a reload and on a fresh device where the same name is typed.
- `variant-unlock` locked Garage cards (Coupe S at Bronze, Race at Silver, Police at Gold, Hyper at Author) carry a padlock and `Earn a <Tier> medal to unlock`, and `Select car` is disabled for them. Once the driver's best Medal reaches the tier, the card is unlocked and selectable.
- `difficulty-medal` each Difficulty radio in Race Setup carries the badge of the Medal earned on that board.

## How to get to it (user POV)

- Lobby → Garage: browse to a locked car to see its lock and unlock copy.
- Lobby → `Select car` → `Select track` → Race Setup tab `01 Race` → `Medals` field (`Your best` and the `Medal targets` list). The `02 Records` tab has a second `Medal targets` legend for the board it shows.
- In a Room → the HUD chip under the lap counter (top-left).
- Drive a lap in a Room → the medal award in the middle of the screen when the lap earns a better Medal.
- Later (reload, or another device with the same `Driver` name) → Garage locks and Race Setup reflect the Medal.

## Driving it with verify.sh

Preconditions:

- The slot is up and healthy. The driver name is new per run (`Medal <uid>`), so it starts with no Medal.

Journey: `scripts/verify.sh run medals-and-unlocks` (about 2 minutes). Player `a` (the driver's device) and player `c` (a fresh device) use the real build. Two `drive` bots under the same driver name earn the Medals. A Medal is read off the name's persisted best, so a bot's lap counts exactly as the player's own would. The Lobby is proven on the real build, the build players get, which also shows the 3D garage's locked and unlocked hero car. The seam build is not used.

- **Locked cars** (`variant-unlock`). A loads `/` and clicks `.garage-card[data-variant="sedan-sports"]`. Result: the four locked cards have class `locked` and `Locked. Earn a <Tier> medal to unlock`. `getByRole("button", { name: "Select car", exact: true })` is disabled, and `.car-lock-note` reads `Earn a Bronze medal to unlock`. Proof: `01-garage-coupe-locked.png`.
- **Targets** (`medal-targets`). A picks the SUV, opens Race Setup, and types the driver name into `getByLabel("Driver", { exact: true })`, then presses Tab. Result: `getByRole("list", { name: "Medal targets" })` has four `listitem`s, Bronze through Author. Bronze is marked `Next`, and `Your best` reads `No lap yet`. Proof: `02-setup-medal-panel.aria.yml` and `02-setup-medal-targets.png`.
- **HUD chip, no Medal** (`medal-hud-chip`). A creates a Room. Result: `.hud-medal` reads `NEXT · BRONZE` and has `data-medal="none"`. Proof: `03-hud-next-bronze.png`.
- **Bronze** (`medal-earn`). `j.bot("bronze", ["--name", DRIVER, "--create", …, "--mode", "drive", "--pace", "0.8", "--stay", "5"])` drives a lap of about 31.4 s, inside Bronze (35.70 s) but not Silver (28.56 s). Proof: `bot-bronze.jsonl` and `bot-bronze-lap.json` hold the `lap` event (`isPersonalBest`) and the afterLap `standings`.
- **After a reload** (`medal-persist`, `variant-unlock`). A reloads. Result: the Coupe S is unlocked (clicking it enables `Select car`), and Race, Police and Hyper stay locked. Race Setup shows `Bronze medal`, Bronze is marked `earned`, and Silver is marked `Next`. Proof: `04-bronze-garage-coupe-unlocked.png`, `05-bronze-setup.png` and `05-bronze-setup-medal-panel.aria.yml`.
- **HUD chip, Bronze** (`medal-hud-chip`). A creates a second Room. Result: `.hud-medal` has `data-medal="bronze"` and `data-next="silver"`, and reads `NEXT · SILVER`. Proof: `06-hud-bronze-next-silver.png` shows the bronze badge.
- **Silver** (`medal-earn`). A second bot at `--pace 1` drives a lap of about 27.8 s. It started while A was reloading, so the two overlap. Result: a personal best faster than the Bronze lap (the journey compares the two times and never asserts their values). Proof: `bot-silver-lap.json`.
- **Fresh device** (`medal-persist`, `variant-unlock`). C opens a new context, which gets a generated `Racer<NNN>` name, so the Coupe S starts locked. C types the driver name in Race Setup. Result: `Silver medal`, Bronze and Silver are marked `earned`, and Gold is marked `Next`. After `Change car`, the Coupe S and Race are unlocked (Race enables `Select car`). Police stays locked with `Earn a Gold medal to unlock`, and Hyper stays locked too. Proof: `07-fresh-device-silver-setup.png`, `07-fresh-device-silver-medal-panel.aria.yml` and `08-fresh-device-silver-garage-police-locked.png`.
- **DB.** Proof: `db-best-laps.json` holds exactly one `best_laps` row for the name, with its Replay.
- **Medal award** (`medal-award`). **Not yet automated.** The server sends the afterLap Standings only to the connection that drove the lap, so a bot's lap never pops the award in a browser. Proving it means driving the lap in a seam browser: about 35 to 40 s of heavy software-WebGL CPU on every run, for one fading overlay. In the past it was proven by injecting the racing-line lap on the seam build and watching for `.medal-award` while the lap ran (`.medal-award-title` `Silver medal`, `.medal-award-unlock` `New cars unlocked: Coupe S, Race`).
- **Difficulty badges** (`difficulty-medal`). **Not yet automated** as an assertion. The Medium radio's badge appears in `05-bronze-setup.png`, but `.diff-medal[data-medal]` is not checked.
- **Gold, Author, Police and Hyper.** **Not yet automated.** The `drive` bot's fastest lap (about 27.8 s at pace 1) cannot reach Gold (25.23 s) or Author (23.80 s) on Sunset Ridge at Medium, so the journey only shows Police and Hyper as still locked.

## Gotchas

- The seam's recorded lap (`lapInputs()`, about 39.3 s) earns **no Medal**. Use `drive` bots: `--pace 0.8` gives a deterministic Bronze and `--pace 1` a Silver. The bot steps its physics by elapsed wall time, so a slow host does not stretch its lap time. Never seed `best_laps` to fake a Medal.
- A browser Lobby fetches a name's Standings only on page load (`welcome`) and when the `Driver` name changes. A bot's lap does not update an open Lobby or HUD, so reload, or type the name on a fresh device. The journey uses this to start each bot early without racing the "before" assertions.
- Give `drive` bots `--stay` (the journey uses 5 s). Without it, the bot leaves on lap completion and can close before the afterLap `standings` arrives.
- The Lobby saves a typed driver name, and fetches its Standings, only on `change`. After `fill`, press Tab (or Enter) or the panel keeps showing the old name's Medals.
- Two `Medal targets` lists exist: one in Race Setup and one in the Records tab. `getByRole` sees only the visible tab's list.
- A Medal is read from the driver name's best lap on any board, and the slot database keeps earlier runs' laps until `down`. Always use `uid()` names, or an old name starts with its Medal.
