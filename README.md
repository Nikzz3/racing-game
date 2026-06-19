# Sunset Ridge Racing

A browser-based 3D multiplayer racing game. Three.js client with arcade WASD driving on a
custom circuit, a Node.js WebSocket server with a lobby/room system, and a persistent
best-lap leaderboard.

## Running

Requires a Postgres database (rooms and the best-lap leaderboard are stored there).
For local development, start one with Docker or Podman:

```bash
docker compose up -d   # or: podman compose up -d
npm install
npm run dev
```

The server connects to `postgres://postgres:postgres@localhost:5432/racing` by default;
set `DATABASE_URL` to override (this is how the deployed environment is configured).

- Client: http://localhost:5173
- WebSocket server: ws://localhost:8080

Open the client in multiple tabs/browsers to race together. Enter a driver name, create a
room (or join an existing one), and drive.

## Controls

- `W` — throttle
- `S` — brake / reverse
- `A` / `D` — steer
- `R` — respawn (teleport back to the start, abandon the in-progress lap)

## How it works

- `shared/` — track spline definition, checkpoints, and the WebSocket message protocol
- `server/` — room manager, server-side checkpoint validation and lap timing, persistent
  leaderboard and room list stored in Postgres
- `client/` — Three.js scene, track mesh generation, car physics, remote player
  interpolation, lobby and HUD

Laps only count when all checkpoints are passed in order (validated server-side), so
cutting the track does not pay off. Best lap times are saved in the database and survive
restarts. Rooms also survive restarts but are automatically closed 1 hour after creation.
