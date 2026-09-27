# Code computes Jev's speed check and racing line

Replaces ADR-0009's cornering guide (its invariant 4 and the consequence about re-checking
it); the rest of ADR-0009 as amended by ADR-0010 stands.

The pedal question used to hand Jev a cornering guide ("a bend turning about 40° within 40 m
can be taken at up to 190 km/h", a braking distance) and ask it to compare the guide with
`speed_kmh` and `bend_ahead`. That made Jev do arithmetic, which TypeSafe's own guidance says
it is not built for ("Jev is not a calculator": compute in code and pass a number or a named
bucket). It also only described bends starting _ahead_, never the turn the car was already
in, so Jev accelerated out of the hairpins while still turning, ran wide onto the grass
twice a lap, and flip-flopped the pedal at the guide's limit. The lap was about 36.9 s
against the AI Record's 23.8 s.

## Decision

- **Code computes a speed check.** `jevSafeSpeed` in `shared/src/jev.ts` works out the
  fastest speed from which the car can still brake for every bend of the racing line (below)
  in the next 190 m and turn onto the racing line 30 m ahead at full lock. It uses the same
  braking and steering constants `CarPhysics` integrates (`shared/src/handling.ts`), times a
  margin of 1.2 (the limits assume full lock exactly along the line, which is conservative),
  and never goes below 14 m/s, where steering grip starts to fade. The state gives Jev the verdict in words, with the
  margin in km/h: `speed_check: "too fast: … 23 km/h faster than it can go here …"` or
  `"room to spare: …"`. The pedal question asks Jev to brake or accelerate given
  `speed_check`.
- **Code computes a racing line.** `racingLine` in `shared/src/racing-line.ts` smooths the
  centre line toward the inside of each bend, never more than 3 m from the centre. The
  speed check and `road_ahead` describe it, and the steer question asks Jev to point the car
  at the racing line.
- **Steering is doubled.** `jevInput` steers by `2 · (P(left) − P(right))`, clamped: Jev's
  steering answers are soft (a few degrees off reads as a lean of about 0.5).

## Consequences

- Jev's pedal answer now mostly follows code's verdict (in the recorded lap it agreed on
  every decision); Jev's judgment is in reading that verdict and in steering. The Jev Lap
  came down to about 25 s, no frame off the tarmac.
- The speed check and the physics share one set of handling constants, and a test pins the
  full-lock radius and braking formulas against `CarPhysics`, so retuning the physics carries
  over to Jev. Re-record the Jev Lap after changing either.
- Jev still drives only Sunset Ridge at Medium: the margin, the 3 m line width and the
  steering gain were tuned there. The margin and line width trade robustness for time —
  wider lines or margins above 1.2 drove laps that left the tarmac in simulation.
- Considered and not taken: correcting the cornering guide's numbers alone (worse: faster
  corner entry without seeing the current turn), partial throttle or brake from the pedal
  probability (under 0.3 s once the pedal answer is sharp), and asking every 50 ms (0.1 s for
  twice the cost).
