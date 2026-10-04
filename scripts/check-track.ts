/**
 * The drive report for a Track: is it drivable, and is it a good drive?
 *
 * Measures the layout (client/src/game/track-design.ts), drives the autopilot on
 * every Difficulty and a racing-line driver on Medium, and writes
 * track-reports/<slug>/report.md with map.png (the racing-line lap coloured by
 * speed) and speed.png (speed against distance). Hard rules fail the run; design
 * targets are the "long straights, easy corners" brief and only warn.
 *
 * Works before a Track is registered: it falls back to shared/src/tracks/<slug>.json.
 *
 * Usage: npm run track:check -- <slug>
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  BRAKE_DECEL,
  DIFFICULTIES,
  type Difficulty,
  defineTrack,
  getTrack,
  MAX_SPEED_MS,
  nearestCenterline,
  ROAD_HALF_WIDTH,
  TRACKS,
  type Track,
} from "@racing/shared";
import { runRacingLineLap, type RunResult, type StepState } from "../client/src/game/harness.ts";
import {
  MIN_CLEARANCE,
  MIN_GATE_CHORD_RATIO,
  measureTrack,
  type TrackDesign,
} from "../client/src/game/track-design.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
/** Scenery is scattered within ±410 m of the origin (client/src/game/scene.ts). */
const WORLD_HALF_EXTENT = 360;
/** Share of a tidy lap that may leave the tarmac before the layout counts as undrivable. */
const MAX_OFF_ROAD = 0.05;
const kmh = (ms: number) => Math.round(ms * 3.6);
const seconds = (ms: number) => (ms / 1000).toFixed(2);

const slug = process.argv[2];
if (!slug) {
  console.error("Usage: npm run track:check -- <slug>");
  process.exit(1);
}
const sourcePath = `${ROOT}shared/src/tracks/${slug}.json`;
const track: Track | undefined =
  getTrack(slug) ??
  (existsSync(sourcePath) ? defineTrack(JSON.parse(readFileSync(sourcePath, "utf8"))) : undefined);
if (!track) {
  console.error(`No track ${slug}: neither registered nor at ${sourcePath}.`);
  process.exit(1);
}

/** The timed lap of a run (from the first start-line crossing) and its braking zones. */
function racingLineLap(t: Track, difficulty: Difficulty = "medium") {
  const run = runRacingLineLap({ track: t, difficulty, maxSteps: 60 * 400 });
  if (!run) return null;
  const first = run.steps - 1 - Math.round(run.lapTimeMs / (1000 / 60));
  const result = {
    ...run,
    trajectory: run.trajectory.slice(first),
    inputs: run.inputs.slice(first),
  };
  // The speed check taps the brake on and off, so taps under half a second apart are one zone.
  let braking = 0,
    lastBrake = -Infinity;
  result.inputs.forEach((input, k) => {
    if (!input.brake) return;
    if (k - lastBrake > 30) braking++;
    lastBrake = k;
  });
  return { result, braking };
}

const offRoadShare = (trajectory: StepState[], t: Track) =>
  trajectory.filter((s) => nearestCenterline(s.x, s.z, t.samples).dist > ROAD_HALF_WIDTH + 0.6)
    .length / Math.max(1, trajectory.length);

