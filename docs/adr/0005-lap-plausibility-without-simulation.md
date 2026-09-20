# Gate leaderboard persistence on lap plausibility, without server simulation

The server never simulates car physics (a founding stance — physics numbers live
client-side), yet lap timing and leaderboard writes are driven entirely by
client-reported positions, so a hostile client can fabricate an arbitrarily fast
lap and overwrite Track Records (issue #38). We decided to gate **persistence
only** (`best_laps`/`replays` — everything downstream: Track Record, Replay,
Pacer) on the lap being a _Plausible Lap_, checked with physics **bounds**, not
physics **simulation**: the reported trajectory may not cover more distance in
any ~1-second window than the Room Difficulty's max speed allows (×1.1
tolerance for network burst delivery), and the lap time may not beat a floor of
0.85 × Track centerline length / max speed. Per-difficulty max speed becomes a
shared constant (single source of truth for client physics, server validation,
and the RL harness); the rest of the tuning stays client-private.

## Considered options

- **Full server-side simulation** — the only airtight fix, rejected: it reverses
  the no-simulation stance and roughly doubles the physics surface to keep in
  sync.
- **Do nothing / defer to identity (claim codes, #31)** — identity stops
  _impersonation_ but not fabricated laps under your own name.
- **Plausibility bounds (chosen)** — bounds what a cheater can gain to roughly
  10–20% over honest pace (sustained-cap driving through corners), rather than
  making cheating impossible. This residual is accepted.

## Consequences

- Rejection is **silent**: the in-Room lap (HUD, session best, broadcast) is
  unaffected; the lap simply never persists, and the server logs the rejection.
  A cheater gets no signal to probe thresholds against; a false positive costs
  an honest driver only the leaderboard write, not their session.
- Validation is **incremental** (rolling window on the player's timing state,
  reset at lap start and Respawn), deliberately independent of the replay frame
  buffer — otherwise the 5-minute replay cap could be weaponised to void the
  evidence before teleporting.
- Samples are stamped on **arrival**, so honest updates delivered in one TCP read
  sit a millisecond apart. The window's duration is floored at 250 ms when
  judging, never skipped: a sub-metre honest hop reads as a few m/s, while a
  checkpoint-sized teleport still reads in the hundreds. Skipping young windows
  would let a client idle past the lap-time floor and then burst the remaining
  checkpoints before the start-line reset discards the evidence.
- Name impersonation remains open and is owned by the claim-codes proposal
  (#31); this decision does not address who a lap belongs to, only whether it
  could have been driven.
