# Sunset Ridge Racing

A browser-based 3D multiplayer arcade racing game. Pick one of eight cars, race the
Sunset Ridge or Stormhaven circuit in a live multiplayer room, watch replays of recorded
laps, chase a human or AI pacer around the track, and put your best lap on a persistent
leaderboard that survives server restarts.

## Play in the browser

Open https://racing.nickzimmermann.com in a desktop or mobile browser. Nothing to install.

## Desktop app

The same game is also packaged as a desktop app. Grab the installer for your platform
from the [latest release](https://github.com/Nikzz3/racing-game/releases/latest); files
are named `Sunset-Ridge-Racing-<version>-<os>-<arch>.<ext>`.

| Platform              | File                                                  |
| --------------------- | ----------------------------------------------------- |
| macOS (Apple Silicon) | `Sunset-Ridge-Racing-<version>-mac-arm64.dmg`         |
| macOS (Intel)         | `Sunset-Ridge-Racing-<version>-mac-x64.dmg`           |
| Windows (x64)         | `Sunset-Ridge-Racing-<version>-win-x64.exe`           |
| Linux (x64)           | `Sunset-Ridge-Racing-<version>-linux-x86_64.AppImage` |

The installers are unsigned, so the first launch needs one extra step:

- **macOS**: the app is not notarized. If macOS refuses to open it, go to System Settings,
  Privacy & Security, and click Open Anyway. Or run this once in a terminal:

  ```bash
  xattr -cr "/Applications/Sunset Ridge Racing.app"
  ```

- **Windows**: in the SmartScreen dialog, click "More info", then "Run anyway".
- **Linux**: `chmod +x` the AppImage, then run it (or add it to Steam as a non-Steam game).

Installed apps check for new releases and update themselves from the published releases.
The exception is the unsigned macOS build, which opens the download page instead so you
can install the new version by hand.

## Controls

- `W` : throttle
- `S` : brake / reverse
- `A` / `D` : steer
- `R` : respawn (teleport back to the start, abandon the in-progress lap)

On phones and tablets, on-screen touch controls replace the keyboard.

## How to race

1. Choose a car in the garage. Cars are cosmetic only; every car has the same physics.
2. Choose a circuit.
3. Enter a driver name, then create a room (name it yourself) or join an open one from
   the room list. Everyone in a room races the same circuit at the same difficulty.

A lap only counts when you pass every checkpoint in order (the server checks this), so
cutting the track does not pay off. Your best lap is saved per circuit and difficulty and
shows up on the leaderboard, where you can watch it as a replay or race against it as a
pacer. Rooms close automatically one hour after they are created.

## Watch Jev drive

On Sunset Ridge at Medium, the Records tab also lets you watch **Jev**, an AI that drives
by answering two questions many times a second: brake or accelerate, and steer left or
right. Replay the lap Jev recorded, or watch it drive a fresh lap live. A box on screen
shows each question and how sure Jev was of every answer. Every live lap turns out a
little different.

## Contributing

Setup, tests, project layout, and the desktop release flow are in
[CONTRIBUTING.md](CONTRIBUTING.md). Bugs and feature requests are tracked as
[GitHub issues](https://github.com/Nikzz3/racing-game/issues).