type Check = { label: string; ok: boolean; detail: string };
type Laps = Record<Difficulty, ReturnType<typeof racingLineLap>>;
function rules(t: Track, d: TrackDesign, laps: Laps): Check[] {
  const xs = t.samples.map((s) => Math.abs(s.x)),
    zs = t.samples.map((s) => Math.abs(s.z));
  const extent = Math.max(...xs, ...zs);
  return [
    {
      label: "Separate stretches keep their barriers apart",
      ok: d.clearance.metres >= MIN_CLEARANCE,
      detail: `closest ${d.clearance.metres.toFixed(1)} m (samples ${d.clearance.a}/${d.clearance.b}), needs ${MIN_CLEARANCE} m`,
    },
    {
      label: "Checkpoints sit on the road in lap order",
      ok: d.misplacedGates.length === 0,
      detail: d.misplacedGates.length
        ? `gates ${d.misplacedGates.join(", ")}`
        : `${t.checkpoints.length} gates`,
    },
    {
      label: "Cutting between checkpoints does not pay",
      ok: d.worstGateChordRatio >= MIN_GATE_CHORD_RATIO,
      detail: `worst chord/arc ${d.worstGateChordRatio.toFixed(2)}, needs ${MIN_GATE_CHORD_RATIO}`,
    },
    {
      label: "Fits inside the scenery",
      ok: extent <= WORLD_HALF_EXTENT,
      detail: `furthest point ${extent.toFixed(0)} m from the origin, limit ${WORLD_HALF_EXTENT} m`,
    },
    ...DIFFICULTIES.map((difficulty) => {
      const lap = laps[difficulty];
      const off = lap ? offRoadShare(lap.result.trajectory, t) : 1;
      return {
        label: `A tidy driver laps it on ${difficulty}`,
        ok: off <= MAX_OFF_ROAD,
        detail: lap
          ? `${seconds(lap.result.lapTimeMs)} s, ${(off * 100).toFixed(1)}% off-road (limit ${MAX_OFF_ROAD * 100}%)`
          : "no lap",
      };
    }),
  ];
}

function targets(d: TrackDesign, lap: ReturnType<typeof racingLineLap>, t: Track): Check[] {
  const longest = [...d.straights].sort((a, b) => b.lengthM - a.lengthM);
  const slow = d.corners.filter((c) => c.kind === "slow").length;
  const fullThrottle = lap
    ? lap.result.inputs.filter((i) => i.throttle).length / lap.result.inputs.length
    : 0;
  return [
    {
      label: "A long, flat-out straight",
      ok: (longest[0]?.lengthM ?? 0) >= 400,
      detail: `longest ${(longest[0]?.lengthM ?? 0).toFixed(0)} m, target ≥ 400 m`,
    },
    {
      label: "A second fast straight",
      ok: (longest[1]?.lengthM ?? 0) >= 250,
      detail: `second ${(longest[1]?.lengthM ?? 0).toFixed(0)} m, target ≥ 250 m`,
    },
    {
      label: "Room to line up at the start",
      ok: d.startStraightM >= 150,
      detail: `${d.startStraightM.toFixed(0)} m straight through the line, target ≥ 150 m`,
    },
    {
      label: "No corner tighter than the road renders cleanly",
      ok: d.minRadius >= 30,
      detail: `tightest radius ${d.minRadius.toFixed(0)} m, target ≥ 30 m`,
    },
    {
      label: "Easy: few slow corners",
      ok: slow <= 2,
      detail: `${slow} slow (apex < ${kmh(MAX_SPEED_MS.medium * 0.5)} km/h), target ≤ 2`,
    },
    {
      label: "Some corners to play with",
      ok: d.corners.length >= 5,
      detail: `${d.corners.length} corners, target ≥ 5`,
    },
    {
      label: "Flat out for a good share of the lap",
      ok: fullThrottle >= 0.6,
      detail: `${Math.round(fullThrottle * 100)}% full throttle on the racing line, target ≥ 60%`,
    },
    {
      label: "The racing line stays on the tarmac",
      ok: lap !== null && offRoadShare(lap.result.trajectory, t) < 0.02,
      detail: lap
        ? `${(offRoadShare(lap.result.trajectory, t) * 100).toFixed(1)}% off-road`
        : "no lap",
    },
  ];
}

/** Blue (slow) → yellow → red (fast). */
function speedColour(share: number): string {
  const hue = 220 - 220 * Math.max(0, Math.min(1, share));
  return `hsl(${hue.toFixed(0)},90%,50%)`;
}

