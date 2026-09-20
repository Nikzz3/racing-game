# Research: Best technology stack for "Sunset Ridge Racing" in September 2026 (independent, blind evaluation)

This document was produced **blind to the existing implementation**. The author did not read any source code, package manifests, configuration, ADRs or prior research in this repository, and did not try to infer what the product is currently built with. Every recommendation below derives only from the technology-neutral requirements restated in §2 and from primary sources fetched on 2026-09-20 (official docs, release notes, GitHub releases/tags, npm/PyPI registry data, MDN/caniuse/Chrome Platform Status, WebKit/Mozilla release notes, IETF specs, first-party pricing pages). Where a claim rests on a blog post, forum thread or inference it is marked **secondary** or **unverified**. Version numbers and dates were re-checked against the npm registry, PyPI and the GitHub Releases API on the research date. The research was parallelised across four sub-agents under the same independence rules; the two places where they disagreed (which libm V8 uses; which Playwright file injects the SwiftShader flag) were re-verified directly against the source files and are reported with the corrected finding.

## Primary sources, pinned (research date 2026-09-20)

| Source | Pinned at |
|---|---|
| three.js | r186 (`three@0.186.0`, 2026-09-08) |
| Babylon.js | `@babylonjs/core@9.27.1` (2026-09-18) |
| PlayCanvas engine | v2.22.2 (2026-09-11) |
| Godot | 4.7.2-stable (2026-08-18); web export docs (WebGL 2 only, no WebGPU) |
| gpuweb Implementation Status wiki | edited 2026-08-13 |
| Chrome WebGPU blogs | Chrome 144 (Linux Intel Gen12+, 2026-01-07), Chrome 146 (compat mode, 2026-02-25), Chrome 147-148 (Linux NVIDIA Wayland, updated 2026-04-22) |
| Chromium `docs/gpu/swiftshader.md` | main branch (SwiftShader fallback deprecated from Chrome 130; `--enable-unsafe-swiftshader` opt-in) |
| Mozilla Gfx blog | WebGPU on Windows in Firefox 141 (2025-07-15) |
| WebKit blog | Safari 26.0 features (2025-09-15, WebGPU); Safari 26.4 features (2026-03-24, WebTransport) |
| ECMA-262 §21.3.2 (Math) | "implementation-approximated" transcendental functions; `Math.sqrt` exact |
| V8 `src/base/ieee754.cc` | main branch: `sin/cos/tan/atan2/exp/log/pow/cbrt` → `LIBC_NAMESPACE::shared::*` (llvm-libc); `tanh` → `std::tanh` |
| CPython `math` docs | "thin wrappers around the platform C math library functions" |
| WebAssembly core spec, Numerics + design/Nondeterminism.md | IEEE-754 RNE; only NaN payloads nondeterministic |
| Rapier | `@dimforge/rapier3d@0.20.0` (2026-08-08); `rapier3d` crate 0.35.3; determinism docs; README "Python bindings under development" (PyPI packages not found) |
| PyO3 / maturin / wasm-bindgen / wasmtime | 0.29.2 / 1.15.0 / 0.2.128 / 48.0.2 (PyPI `wasmtime` 48.0.0) |
| Electron | v44.4.3 (2026-09-18; Chromium 152, Node 24.21) |
| electron-builder / electron-updater | 26.15.3 `latest` (26.16.1 on `v26`, 2026-09-07) / 6.8.9 (2026-06-05) |
| Tauri | crate 2.11.6, CLI 2.11.5 (2026-09-19/20); `tauri-plugin-updater` 2.12.0; v3.0.0-alpha.1 tagged 2026-09-15; "Linux Graphics Issues" page |
| WebKitGTK | 2.54.0 (2026-09-16) release notes (no WebGPU) |
| Playwright | v1.63.0 (2026-09-04; Chromium 153, Firefox 155, WebKit 26.6); `chromium.ts` pushes `--enable-unsafe-swiftshader` |
| WebdriverIO / wdio-electron-service / tauri-driver / Spectron | 9.31.9 / 9.2.1 (2025-10-24) / 2.0.6 pre-alpha / deprecated 2022-02-01 |
| RFC 6455, RFC 7692 | WebSocket; permessage-deflate |
| caniuse / MDN BCD | WebTransport: Chrome 97, Firefox 114, Safari 26.4 (Baseline newly available 2026-03); WebGPU Safari 26 partial, ~87% global |
| `ws` / Socket.IO / uWebSockets.js / Colyseus / PartyServer / Nakama / Rivet | 8.21.3 / 4.8.3 / 20.71.0 / 0.18.6 / 0.5.10 / 3.41.0 / 2.3.17 |
| Cloudflare Durable Objects, Workers, D1, R2 pricing pages | DO on Free plan; 20:1 WS message billing; Workers Paid $5; R2 free 10 GB-month, egress free |
| Node.js release schedule | v24 LTS (maintenance 2026-10-20, EOL 2028-04-30); v26 LTS on 2026-10-28 (EOL 2029-04-30) |
| Bun / Deno / Go / Rust / Phoenix | 1.4.2 / 2.9.7 / 1.27.1 / 1.98.1 / 1.8.14 |
| Zod / Valibot / ArkType / TypeBox / protobuf-es / msgpack / cbor-x | 4.6.5 / 1.5.0 / 2.2.3 / 0.34.52 / `@bufbuild/protobuf` 2.15.0 / 3.1.3 / 1.6.6 |
| Hono / tRPC / oRPC / ts-rest | 4.13.8 / 11.19.0 / 1.15.2 (2.0 beta) / 3.52.1 (stale since 2025-03) |
| PostgreSQL | 18.6 (2026-08-13); 19 Beta 3, GA planned Sept 2026; TOAST docs |
| SQLite / `node:sqlite` / better-sqlite3 / PGlite / Testcontainers | 3.53.4 / Stability 1.2 RC in Node 24 & 26 / 13.0.3 / 0.5.8 (alpha badge) / 12.1.0 |
| Drizzle ORM / Prisma / Kysely / pg | 0.45.2 (1.0.0-rc.4) / 7.10.0 (`latest` = 8.0.0-rc.15) / 0.29.6 / 8.23.0 |
| Litestream | v0.5.17 (2026-08-31) |
| TypeScript | 7.0.2 GA (2026-07-08, native Go compiler; no programmatic API until 7.1); 6.0.3 bridge; `@typescript/typescript6` 6.0.2 |
| Node TypeScript support | type stripping Stable (v24.12/v25.2); `--experimental-transform-types` removed in v26.0 |
| Vite / Rolldown / esbuild / Rspack | 8.3.0 (Rolldown default since 8.0, 2026-03-12) / 1.2.9 / 0.28.2 / 2.2.6 |
| pnpm / Turborepo / Nx | 12.5.1 / 2.11.2 / 23.2.1 |
| oxlint / oxlint-tsgolint / oxfmt / Biome / ESLint / typescript-eslint / Prettier | 1.83.0 / 7.0.2002 / 0.68.0 / 2.5.14 / 10.11.0 / 8.70.0 (TS `<6.1.0`) / 3.9.8 |
| Vitest / fast-check / StrykerJS / `@vitest/coverage-v8` | 5.0.1 / 4.10.2 / 10.0.0 / 5.0.1 |
| Python / uv / ruff / pyright / pytest / Hypothesis / mutmut | 3.14.7 (3.15.0 due 2026-10-01) / 0.12.17 / 0.16.8 / 1.1.414 / 9.1.1 / 6.168.0 / 3.8.0 |
| Gymnasium / Stable-Baselines3 / PyTorch / JAX / NumPy / PufferLib / TorchRL | 1.3.0 / 2.9.0 / 2.14.0 / 0.11.2 / 2.5.3 / 3.0.0 on PyPI (2025-06-23, pins numpy<2) / 0.14.0 |
| ONNX Runtime Web / TensorFlow.js / WebNN | 1.30.0 / 4.22.0 (2024-10-21, no release since) / disabled by default in Chrome 112-156 |
| k6 / Artillery / Locust | v2.2.0 (2026-08-10; `k6/websockets` stable since v1.6.0) / 2.0.34 / 2.46.6 |
| Argos / Percy / Lost Pixel / Chromatic | 5,000 free screenshots/mo / 5,000 free / archived / DOM-archive model |
| GitHub Actions billing & runner pricing | 2,000 free min/mo private; Linux $0.006, Windows $0.010, macOS $0.062 per min; arm64 free on public repos |
| Fly.io / Hetzner / Railway / Render / DigitalOcean / Oracle / Cloudflare pricing | shared-cpu-1x 512 MB $3.19-5.16 by region; CX23 €5.49 (EU only) & CPX11 US €17.49 after 2026-06-15 repricing; Hobby $5; Starter $7; $4/$6 droplets; Always Free halved 2026-06-15; Workers Paid $5 |
| Neon / Supabase / Turso / PlanetScale / D1 pricing | Free 0.5 GB & 100 CU-h / Free pauses after 1 week / Free 5 GB / PS-5 $5, no free tier / Free 5 GB, 500 MB per DB |
| Hathora | acquired by Fireworks AI 2026-03-04, platform shut down (**secondary**: GamesBeat, Fireworks blog; pricing URL now redirects to GameFabric) |

