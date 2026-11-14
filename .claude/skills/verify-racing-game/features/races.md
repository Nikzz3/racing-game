# Races

Any driver in a Room can call a Race (first to three laps) or a Knockout (the last car to complete each lap is out) from the HUD. Every driver in the Room takes a Grid slot, empty slots up to six cars fill with Pacers from the fastest human Replays on the Room's board, and everyone sees the same countdown, live positions and results. A driver who joins mid-race, finishes, is knocked out or leaves is a Spectator with no car, watching the cars still racing. Results show for 10 s, then the Room returns to free driving.

## Sub-features

- `race-call` calls a Race from `Start race`. Both start buttons hide while the race counts down or runs.
- `knockout-call` calls a Knockout from `Start knockout`. It runs one lap fewer than it has cars, and refuses with fewer than two cars.
- `race-countdown` holds every entrant on the Grid for 3 s, then GO.
- `race-grid` seats the Room's drivers in join order, then the grid Pacers behind them.
- `grid-pacer` fills empty Grid slots with Pacers from human Replays on the Room's `(Track, Difficulty)` board. Everyone sees them, and they are ranked like drivers.
- `race-standings` shows live positions to every driver: the `RACE` / `KNOCKOUT` table with `L<k>/<laps>` or a finish time, `P<n>/<cars>` and `LAP <k>/<laps>`.
- `race-finish` counts a car's race laps and finishes it after the last one, with its race time.
- `race-grace` ends a Race 30 s after the first finish. Cars still racing are classified out (DNF).
- `race-spectator` makes a driver who joins mid-race a Spectator: no car, Respawn disabled, a banner naming the watched car (the leader first), and `‹` / `›` to cycle cars.
- `race-dnf` marks a driver who leaves mid-race DNF (Race) or OUT (Knockout).
- `knockout-elimination` knocks out the last car to complete a lap as soon as every other car has completed it, with an `<name> is out` toast.
- `race-results` shows `RACE RESULTS` / `KNOCKOUT RESULTS` with a `Free driving in <n>s` countdown.
- `race-free-driving` returns the Room to free driving after the results: Best Laps standings and start buttons come back, and Spectators drive again.
- `race-not-persisted` writes nothing for the race itself. Only Plausible Laps reach `best_laps`.

## How to get to it (user POV)

- In a Room (see [Rooms](./rooms.md)), click `Start race` or `Start knockout` (bottom-left HUD). Either works when no race is running or while results show.
- Lobby → Race Setup → pick a Room whose race is running → `Join & Race`. The driver arrives as a Spectator.
- During a race → `Leave race`. The leaver gets a DNF.
- As a Spectator, use `Previous car` / `Next car` on the Spectator banner.

## Driving it with verify.sh

Preconditions:

- A fresh `up` on the slot. The Sunset Ridge Medium and Easy boards must hold no Replay, because every Replay takes a Grid slot. Otherwise the journey's first step fails with "run `verify.sh down` then `up`".
- Nothing else. A bot drives the lap behind the grid Pacer.

