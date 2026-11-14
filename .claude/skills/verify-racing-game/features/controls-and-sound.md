# Controls and sound

A driver steers their car with the keyboard, on-screen touch controls, or a gamepad, all at once if they like. Holding accelerate makes the HUD speedometer climb and the car move on the circuit map, and every other driver in the Room sees it move. Respawn puts the car back on the grid. Sound has one volume and one mute setting, changed from the Lobby's Sound group, the in-Room Mute button or the M key, and it survives a reload.

## Sub-features

- `kbd-drive` W / ArrowUp accelerates, S / ArrowDown brakes then reverses: the speedometer climbs and drops, and the car's map marker moves.
- `kbd-steer` A / ArrowLeft steers left, D / ArrowRight steers right.
- `kbd-respawn` R puts the car back on the grid, standing still.
- `kbd-mute` M toggles mute in a Room (not while typing in a field).
- `kbd-rival` N races the Rival the HUD offers. Belongs to [Pacers](./pacers.md).
- `touch-controls` On a touch screen the Room shows `GAS`, `BRAKE` and a steering slider. A mouse-and-keyboard screen shows none of them.
- `touch-drive` Holding GAS drives, BRAKE slows, and a second finger on the slider steers while GAS stays held.
- `touch-buttons` Race Setup's `Steering` picker (touch screens only) swaps the slider for `Steer left` / `Steer right` buttons.
- `pad-drive` A standard-mapping gamepad drives: right trigger or A accelerates, left trigger or X brakes, left stick or d-pad steers, Y respawns.
- `pad-rumble` The pad buzzes while the car is off the road and jolts on a hit.
- `sound-lobby` Race Setup's `Sound` group has a `Mute` toggle and a `Volume` slider (0 to 100 in steps of 5, default 70%).
- `sound-room` In a Room the engine plays at the chosen volume, squared, and the HUD `Mute` button and M key mute and unmute it.
- `sound-persist` Volume and mute survive a reload.

## How to get to it (user POV)

- Keyboard: in any Room, hold the keys. The HUD speedometer (bottom-right, `KM/H`) and the circuit map (bottom-left) react.
- Touch: open the game on a touch screen. Lobby → `Select car` → `Select track` → Race Setup `01 Race` → `Steering` (`Slider` / `Buttons`) → `Create & Race`. The controls sit bottom-left (steering) and bottom-right (`GAS`, `BRAKE`).
- Gamepad: connect a pad and press a button so the browser lists it, then drive in any Room.
- Sound: Race Setup `01 Race` → `Sound` group (`Mute`, `Volume`). In a Room: the speaker `Mute` button at the end of the bottom-left HUD actions, or the M key.
- Respawn: the R key, a pad's Y, or the HUD `Respawn` button.

## Driving it with verify.sh

Preconditions:

- The slot is up and healthy. No database state is needed. Each player creates their own Room named from `uid()`.

Journey: `scripts/verify.sh run controls-and-sound` (about 2 to 3 minutes). Keyboard, touch and gamepad run on the **real** build. Sound runs on the **seam** build, because only the seam exposes the audio output (`window.__game.state().sound`). Players run one after another (`a`+`b`, then `t`, `g`, `s`) to keep software WebGL load down.

Two readouts stand in for "the car moved" on the real build. The HUD speedometer is `.hud-speed .speed-value`. The circuit map marker is `.hud-map-driver` for your own car and `.hud-map-remote` for other drivers, and its inline `--x`/`--z` style is the car's track position in whole metres. Steering is proven by which side of the straight line off the grid the marker ends up on. The journey takes the straight-line direction from the W step, and each `trail-*.json` holds `leftMetres` (positive is left) and the per-frame marker trail.