> **Headline for our decision.** Build the whole product in one TypeScript monorepo: a **three.js (r186) WebGL2-first client** with the WebGPU renderer as a per-platform enhancement, a **hand-rolled deterministic kinematic car model** whose hot path uses only IEEE-754 `+ − × ÷ √` (no `Math.sin`-family calls) so that a **mechanically mirrored NumPy port is bit-identical** and can be golden-tested exactly, a **Node 24→26 LTS relay server on plain `ws`** that batches 24-byte `DataView` poses into one 30 Hz snapshot per room and validates finished laps for plausibility, **SQLite (better-sqlite3 today, `node:sqlite` when it leaves RC) + Drizzle + Litestream→R2** for the leaderboard and gzip-packed int16 trajectory blobs, **Electron 44 + electron-builder/electron-updater** with AppImage/deb/rpm/DMG/NSIS fed from GitHub Releases (Tauri is rejected because WebKitGTK's documented WebGL and missing-WebGPU story fails the explicit Linux audience), **Gymnasium 1.3 + Stable-Baselines3 2.9 PPO** on a batched NumPy env with weights exported to a Float32Array and executed by a ~50-line TypeScript MLP in the browser, all tested with **Vitest 5 + fast-check**, **pytest + Hypothesis**, **Playwright 1.63 under SwiftShader** (WebGL2, multi-context rooms, `window.__game` test hook, temp-file SQLite per run, `toHaveScreenshot` with CI-only baselines), **k6 2.2 `k6/websockets`** load tests, Playwright `_electron` for the desktop smoke, and **GitHub Actions**, hosted on **one Fly.io `shared-cpu-1x` 512 MB machine (≈$5/month all-in)** with Cloudflare Durable Objects as the runner-up host. TypeScript 7 (native), Vite 8 (Rolldown), pnpm 12 + Turborepo 2, and oxlint+tsgolint+oxfmt are the tooling. Total recurring cost ≈ $5/month plus $99/year Apple signing.

---

## 1. Headline tables

### 1a. Recommended stack (ship this)

| Layer | Choice | Runner-up |
|---|---|---|
| 3D rendering | **three.js r186**, `WebGLRenderer` baseline; `three/webgpu` `WebGPURenderer` (auto-falls back to WebGL2) enabled where the browser supports it | Babylon.js 9.x (most complete WebGPU backend, semver, TS-first) |
| Client physics | **Hand-rolled kinematic model in TypeScript**, fixed timestep, integer ticks, transcendental-free hot path (shared polynomial `sinCos`/`atan2`), mirrored 1:1 in NumPy with exact golden tests | Single Rust source → wasm (browser) + same wasm via `wasmtime-py` (trainer) |
| Realtime transport & netcode | **WebSocket (`ws` 8.x)**, client-authoritative poses at 30 Hz, server batches one binary snapshot per room tick, ~100 ms entity interpolation + 1-tick dead reckoning, hand-rolled reconnect | Same room code inside one Cloudflare Durable Object per room via PartyServer; Colyseus 0.18 if ever server-authoritative |
| Server runtime & language | **Node.js 24 LTS → 26 LTS (2026-10-28), TypeScript run via native type stripping** | Bun 1.4.x (single binary, built-in WS pub/sub) |
| Schema / validation / wire | Hot path: **hand-packed `DataView`, 24 B/pose**, in a shared `protocol` package; control path: **JSON + Zod 4 + Hono 4 RPC** | `@bufbuild/protobuf` 2.15 for the hot path; tRPC 11 for control |
| Persistence | **SQLite** (`better-sqlite3` 13 now; `node:sqlite` when Stable) + **Drizzle ORM** + **Litestream 0.5 → Cloudflare R2**; `lap` table + `lap_trajectory` BLOB (int16 delta + gzip, ~10 KB/lap) | PostgreSQL 18 (PlanetScale PS-5 $5 or Neon Free) + Drizzle + `pg`, BYTEA `STORAGE EXTERNAL` |
| Language & build tooling | **TypeScript 7.0 (native)**, **Vite 8 (Rolldown)**, **pnpm 12 workspaces + Turborepo 2.11**, **oxlint 1.83 + oxlint-tsgolint (type-aware) + oxfmt 0.68**; Python side **uv + ruff + pyright** | Biome 2.5 (one binary, one config; typed rules still nursery) |
| Desktop packaging | **Electron 44 + electron-builder 26 + electron-updater 6**, GitHub Releases feed; AppImage (auto-updates) + deb/rpm (update downloaded, pkexec install), DMG (signed+notarized), NSIS | Tauri 2.x (only if download size outweighs Linux GPU fidelity); ship an installable PWA regardless |
| RL pipeline & inference | **Gymnasium 1.3 + Stable-Baselines3 2.9 PPO on PyTorch 2.14**, batched NumPy `VectorEnv` port of the TS tick; export `state_dict()` → JSON/Float32Array; **hand-rolled TS MLP** inference | CleanRL single-file PPO (copied); ONNX Runtime Web 1.30 wasm EP if the policy outgrows an MLP |
| Hosting | **Fly.io `shared-cpu-1x` 512 MB** in one region near players + 1 GB volume + Litestream→R2 ≈ **$5/month** | Cloudflare Workers Paid $5 + Durable Objects + D1 ≈ $7/month (≈$0 on Free for a beta) |
| Unit / integration tests | **Vitest 5 + fast-check 4**, `@vitest/coverage-v8`; **pytest 9 + Hypothesis 6**; JSON golden fixtures asserted bit-exact both ways; StrykerJS 10 / mutmut 3.8 on physics + validator packages only | `node:test` for the server package (zero deps; coverage still experimental) |
| E2E / visual / load | **Playwright 1.63** Chromium with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`, WebGL2 in CI, `browser.newContext()` per player, `window.__game.step(n)` hook, temp-file SQLite per run, `toHaveScreenshot` with CI-generated baselines; **k6 2.2 `k6/websockets`** | WebdriverIO 9 multiremote + Argos + Artillery |
| Desktop tests | **Playwright `_electron.launch` against the packaged app under `xvfb-run`** + a `--smoke` self-test flag run on the final AppImage/.exe/.app | WebdriverIO + `@wdio/electron-service` |
| CI | **GitHub Actions** (public repo → unlimited standard minutes; private → 2,000 min/mo), Linux-only PR CI, 3-OS desktop matrix on tags only, Renovate | Blacksmith (3,000 free min/mo, drop-in `runs-on`) |

### 1b. Frontier stack (what I would build if I were willing to absorb 2026-2027 churn)

| Layer | Choice | Runner-up |
|---|---|---|
| Rendering | three.js `WebGPURenderer` + TSL as the only renderer, WebGL2 via `forceWebGL` only in CI | Babylon.js WebGPU engine (native WGSL shaders) |
| Physics | One Rust crate → wasm (browser) + PyO3/maturin extension (trainer), `libm` crate pinned on both targets, state hashes for rollback | AssemblyScript → wasm run via `wasmtime-py` |
| Transport | WebTransport datagrams (Safari 26.4 closed the gap) via Go `quic-go/webtransport-go` or Colyseus 0.18 `.unreliable()`, WebSocket fallback | WebRTC DataChannels via geckos.io |
| Server & hosting | Cloudflare Durable Object per room (PartyServer) + D1 + R2, `locationHint` per room, Workers Paid $5 | Bun 1.4 single binary on Fly |
| Desktop | Tauri 3 (alpha as of 2026-09-15) once WebKitGTK ships WebGPU/GPU-process WebGL by default | Electrobun 2 |
| Inference | ONNX Runtime Web WebGPU EP; WebNN when Chrome ships it | hand-rolled MLP |
| Tooling | oxlint `--type-check` replacing `tsc --noEmit`; Vitest 5 browser mode (Playwright provider) for renderer unit tests; Astral `ty` for Python | Biome 2.5 |

---

## 2. Requirements restated (technology-neutral)

- Desktop-browser 3D arcade racer; players pick a name and a cosmetic car, then create/join a **Room** with a fixed **Track** (closed circuit, ordered invisible checkpoints) and **Difficulty** (named physics rule set). 2-8 players per room see each other move live.
- Kinematic arcade car model, fixed simulation timestep, **deterministic and portable**: the same physics drives an offline RL training environment; browser/trainer parity is a hard requirement.
- **Leaderboard**: fastest lap per (Track, Difficulty, driver), persisted globally. Uploads on lap completion include the lap time and a trajectory (pose every ~50 ms: position, heading, speed, timestamp). The server does not re-simulate; it validates plausibility (bounded speed, no teleports, checkpoints in order) and silently drops failures.
- **Replays** (chase camera over interpolated stored poses) and **Pacers** (a stored lap or the AI reference lap replayed live in a room as a translucent, non-colliding car).
- **AI opponent**: RL policy trained offline against a port of the physics; the resulting small MLP (10^3-10^4 params) runs in the browser to produce the reference lap on demand.
- **Desktop installers** for macOS, Windows and Linux with auto-update, wrapping the same web client; Linux is an explicit audience.
- **Scale/team**: tens of concurrent players; one developer heavily assisted by AI coding agents; hosting well under $50/month including a database; no ops team; agent-friendliness (documented, conventional, statically typed, fast feedback) matters a lot.
- **Testing**: fast unit tests (physics, plausibility, server logic); property-based tests; cross-language physics parity; E2E launching the real client headless on GPU-less CI, driving a deterministic lap, joining multiple clients to one room, asserting on 3D state (canvas opaque to DOM); ephemeral DB per E2E run; optional visual regression; realtime load testing; desktop smoke test; hosted CI with a reasonable free tier.

---

## 3. Dimension-by-dimension evaluation

### 3.0 Cross-cutting: WebGPU vs WebGL readiness, September 2026

This gates the rendering, desktop and E2E decisions, so it comes first.

| Platform | WebGPU status (primary sources) |
|---|---|
| Chrome/Edge on Windows x64, macOS, ChromeOS | Shipped since Chrome 113 (May 2023). |
| **Chrome on Linux** | **Not on by default in general.** Chrome 144 (2026-01-07) enabled it for Intel Gen12+ only; Chrome 147 added NVIDIA (driver ≥535.183.01, **Wayland only**). AMD and everything else still need `--enable-unsafe-webgpu --ozone-platform=x11 --use-angle=vulkan --enable-features=Vulkan,VulkanFromANGLE`. |
| Firefox | Windows since 141 (2025-07-15); macOS Apple Silicon since 145/147; **Linux: Nightly only** (gpuweb issue #6331 shows 152 working behind `dom.webgpu.enabled`; not shipped as of 155.0.1). |
| Safari | 26.0 (2025-09-15) on macOS 26 / iOS 26; WebKit says WebGPU "supersedes WebGL … preferred for new sites". caniuse still marks desktop Safari 26.x "partial"; WebKit bug 299237 reports `navigator.gpu` undefined on macOS 15 Sequoia with Safari 26.0.1, so it effectively requires macOS 26. |
| WebGPU compatibility mode (GLES 3.1 class) | Shipped in Chrome 146 (2026-02-25), **Android only**. |
| Global support (caniuse) | ~87% of users, heavily skewed by mobile Chrome; the Linux desktop share is where it is missing. |
| Headless / GPU-less CI | Chromium deprecated automatic SwiftShader fallback for WebGL from Chrome 130 and now requires `--enable-unsafe-swiftshader` (Chromium `docs/gpu/swiftshader.md`). Playwright's `chromium.ts` pushes that flag unconditionally (verified in source). Software **WebGPU** via `--use-webgpu-adapter=swiftshader` is documented only in secondary write-ups and reported flaky/black-canvas in headless (Electron #38189) — **unverified against a primary Chromium/Dawn doc; treat as unreliable**. |

**Consequence:** for a desktop game with an explicit Linux audience in 2026, WebGPU cannot be a baseline. WebGL2 is the floor; WebGPU is a progressive enhancement; CI renders on WebGL2 under SwiftShader.

### 3.1 3D rendering engine / game framework

| Candidate | Benefits | Pros | Cons | Maturity 2026-09 |
|---|---|---|---|---|
| **three.js** (+ optional R3F/drei) | Thin renderer around a loop you own; largest ecosystem; ESM tree-shakeable | `WebGPURenderer` from `three/webgpu` "tries to use a WebGPU backend … If not … falls back to a WebGL 2 backend" with a `forceWebGL` option (JSDoc in source); TSL emits WGSL or GLSL; `WebGLRenderer` rock-solid under SwiftShader; enormous agent training corpus | No semver (r-numbers, monthly breaking changes); no editor; TSL is a second shader dialect; R3F pins React 19 and puts a reconciler between the sim loop and rendering (keep sim state out of React) | r186 (2026-09-08), monthly cadence, 100+ commits/30 days; R3F 9.7.0, drei 10.7.8 |
| Babylon.js | Batteries included: loaders, GUI, Inspector, physics plugins (Havok/cannon/ammo), NullEngine for Node | Most mature WebGPU backend among JS engines ("implementation … complete", shaders in native WGSL since 2024); semver; TypeScript-first; fast issue turnaround | Heavier bundle; opinionated scene graph; cannot swap WebGPU↔WebGL after scene creation (you write the `WebGPUEngine.IsSupportedAsync` fallback) | 9.27.1 (2026-09-18), very frequent patches |
| PlayCanvas engine | Game-oriented, MIT engine on npm, WebGPU with "seamless fall back" (marked Beta) | Null device for Node; vehicle examples | Ecosystem strength is the SaaS editor; engine-only usage less documented; still carrying device-specific WebGPU→WebGL fallbacks (issue #8874, June 2026) | 2.22.2 (2026-09-11) |
| Godot 4 web export | Real editor, MIT | Decent 3D | "Godot 4 can only target WebGL 2.0 (Compatibility)"; "does not support WebGPU"; C# cannot export to web; sim lives in GDScript/C++ so no TS/Python parity; desktop = Godot exporter, not the same web client | 4.7.2 (2026-08-18) |
| Unity 6 Web | Editor, asset store | Runtime Fee cancelled | WebGPU still "(Experimental)" in 6.2/6.3 manuals; C#; huge wasm builds; editor licence on CI; no TS parity | 6.3 LTS |
| Bevy (Rust/wasm) | Rust everywhere (synergy with a Rust physics core) | ECS, modern | `webgpu` feature overrides `webgl2` — one backend per wasm build, no runtime fallback; every release breaking; weak UI/tooling; lower agent velocity | 0.19.1 (2026-08-13), 0.20 RC |
| Raw WebGL/WebGPU | Total control | None for a solo dev | Writing a renderer | — |

**Verdict: three.js.** It is the smallest, best-documented surface for "I own a fixed-timestep loop and need a renderer", its WebGL2 path is exactly what SwiftShader CI can run, and its WebGPU path lights up automatically where available. Use plain three.js for the sim/render core; adopt R3F+drei only for menus/HUD if you already want React. **Runner-up: Babylon.js** — pick it if you would rather have a semver'd, TS-first, batteries-included toolkit and the most complete WebGPU backend today. Godot/Unity/Bevy are rejected by the "same web client wrapped for desktop" and "TS/Python physics parity" constraints.

### 3.2 Client physics approach (determinism + trainer parity)

Floating-point facts that decide this dimension (all primary):

- ECMA-262 §21.3.2: `Math.sqrt` returns the exact IEEE square root; `sin/cos/tan/atan2/exp/log/pow/cbrt/hyperbolics` return "an implementation-approximated Number value" — fdlibm is only "recommended (but not specified)".
- **V8 `src/base/ieee754.cc` today delegates `acos/asin/atan/atan2/cos/sin/tan/exp/log/log2/log10/log1p/expm1/cbrt/pow` to llvm-libc** (`LIBC_NAMESPACE::shared::*`) and `tanh` to `std::tanh`; the "adapted from fdlibm" line is a legacy header comment. (One sub-agent reported "fdlibm"; re-verified against the file: llvm-libc.)
- CPython `math`: "thin wrappers around the platform C math library functions" — glibc/musl/Apple libm/MSVCRT; NumPy additionally dispatches SIMD kernels per CPU.
- **Therefore `Math.sin` (V8 → llvm-libc) and `math.sin`/`np.sin` (platform libm/SIMD) are not guaranteed bit-identical.** IEEE-754 `+ − × ÷ √` and comparisons are, in every engine, as long as operation order is identical and nobody contracts an FMA (V8, NumPy and Rust do not by default).
- WebAssembly spec (Numerics): IEEE-754, round-to-nearest-even; nondeterminism confined to NaN payloads — wasm f64 code is bit-deterministic if NaNs never enter state.

| Candidate | Benefits | Pros | Cons | Maturity 2026-09 |
|---|---|---|---|---|
| **(a) Hand-rolled TS model, mirrored NumPy port, golden parity tests** | Zero toolchain; both sides readable by agents; kinematic car is ~200 lines | Exact-equality tests are achievable if the hot path uses only `+ − × ÷ √` plus a shared polynomial/table `sinCos`/`atan2` (or unit-vector heading updated by small-angle rotation) implemented identically in both languages; fixed dt, integer tick ids, NaN guards, quantised inputs | Two sources of truth (mitigated by CI golden tests on every change to either side); discipline needed to keep `Math.*` out of the tick | n/a |
| (b) One Rust crate → wasm (browser) + PyO3/maturin or `wasmtime-py` (trainer) | One physical source; spec-level determinism in wasm | Running the *same wasm* in Python via `wasmtime` 48 gives bit-identity for free; PyO3 native build is fastest but native `f64::sin` uses the platform libm — you must use the `libm` crate on both targets | Rust + wasm-bindgen + maturin in CI; two artifacts; wasm↔JS boundary in the browser hot loop; lower agent velocity than TS | PyO3 0.29.2, maturin 1.15.0, wasm-bindgen 0.2.128, wasmtime 48.0.2 / PyPI 48.0.0 — all current |
| (c) One TS implementation executed by the trainer via Node/Bun subprocess | No duplication; V8-in-browser == V8-in-Node | Bit-identical across Chrome/Electron/Node | Firefox/Safari still not spec-guaranteed; IPC per batch; awkward with Python RL libs; Javy/QuickJS far too slow, AssemblyScript is a different dialect (a port anyway) | Node 24 LTS, Bun 1.4.2 |
| (d) Engine physics library (Rapier / Jolt / cannon-es / Ammo) matched in Python | Rigid-body features | Rapier wasm is "fully cross-platform deterministic" (`enhanced-determinism` feature); Jolt has `CROSS_PLATFORM_DETERMINISTIC` | A kinematic arcade car needs no solver; **Rapier's README says Python bindings are "under development" but none of the four named packages exist on PyPI (checked 2026-09-20)**; Jolt has no official Python bindings; cannon-es unmaintained since 2022; Ammo↔PyBullet are different Bullet builds | Rapier JS 0.20.0 (2026-08-08); JoltPhysics.js 1.1.0; cannon-es 0.20.0 (2022) |

**Verdict: (a) hand-rolled deterministic kinematic model in TypeScript, mirrored in NumPy, with the determinism rules baked in (no `Math.sin/cos/atan2/exp/pow` in the step; shared explicit polynomial approximations; f64 everywhere; fixed dt; integer ticks; NaN guards).** Under those rules both sides execute only correctly-rounded operations and the golden tests assert exact equality. It is the cheapest option for a solo dev with agents, keeps Rust out of the critical path, and the batched NumPy port doubles as the RL vector env (§3.9). Version the physics (`physics_ver`) and store it with every lap. **Runner-up: (b) Rust → wasm, with the trainer running the same wasm via `wasmtime-py`** — the only option with a spec-level single-source guarantee; move to it if the model grows toward rigid-body/contact or you want hash-checked rollback netcode. Keep (c) as a cheap parity oracle (`node replay.js fixtures.json`), never as the training env. Reject (d).

### 3.3 Realtime transport and netcode model

Workload sized for the worst realistic case: 8 cars × 30 Hz = 240 pose messages/s uplink per room; naïve relay = 1,680 msgs/s downlink; batched = 240 snapshots/s. Fleet: 3-5 rooms at peak; ~360 room-hours/month.

| Candidate | Benefits | Pros | Cons | Maturity 2026-09 |
|---|---|---|---|---|
| **WebSocket (RFC 6455) via `ws`** | Universal; 2-6 B frame overhead; every host supports it | Boring in the good way; ~150 lines for rooms; head-of-line blocking is tolerable behind a 100 ms interpolation buffer on desktop networks | TCP HoL blocking on loss; no unreliable channel | `ws` 8.21.3 (2026-08-07), MIT |
| WebTransport (HTTP/3) | Unreliable datagrams — ideal pose semantics | **Baseline "newly available" since 2026-03** (Chrome 97, Firefox 114, **Safari 26.4** 2026-03-24); 91% global | Node has no native support (`@fails-components/webtransport` 1.6.8 self-describes as "duct tape"); Bun has HTTP/3 experimental but no WebTransport (issue #13656 open); needs real TLS + UDP port, which rules out most cheap PaaS; still need a WS fallback | Go `quic-go/webtransport-go` v0.13.0 (2026-08-30) is the mature server |
| WebRTC DataChannel (geckos.io) | UDP-like, unordered | Baseline since 2020; `@geckos.io/server` 3.1.0 | Signalling + STUN/TURN + UDP port range exposed; README warns off users without port-forwarding experience; TURN doubles infra | node-datachannel 0.33.4 (2026-09-12) |
| Socket.IO | Rooms, acks, reconnect | Familiar | Engine.IO + JSON framing wrong for a binary hot path; binary needs placeholders | 4.8.3 |
| Colyseus | Server-authoritative rooms, binary delta state sync, `t.quantized()`/`t.angle()`, WebTransport + `.unreliable()` experimental, "prediction-ready netcode" in 0.18 | MIT; active (0.18.6 2026-09-16); Cloud from $15/mo | More framework than a relay needs; pushes you to server-owned state you do not have | 0.18.6, `@colyseus/schema` 5.0.33 |
| Cloudflare Durable Objects + PartyServer | One DO = one room; WebSocket Hibernation; `locationHint`; **DOs available on the Workers Free plan** | Near-zero ops; TS end-to-end; docs recommend batching 10-100 messages per 50-100 ms (exactly the tick batching you'd do anyway); 20:1 incoming-message billing makes it cheap | Not Node (no `ws`, no raw sockets); deploy drops all sockets; ~1k req/s soft limit per object | partyserver 0.5.10 (2026-08-03); PartyKit CLI effectively superseded |
| Nakama | Full game backend | Apache-2.0, 3.41.0 (2026-09-18) | Needs Postgres/CockroachDB + custom runtime; overkill | active |
| Rivet | Actor model, single Rust binary self-host | Free $5 cap, Hobby $20 | Smaller ecosystem than DOs | 2.3.17 |
| Hathora | — | — | **Dead**: acquired by Fireworks AI 2026-03-04, platform shut down after 90 days (**secondary** sources; pricing URL now redirects to GameFabric) | — |
| Supabase Realtime / Ably / Pusher / Liveblocks | Managed pub/sub | Easy | Message-rate pricing: one 8×30 Hz room-hour ≈ 6.9 M messages ≈ $17 on Ably; Supabase Pro caps at 500 msgs/s; Liveblocks 10 conns/room | unsuitable |

**Netcode model (opinionated):** client-authoritative pose broadcast at 30 Hz; server keeps the latest pose per car and emits one binary snapshot per room per 30 Hz tick; clients render remote cars ~100 ms in the past, lerp between bracketing snapshots, dead-reckon at most one tick on heading/speed (Valve "Source Multiplayer Networking" and Gambetta "Entity Interpolation", **secondary but canonical**); server does lap plausibility only (monotonic checkpoints, per-segment minimum time, speed/acceleration envelope, timestamp sanity). Do **not** enable permessage-deflate (RFC 7692) on the pose channel — 24-200 B payloads gain nothing and it adds per-connection window memory. A 60-line ring-buffer interpolator is easier for an agent to own than `@geckos.io/snapshot-interpolation` (1.1.1, 2025-02).

**Verdict: plain WebSocket on `ws`, hand-written room relay, binary poses, server-side 30 Hz batching, 100 ms interpolation, home-grown backoff reconnect.** **Runner-up: the same room code hosted as one Durable Object per room (PartyServer)**, or Colyseus 0.18 if you ever move physics server-side. Keep WebTransport datagrams as a 2027 upgrade behind the same codec once Node/Bun ship it natively.

### 3.4 Server runtime and language

| Candidate | Benefits | Pros | Cons | Maturity 2026-09 |
|---|---|---|---|---|
| **Node.js + TypeScript** | Shared types with the client end-to-end; largest agent corpus; every host | **Type stripping is Stable** (v24.12/v25.2): `node server.ts` with no build step (erasable syntax only: no enums/namespaces/decorators/parameter properties); `node:sqlite` built in (RC) | Slowest raw WS throughput of the group (irrelevant at 1-2k msgs/s); no polished single-binary | v24 LTS (maintenance 2026-10-20, EOL 2028-04-30); **v26 becomes LTS 2026-10-28** (EOL 2029-04-30) |
| Bun | Built-in `Bun.serve` WS with topic pub/sub, backpressure codes; `bun:sqlite`; `bun build --compile` single executables | Fastest TS iteration; 7× WS throughput claim (first-party) | 1.4 (2026-08-20) is a major rewrite followed by two hot-fix releases in September; not on Cloudflare; fewer agent examples of `Bun.serve` idioms | 1.4.2 |
| Deno | Good TS story | `Deno.serve` WS | Deno Deploy recycles isolates after 5 s-10 min idle and SIGINTs sockets on redeploy — wrong shape for rooms; no advantage self-hosted | 2.9.7 |
| Go | Best static binary; best WebTransport story; goroutine-per-conn relay | `coder/websocket` 1.8.15 active (gorilla dormant since 2024) | No shared client types without codegen; second language for one dev | 1.27.1 |
| Rust (axum + tokio-tungstenite) | Peak perf | — | Slowest iteration; perf irrelevant here | 1.98.1, axum 0.8.9 |
| Elixir / Phoenix Channels | Purpose-built process-per-room + PubSub | Elegant | Different language, smaller agent corpus, JSON-default serializer | Phoenix 1.8.14 |
| Cloudflare Workers / DO | Rooms map 1:1 to actors; free-plan viable | TS stays | Not Node; deploy drops connections | — |
| Python (FastAPI + websockets) | Same language as the trainer | — | Two type systems, no shared client types, asyncio single-core | 3.14.7, FastAPI 0.141.1 |

**Verdict: Node.js 24 LTS → 26 LTS, TypeScript run directly via type stripping**, with a shared `protocol` package (codec + Zod schemas) imported by client and server. **Runner-up: Bun 1.4.x** — keep room/codec logic runtime-agnostic so switching is a one-file change. Go is the only non-TS option worth considering (if WebTransport becomes a priority).

### 3.5 Message schema, validation and wire serialization

Reference pose layout: `carId u8, seq u16, x f32, y f32, z f32, heading u16 (2π/65536), speed u16 (cm/s), tClient u32 (ms, wrapping)` = 21 B; pad to 24 B with flags.

| Candidate | Benefits | Pros | Cons | Maturity 2026-09 |
|---|---|---|---|---|
| **Hand-packed `DataView`** (hot path) | 21-24 B/pose; zero deps; zero allocations with a reused buffer | ~30-line codec in the shared package, trivially property-tested | Manual versioning | n/a |
| `@bufbuild/protobuf` | Schema-first, generated TS types, `.proto` as contract (unlocks Go later) | `toBinary` ~5× faster since 2.14 | ~30-36 B/pose (varint tags); codegen step; overkill for one message type | 2.15.0 (2026-09-11) |
| FlatBuffers | Zero-copy reads | — | ~28-40 B with vtable/alignment; `flatc` toolchain | 25.9.23 |
| MessagePack / CBOR | Schemaless binary | ~32 B as positional f32 array | ~60 B as keyed map; still allocates | `@msgpack/msgpack` 3.1.3; `cbor-x` 1.6.6 |
| JSON | Universal, debuggable | Fine for control messages | ~95-110 B keyed per pose; GC churn at 240 frames/s during a 60 fps render loop | — |
| **Zod 4** (control path) | Conventional; every RPC lib accepts it | 14.7× faster string parse, 6.5× object vs Zod 3; core 5.36 kB gz; `z.toJSONSchema()`; Standard Schema | — | 4.6.5 (2026-09-13) |
| Valibot / ArkType / TypeBox+ajv / effect Schema | Smaller bundle / DSL / JSON-Schema-native / Effect ecosystem | Valibot 1.37 kB vs 15-17 kB Zod for a form | A 3D client is not bundle-size-bound; ArkType perf page 404'd (**unverified**); TypeBox verbose; Effect only if adopted wholesale | 1.5.0 / 2.2.3 / 0.34.52 / 3.22.2 |
| **Hono RPC** (typed HTTP) | Runs identically on Node, Bun, Workers, Deno; `hc<AppType>()` infers request/response | ~10 endpoints → no tsc slowdown | Known tsc cost on large apps | 4.13.8 (2026-09-15) |
| tRPC / oRPC / ts-rest | Procedures; contract-first + OpenAPI; — | tRPC most conventional; oRPC 2.0 promising | oRPC 2.0 still beta; **ts-rest stale since 2025-03** | 11.19.0 / 1.15.2 (2.0.0-beta.37) / 3.52.1 |

Per-room bandwidth at 8 × 30 Hz (payload + WS header + typical TLS/TCP overhead, ±20%): fixed-binary batched ≈ 59 KB/s downlink (0.21 GB per room-hour) vs JSON unbatched ≈ 285 KB/s (1.0 GB). At 360 room-hours/month that is ~75 GB vs ~360 GB — inside every provider's allowance, but batching matters more than encoding, and encoding matters for client GC.

**Verdict: hot path = hand-packed `DataView` 24 B/pose, batched per tick, in a shared TS package with fast-check round-trip tests; control/REST = JSON + Zod 4 + Hono RPC.** **Runner-ups:** protobuf-es if you want a `.proto` contract; tRPC 11 for control.

### 3.6 Persistence for leaderboard + trajectories

Storage math: 60-90 s lap at 20 Hz = 1,200-1,800 poses × 6 × f32 = 29-43 KB raw; JSON ≈ 100-150 KB; **int16-delta layout (t as u16 ms-delta, positions as int16 cm-deltas, heading u16, speed u16) = 12 B/pose ≈ 18 KB, gzip → ~8-12 KB/lap on disk** (compression ratio for smooth physics data estimated, **unverified**). 10,000 laps ≈ 120 MB. Every option below fits for years.

| Candidate | Benefits | Pros | Cons | Maturity 2026-09 |
|---|---|---|---|---|
| **SQLite in the server process** (`better-sqlite3` → `node:sqlite`) + **Litestream → R2** | Zero cost, zero latency for lap validation, ephemeral test DB = a temp file, single writer matches a single relay process | `node:sqlite` Stability 1.2 RC in Node 24/26 (sync API, sessions, backup); `better-sqlite3` 13.0.3 stable; Litestream 0.5.17 (2026-08-31, monthly releases) does continuous replication to S3/R2 with `litestream replicate -exec` wrapping the process; R2 free tier 10 GB-month + free egress; Drizzle has native `node:sqlite` driver in 1.0 rc | You own the backup story (Litestream); one process only (which room state already forces); Fly volumes are local to one host — Litestream is the redundancy | SQLite 3.53.4 |
| PostgreSQL 18 (+ Drizzle + `pg`) | Managed backups, any host, relational leaderboard queries | `uuidv7()`; TOAST: self-compressed BYTEA should be `STORAGE EXTERNAL`; runs as a GitHub Actions service container; PGlite/Testcontainers for tests | Network hop + a second bill or a free tier with cold starts (Neon scale-to-zero after 5 min; Supabase Free pauses after a week); Testcontainers for E2E | 18.6 (2026-08-13); 19 GA planned Sept 2026 (Beta 3) |
| Cloudflare D1 | Pairs with DOs; free 5 GB | No egress | 500 MB/DB on Free, 10 GB on Paid; 2 MB max row/blob; only sensible if the server is on Cloudflare | current |
| libSQL / Turso | Embedded replicas | Free 5 GB | libsql-server last release 2025-02; Turso's Rust rewrite (0.7.2) "not yet 1.0", "keep independent backups" | avoid for greenfield |
| MongoDB / Redis | — | — | Nothing here needs a document store; room state lives in process memory at this scale | — |
| **Drizzle ORM** | Schema-as-TS, no codegen, SQLite + Postgres from one schema | Apache-2.0; 1.0 rc line has 4 RCs since April; `drizzle-kit` migrations | 0.45 stable vs 1.0-rc split | 0.45.2 / 1.0.0-rc.4 |
| Prisma | Popular | 7 removed the Rust engine | **Two architecture rewrites in 10 months** (7.0 2025-11, 8.0 RC since 2026-05 with `latest` tag pointing at an RC); ESM-only; driver adapters mandatory | 7.10.0 / 8.0.0-rc.15 |
| Kysely / TypeORM / MikroORM | Query builder / decorators | Kysely is a great escape hatch | Kysely still 0.x, no migrations generator; decorator ORMs are not erasable-syntax and break `node server.ts` | 0.29.6 / 1.1.1 / 7.2.1 |

Recommended layout (same on SQLite and Postgres):

```sql
CREATE TABLE lap (
  id          TEXT PRIMARY KEY,           -- uuidv7 generated in app code
  track_id    TEXT NOT NULL,
  difficulty  TEXT NOT NULL,
  driver_id   TEXT NOT NULL,
  lap_ms      INTEGER NOT NULL,
  physics_ver INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX lap_board ON lap (track_id, difficulty, lap_ms);
CREATE UNIQUE INDEX lap_pb ON lap (track_id, difficulty, driver_id);   -- keep PBs only
CREATE TABLE lap_trajectory (
  lap_id  TEXT PRIMARY KEY REFERENCES lap(id) ON DELETE CASCADE,
  codec   INTEGER NOT NULL,   -- 1 = int16-delta v1 + gzip
  pose_n  INTEGER NOT NULL,
  data    BLOB NOT NULL
);
```

Top-N and per-driver-best queries never touch the blob table; replay fetch is a PK lookup. Use gzip (Node `zlib` Stable; browser `CompressionStream('gzip')` Baseline) rather than zstd (`node:zlib` zstd is Experimental; browser support varies) so a replay blob is decodable in the browser without a library. Not JSONB (3-4× bytes, invites `data->'poses'` queries), not row-per-pose (1,500 rows per replay), not object storage (below ~100 KB/object it is overhead).

**Verdict: SQLite + Drizzle + Litestream→R2.** Rationale: the relay is one process by construction (room state is in memory), so SQLite's single-writer "limitation" costs nothing; lap validation and leaderboard reads become in-process; the ephemeral-DB-per-E2E-run requirement becomes `mkdtemp()`; the bill is $0; Litestream gives continuous off-box replication. **Runner-up: PostgreSQL 18 on PlanetScale PS-5 ($5) or Neon Free, same Drizzle schema, BYTEA `STORAGE EXTERNAL`** — pick it if you ever need two server replicas or would rather pay $5 for managed backups than run Litestream. Keep the repository layer thin so the other remains a config switch.

### 3.7 Language and build tooling

| Candidate | Benefits | Pros | Cons | Maturity 2026-09 |
|---|---|---|---|---|
| **TypeScript 7.0** (native Go compiler) | 8-12× faster builds, parallel checkers | `npm i typescript` now gives the native `tsc`; 6.0.3 is the deprecation bridge (defaults `strict`, `module: esnext`) | **No programmatic API in 7.0** (planned 7.1); tools that import `typescript` need `@typescript/typescript6` alias; typescript-eslint supports `<6.1.0` only | 7.0.2 (2026-07-08) |
| **Vite 8** | Rolldown for dev and prod, Oxc transforms, lightningcss; Rollup plugin API kept | Obvious client bundler for a three.js game | +15 MB install | 8.3.0 (2026-09-10) |
| esbuild / Rspack / Rsbuild | Fast | — | Not needed with Vite 8; Rspack is for webpack-loader ecosystems | 0.28.2 / 2.2.6 |
| **pnpm 12 workspaces + Turborepo 2.11** | `catalog:` pinning, strict `node_modules`; task graph + cache | Vercel Remote Cache free on all plans | Two tools | 12.5.1 / 2.11.2 |
| Nx / Bun workspaces / npm workspaces | More power / one tool / zero tools | — | Nx has more magic for agents to trip on; Bun/npm lose `catalog:` and strictness | 23.2.1 |
| **oxlint + oxlint-tsgolint + oxfmt** | Type-aware lint on the native TS 7 checker; `--type-check` can replace `tsc --noEmit`; formatter passes 100% of Prettier's JS/TS conformance tests, ~30× faster | JS plugins with ESLint-compatible API | tsgolint covers 59/61 typed rules ("very close"); **oxfmt is 0.x with weekly releases** | 1.83.0 / 7.0.2002 / 0.68.0 |
| Biome 2.5 | One binary, one config, 550 rules | Type-aware rules without tsc | `noFloatingPromises` still nursery; 2026 roadmap prioritises HTML/Vue/Svelte | 2.5.14 |
| ESLint 10 + typescript-eslint + Prettier | Ecosystem | — | Typed linting on the slow JS checker via alias; 9.x EOL 2026-08 | 10.11.0 / 8.70.0 / 3.9.8 |
| Python: uv + ruff + pyright | Lockfile, venv, Python download; lint+format; type check | `astral-sh/setup-uv@v10` in CI | Astral `ty` 0.0.82 is not yet stability-labelled | 0.12.17 / 0.16.8 / 1.1.414 |

**Verdict: TypeScript 7.0 + Node type stripping (tsconfig: `noEmit`, `module: nodenext`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `rewriteRelativeImportExtensions`), Vite 8, pnpm 12 + Turborepo 2.11, oxlint+tsgolint+oxfmt (pin exact versions, let Renovate bump weekly); Python 3.13/3.14 with uv/ruff/pyright.** **Runner-up: Biome 2.5** if you value one binary over typed rules.

### 3.8 Desktop packaging with auto-update

| Candidate | Benefits | Pros | Cons | Maturity 2026-09 |
|---|---|---|---|---|
| **Electron + electron-builder + electron-updater** | Bundles Chromium 152 → identical engine and GPU path on all three OSes; WebGL2 everywhere; WebGPU on Windows/macOS by default | electron-updater targets: "macOS: DMG. Linux: AppImage, DEB, Pacman and RPM. Windows: NSIS"; GitHub Releases provider generates `latest*.yml`; AppImage updates without elevation; deb/rpm download then `installPendingUpdateIfAvailable()` (pkexec); best test tooling (§4.3); Steam via `steamworks.js` (**secondary**) | ~85-120 MB per platform (**unverified** exact); Linux WebGPU inherits Chrome's Linux gating (needs `enable-unsafe-webgpu` + Vulkan flags off Intel Gen12+/NVIDIA-Wayland); Forge has no AppImage maker and `update.electronjs.org` is macOS/Windows only — so electron-builder is the only complete Linux path | Electron 44.4.3 (2026-09-18; majors every ~8 weeks, 3 supported lines); electron-builder 26.15.3/26.16.1; electron-updater 6.8.9 |
| Tauri 2.x | <600 KB shell; updater plugin with mandatory signatures; AppImage/deb/rpm/Snap/Flatpak/AUR | WebView2 on Windows has WebGPU; `tauri-plugin-updater` 2.12.0 | **Linux = WebKitGTK**: Tauri's own "Linux Graphics Issues" page documents blank windows/flicker/NVIDIA crashes, `WEBGL_debug_renderer_info` reporting "Apple GPU" on every Linux machine, "WebGL2 context creation succeeds even when backed by a software rasterizer", and recommends "a non-WebGL fallback on Linux"; **no WebGPU in WebKitGTK** (none in 2.48-2.54 release notes; WebKit's WebGPU is Metal-based); deb/rpm are not updater artifacts; three engines to QA; tauri-driver cannot test macOS; Tauri 3 alpha started 2026-09-15 | 2.11.6 / CLI 2.11.5 |
| Wails (Go) | Same system webviews | v2.14.0 stable | Same WebKitGTK problem; no first-party updater in v2 | v3 beta.23 |
| Neutralinojs | Tiny; built-in updater | — | WebKitGTK; updater has no documented signature verification | 6.9.0 |
| Electrobun | Bun-based, bsdiff deltas, optional bundled CEF | Interesting | v2 is a month old, "experimental" UI layer | 2.0.1 (2026-08-22) |
| PWA install | Zero packaging/signing | Chrome/Edge desktop install on Linux/Windows/macOS (web.dev) | Safari macOS no installability; not a real installer/Steam artifact | — |

Signing reality for a new solo developer: Apple Developer Program $99/yr + notarization (required for auto-update on macOS); Windows: Azure Artifact Signing (ex-Trusted Signing) is still effectively gated to organisations with 3+ years of tax history and individual validation paused since 2025-04-02 (Microsoft Q&A, Aug 2026) → budget an OV/EV certificate from a CA (price **unverified**); Linux needs nothing.

**Verdict: Electron + electron-builder + electron-updater with GitHub Releases as the feed** — for a WebGL game with a Linux audience the only wrapper that guarantees the engine you tested in Chrome is bundled Chromium; WebKitGTK's documented GPU story makes Tauri a Linux support-ticket generator. Ship AppImage (auto-updating) + deb/rpm, signed/notarized DMG, NSIS; also ship the PWA for free. **Runner-up: Tauri 2** only if download size outranks Linux rendering fidelity, and then with the software-rendering warning Tauri itself recommends.

### 3.9 RL training pipeline and in-browser inference

| Candidate | Benefits | Pros | Cons | Maturity 2026-09 |
|---|---|---|---|---|
| **Gymnasium 1.3 + Stable-Baselines3 2.9 PPO (PyTorch 2.14)** | Lingua-franca env API; fewest lines to a working PPO; callbacks/eval/checkpoints | Batched NumPy `VectorEnv` subclass (N≈4096 lanes) delivers thousands of transitions per Python call → ~1e5-1e6 env-steps/s realistic for a ~100-op kinematic tick (**estimate, unverified — measure**); `policy.state_dict()` trivially exportable; SBX 0.28 (JAX) if updates are the bottleneck | Python-loop rollout overhead; not the fastest framework (the env will be the bottleneck anyway) | Gymnasium 1.3.0 (2026-04-22, Py 3.14 OK); SB3 2.9.0 (2026-06-15, torch ≥2.8) |
| CleanRL single-file PPO | Best-understood reference; trivially hackable by an agent | — | PyPI 1.2.0 (2023) and repo pin `python<3.11`, `gymnasium==0.29.1` → copy the file, do not install | — |
| PufferLib | 1M+ steps/s | — | Speed comes from C envs; 4.0/5.0 removed Python/Gymnasium emulation and CPU training; PyPI 3.0.0 pins `numpy<2` → collides with NumPy 2.5/Py 3.12+; would force a C port | 3.0.0 on PyPI (2025-06-23) |
| TorchRL / Tianshou / skrl / Sample Factory / RLlib | Various | TorchRL most official | Steeper API / rewrite with low activity / Isaac-Lab oriented / maintenance / Ray cluster overkill | 0.14.0 / 2.0.1 / 2.1.0 / 2.1.1 / 2.58.0 |
| Brax/JAX | Fast on GPU | — | Third physics port in JAX; XLA fusion/TF32 hurt parity | 0.14.2 |
| Train in TypeScript (TensorFlow.js) | One language | — | **TF.js has had no release since 4.22.0 (2024-10-21)**, RC never finalised, no commits since 2026-06 (no official notice — "de facto unmaintained" is an inference); no PPO library in TS | 4.22.0 |
| **Inference: hand-rolled TS MLP** | ~50 lines, zero deps, synchronous inside the fixed-step loop | 10k MACs per forward ≈ 5-20 µs in V8 (**estimate**) — <0.1% of a 16.7 ms frame; weights as JSON/Float32Array (~40 KB); `Math.fround` per accumulate if you want to mirror f32 PyTorch; policy output can be included in golden fixtures | Only matmul+activation ops | n/a |
| ONNX Runtime Web | wasm/WebGPU/WebNN EPs; shared exporter path (`torch.onnx.export(dynamo=True)`) | Escape hatch for recurrent/attention policies | `ort.min.js` 0.37 MB + 14.24 MB wasm (28 MB JSEP) uncompressed; async `session.run` crosses wasm per call — overhead exceeds compute for a 10k-param MLP | 1.30.0 (2026-09-10) |
| WebNN | Native accelerators | — | "Disabled by default" Chrome 112-156; origin trial disabled 2026-03-27; no Intent to Ship | — |

**Verdict: Gymnasium + SB3 PPO on a batched NumPy port of the TS tick (the same port used for parity), Python 3.13/3.14 GIL build; export `state_dict()` → Float32Array/JSON committed as an asset (safetensors for archival); infer with a hand-rolled TS MLP.** Observation design (domain, brief): body-frame lateral offset, heading error, speed, yaw rate, plus curvature/heading of K look-ahead centreline points, normalised to ±1. **Runner-ups:** CleanRL's PPO file; ORT-Web wasm EP; the Rust→wasm+PyO3 architecture if physics stops being kinematic.

### 3.10 Hosting (realtime + DB, region, budget)

| Candidate | Benefits | Pros | Cons | Maturity / price 2026-09 |
|---|---|---|---|---|
| **Fly.io Machines** | One Dockerfile, `fly deploy`, region = a flag; WebSockets first-class; 18+ regions | `shared-cpu-1x` 256 MB $1.94-3.14, **512 MB $3.19-5.16**, 1 GB $5.70-9.20 by region; volumes $0.15/GB-mo; egress $0.02/GB NA/EU | No free tier (card required); volumes are single-host (page does not state replication — Litestream is the redundancy); Managed Postgres from $38 (out of budget) | current |
| Cloudflare Workers Paid + DO + D1 + R2 | Near-zero ops; DOs on Free plan; `locationHint`; no egress fees | $5/mo + DO overage ≈ $2.20 for 360 room-hours (20:1 WS billing) ≈ **$7**; ≈ $0 on Free for ≤2 room-hours/day | Not Node; deploy drops sockets; D1 500 MB/DB on Free | current |
| Hetzner Cloud | Best EU price/perf; 20 TB traffic | CX23 2 vCPU/4 GB **€5.49** (+€0.50 IPv4) | **CX/CAX are EU-only**; after the 2026-06-15 repricing US CPX11 is **€17.49** (3× hike); CX stock showed "currently unavailable" on the research date (**unverified** day-to-day) | current |
| Railway | Simple | Hobby $5 incl. $5 usage; small relay ≈ $2-3 usage | $0.05/GB egress; Postgres adds ~$3-5 usage | current |
| DigitalOcean / Lightsail / Vultr | $4-7 droplets | Many regions | Unmanaged; Vultr prices **unverified** (site 403) | current |
| Render / Koyeb | Free tiers | — | Free instances spin down (15 min / 1 h idle) — unusable for rooms; Starter $7 + PG $6 | current |
| Oracle Cloud Always Free | $0 | 2 OCPU / 12 GB Ampere (halved 2026-06-15) | Idle reclaim after 7 days; capacity errors common — staging box, not prod | current |
| Managed DBs | — | Neon Free 0.5 GB/100 CU-h (scale-to-zero, ~$19/mo if kept awake); Turso Free 5 GB; PlanetScale PS-5 $5 | Supabase Free pauses after a week; Pro $25 | current |

Region strategy: a 30 Hz relay with a 100 ms buffer tolerates ~80-100 ms one-way; transatlantic RTT is ~80-90 ms (**secondary/typical**). One region per room, pinned to the host's region; start with a single region matching most players (`iad` for US, `ams`/`fra` for EU); add a second machine/region and lobby routing by median ping only when players demand it.

Cost table (360 room-hours/month, ~75 GB egress with binary batching):

| Setup | Components | Monthly |
|---|---|---|
| **A. Fly.io + SQLite (winner)** | `shared-cpu-1x` 512 MB ($3.32 ams) + 1 GB volume ($0.15) + Litestream→R2 (free tier) + egress 75 GB × $0.02 ($1.50) | **≈ $5** (≈ $8 with 1 GB RAM) |
| B. Cloudflare Workers Paid + DO + D1 (runner-up) | $5 + DO overage ≈ $2.20 + D1/R2 free | ≈ $7 (≈ $0 on Free for a beta) |
| C. Hetzner CX23 (EU) + SQLite | €5.49 + €0.50 IPv4 | ≈ €6; US variant ≈ €18 |
| D. Railway Hobby | $5 + egress $3.75 (+ small Postgres) | ≈ $9-12 |
| E. Fly + managed Postgres | $3.32 + PlanetScale PS-5 $5 / Neon Free | ≈ $5-10 |

**Verdict: Fly.io `shared-cpu-1x` 512 MB in one region + SQLite + Litestream→R2 ≈ $5/month.** **Runner-up: Cloudflare Workers Paid + one Durable Object per room + D1** — cheapest ops, free-plan-viable beta, per-room region hints; costs are "not Node" and deploys dropping sockets.

---

## 4. Testing stack (dimensions 11-14)

### 4.1 Unit / integration / property / cross-language / mutation

| Candidate | Benefits | Pros | Cons | Maturity 2026-09 |
|---|---|---|---|---|
| **Vitest 5** | One runner across client/server/shared; Vite config shared with the client | 8-53% faster than 4; un-awaited async assertions now fail; rewritten `bench` with saved baselines; typecheck mode drives the native `tsc`; browser mode (Playwright provider) no longer flagged experimental | Requires Node ≥22.12, Vite ≥6.4 | 5.0.1 (2026-09-15) |
| `node:test` | Zero deps; stable; mocking incl. timers; snapshots stable | Fine for the server package | Coverage still Experimental; no shared config/UI with the client | Node 24 |
| Bun test / Jest 30 | Fast / familiar | — | Bun-only; Jest 30.5 is active but ESM/TS still via transformers — nothing better here | 1.4 / 30.5.2 |
| **fast-check 4** | Property tests for codec round-trips, plausibility rules, physics invariants | `fc.float({noNaN, noDefaultInfinity})` for f32-quantised fields; `fc.double()` covers ±0/∞/NaN edge cases | — | 4.10.2 (2026-09-19) |
| **Hypothesis 6** (Python) | Same for the trainer side | `floats(width=64, allow_nan=False)`, `extra.numpy.arrays`; `derandomize` defaults True on CI; `@reproduce_failure` | — | 6.168.0 |
| StrykerJS 10 / mutmut 3.8 | Mutation testing of physics + validator | Vitest runner (perTest coverage, bail); "experimental TypeScript 7 support"; mutmut trampoline-based, coverage-filtered | Slow/noisy on a whole repo — scope to `shared/physics` and `server/validation` | 10.0.0 / 3.8.0 |
| `@vitest/coverage-v8` | Native V8 coverage | Faster reports in v5 | Istanbul only if you need Babel-instrumented branch semantics | 5.0.1 |

Cross-language golden protocol (the parity requirement):

1. Physics step is a pure function `step(state, input, dt) → state` in both languages with identical operation order; every transcendental goes through a shared, explicitly specified helper (identical polynomial in both languages) so only correctly-rounded IEEE ops remain. `Math.hypot`, `**`/`pow`, and any f32 intermediate on one side are banned by a lint rule.
2. Fixture format `fixtures/physics/<case>.json` = `{ physics_ver, seed, dt, initial_state, inputs: [...], expected_trajectory: [...] }`; numbers via `JSON.stringify` (shortest round-trip repr; Python `json` restores f64 exactly). Optionally `.npy`/binary for bulk.
3. TS: fast-check generates seeded input tapes, the TS step produces trajectories, fixtures are regenerated only via an explicit `pnpm gen:golden`; a Vitest test replays every fixture asserting `Object.is` per element.
4. Python: pytest parametrised over the same files asserts `np.array_equal` (bitwise); Hypothesis fuzzes the Python step and dumps any counterexample as a fixture the TS suite must also pass (reverse direction).
5. Both suites gate on the same `physics_ver`; the server-side plausibility validator reuses the fixtures as its regression tests.

**Verdict: Vitest 5 + fast-check 4 everywhere in TS; pytest 9 + Hypothesis 6 in Python; bit-exact JSON golden fixtures in both directions; V8 coverage; Stryker/mutmut scoped to physics + validator.** **Runner-up:** `node:test` for the server package.

### 4.2 E2E / visual / load

| Candidate | Benefits | Pros | Cons | Maturity 2026-09 |
|---|---|---|---|---|
| **Playwright 1.63** | Multi-context per player; sharding + blob `merge-reports`; trace viewer; `page.clock`; test locks (1.63) serialise room-sharing tests | Headless-shell by default (`channel: 'chromium'` = new headless); `chromium.ts` already adds `--enable-unsafe-swiftshader`; add `--use-gl=angle --use-angle=swiftshader --ignore-gpu-blocklist`; Chromium 153 bundled | SwiftShader ≈10× slower than a GPU (**secondary**) — keep scenes small, use a low-detail preset, 2-4 rendering clients per test; give 8-player tests a no-render client flag | 1.63.0 (2026-09-04) |
| Cypress 16 | — | — | Electron with HW acceleration off on Linux; single-tab architecture cannot drive two players in one test; Chromium 146 (two majors behind) | 16.1.0 |
| WebdriverIO 9 | Multiremote drives several browsers natively; W3C BiDi | Real cross-vendor (Safari) coverage | No first-party clock API; screenshot assertions via plugins | 9.31.9 |
| Puppeteer | Chrome scripting | — | No test runner | 25.11.0 |
| **Asserting 3D state** | `window.__game = { step(n), setInput(id, input), getState(), seed(s), snapshotHash() }` exposed only under an E2E build flag; `page.evaluate` + `expect.poll` | Canvas pixels are irrelevant for state assertions | — | — |
| **Deterministic time** | Game-owned fixed-step loop with injectable clock + `step(n)` API | `page.clock.install()` does fake rAF/timers/Date/performance and `runFor()` fires frames, so it *can* drive a rAF loop — but it is per page, cannot pause the server, and lock-stepping 8 contexts through independent fake clocks is awkward; use it for lobby countdown/backoff UI tests only | — | Playwright clock API since 1.45 |
| **Ephemeral DB per run** | **SQLite temp file** (`mkdtemp`) started with the server in `globalSetup` | Zero infra, ms startup, one DB per worker | Only right because production is SQLite | — |
| Testcontainers 12.1 / PGlite 0.5.8 (if Postgres) | Real Postgres in Docker (Podman via `DOCKER_HOST`, rootless needs `TESTCONTAINERS_RYUK_DISABLED=true`); Postgres-in-wasm "under 3 MB gzipped" | GitHub runners have Docker → zero config | PGlite carries an alpha badge, single connection | 12.1.0 / 0.5.8 |
| **Visual regression: `toHaveScreenshot`** | Built in; `maxDiffPixelRatio`, `mask`, `animations: 'disabled'` | Snapshots are per project+platform | Docs warn rendering varies by OS/hardware → **generate and update baselines only in CI (Linux/SwiftShader)** via a manual `--update-snapshots` workflow; use `maxDiffPixelRatio` ≈ 0.01-0.03, `threshold` ≈ 0.1-0.2, mask HUD/timer, wait on a `frameRendered` hook | — |
| Argos / Percy / Chromatic / Lost Pixel / reg-suit | Review UX | Argos Hobby 5,000 screenshots/mo free; `@argos-ci/playwright` 7.6.0 uploads pixels as-is | Percy and Chromatic re-render DOM snapshots in their cloud — canvas content does not survive (**inferred, unverified**); Lost Pixel archived (last release 2024-11); reg-suit adds S3 plumbing | — |
| **k6 2.2** | Single Go binary; thresholds as CI pass/fail; VU model = N cars in M rooms | `k6/websockets` stable since v1.6.0 (browser-style API, `binaryType='arraybuffer'`); `k6/experimental/websockets` deprecated | Scripts run in Sobek (Goja), not Node → bundle the pose codec with esbuild without Node APIs; AGPL-3.0 | v2.2.0 (2026-08-10) |
| Artillery 2 / Locust / Gatling / custom `ws` script | YAML scenarios; Python UI; JVM DSL; reuse the real codec | Artillery has a Socket.IO engine | Artillery WS engine JSON-stringifies (weak for binary); Locust WS is a custom `User`; Gatling is a JVM toolchain; custom script = own metrics | 2.0.34 / 2.46.6 / 3.15.1 |

**Verdict: Playwright 1.63 on Chromium under SwiftShader (WebGL2; WebGPU only as an opt-in, allowed-to-fail nightly under xvfb), `browser.newContext()` per player, `window.__game.step(n)` + seeded input tapes, SQLite temp file per run, `toHaveScreenshot` with CI-only baselines and loose WebGL tolerances, `fullyParallel` + `--shard` matrix + blob merge, k6 2.2 `k6/websockets` for load.** **Runner-up: WebdriverIO 9 multiremote + Argos + Artillery.**

### 4.3 Desktop test stack

| Candidate | Benefits | Pros | Cons | Maturity 2026-09 |
|---|---|---|---|---|
| **Playwright `_electron.launch`** | Same runner and assertions as the web suite; `executablePath` = packaged build; `evaluate()` in the main process; `firstWindow()` is a normal `Page` | Under `xvfb-run` with `--no-sandbox --use-angle=swiftshader --enable-unsafe-swiftshader` on Linux runners it gets a WebGL2 context | Docs still say "experimental" (label unchanged for years while the API has been stable); do not flip the `nodeCliInspect` fuse | 1.63.0 |
| **`--smoke` self-test flag on the release artifact** | Launches the real AppImage/NSIS/DMG, loads the bundle, creates a WebGL context, exits 0 | Catches asar/packaging/signing regressions the dev-build test misses; runs on all three OS runners; no framework | AppImage detection depends on `APPIMAGE` env when not launched via the runtime (electron-updater docs) | n/a |
| WebdriverIO + `@wdio/electron-service` | Electron API mocking; auto Chromedriver; auto-Xvfb (WDIO ≥9.19.1) | Listed first in Electron's own docs | Heavier stack; service last released 2025-10-24 | 9.2.1 |
| tauri-driver | — | — | README: "pre-alpha"; Linux + Windows only, "[Todo] macOS" (CrabNebula fork needs a paid key) | 2.0.6 |
| Spectron | — | — | Deprecated 2022-02-01 | dead |

**Verdict: Playwright `_electron` against the packaged app under Xvfb + SwiftShader on Linux PR CI, plus the `--smoke` flag run on the final artifacts in the tag-triggered 3-OS release workflow.** **Runner-up: WebdriverIO + electron service.**

### 4.4 CI

| Candidate | Benefits | Pros | Cons | Maturity / price 2026-09 |
|---|---|---|---|---|
| **GitHub Actions** | Standard runners **free for public repos**; private: 2,000 min/mo (Free), 10 GB cache/repo; Docker preinstalled; `services: postgres` if ever needed; Playwright container image `mcr.microsoft.com/playwright:v1.63.0-noble`; Linux arm64 free on public repos (2025-01 public preview; GA note **unverified**) | Per-minute: Linux $0.006, Windows $0.010, **macOS $0.062 (≈10.3× Linux)**; 20 concurrent jobs (5 macOS) on Free; `ubuntu-latest` moves to 26.04 in Nov 2026 (pin `ubuntu-24.04`) | A 10-min 3-OS desktop build ≈ $0.78/run, 80% macOS → ~19 macOS-minutes/day would exhaust a private-repo quota | current |
| GitLab.com Free | 400 compute min/mo | — | Weaker than GitHub | current |
| CircleCI Free | 30,000 credits/mo | — | macOS effectively unavailable on Free | current |
| Buildkite Free | 2,000 hosted Linux vCPU-min | BYO agents | No Mac | current |
| Blacksmith | 3,000 free min/mo; Linux $0.004, macOS M4 $0.08 | Drop-in `runs-on` | Another vendor | current |
| Depot / Namespace | Faster runners | — | No free tier ($20/mo) / pay-as-you-go | current |
| **Renovate (Mend Community)** | Free for unlimited public and private repos; handles pnpm catalogs, `uv.lock`, Actions digests, grouping | 1 concurrent job/org, every 4 h | — | 44.x |
| Dependabot | Built in | Security alerts | Less flexible grouping | — |

**Verdict: GitHub Actions, public repo if at all possible.** Workflows: `ci.yml` (PR/push, Linux only: pnpm install with cached store, `oxlint --type-aware --type-check`, `oxfmt --check`, `vitest run --coverage`, `uv sync && ruff && pyright && pytest`, Playwright E2E with sharding, artifacts 7-14 days); `desktop.yml` (tags/`workflow_dispatch`: 3-OS matrix, `--smoke` on artifacts, electron-builder publish to GitHub Releases); Renovate app + Dependabot security alerts. **Runner-up: Blacksmith** as a drop-in if a private repo exceeds the quota.

---

## 5. Risks, open questions and unverified items

**Risks**

1. **Transcendental discipline is the parity linchpin.** One `Math.atan2` in the tick silently breaks bit-exact golden tests (V8 → llvm-libc vs NumPy → platform libm/SIMD). Enforce with a lint rule (oxlint `no-restricted-properties` on `Math.*` in `shared/physics`) and a CI golden job on every change to either side. If exactness ever becomes impossible, the fallback is `rtol=1e-9` tolerances plus the Rust→wasm runner-up.
2. **oxfmt is 0.x** (weekly releases). Pin exact versions; expect occasional formatting diffs on bumps. Biome 2.5 is the safe swap.
3. **TypeScript 7.0 has no programmatic API** until 7.1; any tool importing `typescript` (typescript-eslint, some Vite plugins) needs the `@typescript/typescript6` alias. Check plugin compatibility before adopting.
4. **`node:sqlite` is Stability 1.2 (RC)** in Node 24/26; start on `better-sqlite3` 13 and switch when it goes Stable. Drizzle's native `node:sqlite` driver is in the 1.0 rc line only.
5. **Windows code signing** for a new solo developer: Azure Artifact Signing remains gated to organisations with 3+ years of history; budget an OV/EV certificate from a CA.
6. **Electron's ~100 MB download** and 8-week major cadence are a maintenance tax; trivial with agents and Renovate, but real.
7. **Fly volumes are single-host**; Litestream replication to R2 is the durability story — test the restore path in CI once.
8. **WebGPU on Linux** is still gated (Chrome Intel Gen12+/NVIDIA-Wayland only; Firefox Nightly only; WebKitGTK none). Keep the renderer selectable and treat WebGPU as an enhancement through 2026.
9. **Hetzner's 2026-06-15 repricing** removed its US advantage and CX stock is intermittent — do not plan around it outside the EU.
10. **RL throughput figures are estimates** (1e5-1e6 env-steps/s for a batched NumPy env; 5-20 µs per MLP forward in V8). Measure before committing to N-lane sizes.

**Open questions**

- Player geography: decides the single Fly region (`iad` vs `ams`/`fra`).
- Public vs private repository: decides whether CI minutes are a constraint (public = unlimited standard minutes).
- Will physics ever need contact/collisions between cars? If yes, revisit the Rust→wasm single-source option early.
- Is a Steam release planned? If so, Electron + `steamworks.js` (secondary) is the path; Tauri's Linux webview makes Steam-on-Linux worse.

**Unverified (could not pin to a primary source on 2026-09-20)**

- Software WebGPU in headless Chromium via `--use-webgpu-adapter=swiftshader` (secondary write-ups only; reported flaky).
- Exact Electron download size (~85-120 MB, secondary comparison).
- Hathora shutdown (GamesBeat/Fireworks blog; pricing URL redirect observed).
- Percy/Chromatic canvas capture behaviour (inferred from their DOM-snapshot models).
- TensorFlow.js "maintenance mode" (inferred from 23 months without a release; no official notice).
- Colyseus Cloud tiers above $15; Vultr and Render exact prices (secondary); Hetzner CX stock; Windows OV/EV certificate prices.
- Whether GitHub's free Linux arm64 runners left "public preview"; GitHub artifact retention defaults (settings page 404'd).
- PGlite's underlying Postgres major; NumPy per-ufunc ULP bounds; RL-framework wheels for Python 3.14 (torch 2.14 ships 3.15 eager wheels, so 3.14 is expected fine).
- Compression ratio of gzip on int16-delta trajectories (~40-60% estimated).
- three.js manual wording that `WebGPURenderer` is "still in an experimental state" (manual page 404'd; wording via search snippet).
- Cross-region RTT and per-packet TLS/TCP overhead figures are typical values, not measurements.

---

## 6. Full source list

Registry and GitHub data were gathered with `npm view`, PyPI JSON, crates.io and `gh api` on 2026-09-20.

**WebGPU / WebGL / headless**
- gpuweb Implementation Status (edited 2026-08-13) — https://github.com/gpuweb/gpuweb/wiki/Implementation-Status
- caniuse WebGPU — https://caniuse.com/webgpu
- Chrome blog: What's New in WebGPU 144 (Linux Intel Gen12+) — https://developer.chrome.com/blog/new-in-webgpu-144
- Chrome blog: What's New in WebGPU 146 (compat mode, Android) — https://developer.chrome.com/blog/new-in-webgpu-146
- Chrome blog: What's New in WebGPU 147-148 (Linux NVIDIA Wayland) — https://developer.chrome.com/blog/new-in-webgpu-147-148
- Chrome WebGPU troubleshooting (Linux flags) — https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips
- Chromium "Using Chromium with SwiftShader" — https://chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/gpu/swiftshader.md
- blink-dev Intent to Remove: SwiftShader fallback — https://groups.google.com/a/chromium.org/g/blink-dev/c/yhFguWS_3pM
- Chromium headless (new vs `chrome-headless-shell`) — https://developer.chrome.com/docs/chromium/headless
- Chrome headless GPU post (hardware GPU flags) — https://developer.chrome.com/blog/supercharge-web-ai-testing
- Mozilla Gfx: Shipping WebGPU on Windows in Firefox 141 — https://mozillagfx.wordpress.com/2025/07/15/shipping-webgpu-on-windows-in-firefox-141/
- gpuweb issue #6331 (Firefox 152 Linux behind pref) — https://github.com/gpuweb/gpuweb/issues/6331
- WebKit: Safari 26.0 features — https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
- WebKit bug 299237 (`navigator.gpu` undefined on Sequoia) — https://bugs.webkit.org/show_bug.cgi?id=299237
- Electron issues #41763, #38189 — https://github.com/electron/electron/issues/41763 , https://github.com/electron/electron/issues/38189
- Headless SwiftShader WebGPU recipe (**secondary**) — https://zenn.dev/syoyo/articles/4f084b2288428f

**Rendering engines**
- three.js r186 — https://github.com/mrdoob/three.js/releases/tag/r186
- three.js `WebGPURenderer.js` (fallback/`forceWebGL` JSDoc) — https://raw.githubusercontent.com/mrdoob/three.js/dev/src/renderers/webgpu/WebGPURenderer.js
- three.js TSL wiki — https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language
- `@react-three/fiber` 9.7.0, `@react-three/drei` 10.7.8 — npm
- Babylon.js 9.27.1 — https://github.com/BabylonJS/Babylon.js/releases/tag/9.27.1 ; WebGPU support — https://doc.babylonjs.com/setup/support/webGPU ; status — https://doc.babylonjs.com/setup/support/webGPU/webGPUStatus
- PlayCanvas engine v2.22.2 — https://github.com/playcanvas/engine/releases/tag/v2.22.2 ; Graphics manual — https://developer.playcanvas.com/user-manual/graphics/ ; issue #8874 — https://github.com/playcanvas/engine/issues/8874
- Godot 4.7.2 — https://github.com/godotengine/godot/releases/tag/4.7.2-stable ; Exporting for the Web — https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html
- Unity 6.3 manual WebGPU (Experimental) — https://docs.unity3d.com/6000.3/Documentation/Manual/WebGPU.html ; Runtime Fee cancellation — https://unity.com/blog/unity-is-canceling-the-runtime-fee
- Bevy 0.19 — https://bevy.org/news/bevy-0-19/ ; cargo features — https://github.com/bevyengine/bevy/blob/main/docs/cargo_features.md

**Floating point / physics / wasm**
- ECMA-262 §21.3.2 Math — https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-function-properties-of-the-math-object
- V8 `src/base/ieee754.cc` (llvm-libc delegation) — https://raw.githubusercontent.com/v8/v8/main/src/base/ieee754.cc
- CPython `math` — https://docs.python.org/3/library/math.html
- NumPy SIMD dispatch — https://numpy.org/doc/stable/reference/simd/index.html
- WebAssembly Numerics — https://webassembly.github.io/spec/core/exec/numerics.html ; Nondeterminism — https://github.com/WebAssembly/design/blob/main/Nondeterminism.md
- Rapier determinism (Rust) — https://rapier.rs/docs/user_guides/rust/determinism ; (JS) — https://rapier.rs/docs/user_guides/javascript/determinism ; README — https://github.com/dimforge/rapier/blob/master/README.md
- Jolt Architecture (Deterministic Simulation) — https://github.com/jrouwe/JoltPhysics/blob/master/Docs/Architecture.md
- cannon-es — https://github.com/pmndrs/cannon-es ; ammo.js — https://github.com/kripken/ammo.js
- AssemblyScript 0.28.20 — https://github.com/AssemblyScript/assemblyscript/releases/tag/v0.28.20 ; std math (musl port) — https://github.com/AssemblyScript/assemblyscript/blob/main/std/assembly/math.ts
- PyO3 0.29.2 — https://github.com/PyO3/pyo3/releases/tag/v0.29.2 ; maturin 1.15.0 — https://github.com/PyO3/maturin/releases/tag/v1.15.0
- wasm-bindgen 0.2.128 — https://github.com/wasm-bindgen/wasm-bindgen/releases/tag/0.2.128 ; wasm-pack 0.15.0 — https://github.com/rustwasm/wasm-pack/releases/tag/v0.15.0
- wasmtime 48.0.2 — https://github.com/bytecodealliance/wasmtime/releases/tag/v48.0.2 ; PyPI wasmtime — https://pypi.org/project/wasmtime/
- Rust `libm` crate — https://crates.io/crates/libm ; Javy 9.1.0 — https://github.com/bytecodealliance/javy/releases
- es-discuss accuracy of special functions (**secondary**) — https://esdiscuss.org/topic/es6-accuracy-of-special-functions

**Transport / netcode**
- RFC 6455 — https://www.rfc-editor.org/rfc/rfc6455 ; RFC 7692 — https://www.rfc-editor.org/rfc/rfc7692
- caniuse WebTransport — https://caniuse.com/webtransport ; MDN BCD — https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/WebTransport.json ; MDN WebTransport — https://developer.mozilla.org/en-US/docs/Web/API/WebTransport
- WebKit: Safari 26.4 features (WebTransport) — https://webkit.org/blog/17862/webkit-features-for-safari-26-4/
- MDN RTCDataChannel — https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel
- `@fails-components/webtransport` — https://github.com/fails-components/webtransport ; `quic-go/webtransport-go` — https://github.com/quic-go/webtransport-go ; Bun issue #13656
- geckos.io — https://github.com/geckosio/geckos.io ; snapshot-interpolation — https://github.com/geckosio/snapshot-interpolation ; node-datachannel — https://www.npmjs.com/package/node-datachannel
- `ws` — https://www.npmjs.com/package/ws ; uWebSockets.js — https://github.com/uNetworking/uWebSockets.js ; Bun WebSockets — https://bun.com/docs/api/websockets ; Socket.IO Engine.IO protocol — https://socket.io/docs/v4/engine-io-protocol/
- Colyseus — https://docs.colyseus.io/ ; schema — https://docs.colyseus.io/state/schema ; pricing — https://colyseus.io/pricing
- Nakama — https://github.com/heroiclabs/nakama ; https://heroiclabs.com/pricing/ ; Rivet — https://www.rivet.dev/pricing
- Hathora acquisition (**secondary**) — https://fireworks.ai/blog/fireworks-acquires-hathora ; https://gamesbeat.com/hathora-acquired-will-exit-game-infrastructure-biz-and-hand-over-customers-to-nitrado/
- PartyServer — https://github.com/cloudflare/partykit/blob/main/packages/partyserver/README.md
- Cloudflare DO WebSocket best practices — https://developers.cloudflare.com/durable-objects/best-practices/websockets/ ; data location — https://developers.cloudflare.com/durable-objects/reference/data-location/ ; limits — https://developers.cloudflare.com/durable-objects/platform/limits/ ; pricing — https://developers.cloudflare.com/durable-objects/platform/pricing/
- Photon Fusion pricing — https://www.photonengine.com/fusion/pricing ; Supabase Realtime limits — https://supabase.com/docs/guides/realtime/limits ; Ably — https://ably.com/pricing ; Pusher — https://pusher.com/channels/pricing/ ; Liveblocks — https://liveblocks.io/pricing
- Valve Source Multiplayer Networking (**secondary**) — https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking ; Gambetta Entity Interpolation (**secondary**) — https://www.gabrielgambetta.com/entity-interpolation.html

**Runtimes**
- Node.js release schedule — https://raw.githubusercontent.com/nodejs/Release/main/schedule.json ; https://nodejs.org/en/about/previous-releases
- Node TypeScript support — https://nodejs.org/docs/latest-v26.x/api/typescript.html ; `node:sqlite` — https://nodejs.org/docs/latest-v24.x/api/sqlite.html , https://nodejs.org/docs/latest-v26.x/api/sqlite.html ; `node:zlib` — https://nodejs.org/docs/latest-v24.x/api/zlib.html ; `node:test` — https://nodejs.org/docs/latest-v24.x/api/test.html
- Bun releases — https://github.com/oven-sh/bun/releases ; `bun:sqlite` — https://bun.com/docs/api/sqlite ; bun test — https://bun.com/docs/cli/test
- Deno Deploy — https://deno.com/deploy/pricing ; https://docs.deno.com/deploy/reference/runtime/
- Go releases — https://go.dev/doc/devel/release ; coder/websocket — https://github.com/coder/websocket ; gorilla/websocket — https://github.com/gorilla/websocket
- Rust releases — https://github.com/rust-lang/rust/releases ; axum — https://github.com/tokio-rs/axum
- Phoenix — https://github.com/phoenixframework/phoenix ; Channels — https://phoenix.hexdocs.pm/channels.html
- Python downloads — https://www.python.org/downloads/ ; What's New 3.14 — https://docs.python.org/3.14/whatsnew/3.14.html ; FastAPI — https://github.com/fastapi/fastapi ; websockets — https://github.com/python-websockets/websockets

**Schema / serialization / RPC**
- Zod 4 — https://zod.dev/v4 ; Valibot comparison — https://valibot.dev/guides/comparison/ ; ArkType — https://www.npmjs.com/package/arktype ; TypeBox / ajv — npm ; effect — npm
- protobuf-es — https://github.com/bufbuild/protobuf-es/releases ; flatbuffers, `@msgpack/msgpack`, `cbor-x`, bebop — npm
- Hono RPC — https://hono.dev/docs/guides/rpc ; tRPC — https://www.npmjs.com/package/@trpc/server ; oRPC — https://orpc.dev/docs/comparison ; ts-rest — https://www.npmjs.com/package/@ts-rest/core

**Persistence**
- PostgreSQL 18 released — https://www.postgresql.org/about/news/postgresql-18-released-3142/ ; roadmap — https://www.postgresql.org/developer/roadmap/ ; TOAST — https://www.postgresql.org/docs/current/storage-toast.html ; `default_toast_compression` — https://www.postgresql.org/docs/current/runtime-config-client.html
- SQLite limits — https://www.sqlite.org/limits.html ; better-sqlite3 — https://github.com/WiseLibs/better-sqlite3/releases
- Litestream v0.5.17 — https://github.com/benbjohnson/litestream/releases
- Turso / libSQL — https://github.com/tursodatabase/turso ; https://turso.tech/pricing
- Drizzle upgrade v1 — https://orm.drizzle.team/docs/upgrade-v1 ; `node:sqlite` driver — https://orm.drizzle.team/docs/connect-node-sqlite ; releases — https://github.com/drizzle-team/drizzle-orm/releases
- Prisma 7 upgrade — https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7 ; Prisma 8 series — https://www.prisma.io/blog/series/prisma-8
- Kysely — https://kysely.dev/docs/intro ; pg, postgres, typeorm, @mikro-orm/core, mongodb, ioredis — npm
- PGlite — https://pglite.dev/docs/ ; https://pglite.dev/docs/pglite-socket ; https://github.com/electric-sql/pglite
- Testcontainers Node — https://github.com/testcontainers/testcontainers-node/releases/tag/v12.1.0 ; runtimes — https://node.testcontainers.org/supported-container-runtimes/
- MDN CompressionStream — https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream/CompressionStream
- Cloudflare D1 pricing — https://developers.cloudflare.com/d1/platform/pricing/ ; limits — https://developers.cloudflare.com/d1/platform/limits/ ; R2 pricing — https://developers.cloudflare.com/r2/pricing/
- Neon — https://neon.com/pricing ; Supabase — https://supabase.com/pricing ; PlanetScale — https://planetscale.com/pricing

**Tooling**
- Announcing TypeScript 7.0 — https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/ ; `@typescript/typescript6` — https://www.npmjs.com/package/@typescript/typescript6
- Vite 8 — https://vite.dev/blog/announcing-vite8 ; Rolldown — https://github.com/rolldown/rolldown/releases
- pnpm 12 — https://github.com/pnpm/pnpm/releases/tag/v12.0.0 ; Turborepo remote cache — https://turborepo.dev/docs/core-concepts/remote-caching
- oxc apps v1.83.0 — https://github.com/oxc-project/oxc/releases/tag/apps_v1.83.0 ; type-aware linting — https://oxc.rs/docs/guide/usage/linter/type-aware.html ; formatter — https://oxc.rs/docs/guide/usage/formatter.html
- Biome — https://biomejs.dev/linter/ ; https://biomejs.dev/linter/rules/no-floating-promises/ ; roadmap 2026 — https://biomejs.dev/blog/roadmap-2026/
- ESLint v10 — https://eslint.org/blog/2026/02/eslint-v10.0.0-released/ ; typescript-eslint versions — https://typescript-eslint.io/users/dependency-versions/
- uv, ruff, pyright, mypy, pytest, numpy — PyPI ; ty — https://docs.astral.sh/ty/

**Testing**
- Vitest 5 — https://vitest.dev/blog/vitest-5 ; https://github.com/vitest-dev/vitest/releases/tag/v5.0.0 ; browser mode — https://vitest.dev/guide/browser/
- fast-check numbers — https://fast-check.dev/docs/core-blocks/arbitraries/primitives/number/
- Hypothesis — https://hypothesis.readthedocs.io/en/latest/reference/strategies.html ; https://hypothesis.readthedocs.io/en/latest/reference/api.html
- StrykerJS v10 — https://github.com/stryker-mutator/stryker-js/releases/tag/v10.0.0 ; vitest runner — https://stryker-mutator.io/docs/stryker-js/vitest-runner/ ; mutmut — https://mutmut.readthedocs.io/en/latest/
- Playwright v1.63.0 — https://github.com/microsoft/playwright/releases/tag/v1.63.0 ; `chromium.ts` — https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/chromium.ts ; browsers — https://playwright.dev/docs/browsers ; clock — https://playwright.dev/docs/clock ; contexts — https://playwright.dev/docs/browser-contexts ; sharding — https://playwright.dev/docs/test-sharding ; snapshots — https://playwright.dev/docs/test-snapshots ; CI — https://playwright.dev/docs/ci ; Docker — https://playwright.dev/docs/docker ; Electron class — https://playwright.dev/docs/api/class-electron
- Cypress changelog — https://docs.cypress.io/app/references/changelog ; WebGL issue #1194 — https://github.com/cypress-io/cypress/issues/1194
- Puppeteer, WebdriverIO — npm ; WebdriverIO Electron — https://webdriver.io/docs/desktop-testing/electron/ ; wdio-electron-service — https://github.com/webdriverio-community/wdio-electron-service
- tauri-driver README — https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-driver/README.md ; WebDriver guide — https://v2.tauri.app/develop/tests/webdriver/ ; Spectron — https://github.com/electron-userland/spectron
- Electron automated testing — https://www.electronjs.org/docs/latest/tutorial/automated-testing ; headless CI — https://www.electronjs.org/docs/latest/tutorial/testing-on-headless-ci
- Argos — https://argos-ci.com/pricing ; Percy plans — https://www.browserstack.com/docs/percy/overview/plans-and-billing ; Chromatic Playwright — https://www.chromatic.com/docs/playwright/ ; Lost Pixel (archived) — https://github.com/lost-pixel/lost-pixel ; reg-suit — https://github.com/reg-viz/reg-suit/releases
- k6 v2.2.0 — https://github.com/grafana/k6/releases/tag/v2.2.0 ; `k6/websockets` — https://grafana.com/docs/k6/latest/javascript-api/k6-websockets/ ; Artillery ws engine — https://www.artillery.io/docs/reference/engines/websocket ; Locust — https://docs.locust.io/en/stable/testing-other-systems.html ; Gatling WebSocket — https://docs.gatling.io/reference/script/websocket/

**Desktop packaging**
- Electron v44.4.3 — https://github.com/electron/electron/releases/tag/v44.4.3 ; Updating Applications — https://www.electronjs.org/docs/latest/tutorial/updates ; Code Signing — https://www.electronjs.org/docs/latest/tutorial/code-signing
- electron-builder releases — https://github.com/electron-userland/electron-builder/releases ; Auto Update — https://www.electron.build/docs/features/auto-update ; electron-updater README — https://github.com/electron-userland/electron-builder/blob/master/packages/electron-updater/README.md
- Electron Forge makers — https://www.electronforge.io/llms.txt ; auto-update — https://www.electronforge.io/advanced/auto-update
- Tauri releases — https://github.com/tauri-apps/tauri/releases ; updater plugin — https://v2.tauri.app/plugin/updater/ ; webview versions — https://v2.tauri.app/reference/webview-versions/ ; Linux Graphics Issues — https://v2.tauri.app/develop/debug/linux-graphics/ ; issue #9394 — https://github.com/tauri-apps/tauri/issues/9394 ; macOS signing — https://v2.tauri.app/distribute/sign/macos/ ; wry #1848 — https://github.com/tauri-apps/wry/issues/1848
- WebView2 WebGPU discussion — https://github.com/MicrosoftEdge/WebView2Feedback/discussions/4138
- WebKitGTK 2.54 highlights — https://webkitgtk.org/2026/09/16/webkitgtk-2.54-highlights.html ; 2.52 — https://webkitgtk.org/2026/03/18/webkitgtk-2.52-highlights.html ; 2.48 — https://webkitgtk.org/2025/04/08/webkitgtk-2.48.html
- Wails — https://github.com/wailsapp/wails/releases ; Neutralinojs — https://github.com/neutralinojs/neutralinojs/releases ; updater — http://neutralino.js.org/docs/api/updater/ ; Electrobun — https://github.com/blackboardsh/electrobun/releases
- web.dev PWA installation — https://web.dev/learn/pwa/installation
- Azure Artifact Signing — https://learn.microsoft.com/en-us/azure/artifact-signing/overview ; Q&A (3-year org requirement) — https://learn.microsoft.com/en-us/answers/questions/5977141/ ; individual validation paused — https://learn.microsoft.com/en-us/answers/questions/2284182/trusted-signing-is-only-available-to-organizations
- steamworks.js (**secondary**) — https://github.com/ceifa/steamworks.js/

**RL / inference**
- Gymnasium v1.3.0 — https://github.com/Farama-Foundation/Gymnasium/releases/tag/v1.3.0 ; Env API — https://gymnasium.farama.org/api/env/
- Stable-Baselines3 v2.9.0 — https://github.com/DLR-RM/stable-baselines3/releases/tag/v2.9.0 ; sbx-rl — https://pypi.org/project/sbx-rl/
- CleanRL — https://github.com/vwxyzjn/cleanrl ; PufferLib — https://pypi.org/project/pufferlib/ , https://puffer.ai/docs.html ; TorchRL — https://github.com/pytorch/rl/releases/tag/v0.14.0 ; Tianshou, skrl, Sample Factory, RLlib, Brax, EnvPool — GitHub/PyPI
- PyTorch 2.14 — https://github.com/pytorch/pytorch/releases/tag/v2.14.0 ; torch.onnx — https://docs.pytorch.org/docs/2.14/onnx.html ; onnx, onnxscript, safetensors — PyPI ; JAX — https://github.com/jax-ml/jax/releases/tag/jax-v0.11.2
- ONNX Runtime Web 1.30.0 — https://github.com/microsoft/onnxruntime/releases/tag/v1.30.0 ; web EPs — https://onnxruntime.ai/docs/tutorials/web/ ; package contents — https://unpkg.com/onnxruntime-web@1.30.0/dist/?meta
- TensorFlow.js releases — https://github.com/tensorflow/tfjs/releases ; Transformers.js — npm
- WebNN support — https://caniuse.com/mdn-api_navigator_ml ; blink-dev thread — https://groups.google.com/a/chromium.org/g/blink-dev/c/5CWKSChYo98

**Hosting / CI**
- Fly.io pricing — https://fly.io/docs/about/pricing/ ; free trial — https://fly.io/docs/about/free-trial/ ; MPG — https://fly.io/docs/mpg/
- Railway — https://railway.com/pricing ; https://docs.railway.com/reference/pricing/plans ; Render — https://render.com/docs/free ; Koyeb — https://www.koyeb.com/docs/faqs/pricing
- Hetzner price adjustment — https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/ ; IPv4 — https://docs.hetzner.com/general/others/ipv4-pricing/ ; cost-optimized — https://www.hetzner.com/cloud/cost-optimized/ ; regular — https://www.hetzner.com/cloud/regular-performance/
- DigitalOcean — https://www.digitalocean.com/pricing/droplets ; https://www.digitalocean.com/pricing/managed-databases ; Lightsail — https://aws.amazon.com/lightsail/pricing/ ; Vultr (**secondary**, 403) — https://www.vultr.com/products/regular-performance-compute/
- Oracle Always Free — https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- Cloudflare Workers pricing — https://developers.cloudflare.com/workers/platform/pricing/
- GitHub Actions billing — https://docs.github.com/en/billing/managing-billing-for-your-products/about-billing-for-github-actions ; runner pricing — https://docs.github.com/en/billing/reference/actions-runner-pricing ; limits — https://docs.github.com/en/actions/reference/limits ; caching — https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching ; Postgres service containers — https://docs.github.com/en/actions/use-cases-and-examples/using-containerized-services/creating-postgresql-service-containers
- Linux arm64 free on public repos — https://github.blog/changelog/2025-01-16-linux-arm64-hosted-runners-now-available-for-free-in-public-repositories-public-preview/ ; runner-images — https://github.com/actions/runner-images ; issue #14748 — https://github.com/actions/runner-images/issues/14748
- actions/setup-node — https://github.com/actions/setup-node
- GitLab — https://about.gitlab.com/pricing/ ; CircleCI — https://circleci.com/pricing/ ; Buildkite — https://buildkite.com/pricing ; Blacksmith — https://www.blacksmith.sh/pricing ; Depot — https://depot.dev/pricing ; Namespace — https://namespace.so/pricing
- Renovate Mend Community — https://docs.renovatebot.com/mend-hosted/overview/ ; Dependabot — https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/about-dependabot-version-updates
