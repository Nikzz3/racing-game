# Each client resolves collisions for its own car

Players' cars in a Room used to drive through each other. They now collide, and the
collision is resolved **client-side, per car**: each client tests its own car against the
other players' cars _where it draws them_ (interpolated, ~150 ms behind when their own
clients sampled them), pushes its own car out of any overlap, and applies an equal-mass
impulse along the contact normal to its own car only. No client ever moves a car it does not
own. Pacers stay non-colliding: they never enter the set of cars a client collides with.

## Considered options

- **Server-authoritative collision** — the only way both drivers see one agreed outcome,
  rejected: the server never simulates physics (ADR-0005) and would have to start, adding a
  round trip of latency to the driver's own car.
- **Relay a "bump" to the car that was hit** — would let a rammed car be shoved forward, but
  adds a protocol message the server must validate so it cannot be used to push strangers
  around. Left for later if pushing rivals turns out to matter.
- **Collide against the latest received pose, or an extrapolated one** — closer to where the
  other car really is, but the driver would bounce off empty space next to the car they can
  see. Colliding with the drawn car matches what the driver sees.
- **Client-resolved, against the drawn car (chosen)** — no protocol or server change.

## Consequences

- Each driver's car cannot pass through the other cars as that driver sees them. Head-on
  hits bounce both cars back, each on its own client. A rammer loses its closing speed
  against the car in front, but the car in front is not pushed: the rammer's own client has
  already stopped it by the time the other client draws the contact. A third client can see
  fast hits overlap briefly, since each car is stopped against a delayed copy of the other.
- Other clients' poses are relayed unchecked, so they are not trusted to move the local car
  arbitrarily. A remote car is solid only while its drawn motion is one a car could make in
  the Room: at most 2.5 × top speed between two of its states, allowing for two states
  landing in one tick. The time between them is the shorter of what its own client claims
  and what the server saw elapse between the snapshots first carrying them, so a client
  cannot stretch its timestamps to pass a teleport off as motion, and never more than two
  ticks, so going quiet and then reappearing far away is not motion either. A teleport, a
  respawn, or a player just joining from the origin passes through instead of shoving
  anyone. Its reported speed is capped at the Room's top speed before it enters the impulse. What a hostile client can still do is ram, like any player.
- A shove never lifts the local car above the Difficulty's top speed or below its reverse
  limit, so being rammed cannot make an honest lap implausible (ADR-0005). Cars pushed into
  the barrier are held by it as usual.
- The car model has no sideways velocity, so a side-on hit moves the car only through the
  positional push.
- Cars that land exactly on top of each other (both spawned on the same grid slot) separate
  toward opposite sides, chosen by comparing player ids; without that tie-break both
  clients push the same way and the cars leapfrog.
- A long frame stall moves a remote car a whole stall's distance in one frame, and two fast
  cars can pass through each other then, as they did before collisions existed.
- The e2e seam replays inputs through `CarPhysics.update` and so drives without
  collisions; the two-player journey asserts the separation through ordinary frames.
