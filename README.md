# Sunset Ridge Racing

A browser-based 3D multiplayer racing game. Three.js client with arcade WASD driving on a
custom circuit, a Node.js WebSocket server with a lobby/room system, and a persistent
best-lap leaderboard.

## Running

```bash
npm install
npm run dev
```

- Client: http://localhost:5173
- WebSocket server: ws://localhost:8080

Open the client in multiple tabs/browsers to race together. Enter a driver name, create a
room (or join an existing one), and drive.

## Controls

- `W` — throttle
- `S` — brake / reverse
- `A` / `D` — steer

## How it works

- `shared/` — track spline definition, checkpoints, and the WebSocket message protocol
- `server/` — room manager, server-side checkpoint validation and lap timing, persistent
  leaderboard stored in `server/data/leaderboard.json`
- `client/` — Three.js scene, track mesh generation, car physics, remote player
  interpolation, lobby and HUD

Laps only count when all checkpoints are passed in order (validated server-side), so
cutting the track does not pay off. Best lap times are saved on the server and survive
restarts.