- **Keyboard driver and watcher** (`kbd-drive`). A creates a Room and B joins it (`createRoom` / `joinRoom`). Result: the speedometer reads `0`, and `getByRole("button", { name: "Accelerate" })` is hidden on a non-touch screen. Proof: `01-a-parked.png`.
- **Hold W.** `keyboard.down("w")`. Result: the speedometer reaches at least 30, two 12 m chords of the marker differ by less than 0.2 rad (it drives straight), and the car is more than 20 m from the grid. Proof: `02-a-accelerating.png`, plus the journal notes the drift and the peak km/h.
- **The server relays it.** Result: A's `.hud-map-remote` marker on B's map moves more than 15 m. Proof: `03-b-sees-a-move.png` (two markers apart on B's map), and `result.json` `wsCounts` shows `a.out:state` and `b.in:snapshot` in the hundreds.
- **Brake.** Release W and hold S. Result: the speedometer falls below half its earlier reading. Proof: `04-a-braked.png`.
- **Respawn** (`kbd-respawn`). Press R. Result: the marker is back within 8 m of the grid, the speedometer reads `0`, and A sent a `respawn` message (`a-ws.jsonl`, `dir: "out"`). Proof: `05-a-respawned.png`.
- **Steer** (`kbd-steer`). From the grid, hold W+A, then (after R) W+D, then (after R) ArrowUp+ArrowLeft. Result: the car ends at least 3 m left, then right, then left of the straight line. Proof: `06-a-steered-left.png` (nose turned to the left barrier), `07-a-steered-right.png` (turned to the right barrier and grandstands), `08-a-arrows.png`, and `trail-a-key-a.json` / `trail-a-key-d.json` / `trail-a-arrow-left.json`.
- **M key** (`kbd-mute`). Press M twice. Result: the HUD `getByRole("button", { name: "Mute", exact: true })` goes `aria-pressed="true"` and back. Proof: `09-a-hud-muted.aria.yml`.
- **Touch controls** (`touch-controls`). Player `t` uses a 568×320 viewport with `contextOptions: { hasTouch: true, isMobile: true }`. Result: Race Setup shows `radiogroup "Steering"` with `Slider` checked, and the Room shows `Accelerate`, `Brake` and `.touch-steer`. Proof: `10-t-steering-picker.aria.yml`, `11-t-touch-controls.png`.
- **Touch driving** (`touch-drive`). Real touches go through CDP `Input.dispatchTouchEvent`, because Playwright's `touchscreen` only taps with one finger. Holding GAS adds the `pressed` class, the speedometer reaches at least 20, and the car moves more than 10 m (`12-t-gas-held.png`). BRAKE halves the speed (`13-t-braked.png`). Tapping the HUD `Respawn` button, then holding GAS with a second finger on the slider's left end, leaves the car more than 3 m left of the line (`14-t-slider-left.png`, `trail-t-slider-left.json`).
- **Touch buttons** (`touch-buttons`). Leave the race, pick `getByRole("radio", { name: "Buttons" })`, and create a new Room. Result: `Steer left` and `Steer right` are visible, `.touch-steer` is gone, and GAS+`Steer left` veers left. Proof: `15-t-arrow-buttons.png`, `trail-t-steer-left-button.json`.
- **Gamepad** (`pad-drive`, `pad-rumble`). Playwright cannot attach a gamepad, and Chromium lists none until a physical button press. The journey therefore installs a standard-mapping pad behind `navigator.getGamepads` with an init script, the same production boundary as `e2e/specs/gamepad-and-sound.spec.ts`. Everything from `getGamepads()` onward is the real build. Half the right trigger reaches 12+ km/h and moves the car more than 10 m (`17-g-trigger.png`). Y respawns and sends `respawn` (`18-g-respawned.png`). From the grid, full throttle with full left stick veers left, `.offtrack-warn` gets `visible`, and the pad records a weak-led `dual-rumble` (`19-g-offtrack-rumble.png`, `trail-g-stick-left.json`).
- **Lobby sound** (`sound-lobby`). On the seam build, Race Setup `group "Sound"` starts at `Volume` `70` and `Mute` `aria-pressed="false"`. Fill `40` and click `Mute`. Result: the readout shows `40%` and Mute is pressed. Proof: `20-s-lobby-sound.aria.yml`, `20-s-lobby-sound.png`.
- **Room sound** (`sound-room`). Create a Room. Result: `j.state("s").sound` is `{ context: "running", gain: 0, engines: ≥1 }` (`sound-muted.json`). M unmutes, and gain settles at `0.16` (40% squared, `sound-unmuted.json`, `21-s-unmuted.png`). The HUD Mute button mutes again, and gain drops below 0.001 (`22-s-hud-muted.png`).
- **Persistence** (`sound-persist`). Reload. Result: the Lobby shows `Volume` `40` and `Mute` pressed. Proof: `23-s-sound-after-reload.aria.yml`.
- **Audible output.** **Not yet automated.** Headless Chromium has no audio device to record from. The proof stops at the AudioContext state and master gain.
- **Real pad hardware, d-pad, A/X buttons, and collision jolts.** **Not yet automated.** No physical pad is available. The fake pad drives only the trigger, stick and Y paths, and nothing collides with another car in the journey.
- **Rival race key N** (`kbd-rival`). **Not yet automated here.** It needs a Rival offer, which [Pacers](./pacers.md) sets up.

## Gotchas

- From the grid, going straight leaves the road within about 30 m (the circuit bends right). Off the road the speedometer caps at about 16 km/h. Assert speed thresholds before the car leaves the road, or use lower thresholds for slower inputs (a half trigger).
- Barriers sit about 12 m from the centreline, and the grid is off-centre. A turning car that reaches a barrier slides along it, and the marker trail can then run backwards. Start every steering check from the grid (R / Y / HUD `Respawn` first), and read the car's side of the straight line, not its heading change.
- The map marker is rounded to whole metres and updates once per rendered frame. Sample it every frame (a `MutationObserver` on its `style`, as the journey does) rather than polling, or a slow page skips whole turns.
- The last driver to leave closes the Room. To come back after `Leave race`, create a new Room. Joining by name fails because the row is gone.
- Touch controls only show under `(pointer: coarse)`. A context without `hasTouch` never shows them, nor the Lobby's `Steering` picker.
- Keys are ignored while focus is in an input, textarea or select. Keys pressed right after `Create & Race` reach the game. If a journey focuses a field first, it must move focus off it, or the keys are swallowed silently.
- `getByRole("button", { name: "Mute" })` matches the Lobby toggle in the Lobby and the HUD button in a Room. Never both are visible at once.
- Gain glides to each new level. Poll it (`expect.poll`) and never read it once.
