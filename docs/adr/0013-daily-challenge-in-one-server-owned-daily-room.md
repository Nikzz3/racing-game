# The Daily Challenge is raced in one server-owned Daily Room per UTC day

The Daily Challenge (#170) gives drivers one shared challenge a day with its own Daily
Board. A day's Track, Difficulty, Variant and Scene Preset come from the date alone, through
a function in `shared/` that the client and server both import.

## Decision

- **UTC rollover.** UTC gives everyone the same day without any DST edge cases. For drivers
  in Switzerland the day turns over at 01:00 or 02:00 local time.
- **One shared Daily Room per day, owned by the server.** A `joinDaily` lands every driver
  in the same Room. The server picks its Track, Difficulty and Variant from the challenge
  and closes the Room at UTC midnight instead of after the usual hour.
  - Only laps driven in that Room count toward the Daily Board, so the forced Variant can
    be enforced.
  - Daily Rooms are not persisted. They are recreated on demand.
  - Only `joinDaily` enters a Daily Room. It is left out of the room list and refused to
    `joinRoom`, so a client predating it cannot race the Daily in its own car and scene,
    which on a foggy day would mean seeing further.
  - We rejected two alternatives. Counting any lap on today's Track and Difficulty could
    not enforce the Variant. A private Daily Room per driver would have given up racing
    each other.
- **Daily laps also count toward the all-time board.** A Plausible Lap is the same physics
  whatever Variant the driver has, so the Daily Room uses the unchanged all-time path plus
  one extra Daily Board write.
- **No "Top Secret" hiding.** Trackmania hides others' Replays until the day closes. Here a
  daily lap's Replay also lands on the all-time board for the same Track and Difficulty, so
  hiding it would achieve little.

## Consequences

- A lap counts for its Daily Room's day, not for the day on the server clock when it
  finished.
- Changing the derivation, or adding a Track, reshuffles the challenges of today and every
  later day. Past Daily Boards are never shown, so drivers only notice when it is deployed
  mid-day: today's board then mixes laps from the old and the new challenge.
