# Rooms

A Room is the shared race space. A driver names a new Room in Race Setup (taking the Track and Difficulty chosen in the Lobby) or picks an open one from the Room list, and lands in the race scene with the HUD's Best Laps panel listing every driver in it. Other drivers' cars appear and move live, and leaving returns the driver to the Lobby.

## Sub-features

- `room-create` names a new Room and lands the creator in it, with the Room name on the HUD.
- `room-list` shows open Rooms in Race Setup with their Track, Difficulty and `<n> racing` count.
- `room-join` joins an open Room from the list.
- `room-presence` shows every driver in the HUD standings, and other cars and name tags in the scene.
- `room-persist` stores the Room (name, Track, Difficulty) so it survives a server restart for up to 1 hour.
- `room-leave` returns the driver to the Lobby via `Leave race`, and the others see them gone.
- `room-reconnect` returns a driver whose connection dropped to the Lobby, reconnects automatically, and lets them rejoin the still-open Room.

## How to get to it (user POV)

- Lobby → `Select car` → `Select track` → Race Setup tab `01 Race` → fill `Driver` and `Room name` → `Create & Race`.
- Lobby → Race Setup → choose an open Room in the `Room` radiogroup → `Join & Race`.
- In a Room → `Leave race` button (bottom-left HUD).

## Driving it with verify.sh

Preconditions:

- The slot is up and healthy. Its database may hold other journeys' Rooms, so names come from `uid()`.

Journey: `scripts/verify.sh run rooms` (real build, two players `a` and `b`, about 2 minutes).

- **Open the Lobby.** Both players load `/`. Handle: `.lobby-deck` visible with `data-screen="garage"`. Proof: `01-lobby-garage.png` shows `CHOOSE YOUR CAR.` and the Daily banner.
- **Pick a car.** A clicks `.garage-card[data-variant="suv"]`. Result: the card has `aria-checked="true"`.
- **Create.** A opens Race Setup (`Select car`, `Select track`, `[data-setup-tab="race"]`), fills `getByLabel("Driver", { exact: true })` and `getByPlaceholder("New room name")`, then clicks `getByRole("button", { name: "Create & Race" })`. Result: `.hud-standings tbody` contains A's name. Proof: `02-a-in-room.png` shows the Room name top-left, `LAP 0`, and A in `BEST LAPS`.
- **List.** B reloads and opens Race Setup. Result: `.room-row` with the Room name contains `1 racing`. Proof: `03-b-room-list.aria.yml` has a `radio "<Room> Sunset Ridge Circuit Medium 1 racing"`.
- **Join.** B clicks that `.room-row`, then `getByRole("button", { name: "Join & Race" })`. Result: both pages' `.hud-standings tbody` list both names. Proof: `04-a-sees-b.png` shows B's car and a `Bravo <id>` name tag, and `05-b-sees-a.png` shows the reverse.
- **Server and DB.** Proof: `joined-messages.json` holds the `joined` server messages for both players, and `db-rooms.json` holds exactly one `rooms` row with the Room name, `track = sunset-ridge` and `difficulty = medium`.
- **Leave** (`room-leave`). B clicks `getByRole("button", { name: "Leave race" })`. Result: B sees `.lobby-deck` and no `.hud-standings`, A's `.hud-standings tbody` no longer contains B's name, and B's `.room-row` for the Room reads `1 racing`. Proof: `06-b-back-in-lobby.png`, `07-a-alone-again.png` and `08-b-room-list-after-leave.aria.yml`; B received a `left` server message.
- **Rejoin.** B joins again so A has an observer for the next step.
- **Reconnect** (`room-reconnect`). The journey drops A's WebSocket at the network boundary, the way a flaky connection would. Result: A is returned to the Lobby (`.lobby-deck`) with a `Connection lost. Reconnecting automatically` notice, B's standings drop A, and A's client opens a new connection by itself until `.connection-status` reads `LIVE MULTIPLAYER` with no `.connect-error`. Proof: `09-a-after-drop.png`, `10-b-sees-a-gone.png`.
- **Rejoin after reconnect.** The player is not put back into the Room automatically. A opens Race Setup, sees the Room still listed with `1 racing` (`11-a-room-list-after-reconnect.aria.yml`), clicks it and `Join & Race`. Result: both standings list both names (`12-a-back-in-room.png`, `13-b-sees-a-back.png`), and the `rooms` row is still the single row for the Room.

## Gotchas

- The Room list renders from the server's `rooms` broadcast. A player whose Lobby was already open before the Room existed may need the list to refresh. The journey reloads B before looking.
- `getByLabel("Driver")` without `exact: true` also matches other labels containing "Driver". Keep `exact`.
- Rooms close 1 hour after creation and survive restarts until then. Old journeys' Rooms show up in the list, so always filter `.room-row` by the run's unique name.
- Under software WebGL, the first `Create & Race` compiles every shader and can block the page for seconds. Wait on `.hud-standings`, never sleep.
- `Start Race` / `Start Knockout` on the same HUD belong to [Races](./races.md), and `Respawn` belongs to [Laps and leaderboard](./laps-and-leaderboard.md).
- A dropped connection sends the driver to the Lobby, not back into the Room. While offline the Lobby's Room list is stale (it still showed `2 racing`). Wait for `LIVE MULTIPLAYER` before reading it.
- The journey observes the drop through a Playwright WebSocket route installed before the first page load; installing it later misses the already-open socket.
