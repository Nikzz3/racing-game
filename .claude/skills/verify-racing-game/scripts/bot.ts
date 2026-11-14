// A headless driver that plays Sunset Ridge over the real WebSocket protocol: no browser,
// no WebGL, near-zero CPU. Run it through `verify.sh bot ...` (see ../SKILL.md, "Bot").
//
//   --mode drive  real CarPhysics + racing-line driver, stepped at 60 Hz in real time.
//                 The server times laps on its own clock, so a lap takes real time
//                 (~25-45 s), and it is a Plausible Lap: Track Record, Replay, Medal,
//                 Daily Board, Standings all follow.
//   --mode warp   hops gate to gate (teleports). Laps and Races complete in seconds and
//                 count in the Room (HUD, session best, Race positions, results), but are
//                 implausible, so nothing is persisted. Use it to get to the end fast.
//   --mode idle   sits on the spawn: presence only (a second driver, a Grid slot, a DNF).
import {
  DIFFICULTIES,
  gridSlot,
  jevSafeSpeed,
  nearestCenterline,
  racingLineAhead,
  TRACKS,
  type ClientMessage,
  type Difficulty,
  type RaceState,
  type ServerMessage,
  type Track,
} from "@racing/shared";
import { parseArgs } from "node:util";
import { CarPhysics } from "../../../../client/src/game/physics";

const { values: opt } = parseArgs({
  options: {
    name: { type: "string" },
    variant: { type: "string" },
    create: { type: "string" },
    join: { type: "string" },
    daily: { type: "boolean", default: false },
    track: { type: "string", default: "sunset-ridge" },
    difficulty: { type: "string", default: "medium" },
    mode: { type: "string", default: "drive" },
    laps: { type: "string", default: "1" },
    pace: { type: "string", default: "1" },
    start: { type: "string" },
    stay: { type: "string" },
    timeout: { type: "string", default: "300" },
    server: { type: "string", default: `ws://127.0.0.1:${process.env.VERIFY_SERVER_PORT ?? 8190}` },
  },
});

