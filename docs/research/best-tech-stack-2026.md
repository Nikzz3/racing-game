# Research: the best technology stack for Sunset Ridge Racing, on merit alone (2026-09)

Greenfield evaluation, deliberately **not anchored on the current stack**: if we were starting
Sunset Ridge Racing today, what would we build it with, and what would we test it with? The
question came with an explicit instruction — _"I don't care that our current setup is X. Just
find the best technology and give me a list of the benefits, pros, and cons of each. Consider
both the web and test versions."_ — so every dimension below names a winner and a runner-up
on merit, and then says plainly whether the current choice happens to be that winner. This is
a recommendation, not a migration plan.

Requirements come from `CONTEXT.md`, the ADRs and `docs/agents/e2e-testing.md` (§2). Every
external claim is checked against the source that owns it (official docs, release pages,
npm/PyPI/GitHub release APIs, caniuse/MDN, IETF, first-party pricing). Versions and dates are
as of **2026-09-19**. Where a claim could not be verified against a primary source it is
marked **unverified**; the handful of secondary sources used are marked as such. Docs pages are
live (no SHA); GitHub links are pinned to a tag or release where one exists.

**Primary sources, pinned:**

- three.js r186 — [releases/tag/r186](https://github.com/mrdoob/three.js/releases/tag/r186); `WebGPURenderer` docs — [threejs.org/docs/pages/WebGPURenderer.html](https://threejs.org/docs/pages/WebGPURenderer.html)
- WebGPU implementation status — [gpuweb wiki, Implementation-Status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status); [caniuse.com/webgpu](https://caniuse.com/webgpu)
- Rapier determinism — [rapier.rs/docs/user_guides/javascript/determinism](https://rapier.rs/docs/user_guides/javascript/determinism); `rapier.js` archived — [github.com/dimforge/rapier.js](https://github.com/dimforge/rapier.js)
- WebTransport — [caniuse.com/webtransport](https://caniuse.com/webtransport); [draft-ietf-webtrans-http3-16](https://datatracker.ietf.org/doc/draft-ietf-webtrans-http3/); Safari 26.4 — [webkit.org/blog/17862](https://webkit.org/blog/17862/webkit-features-for-safari-26-4/)
- Node type stripping — [nodejs.org/api/typescript.html](https://nodejs.org/api/typescript.html); release schedule — [github.com/nodejs/Release](https://github.com/nodejs/Release)
- Bun 1.4 — [bun.com/blog/bun-v1.4](https://bun.com/blog/bun-v1.4); WebSockets — [bun.com/docs/api/websockets](https://bun.com/docs/api/websockets)
- Zod 4 — [zod.dev/v4](https://zod.dev/v4); Standard Schema — [standardschema.dev](https://standardschema.dev/)
- PostgreSQL 18 — [postgresql.org/about/news/postgresql-18-released-3142](https://www.postgresql.org/about/news/postgresql-18-released-3142/); TOAST — [docs/current/storage-toast.html](https://www.postgresql.org/docs/current/storage-toast.html)
- TypeScript 7.0 — [devblogs.microsoft.com/typescript/announcing-typescript-7-0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/); Vite 8 — [vite.dev/blog/announcing-vite8](https://vite.dev/blog/announcing-vite8); oxlint type-aware stable — [oxc.rs/blog/2026-07-22-type-aware-linting-stable](https://oxc.rs/blog/2026-07-22-type-aware-linting-stable)
- Electron stable — [releases.electronjs.org/stable](https://releases.electronjs.org/stable); Tauri webviews — [v2.tauri.app/reference/webview-versions](https://v2.tauri.app/reference/webview-versions/); Tauri WebDriver — [v2.tauri.app/develop/tests/webdriver](https://v2.tauri.app/develop/tests/webdriver/); WebKitGTK 2.54 — [webkitgtk.org/2026/09/16](https://webkitgtk.org/2026/09/16/webkitgtk-2.54-highlights.html)
- Playwright release notes — [playwright.dev/docs/release-notes](https://playwright.dev/docs/release-notes); Electron API — [class-electron](https://playwright.dev/docs/api/class-electron); clock — [docs/clock](https://playwright.dev/docs/clock); sharding — [docs/test-sharding](https://playwright.dev/docs/test-sharding)
- Chromium SwiftShader deprecation — [chromium/src docs/gpu/swiftshader.md](https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md); headless WebGPU flags — [developer.chrome.com/blog/supercharge-web-ai-testing](https://developer.chrome.com/blog/supercharge-web-ai-testing)
- Vitest 5 — [vitest.dev/blog/vitest-5](https://vitest.dev/blog/vitest-5); Browser Mode — [vitest.dev/guide/browser](https://vitest.dev/guide/browser/)
- GitHub Actions pricing — [docs.github.com/…/actions-runner-pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing); larger/GPU runners — [docs.github.com/…/larger-runners](https://docs.github.com/en/actions/reference/runners/larger-runners)
- Stable-Baselines3 releases — [github.com/DLR-RM/stable-baselines3/releases](https://github.com/DLR-RM/stable-baselines3/releases); ONNX Runtime Web — [onnxruntime.ai/docs/get-started/with-javascript/web.html](https://onnxruntime.ai/docs/get-started/with-javascript/web.html)
- Hosting: [docs.railway.com/pricing/plans](https://docs.railway.com/pricing/plans), [docs.railway.com/networking/tcp-proxy](https://docs.railway.com/networking/tcp-proxy), [fly.io/docs/about/pricing](https://fly.io/docs/about/pricing/), [fly.io/docs/networking/udp-and-tcp](https://fly.io/docs/networking/udp-and-tcp/), [developers.cloudflare.com/durable-objects/platform/pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)

> **Headline for our decision.** Evaluated from scratch, the _shape_ of the current stack is
> the right one, and most individual choices are the outright winners: **Three.js**, a
> **hand-rolled deterministic kinematic car model** (a rigid-body engine would be pure cost
> for this game), **WebSocket** with client-authoritative poses plus server plausibility,
> **Node LTS** running shared TypeScript, **Postgres**, **Electron**, **Python/SB3** for
> training with a hand-written MLP forward pass in the browser, **Vitest + Playwright +
> Testcontainers**, and **GitHub Actions**. Where the current stack is _not_ the best, it is
> in the connective tissue rather than the pillars: (1) **TypeScript 7.0** (native Go
> compiler, stable since 2026-07-08) with **oxlint + tsgolint / oxfmt** — the only type-aware
> lint that runs on the TS 7 compiler today; (2) **Zod 4 schemas as the single wire contract**
> instead of hand-written parsers, with the 20–60 Hz `state` message **packed as binary**
> (24–28 bytes vs 73–92 bytes of JSON); (3) **fast-check / Hypothesis property tests** on the
> physics and plausibility rules, and a **cross-language golden fixture** consumed by both
> Vitest and pytest; (4) **Vite 8 on Rolldown**; (5) an immediate e2e hardening —
> Chromium is removing the silent SwiftShader WebGL fallback, so headless WebGL runs must pass
> `--enable-unsafe-swiftshader` or they will stop creating contexts on a future Chromium roll.
> The frontier stack (WebGPU renderer, WebTransport datagrams, one Rust physics crate for
> browser _and_ trainer) is real but not yet production-safe for **this** game's constraints:
> Linux WebGPU is hardware-gated in Chrome and flag-only in Firefox and WebKitGTK; WebTransport
> over HTTP/3 is still an Internet-Draft and needs UDP ingress that Railway, Render and
> Cloudflare cannot provide. Adopt it as an opt-in path, not the default.

---

## 1. Headline recommendation

### 1a. Recommended stack (production-safe today)

| Layer                    | Choice                                                                                                                                                                                                              | Runner-up                                                                                 | Current stack is the winner?                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 3D engine                | **Three.js r186**, `WebGLRenderer` (WebGPU via `three/webgpu` as an opt-in flag)                                                                                                                                    | Babylon.js 9                                                                              | Yes                                                    |
| Client physics           | **Hand-rolled deterministic kinematic model**, fixed step, shared constants                                                                                                                                         | Rapier `@dimforge/rapier3d-deterministic` (only if rigid-body collisions are ever wanted) | Yes                                                    |
| Netcode + transport      | **Client-authoritative poses + server plausibility over WebSocket** (`ws`), binary pose frames                                                                                                                      | Colyseus 0.18 (if ever moving to server-authoritative)                                    | Yes (transport); No (wire format, see §7)              |
| Server runtime           | **Node 26 LTS** (from 2026-10-28; Node 24 LTS until then), `.ts` run with built-in type stripping                                                                                                                   | Bun 1.4                                                                                   | Yes                                                    |
| Schema / serialization   | **Zod 4** (Standard Schema) for control messages; **hand-packed `Float32` frame** for `state`                                                                                                                       | Valibot 1.5 / msgpackr                                                                    | Partly (Zod present, parsers hand-written, poses JSON) |
| Persistence              | **Postgres 18**, `pg` driver, raw SQL; trajectories as packed `bytea` with `lz4` TOAST                                                                                                                              | Kysely 0.29 (typed query builder); Drizzle when 1.0 is stable                             | Yes                                                    |
| Language / build         | **TypeScript 7.0**, **Vite 8 (Rolldown)**, **pnpm** workspaces (or npm), **oxlint + tsgolint, oxfmt**                                                                                                               | Biome 2.5                                                                                 | Partly (Vite yes; TS 6, npm, no linter today)          |
| Desktop                  | **Electron 44 + electron-builder + electron-updater**                                                                                                                                                               | Tauri v2 (blocked by Linux WebKitGTK having WebGPU compiled out)                          | Yes                                                    |
| RL pipeline              | **Python: Gymnasium 1.3 + SB3 2.9**, numpy physics port, **hand-written TS MLP forward pass** (~21 KB weights)                                                                                                      | `sbx` (SB3 in JAX) for wall-clock speed                                                   | Yes                                                    |
| Hosting                  | **Railway** (Node service + Postgres, 4 regions, WS-only is fine)                                                                                                                                                   | Fly.io (18 regions, UDP; Managed Postgres from $38/mo)                                    | Yes                                                    |
| Unit / integration tests | **Vitest 5** + **fast-check 4**; **pytest + Hypothesis**; shared golden JSON via `toMatchFileSnapshot` / `pytest.approx`                                                                                            | Bun test                                                                                  | Partly (Vitest/pytest yes; no property tests)          |
| E2E                      | **Playwright 1.63**, `window.__game` seam, multi-context multi-client, `page.clock`; **Testcontainers 12** (`@testcontainers/postgresql`) locally, preinstalled Postgres in CI; **k6 2.x `k6/websockets`** for load | PGlite 0.5 as the _Vitest_ DB double                                                      | Yes (add `--enable-unsafe-swiftshader`)                |
| Visual regression        | **None by default**; if needed, Playwright `toHaveScreenshot` in a pinned Docker image, uploaded to **Argos** (free 5k/mo)                                                                                          | Percy                                                                                     | Yes (none)                                             |
| Desktop tests            | **Playwright `_electron`** (experimental label, works)                                                                                                                                                              | `wdio-electron-service`                                                                   | Yes                                                    |
| CI                       | **GitHub Actions** (free on public repos), Playwright `--shard` + blob `merge-reports`, SwiftShader — no GPU runners                                                                                                | Blacksmith ($0.004/min flat, 3,000 free min)                                              | Yes                                                    |

### 1b. Frontier / maximalist stack (where it differs, and why it is not yet safe)

| Layer     | Frontier choice                                                                              | Blocker as of 2026-09                                                                                                                    |
| --------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Renderer  | Three.js `WebGPURenderer` + TSL (auto-falls back to WebGL2)                                  | 87.35% caniuse; Chrome Linux hardware-gated (Intel Gen12+ / NVIDIA-Wayland only); Firefox Linux flag-only; bundle 821 KB vs 393 KB min   |
| Physics   | One **Rust crate** compiled to wasm (browser) and PyO3 (trainer) — one source, bit-identical | Adds a Rust toolchain; the kinematic model is ~200 lines, so the port it replaces is cheap                                               |
| Transport | **WebTransport** datagrams for `state`, WS for control                                       | HTTP/3 binding is still draft-16 (WG Last Call); needs UDP ingress → **Fly.io or Hetzner**, not Railway/Render/Cloudflare; no k6 support |
| Server    | **Bun 1.4** native WS + pub/sub (~7× `ws` throughput per Bun's own numbers)                  | 1.4.0 (2026-08-20) is the _first_ release of the Rust rewrite, two patch releases in two days                                            |
| Hosting   | **Fly.io** multi-region Machines + Managed Postgres                                          | Postgres floor $38/mo vs Railway template on a volume                                                                                    |
| Training  | **JAX/`sbx` with a vectorised JAX physics** (thousands of envs)                              | Only pays off if PPO wall-clock becomes the bottleneck; rewrites the physics a third time                                                |
| Desktop   | **Tauri v3** with the CEF runtime                                                            | `3.0.0-alpha.1` shipped 2026-09-15; far too early                                                                                        |

---

## 2. Requirements the stack must satisfy

Derived from `CONTEXT.md`, ADR-0001…0007 and `docs/agents/e2e-testing.md`:

1. **Browser-first 3D**, desktop and mobile Safari included, with an installable desktop
   shell for macOS / Windows / Linux (ADR-0007 names Bazzite / SteamOS-style players as
   the Linux target — Linux is not a second-class platform here).
2. **Real-time multiplayer over a persistent connection**; small Rooms; poses at
   20–60 Hz; Rooms survive a server restart (persisted), closed after one hour.
3. **Client-side physics, server plausibility** (ADR-0005): the server _never_ simulates.
   It needs the per-Difficulty max speed as a shared constant and checks bounded speed / no
   teleports on a rolling window. This is a founding stance, and it removes the need for
   server-authoritative rollback netcode.
4. **Physics parity across three hosts**: the TS client (fixed 1/120 s step,
   `client/src/game/physics.ts`), the Python trainer (`rl/physics.py`, golden-tested from
   `rl/gen_golden.ts`) and the Node record-validation path. The policy is baked at
   fixed 1/60 s (ADR-0002/0006); playback is pose interpolation, never re-simulation.
5. **Shared code** between client and server: message schemas, track geometry,
   difficulty constants.
6. **Persisted leaderboard keyed by (Track, Difficulty)** with 20 Hz × ≤5 min lap
   trajectories for Replays and Pacers; SQL rule "a slower lap never overwrites a PB".
7. **In-browser policy inference** of a tiny MLP with no server involvement.
8. **Small team, AI agents doing most of the coding**: the stack must be one agents know
   deeply, with fast feedback loops, deterministic tests, and a `window` test seam for WebGL.
9. **CI budget**: 15-minute e2e wall-time budget on `ubuntu-latest` (no GPU).

---

## 3. 3D rendering engine / game framework

| Candidate            | Benefits                                        | Pros                                                                                                                                                                                                                                                                           | Cons                                                                                                                                                                                                                        | Maturity 2026-09                                                 |
| -------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Three.js**         | Thin scene-graph library; you own the loop      | r186 (2026-09-08), 6–10-week cadence; `WebGPURenderer` "tries to use a WebGPU backend if the browser supports WebGPU. If not … falls back to a WebGL 2 backend"; smallest core (393 KB min WebGL build); by far the largest public corpus, so coding agents are strongest here | WebGPU is a separate entry point (`three/webgpu`, `three/tsl`), 821 KB min; no built-in physics/input/UI (we want none)                                                                                                     | Mature; WebGPU path production-usable with fallback, not default |
| Babylon.js           | Batteries-included engine with editor/inspector | 9.27.1 (2026-09-18), releases several times a week; 9.0 (2026-03-26) brought clustered/volumetric lighting on WebGPU compute with WebGL2 fallbacks, Frame Graph                                                                                                                | Monolithic `babylon.js` is 8.56 MB min; tree-shaken sizes only user-reported (240 KB–1.9 MB, **unverified**); opinionated for an arcade racer that needs eight cars and two tracks                                          | Mature                                                           |
| PlayCanvas engine    | Engine + optional cloud editor                  | v2.22.2 (2026-09-11); WebGPU via `createGraphicsDevice(canvas, { deviceTypes })` with WebGL2 always appended as fallback                                                                                                                                                       | Smaller community; new WebGPU renderer date **unverified**                                                                                                                                                                  | Mature                                                           |
| Bevy (Rust → WASM)   | ECS, `webgpu` feature since 0.11                | 0.19.1 (2026-08-13), 0.20 RC                                                                                                                                                                                                                                                   | No TypeScript, so no shared code with a TS server; no official bundle figure (15–30 MB third-party, **unverified**)                                                                                                         | Pre-1.0                                                          |
| Godot 4.7 web export | Full editor                                     | 4.7.2 (2026-08-18)                                                                                                                                                                                                                                                             | Docs: "Godot 4 can only target WebGL 2.0 … does not support WebGPU"; "Safari has several issues with WebGL 2.0 support … we recommend … Chromium-based browser or Firefox"; threads need COOP/COEP; open iOS Safari crashes | Web export is the weakest Godot target                           |
| Unity 6 Web          | Industry tooling                                | 6.6 (2026-09-03) moved WebGPU to "Supported"                                                                                                                                                                                                                                   | Empty URP template ~10.7 MB, ~2 MB after aggressive stripping (aras-p gist); C#, no shared TS; licensing                                                                                                                    | Mature, heavy                                                    |
| Raw WebGPU           | Zero abstraction                                | Total control                                                                                                                                                                                                                                                                  | Rewrites a renderer; 87.35% support; no fallback for free                                                                                                                                                                   | N/A                                                              |

**WebGPU reality check (gpuweb Implementation-Status, updated 2026-08-13; caniuse):** Chrome
113 on Mac/Win/ChromeOS, Android 121+, **Linux only from Chrome 144 (Intel Gen12+) / 147
(NVIDIA on Wayland), hardware-gated**; Firefox 141 Windows, 145–147 macOS Apple Silicon,
**Linux Nightly-only, "shipping planned for 2026"**; Safari 26 (2025-09-15) on macOS/iOS.
caniuse: 85.72% + 1.63% partial = **87.35%** global.

**Verdict — Three.js wins; runner-up Babylon.js.** For an arcade racer with eight cars, two
tracks and a chase camera, a scene-graph library beats an engine: nothing in the requirements
needs an editor, a built-in physics engine, or GUI widgets, and the game already owns its
loop for deterministic fixed-step physics. Three.js has the smallest payload, the clearest
WebGPU story that keeps a WebGL2 fallback, and — decisively for an agent-driven team — the
largest training corpus of any 3D web library. Babylon is the credible alternative if we ever
wanted an in-browser editor. Godot's web export explicitly warns against Safari and cannot use
WebGPU; Bevy and Unity forfeit shared TypeScript. **The current choice is the best choice.**
Ship `WebGLRenderer` as default and `WebGPURenderer` behind a flag until Linux support
(our named desktop target) is un-gated in both Chrome and Firefox.

## 4. Client physics

The game's physics is a **kinematic arcade model** (heading, speed, surface tuning,
wall clamp), not a rigid-body simulation, stepped at a fixed 1/120 s. That fact drives this
whole section.

| Candidate                                     | Benefits                                       | Pros                                                                                                                                                                                                                                                                                   | Cons                                                                                                                                                                                                                                                                                      | Maturity 2026-09                                        |
| --------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **Hand-rolled deterministic kinematic model** | Exactly the physics the game wants, ~200 lines | Trivially portable (TS ↔ numpy); no wasm payload; fixed-step and accumulator already correct; single source of shared constants (`MAX_SPEED_MS`)                                                                                                                                       | Two ports to keep in parity (goldens exist); transcendental functions (`Math.sin/cos`) are _not_ bit-identical across platforms/languages, so parity is tolerance-based, not bit-exact                                                                                                    | Proven in this game                                     |
| Rapier (Rust/WASM)                            | Real rigid bodies, joints, CCD                 | crate 0.35.3 (2026-08-28); `@dimforge/rapier3d` 0.20.0; explicit **`@dimforge/rapier3d-deterministic`** flavour "with a guarantee of cross-platform deterministic execution" (default flavour is "locally deterministic" only); `world.createSnapshot()` MD5-identical across machines | Python bindings exist in-tree but are "not yet published on PyPI" (3D f32 only); `rapier.js` repo archived 2026-07-12 and folded into the main repo; wasm-bindgen glue makes loading in `wasmtime-py` non-trivial (**unverified**); a racing arcade model would fight a rigid-body solver | Mature                                                  |
| Jolt (WASM)                                   | AAA rigid-body engine                          | JoltPhysics 5.6.0 and `jolt-physics` npm 1.1.0 (2026-07-11); determinism given same call order and same binary; `-DCROSS_PLATFORM_DETERMINISTIC=ON`                                                                                                                                    | No Python bindings (discussion #1090); 46 MB unpacked npm (many variants); heavy for this game                                                                                                                                                                                            | Mature                                                  |
| Ammo.js / Bullet                              | Long history, pybullet exists                  | ammo.js still committed to (2026-09-08)                                                                                                                                                                                                                                                | Bullet 2.82 in JS vs 3.x in pybullet — no shared binary; emscripten-era API                                                                                                                                                                                                               | Legacy                                                  |
| cannon-es                                     | Small pure-JS                                  | Easy                                                                                                                                                                                                                                                                                   | **v0.20.0 from 2022-08-12, last commit 2024-01-06** — dormant                                                                                                                                                                                                                             | Abandoned                                               |
| One WASM module in both hosts                 | Eliminates the Python port                     | `wasmtime` PyPI 48.0.0 (2026-08-20), Python 3.9–3.14; bit-identical stepping                                                                                                                                                                                                           | Per-step Python↔WASM boundary crossing is far slower than vectorised numpy for PPO throughput; loses `SubprocVecEnv` vectorisation benefits                                                                                                                                               | Viable for _parity tests_, poor for training throughput |

**Verdict — the hand-rolled kinematic model wins outright; runner-up Rapier
`-deterministic` only if the game ever needs car-to-car collisions or rigid-body
tumbling.** Every general-purpose engine adds a wasm payload, a foreign API and a Python
problem (Rapier not on PyPI, Jolt no bindings) to solve a problem the game does not have.
The honest weakness of the current approach is not the model but its **parity testing**:
goldens with tolerances catch drift, but property-based tests (fast-check over inputs,
Hypothesis over the same properties) would pin invariants like "speed never exceeds
`MAX_SPEED_MS[d] × 1.1`" and "no step moves more than `maxSpeed × dt`" — the very bounds
ADR-0005 relies on — in both languages. The frontier option that genuinely eliminates the
port is _one Rust crate_ with a wasm target for the browser and PyO3 for Gymnasium (Rapier
proves the pattern), but for ~200 lines of arcade physics it buys bit-exactness at the price
of a Rust toolchain that ADR-0007 already declined once. **Current choice is the best choice;
add property tests.**

## 5. Networking / realtime transport and netcode

Netcode first, because it fixes the transport requirement. ADR-0005 makes the client
authoritative over its pose and the server a _plausibility judge_. Late delivery therefore
costs a stale frame, never correctness; there is no rollback, so unreliable/unordered
delivery is an optimisation for pose freshness only. Server-authoritative rollback (what
Colyseus 0.18's prediction/lag-compensation and SpacetimeDB reducers are built for) would
require server-run physics, reversing the founding stance.

| Candidate                                                            | Benefits                                           | Pros                                                                                                                                                                                           | Cons                                                                                                                                                                                                                                                                                                        | Maturity 2026-09                               |
| -------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **WebSocket** (RFC 6455; over HTTP/2 RFC 8441; over HTTP/3 RFC 9220) | Universal, TCP, trivially proxied                  | Every browser, every PaaS (Railway/Render/Cloudflare are WS-only); `ws` 8.21.3 (2026-08-06), `uWebSockets.js` 20.71.0, Bun native; k6/Artillery load tools                                     | Head-of-line blocking on loss; `WebSocketStream` (backpressure) is Chromium-only (72.69%)                                                                                                                                                                                                                   | Standard                                       |
| WebTransport (HTTP/3, datagrams)                                     | Unreliable datagrams + streams over QUIC           | Chrome 97, Edge 98, Firefox 114, **Safari 26.4 (2026-03-24)**; caniuse **91.3%**; MDN Baseline "newly available" 2026                                                                          | **HTTP/3 binding still an Internet-Draft** (draft-16, 2026-07-06, WG Last Call); needs UDP/QUIC termination the server owns — **Railway has no public UDP**, Render/Cloudflare neither (workerd#6451: "may not yet be on the roadmap"); Node side via `@fails-components/webtransport` 1.6.8; no k6 support | Browser-ready, infrastructure-gated            |
| WebRTC DataChannel (`ordered:false`, `maxRetransmits`)               | Unreliable delivery, Baseline since 2020           | `node-datachannel` 0.33.4 (2026-09-12), `werift` 0.24.4 (pure TS), Pion 4.2.20 (Go)                                                                                                            | ICE/STUN/TURN complexity for client↔server; still needs UDP ingress                                                                                                                                                                                                                                         | Mature but heavyweight for one-server topology |
| Colyseus                                                             | Rooms, binary delta schema, prediction             | 0.18.6 (2026-09-16), MIT; transports ws / uWS / Bun / **WebTransport (experimental — "hasn't been battle tested")**; `@colyseus/schema` 5 with `t.quantized()`, `t.angle()`; Cloud from $15/mo | Schema 4→5 in seven months; **63-field cap per Schema**; its value (server-authoritative state sync) is the thing ADR-0005 rejects                                                                                                                                                                          | Mature, churny                                 |
| Nakama                                                               | Full backend (auth, leaderboards, matchmaking)     | 3.41.0 (2026-09-18), Apache-2.0; Go/TS/Lua runtimes                                                                                                                                            | TS runtime is **ES5 on goja** — "All code must compile down to ES5", no shared TS modules verbatim; Heroic Cloud pricing not public (**unverified**)                                                                                                                                                        | Mature, wrong shape                            |
| SpacetimeDB                                                          | DB + server modules, TS modules out of beta in 2.0 | 2.10.1 (2026-09-15), weekly                                                                                                                                                                    | **BSL 1.1** (grant ≤1 production instance; AGPL in 2031); server-authoritative model                                                                                                                                                                                                                        | Young                                          |
| PartyKit / Cloudflare Durable Objects                                | Edge rooms, WS hibernation                         | `partyserver` 0.5.10 (2026-08-03) succeeds `partykit` (last publish 2025-05); DO pricing $0.15/M req, incoming WS billed 20:1                                                                  | No Postgres (D1/DO SQLite; Hyperdrive to external); no UDP; `partykit` itself is effectively frozen                                                                                                                                                                                                         | Mature platform, thin library                  |
| geckos.io / nengi / Hathora                                          | —                                                  | —                                                                                                                                                                                              | geckos 3.1.0 (2026-03-27) then quiet; nengi 2.0.0-alpha (2024); **Hathora gaming shut down 2026-05-05** (Fireworks AI acquisition; docs redirect to GameFabric)                                                                                                                                             | Not safe bets                                  |

**Verdict — WebSocket wins; runner-up WebTransport as the frontier lane.** For a
plausibility-checked, client-authoritative racer with a handful of players per Room, TCP
head-of-line blocking costs a late pose, not a wrong result, and every host we might use
terminates WebSockets. WebTransport is now browser-ready (Safari 26.4 closed the gap) but the
HTTP/3 spec is still a draft and it forces the hosting choice to Fly.io/Hetzner. A plain `ws`
(or Bun-native) server beats every framework here: Colyseus, Nakama and SpacetimeDB all
sell server-authoritative state, which is the one thing this game deliberately does not
want. **Current transport is the best choice.** The wire _format_ is not — see §7.

## 6. Server runtime and language

| Candidate        | Benefits                                          | Pros                                                                                                                                                                                                                        | Cons                                                                                                                                                    | Maturity 2026-09                |
| ---------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| **Node.js**      | Runs the shared TypeScript verbatim               | 24.21.0 Active LTS (2026-09-07); **26 becomes LTS 2026-10-28**; type stripping **Stable**, on by default (`.ts` runs flagless; erasure only — no enums/decorators/parameter properties); global `WebSocket` _client_ stable | No built-in WS _server_ (use `ws`/`uWebSockets.js`); slowest raw WS throughput of the three JS runtimes                                                 | Rock solid                      |
| Bun              | Fastest JS WS server                              | 1.4.2 (2026-09-05); native WS with pub/sub and backpressure, Bun's own numbers "7× more throughput" than Node+`ws` (~700k vs ~100k msg/s); "97%" of Node's `http/fs/stream` suite                                           | **1.4.0 (2026-08-20) "is now written in Rust — and this is the first release"**; two patch releases in two days; "not 100% compatible with Node.js yet" | Fast, freshly rewritten         |
| Deno             | Secure-by-default TS runtime                      | 2.9.7 (2026-09-17), 2.9 LTS; Deno Deploy GA 2026-02-03                                                                                                                                                                      | New Deploy has **2 regions**; Deploy Classic shut 2026-07-20                                                                                            | Mature, small hosting footprint |
| Go               | Great tick-loop perf, single binary               | 1.27.1; `coder/websocket` 1.8.15 active (gorilla stagnant since 2025-03); Pion for WebRTC                                                                                                                                   | Second copy of every schema/constant, or protobuf codegen; agents split across two languages                                                            | Mature                          |
| Rust             | Max performance, shares a physics crate with wasm | tokio 1.53, axum 0.8.9, tokio-tungstenite 0.30                                                                                                                                                                              | Same shared-code cost as Go plus toolchain weight                                                                                                       | Mature                          |
| Elixir / Phoenix | Channels + Presence (CRDT, no Redis)              | Phoenix 1.8.14 (2026-09-14)                                                                                                                                                                                                 | Third language for a small team; no shared TS                                                                                                           | Mature                          |

**Verdict — Node LTS wins; runner-up Bun.** The single most valuable property here is
running `shared/` unchanged on both ends — Node, Bun and Deno alone do that, and Node
now does it with no build step and no flags. Bun's WS numbers are genuinely attractive for a
tick loop, but adopting a runtime three weeks after its ground-up Rust rewrite is not a
merit-based choice for production; revisit in 2027. Go/Rust/Elixir would each be the _right_
answer for a server that simulates physics at scale — which ADR-0005 says this one never
will. **Current choice is the best choice**; move to Node 26 LTS in late October.

## 7. Shared schema and serialization

Two very different message classes exist: infrequent **control** messages (hello, rooms,
replays, leaderboard) that want validation and readable JSON, and the **`state` pose**
message at 20–60 Hz per player that wants compactness and cheap parsing.

| Candidate                                   | Benefits                                          | Pros                                                                                                                                                                            | Cons                                                                                 | Maturity 2026-09 |
| ------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------- |
| **Zod 4**                                   | Runtime validation = static types, one definition | 4.6.5 (2026-09-13); core "12.47kb → 5.36kb", `zod/mini` "1.88kb" gzip; "14.71x faster" strings, "7.43x" arrays vs v3; tsc instantiations >25,000 → ~175; Standard Schema author | Still the largest of the three Standard-Schema libs                                  | Mature           |
| Valibot                                     | Smallest                                          | 1.5.0 (2026-09-09); "between 1 and 2 kB for most users"                                                                                                                         | Smaller ecosystem/corpus for agents                                                  | Mature           |
| ArkType                                     | Fastest validation                                | 2.2.3 (2026-07-07); "20x faster than Zod" (14 ns vs 281 ns)                                                                                                                     | ~40 kB bundle (**unverified**); string-DSL types are less agent-friendly             | Mature           |
| TypeBox                                     | JSON Schema 2020-12 native                        | `typebox` 1.3.34 (2026-09-18); TS 6–7                                                                                                                                           | Two npm lines (`@sinclair/typebox` LTS vs `typebox`) — easy to install the wrong one | Mature           |
| Effect Schema                               | Bidirectional codecs, `Arbitrary` for fast-check  | effect 3.22.2; Standard Schema output                                                                                                                                           | Pulls the Effect world in                                                            | Mature           |
| protobuf-es (Buf)                           | Cross-language binary + schema                    | `@bufbuild/protobuf` 2.15.0 (2026-09-11); the only JS protobuf fully conformance-compliant; pure-TS codegen                                                                     | Codegen step; overkill when both ends are TS                                         | Mature           |
| FlatBuffers                                 | Zero-copy                                         | —                                                                                                                                                                               | npm 25.9.23 is a year stale vs GitHub 25.12.19; needs `flatc --ts`                   | Stale on npm     |
| msgpackr / cbor-x                           | Drop-in binary JSON                               | 2.1.0 / 1.6.6 (Aug 2026); faster than native JSON on Node; record extension 15–50% more compact                                                                                 | Schema-less: no validation, no field-level quantisation                              | Mature           |
| Hand-packed `DataView`/`Float32Array` frame | Smallest, fastest for one fixed record            | 5×f32 + u32 ms = **24 B**; 5×f32 + f64 = 28 B                                                                                                                                   | One bespoke encoder/decoder to test (a fast-check round-trip property covers it)     | N/A              |
| `@colyseus/schema` / bitECS                 | Binary delta / typed-array components             | `t.quantized()`, `t.angle()`                                                                                                                                                    | Coupled to Colyseus; bitECS is an ECS, not a wire format                             | —                |

Computed sizes for `{x,y,z,heading,speed,t}`: compact-key JSON **73 B**, descriptive keys
**92 B**, MessagePack map ~47 B / array ~35 B, packed binary 24–28 B. At 60 Hz × 8 players
that is ~35 KB/s vs ~11 KB/s per client — bandwidth is small either way; the win is parse
cost, precision control (quantise heading), and never sending `NaN`-able floats unvalidated.

**Verdict — Zod 4 for every control message (Standard Schema, `z.infer` as the single
type source) plus a hand-packed binary frame for `state`; runner-up msgpackr if a
zero-code binary path is preferred over the 24-byte frame.** protobuf-es is the right answer
only if a Go/Rust server ever appears. **The current stack is not the winner here**: Zod is
installed but `shared/src/messages.ts` hand-writes one parser per variant, and poses ride as
JSON strings. That is more code to keep in sync and the least compact possible pose frame.

## 8. Persistence

| Candidate                               | Benefits                                         | Pros                                                                                                                                                                                                              | Cons                                                                                                                                                                                                                                                  | Maturity 2026-09      |
| --------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| **PostgreSQL 18**                       | Relational truth for leaderboard, rooms, replays | 18.0 (2025-09-25): async I/O "up to 3× performance improvements for storage reads", `uuidv7()`, skip-scan, checksums on; 18.6 latest minor (2026-08-13); **19 still Beta 3** despite "planned for September 2026" | Needs hosting; Railway's template is "considered unmanaged"                                                                                                                                                                                           | The default           |
| `pg` (node-postgres)                    | Minimal, everywhere                              | 8.23.0 (2026-08-08), repo pushed 2026-09-18                                                                                                                                                                       | Untyped rows — you write the types                                                                                                                                                                                                                    | Mature                |
| postgres.js                             | Fast tagged-template driver                      | 3.4.9                                                                                                                                                                                                             | Nothing published since 2026-04-05                                                                                                                                                                                                                    | Slowing               |
| Kysely                                  | Type-safe SQL builder, no ORM opinions           | 0.29.6 (2026-09-16), steady                                                                                                                                                                                       | Pre-1.0 forever                                                                                                                                                                                                                                       | Mature                |
| Drizzle ORM                             | Schema-as-code, migrations, `drizzle-orm/zod`    | 1.0 brings DDL-snapshot migrations, validators in-tree                                                                                                                                                            | **1.0 still not stable** (`1.0.0-rc.5-…` 2026-09-09); stable line frozen at 0.45.2 since 2026-03-27; Standard Schema support **unverified**                                                                                                           | Long beta             |
| Prisma                                  | Rich tooling                                     | 7.0 (2025-11-19) made the Rust-free client default; 7.10.0 client                                                                                                                                                 | **`prisma` CLI `latest` tag points at 8.0.0-rc.15** while client is 7.x; Prisma 8 becomes "a framework that knows nothing about any database by default"; 7 supported 12 months                                                                       | Mid-transition        |
| PGlite                                  | Postgres in WASM, "only 3.7mb gzipped"           | 0.5.8 (2026-08-26); browser/Node/Bun; pgvector, PostGIS                                                                                                                                                           | Single exclusive connection; 0.x; no production-ready statement; PG major **unverified**                                                                                                                                                              | Test double, not prod |
| SQLite / Turso / libSQL                 | Embedded, cheap edge                             | Turso (Rust rewrite) 0.7.2, MIT                                                                                                                                                                                   | "not yet reached 1.0"; cloud server closed source; Railway Postgres is already free of this trade                                                                                                                                                     | Young                 |
| Redis / Valkey                          | Ephemeral room state, pub/sub                    | Valkey 9.1.2 BSD-3; Redis 8.x tri-licensed (RSALv2/SSPL/AGPL)                                                                                                                                                     | Unneeded for a single-process room server; a second stateful service to run                                                                                                                                                                           | Mature, unnecessary   |
| Object store (R2 / S3) for trajectories | Cheap bulk bytes                                 | R2 $0.015/GB-mo with free egress; S3 $0.023/GB + $0.09/GB egress                                                                                                                                                  | A 5-min lap at 60 Hz × 7 f32 ≈ **504 KB**; at 20 Hz ≈ 168 KB — Postgres TOASTs this fine (1 GB field limit, `COMPRESSION lz4`); an object store adds a network hop and a consistency problem for nothing until there are tens of thousands of replays | Premature             |
| TimescaleDB / columnar                  | Time-series compression                          | 2.30.1                                                                                                                                                                                                            | Columnstore and continuous aggregates are **Community Edition only** (Tiger Data License); replays are read whole, not queried by time                                                                                                                | Wrong shape           |

**Verdict — Postgres 18 with the `pg` driver and raw SQL wins; runner-up Kysely for typed
queries if the query surface grows past a handful of statements.** The schema is three
tables and the load-bearing rule ("a slower lap never overwrites a PB") is SQL; an ORM buys
nothing for this and both leading ORMs are mid-transition (Drizzle's endless 1.0 beta,
Prisma's 8 RC on `latest`). Store trajectories as a packed `bytea` (same encoder as the
wire frame from §7) in Postgres with `lz4` compression rather than `float4[]` or JSONB — the
Postgres docs themselves warn that "searching for specific array elements can be a sign of
database misdesign", and replays are read whole. Redis/Valkey is unnecessary while Rooms live
in one process. **Current choice is the best choice** (with the trajectory encoding change).

## 9. Language and build tooling

| Candidate                                | Benefits                                               | Pros                                                                                                                                                                                                | Cons                                                                                                                                                                                | Maturity 2026-09              |
| ---------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| **TypeScript 7.0**                       | 10× faster native compiler as standard `tsc`           | 7.0.2 is `latest` (2026-07-08); VS Code typecheck 125.7 s → 10.6 s; 6.0 (2026-03-23) was "the last release based on the current JavaScript codebase"; strict-by-default                             | **"does not ship with an API"** until 7.1 — so typescript-eslint 8.70 still runs on the TS 6 API (`@typescript/typescript6`) and warns on TS 7; Vue/Svelte/MDX tooling not yet on 7 | Stable; ecosystem catching up |
| Vite 8                                   | Fast dev server + Rolldown                             | 8.3.0 (2026-09-10); 8.0 "ships with Rolldown as its single, unified, Rust-based bundler", esbuild dropped from core                                                                                 | Rolldown 1.0 only since 2026-05-07                                                                                                                                                  | Stable                        |
| Rspack / Rsbuild                         | webpack-compatible Rust bundler                        | 2.2.x                                                                                                                                                                                               | No advantage for a Vite-shaped app                                                                                                                                                  | Stable                        |
| esbuild / tsdown / Bun bundler           | Fast single-purpose                                    | esbuild 0.28.2 (0.x by design); tsdown 0.23                                                                                                                                                         | Not a dev server (esbuild); pre-1.0 (tsdown); Bun rewrite risk                                                                                                                      | —                             |
| **pnpm**                                 | Strict, fast, `catalog:` for one-version-of-everything | 12.4.2 (2026-09-15); catalogs with `workspace:` ranges since 11.26                                                                                                                                  | **12.0 (2026-08-26) is a "complete rewrite in Rust"** — stay on 11.x until 12 settles                                                                                               | Mature (11), fresh (12)       |
| npm workspaces                           | Zero extra tooling                                     | 11.19.1                                                                                                                                                                                             | No catalogs, slower installs; hoisting hides phantom deps                                                                                                                           | Mature                        |
| Bun workspaces                           | Fastest installs                                       | Isolated installs default since 1.3                                                                                                                                                                 | Catalog bugs at 1.3.0 (oven-sh/bun#23615); runtime rewrite                                                                                                                          | Young                         |
| Turborepo / Nx                           | Task graph + remote cache                              | Turbo 2.11.2; Nx 23.2.1                                                                                                                                                                             | A five-package monorepo with `--workspaces` scripts doesn't need a task graph yet                                                                                                   | Mature, unnecessary           |
| **oxlint + tsgolint / oxfmt**            | Type-aware lint on the TS 7 compiler                   | oxlint 1.83.0; type-aware **stable 2026-07-22**: "59 of typescript-eslint's 61 type-aware rules", 12–18× faster; oxfmt 0.68 "passes 100% of Prettier's JavaScript and TypeScript conformance tests" | oxfmt still Beta (since 2026-02-24); younger ecosystem for custom rules                                                                                                             | Stable (lint) / Beta (fmt)    |
| Biome 2.5                                | One tool: lint + format                                | 2.5.14 (2026-09-16), ">500 rules", own type-inference engine                                                                                                                                        | Roadmap admits "monorepo memory leaks"; its type inference is its own, not `tsc`'s                                                                                                  | Stable                        |
| ESLint 10 + typescript-eslint + Prettier | Largest rule ecosystem                                 | ESLint 10.11 (flat config only); Prettier 3.9.8                                                                                                                                                     | Type-aware rules still on the TS 6 API; slowest                                                                                                                                     | Mature                        |

**Verdict — TypeScript 7.0, Vite 8, pnpm (11.x until 12 settles), oxlint + tsgolint and
oxfmt; runner-up Biome as the one-tool alternative.** TypeScript 7 is the largest
productivity win available in the whole stack for an agent-heavy team (10× typecheck), and
oxlint is the only type-aware linter that actually runs against the TS 7 compiler today.
**The current stack is not the winner here**: it is on TS 6, npm workspaces, and has no
linter or formatter at all — the latter is the real gap for a codebase mostly written by
agents. Vite is already the right bundler.

## 10. Desktop distribution

| Candidate              | Benefits                                             | Pros                                                                                                                                                                                                                                                                                                                  | Cons                                                                                                                                                                                                                                                                                                                                                                               | Maturity 2026-09                        |
| ---------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| **Electron**           | One Chromium everywhere — one rendering path to test | v44.4.3 (2026-09-18), Chromium 152, Node 24.21; WebGPU inherited from Chromium (same Linux gating as the browser); electron-updater; electron-builder covers dmg/nsis/AppImage; Electron + NW.js are the only frameworks the main Steam libs officially support (webgamedev.com, **secondary**); Playwright drives it | Prebuilt zips 117–150 MiB; installers large; signing/notarisation still our job                                                                                                                                                                                                                                                                                                    | Mature                                  |
| Tauri v2               | Tiny binaries, Rust core                             | 2.11.5 (2026-07-01); "as little as 600KB"; updater with mandatory signatures; notarisation built in; `@wdio/tauri-service` covers macOS                                                                                                                                                                               | **Three webviews**: WebView2 (Chromium) / WKWebView / WebKitGTK; **WebKitGTK compiles `ENABLE_WEBGPU` OFF** (2.54, 2026-09-16 highlights silent on it) — our Bazzite/Linux target loses WebGPU and gets a different WebGL implementation from the browser build; Linux updater is AppImage-only; Rust toolchain on every contributor/runner; Steam overlay issue open (tauri#6196) | Mature core, platform-uneven            |
| Tauri v3 (CEF runtime) | Would give Tauri one Chromium                        | `3.0.0-alpha.1` 2026-09-15 with `tauri-runtime-cef` tags                                                                                                                                                                                                                                                              | Alpha, days old                                                                                                                                                                                                                                                                                                                                                                    | Far too early                           |
| Neutralino             | Small                                                | 6.9.0 (2026-07-24)                                                                                                                                                                                                                                                                                                    | Uses `webview/webview` → same per-OS WebGPU story as Tauri; no e2e testing story                                                                                                                                                                                                                                                                                                   | Niche                                   |
| PWA only               | No installer, no signing                             | Desktop Chrome/Edge install; Safari macOS 14+ "Add to Dock"                                                                                                                                                                                                                                                           | Firefox desktop needs an extension; no Steam; no auto-update control; no file-protocol origin control                                                                                                                                                                                                                                                                              | Mature, insufficient for "add to Steam" |

**Verdict — Electron wins; runner-up Tauri v2.** For a game whose rendering path _is_ the
product and whose named Linux audience runs SteamOS-style distros, one Chromium on all three
OSes beats a 600 KB binary that renders through three different engines — one of which
(WebKitGTK) has WebGPU compiled out entirely. Steam's officially supported shells are
Electron/NW.js. Installer size is the honest cost. ADR-0007's reasoning holds on merit, not
just on inertia. **Current choice is the best choice.** Re-evaluate when Tauri v3's CEF
runtime reaches beta.

## 11. RL / AI-opponent pipeline

| Candidate                                            | Benefits                       | Pros                                                                                          | Cons                                                                                                                                              | Maturity 2026-09 |
| ---------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| **Python: Gymnasium + Stable-Baselines3**            | The standard PPO; reproducible | SB3 2.9.0 (2026-06-15), torch ≥2.8; Gymnasium 1.3.0 (2026-04-22); `SubprocVecEnv` parallelism | A second physics implementation to keep in parity (goldens today)                                                                                 | Mature           |
| `sbx` (SB3 in JAX)                                   | Same API, faster               | 0.28.1 (2026-07-24)                                                                           | jax ≥0.4.24,<0.12 pin churn                                                                                                                       | Mature           |
| CleanRL                                              | Single-file, readable          | Repo active                                                                                   | PyPI 1.2.0 from 2023 — copy the file, don't `pip install`                                                                                         | Mature-by-copy   |
| RLlib (Ray)                                          | Scale-out                      | 2.58.0                                                                                        | Pins `gymnasium==1.2.2`, conflicts with the 1.3 SB3 supports; vast for one policy                                                                 | Overkill         |
| JAX vectorised sim (Brax / MJX / Gymnax / PureJaxRL) | Thousands of envs on one GPU   | Brax 0.14.2; mujoco 3.13; gymnax 1.0.0                                                        | PureJaxRL unmaintained (last push 2024-09); requires rewriting the physics in JAX — a _third_ port                                                | Frontier         |
| TorchRL                                              | PyTorch-native                 | 0.14.0 (2026-09-10)                                                                           | Steeper than SB3 for a 6k-param MLP                                                                                                               | Mature           |
| Training in TypeScript                               | One language                   | —                                                                                             | No credible library (`rl-ts` 32 stars, last push 2025-03)                                                                                         | Not viable       |
| Same WASM physics in Python (`wasmtime` 48.0)        | Bit-exact parity               | Works                                                                                         | Per-step boundary crossing throttles PPO; use for **parity tests**, not training                                                                  | Viable for tests |
| **Browser inference: hand-written MLP forward**      | ~40 lines of TS                | 16→64→64→2 fp32 = 5,378 params = **21 KB**; 32→128→128→3 = 82.5 KB                            | You own the matmul (trivially unit-tested against the exporter)                                                                                   | N/A              |
| ONNX Runtime Web                                     | Standard runtime               | 1.30.0 (2026-09-14)                                                                           | `ort-wasm-simd-threaded.wasm` **3.5 MB gzip** (WebGPU EP 6.3 MB) to run a 21 KB policy; WebGPU/WebNN EPs "experimental", WebGL "maintenance mode" | Disproportionate |
| TensorFlow.js                                        | —                              | —                                                                                             | 4.22.0 published **2024-10-21**, ~2 years without a release                                                                                       | Dormant          |
| WebNN                                                | Hardware NN API                | —                                                                                             | Not shipped by default anywhere; Chrome origin trial slipped (webnn.io "156 (TBD) to 160")                                                        | Not ready        |

**Verdict — Python/SB3 for training, numpy physics port, hand-written TS forward pass for
inference; runner-up `sbx` when wall-clock matters.** ADR-0002/0006 already keep the
forward pass out of the race loop (bake at selection time), so inference cost is irrelevant
and a 3.5 MB runtime for 21 KB of weights is indefensible; TF.js is dormant and WebNN
unshipped. The parity problem is best attacked with **shared property tests and a shared
golden fixture**, plus an optional `wasmtime-py` replay of the compiled TS physics as a
parity oracle, rather than by moving training to TS (no viable library) or to JAX (a third
port). **Current choice is the best choice.**

## 12. Hosting

| Candidate                            | Benefits                                  | Pros                                                                                                                                                               | Cons                                                                                                                                          | Maturity 2026-09         |
| ------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| **Railway**                          | Git-push deploy, Postgres template, cheap | Hobby $5 / Pro $20 + usage (RAM $10/GB-mo, CPU $20/vCPU-mo, egress $0.05/GB); WS exempt from request-duration limits; 4 regions (US-W, US-E, Amsterdam, Singapore) | **No public inbound UDP** (TCP proxy only) → no WebTransport/WebRTC server; HTTP/1.1+2 ingress only; Postgres template "considered unmanaged" | Mature                   |
| Fly.io                               | Machines near players, UDP                | shared-cpu-1x $2.02/mo; **18 regions**; UDP via `fly-global-services` + dedicated IPv4 ($2/mo)                                                                     | Managed Postgres Basic **$38/mo** (unmanaged Fly Postgres no longer supported)                                                                | Mature                   |
| Cloudflare Workers + Durable Objects | Global edge, WS hibernation               | $5/mo min; hibernation costs no GB-s; `partyserver`                                                                                                                | No Postgres (DO SQLite/D1; Hyperdrive to external); **no UDP / WebTransport server**; incoming WS messages billed 20:1                        | Mature, wrong data story |
| Hetzner Cloud VM                     | Cheapest raw compute, UDP                 | CX23 2 vCPU/4 GB €5.49; 6 locations                                                                                                                                | +30–37% price rise in 2026; cheapest tiers EU-only; BYO Postgres, backups, TLS, deploys                                                       | Mature, DIY              |
| Render                               | Simple PaaS                               | Managed Postgres                                                                                                                                                   | No UDP; pricing details **unverified**                                                                                                        | Mature                   |
| AWS GameLift / Agones                | Fleet orchestration for dedicated servers | GameLift bandwidth free since 2026-06-15; Agones 1.60 CNCF                                                                                                         | Built for authoritative dedicated game servers at scale — wrong size for one Node process                                                     | Mature, oversized        |
| Hathora                              | —                                         | —                                                                                                                                                                  | **Shut down for gaming 2026-05-05**                                                                                                           | Gone                     |

**Verdict — Railway wins for the recommended (WebSocket) stack; Fly.io is the runner-up
and becomes the winner the moment WebTransport or WebRTC enters the picture.** Railway's
single real limitation — no UDP — is irrelevant while the transport is WebSocket, and its
Postgres-on-a-volume plus native backups is the cheapest sane persistence for a leaderboard.
Fly's 18 regions matter for latency only if the player base spreads beyond the four Railway
regions. **Current choice is the best choice.**

---

## 13. Test stack, unit and integration

| Candidate               | Benefits                                      | Pros                                                                                                                                                                                                                                                                                                                                                                                     | Cons                                                                                                                                                                       | Maturity 2026-09 |
| ----------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| **Vitest 5**            | Vite-native, fast, one config with the app    | 5.0.1 (2026-09-15); Node ≥22.12; **Browser Mode stable since 4.0** ("removing the `experimental` tag"), providers `@vitest/browser-playwright` etc.; `toMatchFileSnapshot` (arbitrary file — ideal for cross-language goldens); `expect.closeTo` inside `toEqual`; `vi.useFakeTimers` on `@sinonjs/fake-timers`; `--shard` + `--merge-reports`; "−53%"/"−25%" perf claims in the v5 post | Un-awaited async assertions now fail (good, but migration noise)                                                                                                           | Stable           |
| Bun test                | Fastest startup                               | Jest-style API                                                                                                                                                                                                                                                                                                                                                                           | "Bun aims for compatibility with Jest, but not everything is implemented"; no auto-mocking/hoisting, `addSnapshotSerializer` "Not Yet Implemented"; runtime just rewritten | Young            |
| `node:test`             | Zero deps                                     | Module Stable; snapshots stable (v23.4); `run()` supports `shard`                                                                                                                                                                                                                                                                                                                        | Coverage still Experimental in Node 26; tags/global setup "early development"                                                                                              | Stable-ish       |
| Jest 30                 | Ubiquity                                      | 30.5.2 (2026-09-18), active                                                                                                                                                                                                                                                                                                                                                              | Not Vite-aware; slower; duplicate transform config                                                                                                                         | Mature           |
| **fast-check 4**        | Property-based tests for physics/plausibility | 4.10.1 (2026-09-15); `@fast-check/vitest` 0.5.0 supports Vitest 5                                                                                                                                                                                                                                                                                                                        | Learning curve for shrinking/arbitraries                                                                                                                                   | Mature           |
| Effect `Arbitrary`      | Derive arbitraries from schemas               | `Arbitrary.make(schema)` → fast-check                                                                                                                                                                                                                                                                                                                                                    | Only if on Effect Schema                                                                                                                                                   | Mature           |
| **Hypothesis** (Python) | Same properties on the Python port            | 6.168.0 (2026-09-08)                                                                                                                                                                                                                                                                                                                                                                     | —                                                                                                                                                                          | Mature           |
| StrykerJS 10            | Mutation testing                              | 10.0.0 (2026-08-14), Node 22+, TS 7 experimental; Vitest runner                                                                                                                                                                                                                                                                                                                          | Vitest **Browser Mode "Not currently supported"**; `perTest` coverage only; slow on a 40-file suite                                                                        | Mature           |
| mutmut 3.8              | Python mutation testing                       | fork-based, incremental                                                                                                                                                                                                                                                                                                                                                                  | —                                                                                                                                                                          | Mature           |
| `pytest.approx`         | Tolerant goldens                              | rel 1e-6 / abs 1e-12 defaults; numpy arrays supported                                                                                                                                                                                                                                                                                                                                    | —                                                                                                                                                                          | Mature           |

**Verdict — Vitest 5 + fast-check (TS) and pytest + Hypothesis (Python), with one shared
golden JSON fixture read by `toMatchFileSnapshot` on one side and `pytest.approx` on the
other; runner-up Bun test only if the runtime ever moves to Bun.** The specific gap in the
current stack is not the runner but the _kind_ of tests: the physics and the ADR-0005 bounds
are stated as invariants ("never exceeds max speed × 1.1", "no window covers more distance
than `maxSpeed × dt`", "encode∘decode = id" for the pose frame) and invariants are exactly
what property-based tests pin, in both languages, from one property list. Mutation testing
is a nice-to-have on `plausibility` and `physics` only. **Current runners are the best
choice; the test _techniques_ are incomplete.**

## 14. Test stack, e2e and visual

| Candidate           | Benefits                                                    | Pros                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Cons                                                                                                                                                                                         | Maturity 2026-09    |
| ------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| **Playwright 1.63** | Multi-context multi-client, clock control, sharding, agents | 1.63.0 (2026-09-04), Chromium 153 / Firefox 155 / WebKit 26.6; `page.clock` overrides `Date`, timers, rAF, `performance`; multiple `browser.newContext()` in one test for "multi-user functionality"; `--shard` + blob + `merge-reports`; `toHaveScreenshot` with `threshold`/`maxDiffPixelRatio`/`mask`; `retryStrategy: 'isolated'`; **Playwright Agents** (planner/generator/healer, `npx playwright init-agents --loop=claude-code`); `--debug=cli` for agents | Default browser is the **headless shell**; WebGPU needs `channel: 'chromium'` (new headless)                                                                                                 | Stable              |
| Cypress 16          | DX                                                          | 16.1.0 (2026-09-15)                                                                                                                                                                                                                                                                                                                                                                                                                                                | "does not support controlling more than 1 open browser at a time" → no multi-client races; **Electron deprecated as a test browser**; no WebSocket interception; no WebGL/canvas positioning | Stable, wrong shape |
| WebdriverIO 9       | Standards (BiDi), Electron + Tauri services                 | 9.31.9                                                                                                                                                                                                                                                                                                                                                                                                                                                             | BiDi API: "Browser support is not guaranteed"                                                                                                                                                | Stable              |
| Puppeteer 25        | Chrome-only automation                                      | 25.11.0                                                                                                                                                                                                                                                                                                                                                                                                                                                            | No test runner, no multi-browser                                                                                                                                                             | Stable              |

**Headless GPU on CI (Chromium docs):** since 112 `--headless` is the unified "new"
headless; the old mode survives only as `chrome-headless-shell`. SwiftShader flags:
`--use-gl=angle --use-angle=swiftshader`; WebGL fallback `--use-angle=swiftshader-webgl
--enable-unsafe-swiftshader`; WebGPU on a GPU-less Linux box: `--headless=new
--use-angle=vulkan --enable-features=Vulkan --disable-vulkan-surface --enable-unsafe-webgpu`
(Chrome's own blog shows the adapter reporting "SwiftShader Device (Subzero)"). **Critical:**
the SwiftShader doc states "WebGL context creation will soon fail instead of falling back to
SwiftShader" — opt-in via `--enable-unsafe-swiftshader`. Firefox headless WebGPU on Linux CI:
**unverified**.

| Ephemeral DB / contract / load                            | Benefits                                   | Pros                                                                                    | Cons                                                                                                                                | Maturity               |
| --------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **Testcontainers Node 12** (`@testcontainers/postgresql`) | Real Postgres, real SQL rules              | 12.1.0 (2026-08-04); `.snapshot()`/`.restoreSnapshot()`                                 | Needs a container socket (rootless Podman works; Ryuk off)                                                                          | Stable                 |
| **PGlite 0.5**                                            | Postgres in-process, <3 MB gz, no Docker   | Ideal as the **Vitest** double for `server/src/test-database.ts`-class tests            | Single connection; PG major **unverified**; not the production engine                                                               | Test double            |
| embedded-postgres (leinelissen)                           | Real binaries, no Docker                   | 18.4.0-beta.17; PG 14–18                                                                | 146 stars; cannot run as root                                                                                                       | Niche                  |
| pg-mem                                                    | Pure-JS                                    | —                                                                                       | Experimental; no timezone, numerics as JS numbers, no plpgsql                                                                       | Weak fidelity          |
| Pact-js 17                                                | Consumer-driven contracts                  | Message pacts (async)                                                                   | WebSockets not covered — model frames as messages yourself; the **shared Zod schema is already the contract** when both ends are TS | Mature, redundant here |
| **k6 2.x**                                                | WebSocket load                             | 2.2.0 (2026-08-10); `k6/websockets` (W3C API) stable since 1.6; many connections per VU | **No WebTransport**                                                                                                                 | Stable                 |
| Artillery 2.0.34                                          | WS + Socket.IO engines, bundles Playwright | 2026-08-14                                                                              | Heavier                                                                                                                             | Stable                 |
| Gatling / Locust                                          | —                                          | —                                                                                       | Gatling WS checks blocking; Locust HTTP-only built-in                                                                               | —                      |

| Visual regression                       | Benefits                                 | Pros                                                                                               | Cons                                                                                                                                      | Maturity         |
| --------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Playwright `toHaveScreenshot`           | Built in                                 | `threshold` (YIQ, default 0.2), `maxDiffPixels`, `animations: 'disabled'`, `mask`; WebP since 1.62 | Cross-GPU/driver drift; must pin `mcr.microsoft.com/playwright:v1.63.0-noble`                                                             | Stable           |
| Vitest Browser Mode `toMatchScreenshot` | Component-level visuals                  | pixelmatch; `allowedMismatchedPixelRatio`                                                          | Same drift problem                                                                                                                        | Stable           |
| **Argos**                               | Uploads _real_ screenshots (sees canvas) | Hobby **free 5,000/mo**; Pro $100/mo; `@argos-ci/playwright` 7.6.0                                 | Paid past 5k                                                                                                                              | Stable           |
| Percy                                   | Real screenshots                         | free 5,000/mo; Pro ~$199 (**partially unverified**)                                                | Pricier                                                                                                                                   | Stable           |
| Chromatic                               | Storybook lineage                        | Free 5,000                                                                                         | Playwright integration is **archive-and-re-render** — it cannot see client-drawn WebGL pixels (inference from docs; verify before buying) | Wrong for canvas |
| Lost Pixel                              | OSS                                      | —                                                                                                  | **Archived 2026-04-22**                                                                                                                   | Dead             |

**Verdict — Playwright wins decisively (multi-context multi-client and `page.clock` are the
two features a racing e2e suite cannot do without, and Cypress has neither); runner-up
WebdriverIO only because of its desktop services.** For databases: **Testcontainers for e2e
locally, the runner's preinstalled Postgres in CI, and PGlite as the fast Vitest double** for
SQL-rule tests — three tools, each the best at its layer. Contract tests are subsumed by the
shared Zod schemas from §7; Pact adds ceremony without a WebSocket story. k6 for load. Visual
regression stays _out_ by default (the `window.__game` seam answers "is the lap valid?", which
screenshots cannot); if we ever add it, Argos is the only free-tier service that can see a
canvas. **Current e2e stack is the best choice, with two hardening actions**: add
`--enable-unsafe-swiftshader` to launch args _now_, and use `channel: 'chromium'` plus the
Vulkan/SwiftShader flags if WebGPU e2e is ever needed.

## 15. Test stack, desktop

| Candidate                   | Benefits                                                  | Pros                                                                                                                                               | Cons                                                                                                | Maturity 2026-09  |
| --------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------- |
| **Playwright `_electron`**  | Same tool as web e2e                                      | Launches the packaged main process, exposes `firstWindow()`; Electron docs list it alongside WebdriverIO/Selenium                                  | Labelled "Playwright has **experimental** support for Electron automation" — and has been for years | Works, unpromised |
| `wdio-electron-service`     | Electron API mocking, auto-detects electron-builder/Forge | 9.2.1 (npm 2026-06-05)                                                                                                                             | 39 stars, repo last push 2026-05-06 — slow cadence                                                  | Niche             |
| Tauri `tauri-driver`        | Native WebDriver                                          | crate 2.1.0-alpha.0                                                                                                                                | **Windows and Linux only**: "macOS has no WKWebView driver tool available"                          | Partial           |
| Tauri `@wdio/tauri-service` | Embedded WebDriver server                                 | "no external driver is needed on any platform — and this is how macOS is supported"; `@tauri-apps/api/mocks` (`mockIPC`, `mockWindows`) for Vitest | Ties you to WebdriverIO for desktop while Playwright runs the web suite                             | Newer             |
| Neutralino                  | —                                                         | —                                                                                                                                                  | No documented e2e story                                                                             | Absent            |

**Verdict — Playwright `_electron` wins as long as Electron is the shell (one tool, one
seam, one CI job); runner-up `wdio-electron-service` for Electron-API mocking.** A surprise
worth recording: Tauri's desktop _test_ story on macOS is no longer the blocker the brief
assumed — the WDIO service covers it — so if Tauri v3/CEF ever fixes the Linux rendering
problem, testing would not stand in the way. The `xvfb --no-sandbox --use-angle=swiftshader`
recipe already in the team's memory stays valid. **Current choice is the best choice.**

## 16. CI

| Candidate          | Benefits                       | Pros                                                                                                                                                 | Cons                                                                                                                                                                                                         | Maturity 2026-09 |
| ------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| **GitHub Actions** | Where the repo and issues live | Standard runners **free on public repos**; 2-core Linux $0.006/min otherwise; 10 GB cache/repo; 6 h job limit; matrix sharding for Playwright/Vitest | **"Larger runners are always charged for, even when used by public repositories"**; GPU `gpu-t4-4-core` $0.052/min Linux (≈26× a standard minute, ≈$0.52 per 10-min e2e run), **Team/Enterprise Cloud only** | Mature           |
| Blacksmith         | Drop-in faster runners         | x64 2–32 vCPU **$0.004/min flat**, ARM $0.0025; **3,000 free min/mo**; macOS M4 $0.08                                                                | No GPU                                                                                                                                                                                                       | Mature           |
| Depot              | Fast runners + build cache     | Developer $20/mo (2,000 min, 25 GB cache); 8-core $0.006/min                                                                                         | GPU on Business tier only                                                                                                                                                                                    | Mature           |
| Namespace          | Unit-minute runners            | Team $100/mo                                                                                                                                         | GPU **unverified**                                                                                                                                                                                           | Mature           |
| Buildkite          | Hybrid                         | Free ≤5 users, 2,000 vCPU-min                                                                                                                        | Own agents or hosted $0.004/vCPU-min                                                                                                                                                                         | Mature           |
| GitLab CI          | Alternative                    | Free 400 min                                                                                                                                         | Repo migration for no gain                                                                                                                                                                                   | Mature           |

**Verdict — GitHub Actions wins; runner-up Blacksmith if the 15-minute e2e budget is ever
threatened.** Real-GPU WebGL in CI is _available_ but never free and never on the Free/Pro
plan; SwiftShader on `ubuntu-latest` remains the right trade for a suite that asserts game
state through a seam rather than pixels. Playwright's `--shard` with blob reports and
`merge-reports` (and Vitest's identical trio) is the growth path before paying for faster
runners. Cache `~/.cache/ms-playwright` keyed on the lockfile (already done) and consider
`--only-shell` to shrink it. **Current choice is the best choice.**

---

## 17. Risks, open questions, unverified items

**Risks in the recommended stack**

- **SwiftShader WebGL fallback removal in Chromium** is the one time-bomb: without
  `--enable-unsafe-swiftshader`, headless WebGL context creation "will soon fail". A
  Playwright browser roll could turn the whole e2e suite red overnight.
- **TypeScript 7 has no programmatic API until 7.1**; anything that embeds the compiler
  (typescript-eslint, some Vite plugins, editor tooling) runs on the TS 6 API for now. oxlint
  sidesteps this; Biome uses its own inference. Verify `vitest` and `vite` typecheck plugins
  on TS 7 before flipping.
- **Node 26 LTS** lands 2026-10-28; Node 24 is Active LTS until then. Type stripping is
  erasure-only — no `enum`, no parameter properties in `shared/` or `server/`.
- **Binary pose frame** introduces a versioning concern; put a one-byte schema version at
  offset 0 and keep the Zod-validated JSON path for everything else.
- **Drizzle/Prisma churn**: deliberately avoided. Revisit Drizzle at a real 1.0.

**Frontier-stack blockers (why they are not the default)**

- WebGPU on **Linux** is hardware-gated in Chrome, flag-only in Firefox, compiled out of
  WebKitGTK. Our Linux desktop audience is explicit (ADR-0007).
- WebTransport's HTTP/3 binding is still an Internet-Draft; it needs UDP ingress (Fly/Hetzner
  only among candidates); no k6 support.
- Bun 1.4 and pnpm 12 are both ground-up Rust rewrites shipped within a week of each other
  (2026-08-20 / 2026-08-26). Good direction, wrong month to bet production on.
- Tauri v3's CEF runtime is alpha as of 2026-09-15.

**Open questions**

- Should the plausibility bounds themselves be expressed as fast-check/Hypothesis properties
  in `shared/` so the client physics, server validator and Python env are checked against the
  _same_ property list? (Recommended; not costed.)
- Is a 20 Hz stored trajectory at `float32` precision sufficient for Pacer interpolation, or
  should the stored frame be quantised further? (Storage is ~168 KB per 5-minute lap either
  way; not a cost problem.)
- Whether to adopt Playwright Agents (`init-agents --loop=claude-code`) for spec generation —
  aligns with the Sandcastle pipeline but was not evaluated on this suite.

**Unverified (labelled inline above)**

Babylon tree-shaken sizes; PlayCanvas "new WebGPU renderer" date; Bevy WASM bundle size;
loading Rapier's wasm-bindgen module under `wasmtime-py`; ArkType bundle size; Drizzle
Standard-Schema support; PGlite's Postgres major; Colyseus Cloud plan table beyond the $15
floor; Heroic Cloud pricing; Render pricing; Namespace GPU; Cirrus CI; GitHub GPU-runner plan
eligibility (brief 4 says Team/Enterprise Cloud only — treated as true); Firefox headless
WebGPU on Linux; Chromatic's inability to see canvas pixels (inference from its
archive-and-re-render design); Percy Pro price; Web-Worker timer coverage in `page.clock`;
claims that Three.js will make WebGPU the default "by end of 2026" (third-party only).

---

## 18. Full source list

**Rendering / WebGPU**

- https://github.com/mrdoob/three.js/releases · https://github.com/mrdoob/three.js/releases/tag/r186 · https://threejs.org/docs/pages/WebGPURenderer.html
- https://github.com/BabylonJS/Babylon.js/releases · https://blogs.windows.com/windowsdeveloper/2026/03/26/announcing-babylon-js-9-0/
- https://github.com/playcanvas/engine/releases · PlayCanvas `src/platform/graphics/graphics-device-create.js`
- https://github.com/bevyengine/bevy/releases · https://bevy.org/news/bevy-webgpu/ · https://bevy-cheatbook.github.io/platforms/wasm/size-opt.html (secondary)
- https://github.com/godotengine/godot/releases · https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html
- https://docs.unity3d.com/6000.6/Documentation/Manual/WebGPU-features.html · https://discussions.unity.com/t/webgpu-out-of-experimental-in-unity-6-6/1734694 · https://gist.github.com/aras-p/740c2d4f9977ce92b7de72b1394dd365 (secondary)
- https://github.com/gpuweb/gpuweb/wiki/Implementation-Status · https://caniuse.com/webgpu · https://developer.chrome.com/blog/webgpu-release · https://www.firefox.com/en-US/firefox/147.0/releasenotes/ · https://webkit.org/blog/17333/webkit-features-in-safari-26-0/ · https://github.com/gpuweb/gpuweb/issues/6331

**Physics**

- https://github.com/dimforge/rapier/blob/master/CHANGELOG.md · https://github.com/dimforge/rapier.js · https://rapier.rs/docs/user_guides/javascript/determinism · https://rapier.rs/docs/user_guides/rust/determinism
- https://github.com/jrouwe/JoltPhysics/releases · https://github.com/jrouwe/JoltPhysics.js · https://jrouwe.github.io/JoltPhysics/#deterministic-simulation
- https://github.com/pmndrs/cannon-es/releases · https://pypi.org/project/wasmtime/

**Networking / server / serialization**

- https://www.rfc-editor.org/rfc/rfc6455 · https://datatracker.ietf.org/doc/rfc9220/ · https://datatracker.ietf.org/doc/rfc9297/ · https://datatracker.ietf.org/doc/draft-ietf-webtrans-http3/
- https://caniuse.com/webtransport · https://caniuse.com/mdn-api_websocketstream · https://webkit.org/blog/17862/webkit-features-for-safari-26-4/ · https://developer.mozilla.org/en-US/docs/Web/API/WebTransport_API · https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel
- https://github.com/murat-dogan/node-datachannel/releases · https://github.com/pion/webrtc/releases
- https://github.com/colyseus/colyseus/releases · https://docs.colyseus.io/migrating/0.18 · https://docs.colyseus.io/server/transport/webtransport · https://docs.colyseus.io/state/schema · https://colyseus.io/pricing/
- https://github.com/heroiclabs/nakama/releases · https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/
- https://github.com/clockworklabs/SpacetimeDB/releases · https://spacetimedb.com/pricing
- https://github.com/cloudflare/partykit/blob/main/packages/partyserver/README.md · https://developers.cloudflare.com/durable-objects/best-practices/websockets/ · https://developers.cloudflare.com/durable-objects/platform/limits/ · https://developers.cloudflare.com/durable-objects/platform/pricing/ · https://github.com/cloudflare/workerd/issues/6451
- https://fireworks.ai/blog/fireworks-acquires-hathora · https://gamefabric.com/
- https://nodejs.org/api/typescript.html · https://github.com/nodejs/Release · https://bun.com/blog/bun-v1.4 · https://bun.com/docs/api/websockets · https://deno.com/blog/deno-deploy-is-ga · https://deno.com/deploy/pricing · https://github.com/coder/websocket · https://phoenix.hexdocs.pm/changelog.html
- https://zod.dev/v4 · https://valibot.dev/blog/valibot-v1-the-1-kb-schema-library/ · https://arktype.io/ · https://github.com/sinclairzx81/typebox · https://effect.website/docs/schema/introduction/ · https://standardschema.dev/ · https://github.com/bufbuild/protobuf-es · https://flatbuffers.dev/languages/typescript/ · https://github.com/kriszyp/msgpackr · https://github.com/kriszyp/cbor-x

**Persistence**

- https://www.postgresql.org/about/news/postgresql-18-released-3142/ · https://www.postgresql.org/developer/roadmap/ · https://www.postgresql.org/docs/current/limits.html · https://www.postgresql.org/docs/current/storage-toast.html · https://www.postgresql.org/docs/current/arrays.html
- https://orm.drizzle.team/docs/v0-v1-changes · https://www.prisma.io/blog/is-prisma-8-ready-for-long-lived-production-apps · https://pglite.dev/docs/ · https://github.com/tursodatabase/turso · https://turso.tech/pricing · https://redis.io/legal/licenses/ · https://github.com/valkey-io/valkey/releases
- https://developers.cloudflare.com/r2/pricing/ · https://aws.amazon.com/s3/pricing/ · https://www.tigerdata.com/docs/about/latest/timescaledb-editions

**Language / build tooling**

- https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/ · https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- https://vite.dev/blog/announcing-vite8 · https://pnpm.io/blog/releases/12.0 · https://nx.dev/blog/nx-22-release · https://github.com/oven-sh/bun/issues/23615
- https://biomejs.dev/blog/roadmap-2026/ · https://eslint.org/blog/2026/02/eslint-v10.0.0-released/ · https://oxc.rs/blog/2026-07-22-type-aware-linting-stable · https://oxc.rs/blog/2026-02-24-oxfmt-beta

**Desktop**

- https://releases.electronjs.org/stable · https://playwright.dev/docs/api/class-electron · https://www.electronjs.org/docs/latest/tutorial/automated-testing
- https://github.com/tauri-apps/tauri/releases · https://v2.tauri.app/reference/webview-versions/ · https://v2.tauri.app/plugin/updater/ · https://v2.tauri.app/develop/tests/webdriver/ · https://v2.tauri.app/develop/tests/mocking/ · https://tauri.app/ · https://github.com/tauri-apps/tauri/issues/6381 · https://webkitgtk.org/2026/09/16/webkitgtk-2.54-highlights.html
- https://github.com/neutralinojs/neutralinojs/releases · https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Installing · https://www.webgamedev.com/publishing/desktop (secondary) · https://webdriver.io/docs/desktop-testing/electron/

**RL / inference**

- https://github.com/DLR-RM/stable-baselines3/releases · PyPI: gymnasium, sbx-rl, torchrl, ray, brax, mujoco, gymnax, torch, jax, onnx, onnxruntime, wasmtime
- https://onnxruntime.ai/docs/get-started/with-javascript/web.html · npm `onnxruntime-web` 1.30.0 · npm `@tensorflow/tfjs` 4.22.0 · https://webnn.io/

**Hosting**

- https://docs.railway.com/pricing/plans · https://docs.railway.com/networking/tcp-proxy · https://docs.railway.com/databases/postgresql
- https://fly.io/docs/about/pricing/ · https://fly.io/docs/networking/udp-and-tcp/ · https://fly.io/docs/mpg/
- https://www.hetzner.com/cloud/ · https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/ · https://render.com/docs/websocket
- https://aws.amazon.com/blogs/gametech/free-network-bandwidth-amazon-gamelift-servers-is-here-yes-really/ · https://agones.dev/site/blog/releases/

**Testing**

- https://vitest.dev/blog/vitest-5 · https://vitest.dev/blog/vitest-4 · https://vitest.dev/guide/browser/ · https://vitest.dev/guide/browser/visual-regression-testing · https://vitest.dev/api/vi.html · https://vitest.dev/api/expect.html · https://vitest.dev/guide/cli.html · https://vitest.dev/guide/improving-performance
- https://bun.com/docs/test · https://bun.com/docs/test/mocks · https://bun.com/docs/test/writing · https://nodejs.org/api/test.html · https://github.com/jestjs/jest/releases
- https://github.com/dubzzz/fast-check/releases · https://effect.website/docs/schema/arbitrary/ · https://pypi.org/project/hypothesis/ · https://github.com/stryker-mutator/stryker-js/releases · https://stryker-mutator.io/docs/stryker-js/vitest-runner/ · https://pypi.org/project/mutmut/ · https://docs.pytest.org/en/stable/reference/reference.html#pytest-approx
- https://playwright.dev/docs/release-notes · https://playwright.dev/docs/test-agents · https://playwright.dev/docs/clock · https://playwright.dev/docs/api/class-pageassertions#page-assertions-to-have-screenshot-1 · https://playwright.dev/docs/browser-contexts · https://playwright.dev/docs/browsers · https://playwright.dev/docs/test-sharding · https://playwright.dev/docs/docker
- https://docs.cypress.io/app/references/changelog · https://docs.cypress.io/app/references/trade-offs · https://webdriver.io/docs/api/webdriverBidi/
- https://developer.chrome.com/docs/chromium/headless · https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md · https://developer.chrome.com/blog/supercharge-web-ai-testing · https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips
- https://argos-ci.com/pricing · https://www.chromatic.com/docs/playwright/ · https://www.browserstack.com/docs/percy/overview/plans-and-billing · https://github.com/lost-pixel/lost-pixel
- https://node.testcontainers.org/modules/postgresql/ · https://github.com/leinelissen/embedded-postgres · https://github.com/oguimbal/pg-mem · https://docs.pact.io/implementation_guides/javascript/docs/messages
- https://github.com/grafana/k6/releases · https://grafana.com/docs/k6/latest/javascript-api/k6-experimental/websockets/ · https://www.artillery.io/docs/reference/engines/websocket

**CI**

- https://docs.github.com/en/billing/reference/actions-runner-pricing · https://docs.github.com/en/actions/reference/runners/larger-runners · https://docs.github.com/en/actions/reference/limits
- https://depot.dev/pricing · https://www.blacksmith.sh/pricing · https://namespace.so/pricing · https://buildkite.com/pricing/ · https://about.gitlab.com/pricing/
