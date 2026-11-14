# Garage and circuits

The Lobby opens on the Garage, a car carousel, then moves on to the Circuit carousel and finally Race Setup. The driver browses cars with arrow buttons, arrow keys or the car cards, and the chosen car is remembered across reloads. Variants that need a Medal tier show a lock and cannot be selected until a Medal is earned. The chosen Track and Difficulty carry into the Room the driver creates.

## Sub-features

- `garage-carousel` browses cars with `Previous car` / `Next car`, the left/right arrow keys and the car cards, wrapping at both ends.
- `garage-persist` remembers the selected car across a reload.
- `garage-locked` shows Medal-gated Variants as locked, names the Medal needed, and keeps `Select car` disabled for a fresh driver.
- `circuit-carousel` browses all three Tracks with `Previous track` / `Next track`, the arrow keys and the track cards.
- `progress-steps` returns to the Circuit or Garage step from the progress bar, keeping the choices.
- `track-to-room` carries the chosen Track and Difficulty into the Room: HUD Circuit map label, `joined` message and `rooms` row.

## How to get to it (user POV)

- Open `/`: the Garage (`CHOOSE YOUR CAR.`) is the first screen. Browse with `Next car` / `Previous car`, `ArrowLeft` / `ArrowRight`, or click a `.garage-card[data-variant]`.
- `Select car` → Circuit screen (`CHOOSE YOUR CIRCUIT.`): `Next track` / `Previous track`, arrow keys, or click a `.track-card[data-track]`.
- `Select track` → Race Setup: `Change car` / `Change track`, or the `Race setup progress` navigation (`01 GARAGE`, `02 CIRCUIT`) to go back.
- Race Setup → Difficulty radiogroup (`Hard`) → `Driver`, `New room name` → `Create & Race`.

## Driving it with verify.sh

Preconditions:

- The slot is up and healthy, and the player is fresh (no Medal, so the four Medal-gated cars are locked). Visuals are real-build only: the seam build skips the Garage and Circuit WebGL stages.

Journey: `scripts/verify.sh run garage-and-circuits` (real build, one player, about 1 minute).

- **Garage opens.** Load `/`. Handle: `.lobby-deck[data-screen="garage"]`, `Select car` visible. Proof: `01-garage.png`.
- **Arrows and keys.** Click `Next car` / `Previous car`, then press `ArrowRight` / `ArrowLeft` with focus on `Next car`. Result: `.garage-card.active` changes and returns. Proof: `02-next-car.png`, `03-arrow-right.png`. Cycling every car returns to the start (wrap).
- **Locked cars.** Click each of `sedan-sports`, `race`, `police`, `race-future`. Result: the card has class `locked`, `aria-checked="true"`, `Select car` is disabled, `.car-lock-note` names a Medal, and a forced click stays on the Garage. Proof: `04-locked-police.png` (lock over the car, `Earn a Gold medal to unlock`), `04-locked-garage.aria.yml`.
- **Select a free car and persist.** Click `.garage-card[data-variant="suv"]`, then reload. Result: the SUV card is still `aria-checked="true"`. Proof: `05-suv-selected.png`, `06-suv-after-reload.png`.
- **Circuit carousel.** `Select car`. Result: three `.track-card[data-track]` (ids in `tracks.json`); `[data-track-carousel]` arrows and arrow keys change `.track-card.active`; clicking each card makes it active and updates `.hero-track-name`. Proof: `07-circuit.png`, `08-track-<id>.png`.
- **Progress steps.** From Race Setup click `02 CIRCUIT`, then `01 GARAGE` in the `Race setup progress` navigation. Result: `data-screen` goes back to `track` then `garage`, with the Track and the SUV still selected. Proof: `10-back-to-circuit.png`, `11-back-to-garage.png`.
- **Track and Difficulty reach the Room.** Pick the last Track and `Hard`, name driver and Room, `Create & Race`. Result: the HUD Circuit map label and `.hud-room` show the Track and Room, the `joined` message has that `track` and `difficulty`, and exactly one `rooms` row matches. Proof: `13-hud-track.png`, `joined-message.json`, `db-rooms.json`.
- **Unlocking a car by Medal** (`garage-locked`, unlocked side). **Not yet automated** here: it needs a driven lap, covered by [Medals and unlocks](./medals-and-unlocks.md).
- **Touch / reduced-motion layout.** **Not yet automated**: `e2e/specs/carousel.spec.ts` covers the phone viewport.

## Gotchas

- The Garage shows the car cards in carousel order, not the first free car's position; read `data-variant`, never the index.
- A locked car can be browsed and is remembered as the browsed car, but the driver races as the first free car. Assert the lock UI, not the saved value.
- Race Setup's progress steps are disabled on the Garage and on the Race Setup step itself; they work from Circuit and Race Setup only.
- Under software WebGL the first Garage and Circuit renders take seconds. Wait on `data-screen` and active cards, never sleep.
- The Daily banner on the Garage names a Track too; it is unrelated to the Track the driver picks in the carousel.