function fail(message: string): never {
  emit({ event: "error", message });
  process.exit(2);
}
function emit(event: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ t: Date.now(), ...event })}\n`);
}

if (!opt.name) fail("--name is required");
if ([opt.create, opt.join, opt.daily || undefined].filter(Boolean).length !== 1)
  fail("pick exactly one of --create <room>, --join <room>, --daily");
if (!["drive", "warp", "idle"].includes(opt.mode)) fail(`--mode must be drive|warp|idle`);
if (!DIFFICULTIES.includes(opt.difficulty as Difficulty))
  fail(`unknown --difficulty ${opt.difficulty}`);
if (!TRACKS.some((t) => t.id === opt.track))
  fail(`unknown --track ${opt.track} (${TRACKS.map((t) => t.id).join(", ")})`);
if (opt.start && !["race", "knockout"].includes(opt.start)) fail("--start must be race|knockout");

/** `--laps race` (implied by --start): sit until a Race this car is on the Grid of, then drive it out. */
const RACE_ONLY = opt.laps === "race" || !!opt.start;
const LAPS = RACE_ONLY ? Infinity : Number(opt.laps);
if (!RACE_ONLY && !(LAPS >= 0)) fail("--laps must be a number or 'race'");
const PACE = Number(opt.pace);
if (!(PACE > 0 && PACE <= 1)) fail("--pace must be in (0, 1]");
// An idle bot exists to be present, so it stays until killed unless told otherwise.
const STAY = opt.stay ?? (opt.mode === "idle" ? "forever" : "0");
const STAY_S = STAY === "forever" ? Infinity : Number(STAY);
if (Number.isNaN(STAY_S)) fail("--stay must be seconds or 'forever'");
const DT = 1 / 60;
const SEND_MS = 50;
/** Real time between warp hops: well above the server's 50 ms snapshot tick. */
const WARP_HOP_MS = 120;

let track: Track = TRACKS.find((t) => t.id === opt.track)!;
let difficulty = opt.difficulty as Difficulty;
let myId = "";
let joined = false;
let race: RaceState | null = null;
let laps = 0;
let car: CarPhysics | null = null;
let gridFor: number | null = null;
/** The gate the server says this car owes next (from snapshots); warp hops to it. */
let owedGate = 0;
let finishedAt: number | null = null;
let lastLapAt = 0;
/** The last lap's post-lap Standings arrived, so the server persisted it. */
let persisted = false;
const STANDINGS_WAIT_MS = 5000;

const socket = new WebSocket(opt.server);
const send = (message: ClientMessage) => socket.send(JSON.stringify(message));

function spawn(spot?: { sample: number; offset: number }): void {
  car = new CarPhysics(difficulty, track.samples);
  car.spawnAtSample(spot?.sample ?? track.samples.length - 14, spot?.offset ?? 0);
}

/** The racing-line driver the game's own AI harness uses (client/src/game/harness.ts). */
function racingLineInput(c: CarPhysics) {
  const { index } = nearestCenterline(c.x, c.z, track.samples);
  const aim = racingLineAhead(track, index, Math.max(10, Math.min(25, c.speed * 0.4)));
  const bearing = Math.atan2(aim.x - c.x, aim.z - c.z) - c.heading;
  const turn = Math.atan2(Math.sin(bearing), Math.cos(bearing));
  const brake = c.speed > jevSafeSpeed(c, track) * PACE;
  return {
    throttle: brake ? 0 : 1,
    brake: brake ? 1 : 0,
    steer: Math.max(-1, Math.min(1, turn * 2.5)),
  };
}

const myEntrant = () => race?.entrants.find((e) => e.id === myId);
/** Held on the grid until GO, or out of the Race (Spectator, DNF, finished): no driving. */
const held = () =>
  RACE_ONLY
    ? race?.phase !== "racing" || myEntrant()?.status !== "racing"
    : !!race &&
      (race.phase === "countdown" || (race.phase === "racing" && myEntrant()?.status !== "racing"));

socket.addEventListener("open", () => {
  send({ type: "hello", name: opt.name!, ...(opt.variant && { variant: opt.variant as never }) });
});

socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data)) as ServerMessage;
  switch (message.type) {
    case "welcome": {
      myId = message.playerId;
      emit({ event: "welcome", playerId: myId });
      if (opt.daily) send({ type: "joinDaily" });
      else if (opt.create)
        send({ type: "createRoom", roomName: opt.create, track: track.id, difficulty });
      else {
        const room = message.rooms.find((r) => r.name === opt.join);
        if (!room)
          fail(
            `no open Room named "${opt.join}" (open: ${message.rooms.map((r) => r.name).join(", ") || "none"})`,
          );
        send({ type: "joinRoom", roomId: room.id });
      }
      break;
    }
    case "joined": {
      joined = true;
      track = TRACKS.find((t) => t.id === message.track)!;
      difficulty = message.difficulty;
      spawn();
      emit({
        event: "joined",
        roomId: message.roomId,
        roomName: message.roomName,
        track: message.track,
        difficulty,
        daily: message.daily?.number,
      });
      if (opt.start) send({ type: "startRace", format: opt.start as "race" | "knockout" });
      break;
    }
    case "snapshot": {
      const me = message.players.find((p) => p.id === myId);
      if (me) owedGate = me.nextCheckpoint;
      break;
    }
    case "lap":
      if (message.playerId !== myId) break;
      laps = message.laps;
      lastLapAt = Date.now();
      persisted = false;
      emit({
        event: "lap",
        laps: message.laps,
        lapTimeMs: message.lapTimeMs,
        penaltyMs: message.penaltyMs,
        isPersonalBest: message.isPersonalBest,
        isTrackRecord: message.isTrackRecord,
      });
      break;
    case "race": {
      race = message.race;
      const me = myEntrant();
      emit({
        event: "race",
        phase: race?.phase ?? null,
        format: race?.format,
        laps: race?.laps,
        me: me && { slot: me.slot, laps: me.laps, status: me.status },
        order: race?.entrants.map((e) => `${e.name}:${e.status}`),
      });
      // Lined up on the grid at the countdown, as the game client does.
      if (race?.phase === "countdown" && me?.status === "racing" && gridFor !== race.goT) {
        gridFor = race.goT;
        spawn(gridSlot(track, me.slot));
      }
      break;
    }
    case "standings":
      if (!message.afterLap) break;
      persisted = true;
      emit({ event: "standings", standings: message.standings });
      break;
    case "daily":
      emit({ event: "daily", entries: message.board.entries.length });
      break;
    case "error":
      // The server refused something this bot asked for (e.g. a Knockout with one car).
      fail(`server: ${message.message}`);
  }
});

socket.addEventListener("close", () => {
  emit({ event: "closed" });
  // A drive bot promises a Plausible Lap: one the server did not persist is a failure.
  const unpersisted = opt.mode === "drive" && !RACE_ONLY && LAPS > 0 && !persisted;
  process.exit(finishedAt === null || unpersisted ? 1 : 0);
});
socket.addEventListener("error", () => fail(`cannot connect to ${opt.server}; is the slot up?`));

/** Is the job done: laps driven (or the Race over for this car)? */
function done(): boolean {
  if (opt.mode === "idle") return joined;
  const me = myEntrant();
  // Out of the Race this car was on the Grid of: finished, knocked out or DNF.
  if (race && me && me.status !== "racing" && race.phase !== "countdown") return true;
  if (RACE_ONLY || laps < LAPS || (race && me?.status === "racing")) return false;
  // A drive lap is persisted after the lap message: stay for its Standings (none ever come
  // for an implausible lap, hence the cap).
  return opt.mode !== "drive" || persisted || Date.now() - lastLapAt > STANDINGS_WAIT_MS;
}

// Physics in real time; send the pose every 50 ms like the game client.
let previous = performance.now();
let stepAccum = 0;
let sendAccum = 0;
let hopAccum = 0;
const started = Date.now();
setInterval(() => {
  const now = performance.now();
  const elapsed = (now - previous) / 1000;
  previous = now;
  // The timeout bounds the work, not a --stay after it.
  if (finishedAt === null && Date.now() - started > Number(opt.timeout) * 1000)
    fail(`timed out after ${opt.timeout}s with ${laps}/${LAPS} laps`);
  if (!car || !joined) return;

  if (finishedAt === null && done()) {
    finishedAt = Date.now();
    emit({ event: "done", laps, persisted, race: race && { phase: race.phase, me: myEntrant() } });
  }
  if (finishedAt !== null && Date.now() - finishedAt >= STAY_S * 1000) {
    send({ type: "leaveRoom" });
    socket.close();
    return;
  }
  const driving = finishedAt === null && !held();

  if (opt.mode === "warp" && driving) {
    hopAccum += elapsed * 1000;
    if (hopAccum >= WARP_HOP_MS) {
      hopAccum = 0;
      // Always the gate the server says is owed, so a dropped hop is simply retried.
      const gate = track.checkpoints[owedGate];
      send({ type: "state", x: gate.x, y: 0, z: gate.z, rot: 0, speed: 0, t: now });
    }
    return;
  }

  if (opt.mode === "drive" && driving) {
    stepAccum += elapsed;
    while (stepAccum >= DT) {
      car.update(DT, racingLineInput(car));
      stepAccum -= DT;
    }
  }
  sendAccum += elapsed * 1000;
  if (sendAccum >= SEND_MS) {
    sendAccum = 0;
    send({ type: "state", x: car.x, y: 0, z: car.z, rot: car.heading, speed: car.speed, t: now });
  }
}, 1000 / 120);
