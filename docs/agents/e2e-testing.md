# End-to-end testing

The Playwright suite is the outside-in bookend for feature development. Use Vitest as
the fast inner loop: driving a Plausible Lap through the browser and server takes roughly
2–5 minutes.

## Suite layout and naming

The top-level `e2e/` npm workspace owns the suite:

```text
e2e/
├── package.json
├── playwright.config.ts
├── scripts/test-e2e.ts
├── fixtures/            # Postgres, players, and window.__game helpers
├── specs/               # Playwright journeys
├── lap-inputs.json      # harness-recorded CarInput[]
└── LAP_INPUTS.md        # regeneration instructions
```

Use `.spec.ts` for Playwright e2e tests and `.test.ts` for Vitest unit tests. This is a
structural boundary, not just a naming preference. The client test command is a bare
`vitest run`, whose default include sweeps `**/*.{test,spec}.*`; putting a `.spec.ts`
inside `client/` would therefore run it as a unit test.

## Running the suite

Install Chromium once with `npx playwright install chromium`, then run:

```bash
npm run test:e2e
npm run test:e2e -- --ui
npm run test:e2e -- --headed --debug
npm run test:e2e -- specs/drive-lap.spec.ts -g "plausible"
```

The wrapper forwards everything after `--` verbatim to Playwright. It starts one
throwaway Postgres container for the invocation, then keeps that container alive for the
whole invocation or UI session. The server and client use dedicated e2e ports, and the
per-test database fixture truncates state between runs.

A Docker-compatible container socket must be available. With rootless Podman, enable its socket
(`systemctl --user enable --now podman.socket`) and the wrapper finds it at
`$XDG_RUNTIME_DIR/podman/podman.sock`, setting `DOCKER_HOST` and disabling the Ryuk
reaper — which cannot reap under rootless Podman — for you. An explicit `DOCKER_HOST`
overrides that detection. To use an existing Postgres instead, set
`E2E_DATABASE_URL`; the wrapper uses that URL verbatim and skips testcontainers. This is
also the escape hatch when no container socket is available. Because the suite truncates
`rooms`, `best_laps`, and `replays` in the target database, an external URL also
requires `E2E_DATABASE_ALLOW_TRUNCATE=1` as an explicit "this database is disposable"
opt-in; both the wrapper and the database fixture refuse to run without it.

## Outside-in TDD

1. **Red, once.** Add one e2e assertion for the feature's user-visible outcome through
   an existing surface: Room or HUD DOM, the `window.__game` seam, or a `best_laps` row.
   Run it and confirm that an assertion fails for the intended reason—not suite boot,
   fixture, or selector setup. Commit the red spec.
2. **Inner loop, many times.** Drive physics, timing, parsing, and HUD design with
   colocated Vitest `.test.ts` tests. These run in seconds and provide the design
   pressure.
3. **Green, once.** Run only the relevant journey with
   `npm run test:e2e -- specs/<one>.spec.ts`. The feature is done only when that spec
   passes.
4. **Refactor.** Keep both the focused Vitest tests and the e2e bookend green.

Mark a deliberately red Playwright test with `test.fail()`, not `test.skip()`.
`test.fail()` still runs the assertion and fails the suite if the test unexpectedly
passes, so the bookend cannot silently rot. `test.skip()` does not exercise the flow.
The extra Plausible Lap wall time on every feature-branch CI run is an accepted cost.

Every feature issue names its e2e assertion in prose. The agent's first feature commit
turns that prose into the red spec, and the last turns it green. The resulting diff is
the Sandcastle pipeline's proof that the feature is exercised.

## What belongs in e2e

E2e tests assert integration, not logic. “The lap time reached Postgres and rendered at
the correct rank” belongs here. “A lap that missed a Checkpoint is not a Plausible Lap”
belongs in Vitest, even though a browser journey could demonstrate it. If a bug is
reachable with a unit test, cover it with a unit test.

Leaderboard assertions use position and driver name. Never assert a numeric server lap
time: server lap milliseconds follow wall-clock time and are intentionally
nondeterministic.

## Growing the suite

Default to extending an existing spec. A feature should add assertions to a lap already
being driven whenever it uses the same journey. A new spec is earned only by a new flow,
such as spectating or reconnecting after a disconnect—not by another feature within an
existing Room or lap journey.

The e2e CI wall-time budget is **15 minutes**. If a change would exceed it, fold the
assertion into an existing spec or invest in per-worker database isolation and
parallelism.
