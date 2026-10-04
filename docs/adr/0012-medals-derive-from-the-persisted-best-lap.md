# Medals and car unlocks derive from the persisted best lap

The all-time leaderboard was the game's only goal, and only a few drivers can chase it.
**Medals** (Bronze, Silver, Gold, Author per `(Track, Difficulty)`) give everyone reachable
targets, the **Rival** ladder offers the next lap just ahead of theirs, and Medals unlock
the Variants that are no longer free (#169, #116).

## Decision

A Medal is **not stored anywhere**. It is a pure function of two things the game already
has: the driver name's persisted best lap on the board (`best_laps`) and a static table of
target times in `shared/src/medals.ts`. Car unlocks follow from the best Medal across all
boards in the same way. The server answers one `getStandings` request with every board's
best lap and Rival in a single query, and pushes a fresh copy to a driver after each of
their Plausible Laps is persisted.

Target times come from an Author time per board, with Gold, Silver and Bronze at
Trackmania's editor defaults of 106%, 120% and 150%. Sunset Ridge at Medium uses the AI
Reference Lap, and a test pins the table to the trained policy, so a retrain that moves the
AI Record fails the build until the table is updated. Every other board has no policy, so its
Author time is hand-set just under that board's production Track Record when Medals shipped.

## Considered Options

- **Store medal state locally (rejected):** every device would start from zero, and the
  client cannot tell a Plausible Lap from an implausible one, since rejection is silent
  (ADR-0005). Medals would reward exactly the laps the leaderboard refuses.
- **A medals table on the server (rejected):** it duplicates `best_laps` and can drift from it
  when target times change. Deriving the Medal instead re-grades every driver immediately when
  the table is retuned.
- **Derive from the persisted best (chosen):** no new table or migration, and only Plausible
  Laps earn Medals, consistent with the leaderboard.

## Consequences

- **Medals follow the driver name, not a person.** Names are unauthenticated, so a driver who
  types a medalled name gets its Medals and unlocked cars. This is the leaderboard's existing
  trust model, and Variants are cosmetic.
- **Unlocks are enforced by the client.** The server accepts any Variant in `hello`, so a
  modified client can drive a locked car. That is acceptable for a cosmetic choice.
- **Retuning target times is a code change.** Changing the table re-grades every driver at the
  next release, and can take away a Medal that a driver held under the old times.