function mapSvg(t: Track, d: TrackDesign, lap: RunResult | null): string {
  const s = t.samples;
  const xs = s.map((p) => p.x),
    zs = s.map((p) => p.z);
  const pad = 40,
    x0 = Math.min(...xs) - pad,
    z0 = Math.min(...zs) - pad;
  const w = Math.max(...xs) + pad - x0,
    h = Math.max(...zs) + pad - z0;
  const font = Math.max(w, h) / 45;
  const road =
    s.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.z.toFixed(1)}`).join("") + "Z";
  const top = Math.max(...(lap?.trajectory.map((p) => p.speed) ?? [1]));
  const trail = (lap?.trajectory ?? [])
    .filter((_, i) => i % 3 === 0)
    .map((p, i, all) => {
      const q = all[i + 1];
      return q
        ? `<line x1="${p.x.toFixed(1)}" y1="${p.z.toFixed(1)}" x2="${q.x.toFixed(1)}" y2="${q.z.toFixed(1)}" stroke="${speedColour(p.speed / top)}" stroke-width="4" stroke-linecap="round"/>`
        : "";
    })
    .join("");
  const labels = d.corners
    .map((c, k) => {
      const p = s[c.apex];
      return `<circle cx="${p.x}" cy="${p.z}" r="${font / 4}" fill="#fff" stroke="#000"/><text x="${p.x + font / 2}" y="${p.z - font / 2}" font-size="${font}" font-family="sans-serif" font-weight="bold" fill="#111">T${k + 1} ${kmh(c.apexSpeed)}</text>`;
    })
    .join("");
  const gates = t.checkpoints
    .map((g) => `<circle cx="${g.x}" cy="${g.z}" r="3" fill="#0a0"/>`)
    .join("");
  const s0 = s[0];
  const startLine = `<line x1="${s0.x - s0.dirZ * 12}" y1="${s0.z + s0.dirX * 12}" x2="${s0.x + s0.dirZ * 12}" y2="${s0.z - s0.dirX * 12}" stroke="#000" stroke-width="5"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${z0} ${w} ${h}" width="${Math.round((1200 * w) / Math.max(w, h))}" height="${Math.round((1200 * h) / Math.max(w, h))}"><rect x="${x0}" y="${z0}" width="${w}" height="${h}" fill="#f4efe6"/><path d="${road}" fill="none" stroke="#9a9a9a" stroke-width="${ROAD_HALF_WIDTH * 2}" stroke-linejoin="round"/>${trail}${gates}${startLine}${labels}<text x="${x0 + 10}" y="${z0 + font * 1.4}" font-size="${font * 0.8}" font-family="sans-serif">${t.name}: racing line by speed (blue slow, red fast); T# full-lock apex km/h</text></svg>`;
}

