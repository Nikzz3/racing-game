# Verifying changes

Before calling a change done or pushing it, prove it the way a player would see it, unprompted. Unit tests show the logic is right; the `verify-racing-game` skill (`.claude/skills/verify-racing-game/`) shows the game still works end to end. Read its `SKILL.md` and `features/README.md` before the first run.

## Cheapest check first

1. `.claude/skills/verify-racing-game/scripts/verify.sh smoke` (~50 s, no browser) after every `server/` or `shared/` change. Bots play Rooms, a persisted lap, a Race, a Knockout and the Daily over the real protocol, and the database is read back.
2. The journeys below for whatever the change shows a player.
3. `verify.sh all` (~3 min) before a desktop release or after a change that touches many features.

## What to run for which change

| Change touches                                       | Run                                                                         |
| ---------------------------------------------------- | --------------------------------------------------------------------------- |
| `shared/` physics, tracks, checkpoints, timing rules | `npm test`, then the `laps-and-leaderboard` journey                         |
| `server/` lap validation, persistence, leaderboard   | `npm test -w server`, then `laps-and-leaderboard` and `records-and-replays` |
| `server/` or `client/` Rooms, networking, reconnect  | `rooms`                                                                     |
| Races, Knockouts, Grid, Spectators                   | `races`                                                                     |
| Pacers, Rivals, Standings                            | `pacers`                                                                    |
| Medals, car unlocks                                  | `medals-and-unlocks`                                                        |
| Daily Challenge                                      | `daily-challenge`                                                           |
| Lobby: Garage, Circuit, Race Setup                   | `garage-and-circuits` (and the feature the setting feeds)                   |
| HUD, input, touch, gamepad, sound                    | `controls-and-sound`                                                        |
| A Track's geometry                                   | `npm run track:check`, then `garage-and-circuits`                           |
| `desktop/`                                           | `desktop-app`, then release it (AGENTS.md, "Desktop releases")              |
| Docs, CI, `rl/` only                                 | No journey                                                                  |

Run each journey named for every feature the change touches, not just the first. A feature the map does not cover yet gets a journey and a feature file before it can be reported as verified. Reach game states with the skill's bot (`verify.sh bot`), never by driving a browser to get there.

## Reporting

End the hand-back with a `## Proof` section, one line per sub-feature ID from the feature files:

```markdown
## Proof

Revision 1a2b3c4 (dirty: client/), slot 0.

- `room-join` — **passed**: `rooms` journey; B's HUD lists A and B (`04-a-sees-b.png`); one `rooms` row. Evidence: `reports/verify/20261114-185609-s0-rooms/`
- `lap-persist` — **failed**: expected a `best_laps` row for `Ace`; observed none, and no `standings` followed the `lap` message (silently implausible). Evidence: `reports/verify/…`
- `medal-award` — **unproved**: Not yet automated (the award shows only to the browser that drove the lap).
```

- **passed** means the journey ran green on this revision and the artifacts named show it.
- **failed** gives what was expected, what was observed and where.
- **unproved** names the precondition or capability that was missing. That includes the sandbox when running unsandboxed was not authorized. Never report an unproved entry point as passed through another one.