Journey: `scripts/verify.sh run races`. It uses three real-build players (`a`, `b`, `c`) plus headless bots and takes about 2.5 minutes. The bots: `pete` (`drive`, the Grid Pacer's Replay), `ann` / `ben` (`warp`, Race) and `cat` / `dan` (`warp`, Knockout). The browsers only click and watch. Bots do all the driving.

- **Replay on the board** (`grid-pacer` precondition). Bot Pete creates its own Room and drives one Plausible Lap (~30 s) while the three Lobbies load. Proof: `bot-pete.jsonl` has a `lap` event, and `db-pete-replay.json` has Pete's `replays` row.
- **Four drivers in the Race Room.** A creates the Room and B joins. Then warp bots Ann and Ben join with `--laps race`, so they sit until a Race and drive it out. Handles: `getByRole("button", { name: "Start race", exact: true })` and `"Start knockout"` are visible. Proof: `01-a-free-driving-four-drivers.png`.
- **Call a Race** (`race-call`, `race-standings`). C picks the Room in Race Setup first. A clicks `Start race`, and C clicks `Join & Race` once A's `.race-standings h3` reads `RACE`. Result on A and B: `.rs-name` lists A, B, Ann, Ben and Pete. `.race-standings tr.pacer .rs-name` is Pete, `.race-position` reads `P<n>/5` and `.hud-lap` reads `LAP 1/3`. The start buttons and `.hud-standings` are hidden. Proof: `02-a-race-grid.png`.
- **Server state** (`race-countdown`, `race-grid`, `grid-pacer`). `a-ws.jsonl` holds a `race` message with `phase: "countdown"`, `format: "race"`, `laps: 3` and a `goT`. Its slots are A 0, B 1, Ann 2, Ben 3 and Pete 4 (`pacer: true`), and a `phase: "racing"` message follows. Proof: `racePacers-b.json` holds Pete's Pacer with its frame count.
- **Cars finish their laps** (`race-finish`). Ann and Ben finish 3 laps within seconds of GO. Result on A and B: two `.race-standings tr.finished` rows whose `.rs-status` is a race time, and A still at `L0/3`. Proof: `race-bots-done.json` (each bot `finished` with `laps: 3`), `03-b-bots-finished.png` and `03-b-race-standings.aria.yml`.
- **DNF** (`race-dnf`). B clicks `Leave race`. Result: B's row on A's standings reads `DNF`. The first `race` state with B `out` is still `phase: "racing"` with A `racing`, so the leave caused it, not the grace period. Proof: `04-a-b-dnf.png`.
- **Spectator** (`race-spectator`). Result on C: `.spectator-banner` has class `visible` and `.spectator-target` reads Pete (the leader still racing). `.race-position` is hidden, `getByRole("button", { name: "Respawn" })` is disabled, and C is not an entrant. `getByRole("button", { name: "Next car" })` switches the target to A. Proof: `05-c-spectating-leader.png` and `06-c-spectating-next-car.png`.
- **Race results** (`race-grace`, `race-results`). Thirty seconds after Ann's finish, A and Pete are out. Result on A and C: `.race-results` has class `visible` and its `h2` reads `RACE RESULTS`. `.rr-name` lists Ann and Ben (finished, in either order), then Pete, A and B, all `DNF`. `.race-results-return` says `Free driving in`. Proof: `07-a-race-results.png`, `08-c-race-results.png` and `race-results-a.json`.
- **Back to free driving** (`race-free-driving`). Result on A and C after 10 s: the results are gone, `Start race` is visible and `.hud-standings` lists A, C, Ann and Ben. C's Spectator banner is gone and C's Respawn is enabled. The last `race` message is `null`. Proof: `09-c-free-driving-again.png`.
- **Knockout needs two cars** (`knockout-call`). A leaves, picks `.diff-opt[data-diff="easy"]` (an empty board, so no Pacer) and creates the Knockout Room alone. A clicks `Start knockout`. Result: `getByRole("alert")` reads `A Knockout needs at least two cars` and no race starts. Proof: `10-a-knockout-needs-two-cars.png`.
- **Knockout by laps** (`knockout-call`, `knockout-elimination`). Warp bots Cat and Dan join, and A clicks `Start knockout`: 3 cars, 2 laps. Both bots complete lap 1, so A is out at once. On lap 2 the first bot home wins and the other is out. Proof: `knockout-a-out-state.json` (`phase: "racing"`, both bots at ≥ 1 lap, received well before GO + 30 s), `knockout-bots-done.json` (one `finished`, one `out`), and A's recorded toasts, which include `<A> is out`.
- **Knockout results.** Result on A: `KNOCKOUT RESULTS`, with the winning bot, then the other bot, then A. There is one `li.finished` row and two `li.out` rows that read `OUT`. Proof: `11-a-knockout-results.png` and `knockout-results-a.json`. Then free driving returns: `Start knockout` is visible and all three are in `.hud-standings`. Proof: `12-a-free-driving-after-knockout.png`.
- **Not persisted** (`race-not-persisted`). Proof: `db-best-laps.json` holds only Pete's lap among the eight run names. Warp laps are implausible and never persist.

These parts are **Not yet automated**:

- **A browser driver finishing a race** (the `You finished P<n>` toast and the local HUD lap count rising mid-race). Proving it means a browser must drive its own race laps. The seam's recorded lap (`e2e/lap-inputs.json`) starts from the free-driving spawn, 50-60 m behind the Grid. Replaying it from a Grid slot would brake and turn in the wrong places, and the journey does not attempt it. A recording that starts on a Grid slot would fix this. Bots prove finishing for every other viewer.
- **The visible countdown** (`3`, `2`, `1`, `GO!` in `.race-countdown`). Its 3 s window is too short to catch under software WebGL (see `docs/agents/e2e-testing.md`). The countdown → racing messages prove it instead.
- **A Knockout elimination by the grace timeout** (a car that never completes the lap). It costs 30 s plus a lap. The Race's grace period is covered, and so is a Knockout elimination by laps.

## Gotchas

- The buttons read `Start race` and `Start knockout`, with a lower-case r and k. Use `exact: true`.
- Every Replay on the Room's `(Track, Difficulty)` board takes a Grid slot, up to six cars. A second run on the same `up` gets more Pacers and different slots. Run `down` then `up` first. Any `drive` bot or seam lap on Sunset Ridge Medium adds Pacers to every later race there.
- The Race ends about 35 s after GO: the warp bots finish in ~5 s, then the 30 s grace runs. The race call, B's DNF and C's Spectator checks must all land inside that window. C picks the Room before the call so that only `Join & Race` is left to click.
- Warp bots' finishing order is not fixed. Assert the finishers as a set and assert everything after them in order.
- Toasts disappear after 3.8 s. The journey records `.toasts` children with a MutationObserver on A's page instead of racing them.
- A Room with nobody in it is deleted, race and all. The bots stay (`--stay 120`), so each Room stays alive while players leave and join.
- The server cuts names to 16 characters. `Charlie <uid>` is 13.
- While results show, the HUD still shows the race lap (`LAP 1/2`) and both start buttons. A new race may be called during results.
