# Each client resolves collisions for its own car

Players' cars in a Room used to drive through each other. They now collide, and the
collision is resolved **client-side, per car**: each client tests its own car against the
other players' cars _where it draws them_ (interpolated, ~130 ms behind the network), pushes
its own car out of any overlap, and applies its own half of an equal-mass impulse along the
contact normal. The other client does the same for its car, so a hit is resolved from both
ends without either client moving a car it does not own. Pacers stay non-colliding: they
never enter the set of cars a client collides with.

## Considered options

- **Server-authoritative collision** — the only way both drivers see one agreed outcome,
  rejected: the server never simulates physics (ADR-0005) and would have to start, adding a
  round trip of latency to the driver's own car.
- **Collide against the latest received pose, or an extrapolated one** — closer to where the
  other car really is, but the driver would bounce off empty space next to the car they can
  see. Colliding with the drawn car matches what the driver sees.
- **Client-resolved, against the drawn car (chosen)** — no protocol or server change; the
  two views of a hit can disagree by up to the render delay, which reads as a softer or
  slightly early bump rather than an error.

## Consequences

- The response is kept inside the Room's physical limits: a shove never lifts speed above
  the Difficulty's top speed, so being rammed cannot make an honest lap implausible
  (ADR-0005), and cars pushed into the barrier are held by it as usual.
- The car model has no sideways velocity, so a side-on hit moves the car only through the
  positional push; head-on and rear-end hits exchange speed.
- Cars that land exactly on top of each other (both spawned on the same grid slot) separate
  toward opposite sides, chosen by comparing player ids; without that tie-break both
  clients push the same way and the cars leapfrog.
- The e2e seam replays inputs through `CarPhysics.update` and so drives without
  collisions; the two-player journey asserts the separation through ordinary frames.
