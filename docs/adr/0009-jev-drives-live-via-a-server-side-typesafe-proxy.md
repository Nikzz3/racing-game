# Jev drives live through a server-side TypeSafe proxy

ADR-0002 and ADR-0006 keep the RL policy's forward pass out of the race loop: the AI
Reference Lap is a deterministic bake, and a live policy under variable browser `dt` would
not be the validated record. This ADR adds a second, different AI driver — **Jev**,
TypeSafe's System One model — whose whole point is to decide _live_. It does not relax the
invariants of ADR-0002/0006 for the RL policy; it defines what Jev may do.

## Decision

Jev reads a plain-English description of the car and the road ahead
(`jevDrivingState` in `shared/src/jev.ts`) and answers two Choice questions in one request:
**brake or accelerate**, and **steer left or right**. Code owns the geometry, the physics and
the mapping to pedals: full throttle or full brake for the pedal Jev picked, and a steering
amount equal to how sure Jev is of its side (`P(left) − P(right)`).

Jev drives in two ways, both on Sunset Ridge at Medium only:

- **Jev Lap:** `npm run jev:record` drives one lap headlessly against the real `CarPhysics`
  at 1/60 s, asking Jev every 100 ms of game time, and writes the frames and decisions to a
  bundled JSON file. Players replay it at no API cost, offline and in the desktop app.
- **Jev Live Run:** the client simulates the car in real time and asks the server for each
  decision over the existing WebSocket (`jevDrive` → `jevDecision`). The server holds
  `TYPESAFE_API_KEY`, builds the prompt from the numbers the client sends, and answers.

## Considered Options

- **Call TypeSafe from the browser (rejected):** would expose the API key to every player.
- **An HTTP endpoint (rejected):** the WebSocket already reaches the server from the
  browser, the Vite dev server and the desktop app (whose CSP allows `ws:`/`wss:` only), with
  no CORS. Per-connection limits also fall out of the connection itself.
- **Let the client send the state or questions (rejected):** the server accepts only a pose
  and a track and builds the prompt itself, so the endpoint is not an open TypeSafe proxy.
- **Ask Jev about the current pose in live runs (rejected):** a TypeSafe round trip takes
  about 250 ms, and a decision about where the car _was_ arrives too late — in the prototype
  the car never finished a lap. The client instead steps a copy of the physics forward by
  the measured latency and asks about the pose it will have when the answer lands; with that
  prediction the live lap matched the fixed-cadence one (36.6 s against 36.5 s).

## Invariants

1. **The key never leaves the server.** Without `TYPESAFE_API_KEY` (and without the
   `JEV_STUB=1` stand-in used by e2e) the server reports `jev: false` in `welcome` and the
   client hides the live run.
2. **Bounded spend.** Per connection: one decision in flight and the Jev Lap's 10
   decisions/s (burst 3). Server-wide, so opening more sockets buys nothing: 24 decisions in
   flight, 20 decisions/s, and a daily budget (`JEV_DAILY_DECISIONS`, default 50,000 — about
   300 live laps) after which Jev answers `disabled` until UTC midnight. A refused request
   answers `jevUnavailable` and never queues. A decision gets 2 s and no retries, and an
   answer whose probabilities are not in 0–1 is reported as `failed`
   (`server/src/jev-proxy.ts`).
3. **Never a leaderboard row.** Neither the Jev Lap nor a Jev Live Run is sent through lap
   timing, persisted, ranked, or used as a Track Record (ADR-0001 stands).
4. **Medium, Sunset Ridge.** The cornering guide in the pedal question is derived from the
   Medium grip model; other difficulties or tracks need it retuned first.

## Consequences

- Live runs differ from run to run because network latency does; the Jev Lap is a single
  recording that changes only when someone re-records it.
- The prompt is code (`JEV_QUESTIONS`); changing the physics tuning means re-checking the
  cornering guide and re-recording the Jev Lap.
- A TypeSafe outage or rate limit degrades a live run (the car holds its last input and the
  HUD shows it), not the rest of the game.
