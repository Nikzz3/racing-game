# Sector splits: storage on `best_laps` with best-effort backfill

Live sector deltas (vs PB and TR) need the reference lap's sector splits available at every sector-boundary crossing. We chose to persist the three splits as `s1_ms, s2_ms, s3_ms` columns on `best_laps` (computed transactionally when a new PB is set, alongside the existing `submitLap` upsert) and to run a one-shot, idempotent backfill on server boot that derives splits from each row's stored replay. Old `best_laps` rows that predate the replay feature (commit `fc3e397`) have no frames to derive from and keep NULL splits indefinitely.

## Considered Options

- **Derive on demand from the replay JSONB (rejected):** No schema change, but every lap completion parses two replay documents (the driver's PB and the TR holder's) to find the frames nearest CP4 and CP8. Adds JSONB parsing to a hot path, and offers no story at all for records that have no replay — they'd never produce a delta.
- **Drop pre-replay records to make backfill uniform (rejected):** Destroys legitimate lap records held by real players for no functional benefit. The leaderboard would shrink visibly with no explanation.
- **Persist on `best_laps` with best-effort backfill (chosen):** Three nullable INT columns added to a table we already migrate on boot. Reference lookup at sector crossing is one row read with no JSONB work. Backfill is honest — rows that *can* be reconstructed are; rows that can't keep NULL and the UI shows "—" until that driver sets a fresh PB.

## Consequences

- The reference is computed exactly once per PB (inside the existing `submitLap` transaction), then read cheaply forever after. New PBs overwrite the splits atomically with the lap time itself, so the splits row can never disagree with the lap time it describes.
- Backfill accuracy is bounded by the replay sample rate (~20 Hz / 50 ms). We find the frame whose position is nearest the boundary checkpoint and read its `t`. That's accurate enough for split deltas shown to 0.1 s; we don't interpolate.
- Pre-replay rows are a permanent two-tier leaderboard: rows with splits and rows without. The driver who set such a row sees "PB delta: —" on subsequent laps until they beat their old PB, at which point the new row carries splits and the gap closes for them. The UI must render NULL splits as "—" rather than "0.000".
- The reference is snapshotted into in-memory per-player state at lap start (CP0 crossing with `lapStartT` transitioning to a value), not re-read at each sector. This locks the lap's deltas against the references in effect when the driver began the lap, so a TR set by another player mid-lap doesn't shift the deltas underneath the driver.
