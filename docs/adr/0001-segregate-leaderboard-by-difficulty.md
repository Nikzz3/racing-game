# Segregate the all-time leaderboard by difficulty

Adding Easy/Medium/Hard difficulties (each with different acceleration, max speed, and off-road penalty) means lap times are no longer comparable across difficulties — Easy laps are systematically slower and Hard laps systematically faster. Rather than keep one mixed board (which would let one difficulty dominate and make the ranking meaningless), we made difficulty a dimension of the persisted lap records: `best_laps` and `replays` move from a `name` primary key to a composite `(name, difficulty)` key, and "track record" is computed per difficulty.

## Considered Options

- **Mixed board (rejected):** cheapest, but knowingly corrupts the ranking — the most forgiving difficulty wins every top slot.
- **One ranked difficulty (rejected):** only Medium laps persist; minimal schema change, but Easy/Hard players get no leaderboard presence and the work invested in per-difficulty feel is invisible.
- **Segregate by difficulty (chosen):** preserves the lap-time integrity already built (track records, persisted bests, replays) by giving each difficulty its own honest board.

## Consequences

- Difficulty is authoritative on the server as a Room property (rooms are server-side), so a lap is always recorded under its room's real difficulty — no new client-trust hole beyond the pre-existing client-side physics.
- Existing `best_laps`/`replays` rows predate difficulty and are backfilled to **Medium**, which is defined to equal the pre-feature physics. This keeps existing records meaningful instead of orphaning them.
- "Track record" becomes per-difficulty: the fastest lap in each of Easy/Medium/Hard is its own record.