function speedSvg(t: Track, d: TrackDesign, lap: RunResult | null): string {
  const W = 1400,
    H = 420,
    top = MAX_SPEED_MS.medium;
  const along = (p: StepState) => d.distance[nearestCenterline(p.x, p.z, t.samples).index];
  const pts = (lap?.trajectory ?? []).filter((_, i) => i % 2 === 0);
  // A new subpath wherever the distance wraps past the start line.
  const path = pts
    .map((p, i) => {
      const jump = i === 0 || along(p) < along(pts[i - 1]) - d.lengthM / 2;
      return `${jump ? "M" : "L"}${((along(p) / d.lengthM) * W).toFixed(1)},${(H - (p.speed / top) * H).toFixed(1)}`;
    })
    .join("");
  const straights = d.straights
    .map(
      (st) =>
        `<rect x="${(st.startM / d.lengthM) * W}" y="0" width="${(st.lengthM / d.lengthM) * W}" height="${H}" fill="#dfe9f5"/>`,
    )
    .join("");
  const grid = [50, 100, 150, 200, 250, 300]
    .map(
      (k) =>
        `<line x1="0" x2="${W}" y1="${H - (k / 3.6 / top) * H}" y2="${H - (k / 3.6 / top) * H}" stroke="#ccc"/><text x="4" y="${H - (k / 3.6 / top) * H - 3}" font-size="14" font-family="sans-serif">${k} km/h</text>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/>${straights}${grid}<path d="${path}" fill="none" stroke="#c0392b" stroke-width="2.5"/><text x="${W - 520}" y="22" font-size="16" font-family="sans-serif">Speed along the lap (blue bands: straights), ${(d.lengthM / 1000).toFixed(2)} km</text></svg>`;
}

const design = measureTrack(track);
const laps = Object.fromEntries(
  DIFFICULTIES.map((difficulty) => [difficulty, racingLineLap(track, difficulty)]),
) as Laps;
const lap = laps.medium;
const hard = rules(track, design, laps);
const soft = targets(design, lap, track);

const compare = TRACKS.filter((t) => t.id !== track.id)
  .concat(track)
  .map((t) => {
    const d = t === track ? design : measureTrack(t);
    const l = t === track ? lap : racingLineLap(t);
    return `| ${t.name} | ${(d.lengthM / 1000).toFixed(2)} km | ${Math.max(0, ...d.straights.map((s) => s.lengthM)).toFixed(0)} m | ${d.corners.length} (${d.corners.filter((c) => c.kind === "slow").length} slow) | ${l ? seconds(l.result.lapTimeMs) + " s" : "–"} |`;
  });

const tick = (c: Check) => `- ${c.ok ? "✅" : "❌"} ${c.label}: ${c.detail}`;
const report = `# ${track.name} drive report

${readSource(track.id)}

## Hard rules (must pass)
${hard.map(tick).join("\n")}

## Design targets (the "long straights, easy corners" brief; advisory)
${soft.map((c) => tick(c).replace("❌", "⚠️")).join("\n")}

## Layout
- Lap length: ${design.lengthM.toFixed(0)} m, ${track.controlPoints.length} control points, ${track.checkpoints.length} checkpoints
- Straights (radius ≥ 300 m): ${design.straights.map((s) => `${s.lengthM.toFixed(0)} m @ ${s.startM.toFixed(0)} m`).join(", ") || "none"} (${Math.round(design.straightShare * 100)}% of the lap)

| Corner | At | Radius | Full-lock apex speed | Kind |
| --- | --- | --- | --- | --- |
${design.corners.map((c, k) => `| T${k + 1} | ${c.startM.toFixed(0)} m | ${c.radius.toFixed(0)} m | ${kmh(c.apexSpeed)} km/h | ${c.kind} |`).join("\n")}

## Drives
- Racing line, medium: ${lap ? `${seconds(lap.result.lapTimeMs)} s, top ${kmh(Math.max(...lap.result.trajectory.map((p) => p.speed)))} km/h, slowest ${kmh(Math.min(...lap.result.trajectory.map((p) => p.speed)))} km/h, ${lap.braking} braking zones, ${Math.round((lap.result.inputs.filter((i) => i.throttle).length / lap.result.inputs.length) * 100)}% full throttle` : "did not complete a lap"}
  (Brakes on Jev's speed check at ${BRAKE_DECEL} m/s²; see map.png and speed.png.)
${(["easy", "hard"] as const)
  .map((difficulty) => {
    const l = laps[difficulty];
    return `- Racing line, ${difficulty}: ${l ? `${seconds(l.result.lapTimeMs)} s` : "did not complete a lap"}`;
  })
  .join("\n")}

## Compared with the other circuits (racing line, medium)
| Track | Length | Longest straight | Corners | Lap |
| --- | --- | --- | --- | --- |
${compare.join("\n")}
`;

function readSource(id: string): string {
  const path = `${ROOT}shared/src/tracks/${id}.json`;
  return existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as { description: string }).description
    : "";
}

const out = `${ROOT}track-reports/${track.id}`;
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/report.md`, report);
await sharp(Buffer.from(mapSvg(track, design, lap?.result ?? null)))
  .png()
  .toFile(`${out}/map.png`);
await sharp(Buffer.from(speedSvg(track, design, lap?.result ?? null)))
  .png()
  .toFile(`${out}/speed.png`);
console.log(report);
console.log(`Wrote ${out}/report.md, map.png and speed.png`);
if (hard.some((c) => !c.ok)) process.exit(1);
