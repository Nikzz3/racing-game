# Persisted human Replays may drive as Pacers in live Rooms

ADR-0002 confined the AI **Reference Lap** to a client-only viewer, off the leaderboard and
out of live Rooms, to respect PRD #7's exclusion of in-game inference. That decision was
about the *AI benchmark* specifically. This effort (map #53, spec on #27) surfaces a
different thing in the Room: a persisted *human* **Replay**, rendered as a **Pacer** — a
translucent, non-colliding, driver-local overlay car that plays back a real human lap so a
driver can race a leaderboard time in place.

Grilling ADR-0002 while naming the concept (#58) established that the AI's baked-pose lap
*could* mechanically be a Pacer too — the playback path is pose interpolation either way.
So the line between "human Replays enter Rooms" and "the AI Reference Lap does not" is a
**scoping choice, not a physics constraint**. This ADR records that choice and where the
line sits, so a later effort has a clear thing to revisit.

## Decision

Persisted human Replays may be selected as a **Pacer** in a live Room. The AI Reference Lap
stays out — governed, unchanged, by ADR-0002.

A Pacer is a driver-local overlay: nothing is broadcast, there are no server or protocol
changes, and it is read-only playback of an existing `getReplay` payload. Selection is
lobby-only and constrained to leaderboard entries matching the Room's track **and**
difficulty; one Pacer at a time. See `CONTEXT.md` (**Pacer**) for the term and the child
tickets of #53 for the full behaviour.

## Considered Options

- **Also surface the AI Reference Lap as a Pacer (rejected):** mechanically possible, but it
  reopens exactly the boundary ADR-0002 drew for PRD #7 — the AI Record driving in a Room,
  not just being watched. Kept out as a deliberate scope line; a future "AI Pacer" effort
  would supersede *this* ADR rather than 0002.
- **Persisted human Replays as Pacers (chosen):** the Replay is an honest human record that
  already exists in the leaderboard DB; playing it back as a non-colliding overlay adds no
  new authority and no server surface.

## Consequences

- **Leaderboard integrity preserved.** A Pacer is read-only playback of an existing Replay;
  it writes nothing and ranks nothing, so ADR-0001's "honest human records" and the
  human/AI separation ADR-0002 protects both stand.
- **No server or protocol changes.** Playback is driver-local and client-only, so the
  feature ships without touching the Room broadcast path.
- **ADR-0002 stands unamended.** The two coexist: 0002 governs the AI viewer, 0004 governs
  human Pacers. This ADR does *not* supersede it.
- **The AI/human line is now explicit.** Because the exclusion of the AI lap is recorded as
  scoping rather than capability, a later effort to run an AI Pacer can reopen it cleanly by
  superseding this ADR, without relitigating physics.
