# Research: Playwright e2e for a WebGL/Three.js multiplayer game

Wayfinder research for issue #77 (map issue #76; unblocks #78 deterministic lap-driving and
#80 multi-client Room join). The question: **how do Playwright e2e suites assert against
WebGL/Three.js game state, and how do they drive deterministic input?** This repo has no e2e
suite yet, so everything below is from external primary sources — Playwright's own docs and
real open-source game/canvas test suites — read against the live pages. Every non-doc claim
links to a file pinned at a commit SHA so citations stay stable; Playwright docs are versioned
live pages (no per-file SHA available), linked to `playwright.dev` directly.

**Primary sources, pinned:**

- three.js e2e runner — [`test/e2e/puppeteer.js` @ `da4d5e0`](https://github.com/mrdoob/three.js/blob/da4d5e022d7591152e42c1fab6af081672305e24/test/e2e/puppeteer.js)
- satelllte/playwright-canvas — [`@ 48716b6`](https://github.com/satelllte/playwright-canvas/tree/48716b626086774c743a82ac09a204ac13f79d9e) (PoC, HTML canvas)
- testdino-hq/playwright-skill — [`core/canvas-and-webgl.md @ d3be9ca`](https://github.com/testdino-hq/playwright-skill/blob/d3be9ca4d7303e2aee3eba4842963abf573117b0/core/canvas-and-webgl.md)
- createIT blog, headless WebGL launch flags — [createit.com](https://www.createit.com/blog/headless-chrome-testing-webgl-using-playwright/)

> **Headline for our decision.** A WebGL canvas is a black box to the DOM — Playwright's
> locators and DOM assertions reach the HUD/lobby React tree but see **nothing** of the car,
> checkpoints, lap timer, or Room roster living in the Three.js scene / JS game state. The
> mature answer used by real projects is a **dedicated `window` test seam**: the game attaches
> a small, stable read/write hook (e.g. `window.__game`) that `page.evaluate()` reads for
> assertions and (for input) that the game's input system reads _instead of_ real keyboard
> events. This makes state assertions and deterministic input the **same seam** and sidesteps
> both the "nothing in the DOM" problem and the `requestAnimationFrame` timing race that plagues
> real `page.keyboard` input. Recommend: **(a) expose game state via a `window` hook read through
> `page.evaluate()`, (b) drive input by writing an input-intent object through that same hook and
> stepping frames deterministically, (c) reserve `page.keyboard`/CDP for a thin "real keys are
> wired up" smoke test only.** Screenshots stay out of scope (per #76), and this recommendation
> needs no screenshots. See §5.

---

## 1. State-assertion approaches

For a WebGL canvas, "read the rendered state" splits into three families. The core constraint,
stated by the testdino Playwright skill: _"Canvas pixels are not queryable via DOM"_
([canvas-and-webgl.md @ d3be9ca](https://github.com/testdino-hq/playwright-skill/blob/d3be9ca4d7303e2aee3eba4842963abf573117b0/core/canvas-and-webgl.md)).
Everything below is a way around that.

### 1a. Window-exposed test hooks read via `page.evaluate()` — _the strongest fit here_

`page.evaluate()` runs a function **inside the page VM** and marshals a serializable result back
to the test. From the docs:

> "The `page.evaluate()` API can run a JavaScript function in the context of the web page and
> bring results back to the Playwright environment." … "Browser globals like `window` and
> `document` can be used in `evaluate`."
> — [Evaluating JavaScript, playwright.dev](https://playwright.dev/docs/evaluating)

Two hard rules from that page shape the pattern:

> "Playwright scripts and page scripts run in different virtual machines. This means you cannot
> use variables from your test in the page and vice versa. Instead, you should pass them
> explicitly as an argument." — the argument "can be a mix of Serializable values and JSHandle
> instances." ([playwright.dev/docs/evaluating](https://playwright.dev/docs/evaluating))

So the game must **publish** the state it wants asserted onto `window` (only serializable data
crosses the boundary), and the test reads it:

```ts
const lap = await page.evaluate(() => window.__game.getState().currentLap);
expect(lap.checkpointsHit).toBe(4);
expect(lap.finished).toBe(true);
```

This is the pattern the testdino skill reaches for when pixels won't do — reading "the rendering
context state" or "programmatic canvas operations" through `page.evaluate()`
([canvas-and-webgl.md @ d3be9ca](https://github.com/testdino-hq/playwright-skill/blob/d3be9ca4d7303e2aee3eba4842963abf573117b0/core/canvas-and-webgl.md)),
and it is exactly how three.js's e2e runner synchronizes on render state (§3).

- **Pros:** asserts on _actual game state_ (lap count, checkpoint index, car transform, Room
  roster), not a proxy; fast; deterministic; headless-CI safe; no GPU dependency; results are
  small serializable structures that read cleanly in assertions.
- **Cons:** requires a **test seam in production code** — the game must attach the hook. Best
  practice is a single, deliberately stable object (a public contract the tests depend on), not
  scattered globals. There's a small risk of asserting on state the renderer hasn't drawn yet;
  that's why the hook should expose _game-model_ state (authoritative), and, if visual fidelity
  ever matters, a `renderFinished` flag (three.js does this).

### 1b. HUD/DOM-only assertions

Read the parts of the app that _are_ in the DOM — the React HUD/lobby: lap timer text, position,
player-name list, "Room ABCD" label. Standard Playwright locators + web-first assertions
(`expect(locator).toHaveText(...)`), no seam required.

- **Pros:** zero production test-code; uses Playwright's auto-waiting locator assertions; tests
  what the user literally sees; ideal for the **lobby/Room-join** flow, which is DOM.
- **Cons:** only reaches state the HUD chooses to render. #76 says it plainly: _"DOM assertions
  only reach the HUD/lobby UI; game state needs another surface."_ You cannot assert "car passed
  checkpoint 3 with the correct heading" from the HUD unless the HUD happens to surface it, and
  coupling deep game assertions to HUD copy is brittle (a text tweak breaks the test).

### 1c. Screenshot / visual-regression assertions

Playwright's `expect(page).toHaveScreenshot()` captures the canvas and diffs it pixel-wise
against a committed baseline with a tolerance. The testdino skill calls this _"the primary
strategy for canvas"_ because _"screenshot is the source of truth"_ for pixels, recommending
`maxDiffPixelRatio: 0.01`–`0.02` for render variance
([canvas-and-webgl.md @ d3be9ca](https://github.com/testdino-hq/playwright-skill/blob/d3be9ca4d7303e2aee3eba4842963abf573117b0/core/canvas-and-webgl.md)).
It is the dominant pattern in the wild (three.js, satelllte, createIT — all §3).

- **Pros:** the _only_ approach that verifies the WebGL actually **renders correctly** (shaders,
  camera, materials); no per-state seam.
- **Cons:** **explicitly out of scope for our suite per #76.** Also: notoriously flaky across
  GPUs/drivers/OSes — satelllte warns _"the example tests from this repo will fail for other
  operating systems due to some low-level rendering differences"_ and recommends pinning to a
  Docker image
  ([satelllte/playwright-canvas @ 48716b6](https://github.com/satelllte/playwright-canvas/tree/48716b626086774c743a82ac09a204ac13f79d9e)).
  Needs software-GL determinism flags (§3). Answers "did it draw?" not "is the lap valid?" — the
  wrong question for flows #78/#80. Surveyed for completeness; **not recommended.**

A hybrid worth naming: read canvas **pixels** via `page.evaluate()` + `getImageData()` (the
testdino example returns a single pixel's `{r,g,b,a}`). That's assertion-in-code without a
baseline image, but for WebGL it needs `preserveDrawingBuffer` and only proves color at a point —
far weaker than reading game state. Mention, don't adopt.

## 2. Deterministic-input approaches

The game loop is `requestAnimationFrame`-driven, so "press right for 500 ms" is inherently racy:
input arrives on the event loop, physics advances on rAF ticks, and the two are not synchronized.
Three approaches, increasing in determinism.

### 2a. `page.keyboard` / `locator.press` — real DOM key events

Playwright dispatches genuine `keydown`/`keypress`/`keyup` events. `keyboard.press()` is
_"a shortcut for `keyboard.down()` and `keyboard.up()`"_; holding a key means calling
`keyboard.down('ArrowRight')` then later `keyboard.up('ArrowRight')`; `press()` takes a `delay`
= _"Time to wait between `keydown` and `keyup`"_
([Keyboard, playwright.dev](https://playwright.dev/docs/api/class-keyboard)).

- **Pros:** highest fidelity — exercises the game's _real_ keydown/keyup listeners; proves the
  actual input wiring works end-to-end.
- **Cons/caveats:** **timing is wall-clock, not frame-locked.** A held key spans an
  indeterminate number of rAF ticks depending on machine speed / CI load, so the car travels a
  non-reproducible distance — the exact enemy of a "drive a deterministic lap" test (#78).
  Mitigations (Playwright's Clock API to freeze/advance time, or `page.evaluate` to hand-step
  rAF) exist but fight the fact that input still flows through async event dispatch. Good for a
  smoke test, poor for a precise lap.

### 2b. CDP input injection — `Input.dispatchKeyEvent`

Open a raw Chrome DevTools Protocol session and send `Input.*` commands. From the docs, CDP is
for _"controlling features not exposed through Playwright's high level API"_; you obtain a
session with `const client = await page.context().newCDPSession(page)` and call
`client.send('Domain.method', params)`
([CDPSession, playwright.dev](https://playwright.dev/docs/api/class-cdpsession)) — e.g.
`client.send('Input.dispatchKeyEvent', { type: 'keyDown', ... })`.

- **Pros:** lower-level than `page.keyboard`; can inject raw events / synthetic timestamps;
  useful if `page.keyboard` can't express a needed event shape.
- **Cons:** **Chromium-only** (fine for CI-headless-Chrome, but no cross-browser). It still
  injects into the same async input pipeline — it does **not** by itself make input frame-deterministic
  relative to rAF. More ceremony than `page.keyboard` for little determinism gain. Reach for it
  only if the high-level keyboard API genuinely can't do the job; otherwise it's complexity
  without payoff here.

### 2c. Dedicated input test-seam — _the deterministic option_

Have the game's input system read from an **injectable intent object** (e.g. the input layer
checks `window.__game?.input` or a set of virtual axes) _instead of_, or layered over, real DOM
key handlers. Tests then bypass event dispatch entirely:

```ts
// set intent, then advance exactly N frames deterministically
await page.evaluate(() => {
  window.__game.input.throttle = 1;
  window.__game.input.steer = 0.3;
});
await page.evaluate((n) => window.__game.step(n), 30); // step 30 fixed-dt ticks
```

Combined with a **fixed-timestep** stepping hook (`window.__game.step(frames)` that runs the sim
a deterministic number of ticks with fixed `dt`), a lap becomes byte-for-byte reproducible in CI.
`page.exposeFunction`/`exposeBinding` can register the reverse direction — a `window` function
that _"executes callback"_ in Node — but for input the simpler direction is the game reading a
plain `window` object the test writes via `evaluate`
([exposeFunction, playwright.dev](https://playwright.dev/docs/api/class-page#page-expose-function)).

- **Pros:** fully deterministic and rAF-independent; the _same_ `window.__game` seam serves both
  input (write) and assertions (read); no flake from wall-clock timing; trivially fast in
  headless CI. This is what makes #78 (deterministic lap) tractable.
- **Cons:** requires a production seam and, for perfect determinism, a fixed-timestep loop +
  a frame-stepping entry point. It does **not** exercise the real DOM keyboard path — so keep a
  single 2a/2b smoke test proving "arrow keys move the car" so the seam can't mask broken real
  input.

## 3. Prior art (real repos — what they actually do)

Honest finding: **detailed, public Playwright test code for a _3D WebGL game specifically_ is
scarce.** What exists is overwhelmingly **screenshot-based**, and the most rigorous example
(three.js itself) is **Puppeteer**, not Playwright — but its _technique_ transfers directly and
is the best public evidence for the `window`-seam pattern.

- **three.js official e2e** (Puppeteer; adjacent prior art) —
  [`test/e2e/puppeteer.js` @ `da4d5e0`](https://github.com/mrdoob/three.js/blob/da4d5e022d7591152e42c1fab6af081672305e24/test/e2e/puppeteer.js).
  Renders each example headless and does **screenshot pixel-diff** (`pixelThreshold = 0.1`,
  `maxDifferentPixels = 0.1`, i.e. ≤0.1% pixels may differ). Crucially, it uses a **`window`
  seam to synchronize on render completion** rather than sleeping: it sets `window._renderStarted
= true` and then polls until the example signals `window._renderFinished` (lines ~470–485).
  That "attach a boolean/flag on `window`, have the test poll it via evaluate" move is exactly
  the seam we'd generalize to _game state_. It runs software-GPU headless via flags
  `--enable-unsafe-webgpu --enable-features=Vulkan --disable-vulkan-surface --ignore-gpu-blocklist
--disable-gpu-driver-bug-workarounds --disable-gpu-watchdog --no-sandbox` (lines ~204–212).

- **satelllte/playwright-canvas** (Playwright; HTML canvas PoC) —
  [`@ 48716b6`](https://github.com/satelllte/playwright-canvas/tree/48716b626086774c743a82ac09a204ac13f79d9e).
  Explicitly demonstrates _"testing HTML Canvas scenarios"_ including _"gameplay loops, 3D
  scenes, fragment shaders outputs"_ by pairing Playwright's **Clock API**
  ([playwright.dev/docs/clock](https://playwright.dev/docs/clock)) with **visual comparisons**
  ([toHaveScreenshot](https://playwright.dev/docs/test-snapshots)). The Clock API is the notable
  transferable idea: **freeze/advance time** so an animation/gameplay loop is deterministic
  before you assert. Caveat baked into its own README: cross-OS pixel diffs fail; run in Docker.

- **testdino-hq/playwright-skill** — [`core/canvas-and-webgl.md @ d3be9ca`](https://github.com/testdino-hq/playwright-skill/blob/d3be9ca4d7303e2aee3eba4842963abf573117b0/core/canvas-and-webgl.md).
  A distilled how-to: screenshot as "source of truth" for pixels, `page.evaluate()` +
  `getImageData()` for reading pixel/context state in code, `canvas.click({ position: { x, y } })`
  and `mouse.down/move/up` for coordinate input, `maxDiffPixelRatio: 0.01–0.02` for variance.

- **createIT — headless WebGL with Playwright** — [createit.com](https://www.createit.com/blog/headless-chrome-testing-webgl-using-playwright/).
  Practical launch-flag finding: hardware-accelerated headless WebGL needed `--use-angle=gl`
  (not `--use-angle=angle`), plus `--no-sandbox`; verified by screenshots. Confirms the theme:
  public WebGL Playwright examples lean on screenshots + GL launch flags, not state seams.

**Net:** no public repo demonstrates the _"expose game state on `window` and assert lap logic in
code with Playwright"_ pattern end-to-end for a 3D game — but three.js proves the `window`-seam
synchronization mechanism in production, and the Playwright docs bless `page.evaluate` reading
`window`. Our suite would be combining well-supported primitives, not inventing one.

## 4. Playwright facilities for a multiplayer racing e2e suite

### 4a. Multiple browser contexts — two players in one test (#80)

A `BrowserContext` is an isolated session (own cookies/storage). Create several from one browser
to simulate distinct users concurrently
([Browser contexts, playwright.dev](https://playwright.dev/docs/browser-contexts)):

```ts
const browser = await chromium.launch();
const p1 = await (await browser.newContext()).newPage();
const p2 = await (await browser.newContext()).newPage();
// p1 creates a Room; p2 joins by code; assert both rosters show 2 players
```

This is the backbone of #80: two contexts join the same WebSocket Room; assert each sees the
other (roster/HUD via DOM per §1b, or authoritative Room state via the `window` seam per §1a).
The docs frame multi-context precisely for _"multi-user scenarios"_ / collaborative apps.

### 4b. `webServer` — orchestrate client + WebSocket server startup

`playwright.config.ts`'s `webServer` launches (and health-checks) servers before tests
([Test webServer, playwright.dev](https://playwright.dev/docs/test-webserver)):

```ts
webServer: {
  command: 'npm run start',
  url: 'http://localhost:3000',
  reuseExistingServer: !process.env.CI, // reuse local dev, always fresh in CI
  stdout: 'ignore', stderr: 'pipe',
}
```

`url` is polled until it returns 2xx/3xx/4xx; `timeout` defaults to 60 s. **It accepts an array**
of server configs — so we can boot the **Node WebSocket server** _and_ the **client dev server**
(and point at a test Postgres) as separate entries, each with its own `command`/`url`/`name`.
This is how the leaderboard-persistence flow (#76) gets a real Postgres behind a real server.

### 4c. Fixtures (`test.extend`) — reusable per-test setup (seeded Room / connected lap)

Custom fixtures encapsulate setup+teardown and hand a ready object to the test via `use()`
([Test fixtures, playwright.dev](https://playwright.dev/docs/test-fixtures)):

```ts
const test = base.extend<{ room: RoomHandle }>({
  room: async ({ browser }, use) => {
    const host = await (await browser.newContext()).newPage();
    const code = await createRoom(host); // setup
    await use({ host, code }); // test runs here
    await host.context().close(); // teardown
  },
});
```

_"Code before `await use()` runs during setup; code after runs during cleanup."_ Scopes matter:
**worker-scoped** fixtures (`[fixture, { scope: 'worker' }]`) run once per worker — ideal for
_"expensive operations like server startup"_ or a shared seeded DB; **test-scoped** (default) for
per-test isolation like a fresh Room or a seeded lap. Fixtures compose (one can depend on
another), so a `seededLap` fixture can build on a `room` fixture.

## 5. Recommendation (opinionated)

Given the constraints — WebGL canvas (nothing in DOM), multiplayer over WebSocket, need for
two-context tests, **screenshots out of scope (#76)**, and eventual **headless CI**:

**(a) Expose game state through a single `window` test seam, asserted via `page.evaluate()`
(§1a).** Attach one stable, documented object — e.g. `window.__game` — that returns serializable
snapshots of authoritative game-model state: current lap, checkpoints hit + order, lap validity,
car transform, Room id, and the roster of connected players. Treat this hook as a **public test
contract** (versioned, deliberately minimal), gated behind a test/dev build flag if you don't want
it in production bundles. This is the only approach that lets #78 assert "a _valid_ lap completed"
and #80 assert "both players see each other" without screenshots or brittle HUD-text coupling.
Keep **HUD/DOM assertions (§1b)** as the natural surface for the lobby/Room-join UI, which really
is DOM. **Do not** adopt screenshot/visual-regression (§1c) — out of scope, GPU-flaky, and it
answers the wrong question.

**(b) Drive deterministic input through the same seam, with fixed-timestep frame stepping (§2c).**
Have the input layer read an injectable intent (throttle/steer/brake) that tests set via
`page.evaluate`, and expose a `window.__game.step(frames)` that advances the sim a fixed number of
ticks at fixed `dt`. That makes the #78 lap reproducible byte-for-byte in CI, immune to the
`requestAnimationFrame`/wall-clock race that `page.keyboard` suffers. **Retain exactly one thin
smoke test** using real `page.keyboard` (§2a) — "arrow keys actually move the car" — so the seam
can never hide broken real-input wiring. Skip CDP `Input.dispatchKeyEvent` (§2b) unless a specific
event shape proves impossible via `page.keyboard`; it adds Chromium-lock and ceremony without
buying determinism. If a fixed-timestep refactor is too big initially, Playwright's **Clock API**
(as in satelllte, §3) is a fallback for making time-based motion repeatable — but the input seam
is the better target.

**(c) Wiring.** Boot the WebSocket server + client (+ test Postgres) via an **array `webServer`**
config (§4b); model two players with **two browser contexts** (§4a); factor Room/lap setup into
**fixtures** (§4c) — worker-scoped for server/DB, test-scoped for a fresh Room or seeded lap. All
of this runs headless in CI; if a GPU context is ever needed, the software-GL launch flags from
three.js/createIT (§3) apply, but the recommended state+input seams need **no** GPU determinism at
all — they read the game model, not pixels.

The one real cost is the production `window` seam. That cost is unavoidable for a WebGL game — the
DOM simply doesn't expose the scene — and three.js's `_renderStarted`/`_renderFinished` seam is
prior-art proof that a small, stable `window` hook is the accepted way to make a canvas app
testable. Follow-on tickets #78 and #80 should each build directly on `window.__game`.
