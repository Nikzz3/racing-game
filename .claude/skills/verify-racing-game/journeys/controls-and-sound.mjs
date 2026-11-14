// features/controls-and-sound.md — keyboard, touch and gamepad driving on the real build, and
// the Lobby/HUD sound controls with the race's audio output read on a seam page.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, journey } from "../scripts/harness.mjs";
import { createRoom, joinRoom, openLobby, openSetupTab, standings, uid } from "./lib.mjs";

const id = uid();
const ROOM = `Controls ${id}`;
const KEYS = `Keys ${id}`;
const WATCHER = `Watch ${id}`;
const THUMB = `Thumb ${id}`;
const PAD = `Pad ${id}`;
const EARS = `Ears ${id}`;

// Software WebGL renders a few frames a second and physics caps catch-up per frame.
const slow = { timeout: 60_000 };
const small = { width: 960, height: 540 };

/** The HUD speedometer readout, in km/h. */
const speed = async (page) => Number(await page.locator(".hud-speed .speed-value").textContent());

/** Where a circuit-map marker sits, in track metres (the marker's --x/--z). */
const mapPos = (locator) =>
  locator.evaluate((el) => ({
    x: Number(el.style.getPropertyValue("--x")),
    z: Number(el.style.getPropertyValue("--z")),
  }));
/** A marker's position once the HUD has placed it: before its first frame it reads (0, 0). */
const placedPos = async (locator) => {
  await expect
    .poll(() => locator.evaluate((el) => el.style.getPropertyValue("--x")), { timeout: 60_000 })
    .not.toBe("");
  return mapPos(locator);
};
/**
 * Where the driver's car spawned. The HUD first puts the marker on the start line and the
 * first rendered frame moves it to the spawn, about 45 m back, so wait until it has left the
 * line: on a GPU the HUD is up well before that frame.
 */
const spawnPos = async (page) => {
  const line = await page
    .locator(".hud-map svg path")
    .first()
    .evaluate((path) => {
      const [x, z] = path.getAttribute("d").slice(1).split(" ")[0].split(",").map(Number);
      return { x, z };
    });
  const dot = page.locator(".hud-map-driver");
  await expect
    .poll(async () => Math.hypot((await mapPos(dot)).x - line.x, (await mapPos(dot)).z - line.z), {
      timeout: 60_000,
    })
    .toBeGreaterThan(20);
  return mapPos(dot);
};
const driverDot = (page) => page.locator(".hud-map-driver");
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const wrap = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));

/**
 * Records every position the driver's map marker takes (one per rendered frame) from now on,
 * so a slow page's turns are not sampled too coarsely to read.
 */
const startTrail = (page) =>
  page.evaluate(() => {
    const dot = document.querySelector(".hud-map-driver");
    window.__verifyTrail?.observer.disconnect();
    const points = [];
    const push = () =>
      points.push({
        x: Number(dot.style.getPropertyValue("--x")),
        z: Number(dot.style.getPropertyValue("--z")),
      });
    const observer = new MutationObserver(push);
    observer.observe(dot, { attributes: true, attributeFilter: ["style"] });
    push();
    window.__verifyTrail = { observer, points };
  });

/**
 * How far (metres) a car ends up left of the straight line it would drive with no steering:
 * `ahead` is that line's unit direction off the grid, measured by the W step. Steering left
 * grows the car's heading, which in the map's world x/z is a negative cross product of
 * `ahead` with the trail's displacement, so this returns positive to the left and negative
 * to the right. A barrier stops a turning car but keeps it on its side of the line.
 */
async function leftward(j, page, ahead, label) {
  await startTrail(page);
  let left = 0;
  const offset = () =>
    page.evaluate(({ x, z }) => {
      const { points } = window.__verifyTrail;
      const [first, last] = [points[0], points.at(-1)];
      return -(x * (last.z - first.z) - z * (last.x - first.x));
    }, ahead);
  try {
    await j.expect
      .poll(async () => Math.abs((left = await offset())), slow)
      .toBeGreaterThanOrEqual(3);
    return left;
  } finally {
    j.json(label, {
      leftMetres: left,
      ahead,
      trail: await page.evaluate(() => window.__verifyTrail.points),
    });
  }
}

/**
 * Drives two straight chords of `chord` metres with no steering held; returns the heading
 * change between them and the unit direction travelled.
 */
async function straightLine(j, page, chord = 12) {
  const points = [await mapPos(driverDot(page))];
  while (points.length < 3) {
    const from = points.at(-1);
    await j.expect
      .poll(async () => distance(await mapPos(driverDot(page)), from), slow)
      .toBeGreaterThanOrEqual(chord);
    points.push(await mapPos(driverDot(page)));
  }
  const h = (a, b) => Math.atan2(b.z - a.z, b.x - a.x);
  const length = distance(points[0], points[2]);
  return {
    drift: wrap(h(points[1], points[2]) - h(points[0], points[1])),
    ahead: { x: (points[2].x - points[0].x) / length, z: (points[2].z - points[0].z) / length },
  };
}

/** Client→server messages of `type` a player sent (the harness's ws log, outgoing side). */
function sent(j, player, type) {
  try {
    return readFileSync(join(j.env.evidenceDir, `${player}-ws.jsonl`), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter((m) => m.dir === "out" && m.type === type)
      .map((m) => JSON.parse(m.payload));
  } catch {
    return [];
  }
}

/** Real touch input through CDP: every event lists all fingers still down; touchEnd lifts all. */
async function touch(cdp, type, fingers) {
  await cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: fingers.map(({ id, x, y }) => ({ id, x, y, radiusX: 4, radiusY: 4, force: 1 })),
  });
}
async function centreOf(locator) {
  const box = await locator.boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * A standard-mapping pad behind navigator.getGamepads: Chromium lists no pad without a
 * physical one, so this init script is the production boundary (as in
 * e2e/specs/gamepad-and-sound.spec.ts). Its haptic actuator records every effect.
 */
function installFakePad() {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
  const axes = [0, 0, 0, 0];
  const rumbles = [];
  const pad = {
    id: "Fake standard pad",
    index: 0,
    connected: true,
    mapping: "standard",
    timestamp: 0,
    axes,
    buttons,
    vibrationActuator: {
      playEffect(type, params = {}) {
        rumbles.push({
          type,
          strong: params.strongMagnitude ?? 0,
          weak: params.weakMagnitude ?? 0,
        });
        return Promise.resolve("complete");
      },
      reset: () => Promise.resolve("complete"),
    },
  };
  const press = (index, value) => {
    buttons[index] = { pressed: value > 0.5, touched: value > 0, value };
  };
  window.__pad = {
    set({ steer = 0, throttle = 0, brake = 0, respawn = false }) {
      axes[0] = steer;
      press(7, throttle);
      press(6, brake);
      press(3, respawn ? 1 : 0);
      pad.timestamp++;
    },
    rumbles,
  };
  Object.defineProperty(navigator, "getGamepads", { value: () => [pad, null, null, null] });
}

await journey("controls-and-sound", async (j) => {
  /** The direction a car drives off the grid with no steering (set by the W step). */
  let ahead;

  // ---------------------------------------------------------------- keyboard (real build)
  const a = await j.player("a", { viewport: small });
  const b = await j.player("b", { viewport: small });
  let spawn;

  await j.step("keyboard driver A creates a Room, watcher B joins it", async () => {
    await Promise.all([openLobby(a), openLobby(b)]);
    await createRoom(a, { playerName: KEYS, roomName: ROOM });
    await j.expect(standings(a)).toContainText(KEYS);
    await joinRoom(b, { playerName: WATCHER, roomName: ROOM });
    await j.expect(standings(b)).toContainText(KEYS);
    await j.expect(standings(a)).toContainText(WATCHER);
    await j.expect(a.locator(".hud-speed .speed-value")).toHaveText("0");
    // No touch screen: the on-screen pedals stay hidden.
    await j.expect(a.getByRole("button", { name: "Accelerate", exact: true })).toBeHidden();
    spawn = await spawnPos(a);
    j.note(`A spawned at map (${spawn.x}, ${spawn.z})`);
    await j.shot("a", "01-a-parked");
  });

  let watcherStart;
  await j.step("B's circuit map shows A's car, parked", async () => {
    const remote = b.locator(".hud-map-remote").first();
    await j.expect(remote).toBeAttached(slow);
    watcherStart = await placedPos(remote);
  });

  let peak = 0;
  await j.step("holding W: the speedometer climbs and the car drives straight", async () => {
    await a.keyboard.down("w");
    await j.expect.poll(async () => (peak = await speed(a)), slow).toBeGreaterThanOrEqual(30);
    const { drift, ahead: line } = await straightLine(j, a);
    ahead = line;
    j.note(`heading drift over two straight chords: ${drift.toFixed(3)} rad`);
    j.expect(Math.abs(drift)).toBeLessThan(0.2);
    j.expect(distance(await mapPos(driverDot(a)), spawn)).toBeGreaterThan(20);
    j.note(`HUD speed with W held reached ${peak} km/h`);
    await j.shot("a", "02-a-accelerating");
  });

  await j.step("the server relays the move: A's marker moves on B's map", async () => {
    const remote = b.locator(".hud-map-remote").first();
    await j.expect
      .poll(async () => distance(await mapPos(remote), watcherStart), slow)
      .toBeGreaterThan(15);
    await j.shot("b", "03-b-sees-a-move");
  });

  await j.step("releasing W and holding S brakes: the speedometer drops", async () => {
    await a.keyboard.up("w");
    const before = await speed(a);
    await a.keyboard.down("s");
    // Poll fast: with S still held the car stops and then reverses, so on a GPU the speed is
    // below the threshold only for a moment.
    await j.expect
      .poll(() => speed(a), { ...slow, intervals: [50] })
      .toBeLessThan(Math.min(before, peak) / 2);
    await a.keyboard.up("s");
    await j.shot("a", "04-a-braked");
  });

  /** Waits until a player's car is back on the grid, standing still. */
  const backOnGrid = async (page, origin) => {
    await j.expect
      .poll(async () => distance(await mapPos(driverDot(page)), origin), slow)
      .toBeLessThan(8);
    await j.expect(page.locator(".hud-speed .speed-value")).toHaveText("0", slow);
  };

  await j.step(
    "R respawns: back near the spawn, standing still, respawn sent to the server",
    async () => {
      j.expect(distance(await mapPos(driverDot(a)), spawn)).toBeGreaterThan(10);
      await a.keyboard.press("r");
      await backOnGrid(a, spawn);
      j.expect(sent(j, "a", "respawn").length).toBeGreaterThanOrEqual(1);
      await j.shot("a", "05-a-respawned");
    },
  );

  // Each turn starts from the grid, so the car's side of the straight line off the grid
  // shows which way it steered.
  await j.step("from the grid, W+A veers the car left of the straight line", async () => {
    await a.keyboard.down("w");
    await a.keyboard.down("a");
    j.expect(await leftward(j, a, ahead, "trail-a-key-a")).toBeGreaterThan(0);
    await j.shot("a", "06-a-steered-left");
    await a.keyboard.up("a");
    await a.keyboard.up("w");
  });

  await j.step("from the grid, W+D veers it right", async () => {
    await a.keyboard.press("r");
    await backOnGrid(a, spawn);
    await a.keyboard.down("w");
    await a.keyboard.down("d");
    j.expect(await leftward(j, a, ahead, "trail-a-key-d")).toBeLessThan(0);
    await j.shot("a", "07-a-steered-right");
    await a.keyboard.up("d");
    await a.keyboard.up("w");
  });

  await j.step("arrow keys drive too: ArrowUp+ArrowLeft from the grid veers left", async () => {
    await a.keyboard.press("r");
    await backOnGrid(a, spawn);
    await a.keyboard.down("ArrowUp");
    await a.keyboard.down("ArrowLeft");
    j.expect(await leftward(j, a, ahead, "trail-a-arrow-left")).toBeGreaterThan(0);
    j.expect(await speed(a)).toBeGreaterThan(0);
    await j.shot("a", "08-a-arrows");
    await a.keyboard.up("ArrowLeft");
    await a.keyboard.up("ArrowUp");
  });

  await j.step("M toggles the HUD Mute button", async () => {
    const hudMute = a.getByRole("button", { name: "Mute", exact: true });
    await j.expect(hudMute).toHaveAttribute("aria-pressed", "false");
    await a.keyboard.press("m");
    await j.expect(hudMute).toHaveAttribute("aria-pressed", "true");
    await j.aria("a", "09-a-hud-muted", ".hud-actions");
    await a.keyboard.press("m");
    await j.expect(hudMute).toHaveAttribute("aria-pressed", "false");
  });
  await a.context().close();
  await b.context().close();

  // ------------------------------------------------------------------- touch (real build)
  const t = await j.player("t", {
    viewport: { width: 568, height: 320 },
    contextOptions: { hasTouch: true, isMobile: true },
  });
  const gas = t.getByRole("button", { name: "Accelerate", exact: true });
  const brake = t.getByRole("button", { name: "Brake", exact: true });

  await j.step(
    "touch Lobby offers the Steering picker; the Room shows GAS, BRAKE and the slider",
    async () => {
      await openLobby(t);
      await openSetupTab(t, "race");
      await j.expect(t.getByRole("radiogroup", { name: "Steering" })).toBeVisible();
      await j
        .expect(t.getByRole("radio", { name: "Slider", exact: true }))
        .toHaveAttribute("aria-checked", "true");
      await j.aria("t", "10-t-steering-picker", ".steering-picker");
      await createRoom(t, { playerName: THUMB, roomName: `${ROOM} touch` });
      await j.expect(standings(t)).toContainText(THUMB);
      await j.expect(gas).toBeVisible();
      await j.expect(brake).toBeVisible();
      await j.expect(t.locator(".touch-steer")).toBeVisible();
      await j.shot("t", "11-t-touch-controls");
    },
  );

  let cdp;
  let gasFinger;
  let tSpawn;
  await j.step("holding GAS: pressed, the speedometer climbs, the car moves", async () => {
    cdp = await t.context().newCDPSession(t);
    tSpawn = await spawnPos(t);
    gasFinger = { id: 1, ...(await centreOf(gas)) };
    await touch(cdp, "touchStart", [gasFinger]);
    await j.expect(gas).toHaveClass(/\bpressed\b/);
    await j.expect.poll(() => speed(t), slow).toBeGreaterThanOrEqual(20);
    await j.expect
      .poll(async () => distance(await mapPos(driverDot(t)), tSpawn), slow)
      .toBeGreaterThan(10);
    await j.shot("t", "12-t-gas-held");
  });

  await j.step("lifting both fingers releases GAS; holding BRAKE slows the car", async () => {
    await touch(cdp, "touchEnd", []);
    await j.expect(gas).not.toHaveClass(/\bpressed\b/);
    const before = await speed(t);
    await touch(cdp, "touchStart", [{ id: 9, ...(await centreOf(brake)) }]);
    await j.expect(brake).toHaveClass(/\bpressed\b/);
    // Poll fast, as for the S key: held BRAKE takes the car through zero into reverse.
    await j.expect.poll(() => speed(t), { ...slow, intervals: [50] }).toBeLessThan(before / 2);
    await touch(cdp, "touchEnd", []);
    await j.expect(brake).not.toHaveClass(/\bpressed\b/);
    await j.shot("t", "13-t-braked");
  });

  await j.step(
    "HUD Respawn, then GAS with a second finger on the slider's left end turns left",
    async () => {
      await t.getByRole("button", { name: "Respawn", exact: true }).tap();
      await backOnGrid(t, tSpawn);
      const box = await t.locator(".touch-steer").boundingBox();
      gasFinger = { id: 2, ...(await centreOf(gas)) };
      await touch(cdp, "touchStart", [
        gasFinger,
        { id: 3, x: box.x + 4, y: box.y + box.height / 2 },
      ]);
      await j.expect(gas).toHaveClass(/\bpressed\b/);
      j.expect(await leftward(j, t, ahead, "trail-t-slider-left")).toBeGreaterThan(0);
      await j.shot("t", "14-t-slider-left");
      await touch(cdp, "touchEnd", []);
    },
  );

  await j.step(
    "Steering 'Buttons' in the Lobby swaps the slider for Steer left/right arrows",
    async () => {
      await t.getByRole("button", { name: "Leave race" }).click();
      await t.locator(".lobby-deck").waitFor();
      await openSetupTab(t, "race");
      const buttons = t.getByRole("radio", { name: "Buttons", exact: true });
      await buttons.click();
      await j.expect(buttons).toHaveAttribute("aria-checked", "true");
      // The last driver out closes a Room, so this is a new one.
      await createRoom(t, { playerName: THUMB, roomName: `${ROOM} arrows` });
      await j.expect(standings(t)).toContainText(THUMB);
      await j.expect(t.getByRole("button", { name: "Steer left", exact: true })).toBeVisible();
      await j.expect(t.getByRole("button", { name: "Steer right", exact: true })).toBeVisible();
      await j.expect(t.locator(".touch-steer")).toHaveCount(0);
      const left = t.getByRole("button", { name: "Steer left", exact: true });
      await touch(cdp, "touchStart", [
        { id: 4, ...(await centreOf(gas)) },
        { id: 5, ...(await centreOf(left)) },
      ]);
      await j.expect(left).toHaveClass(/\bpressed\b/);
      await j.expect(gas).toHaveClass(/\bpressed\b/);
      j.expect(await leftward(j, t, ahead, "trail-t-steer-left-button")).toBeGreaterThan(0);
      await j.shot("t", "15-t-arrow-buttons");
      await touch(cdp, "touchEnd", []);
    },
  );
  await t.context().close();

  // ----------------------------------------------------------------- gamepad (real build)
  const g = await j.player("g", { viewport: small, init: { fn: installFakePad } });
  const setPad = (controls) => g.evaluate((next) => window.__pad.set(next), controls);
  let padSpawn;

  await j.step("gamepad driver creates a Room, parked", async () => {
    await openLobby(g);
    await createRoom(g, { playerName: PAD, roomName: `${ROOM} pad` });
    await j.expect(standings(g)).toContainText(PAD);
    padSpawn = await spawnPos(g);
    await j.shot("g", "16-g-parked");
  });

  await j.step("half the right trigger: the speedometer climbs and the car moves", async () => {
    await setPad({ throttle: 0.5 });
    await j.expect.poll(() => speed(g), slow).toBeGreaterThanOrEqual(12);
    await j.expect
      .poll(async () => distance(await mapPos(driverDot(g)), padSpawn), slow)
      .toBeGreaterThan(10);
    await j.shot("g", "17-g-trigger");
  });

  await j.step("Y respawns: back near the spawn, standing still", async () => {
    await setPad({ respawn: true });
    await j.expect
      .poll(async () => distance(await mapPos(driverDot(g)), padSpawn), slow)
      .toBeLessThan(8);
    await setPad({});
    await j.expect(g.locator(".hud-speed .speed-value")).toHaveText("0", slow);
    j.expect(sent(j, "g", "respawn").length).toBeGreaterThanOrEqual(1);
    await j.shot("g", "18-g-respawned");
  });

  await j.step("full left stick turns left; off the road the pad rumbles", async () => {
    await setPad({ throttle: 1, steer: -1 });
    j.expect(await leftward(j, g, ahead, "trail-g-stick-left")).toBeGreaterThan(0);
    await j.expect(g.locator(".offtrack-warn")).toHaveClass(/\bvisible\b/, slow);
    const buzzes = () =>
      g.evaluate(
        () =>
          window.__pad.rumbles.filter((r) => r.type === "dual-rumble" && r.weak > r.strong).length,
      );
    await j.expect.poll(buzzes, slow).toBeGreaterThan(0);
    await j.shot("g", "19-g-offtrack-rumble");
  });

  await g.context().close();

  // ------------------------------------------------------- sound (seam build: audio readout)
  const s = await j.player("s", { build: "seam", viewport: small });
  const volume = s.getByRole("slider", { name: "Volume" });
  const lobbyMute = s.getByRole("button", { name: "Mute", exact: true });
  const sound = async () => (await j.state("s"))?.sound;
  const gain = async () => (await sound())?.gain ?? Number.NaN;

  await j.step("Lobby Sound group: Volume to 40%, Mute on", async () => {
    await openLobby(s);
    await openSetupTab(s, "race");
    await j.expect(s.getByRole("group", { name: "Sound" })).toBeVisible();
    await j.expect(volume).toHaveValue("70");
    await j.expect(lobbyMute).toHaveAttribute("aria-pressed", "false");
    await volume.fill("40");
    await j.expect(s.locator(".sound-volume-value")).toHaveText("40%");
    await lobbyMute.click();
    await j.expect(lobbyMute).toHaveAttribute("aria-pressed", "true");
    await j.aria("s", "20-s-lobby-sound", ".sound-field");
    await j.shot("s", "20-s-lobby-sound");
  });

  await j.step(
    "in the Room the engine plays, silent while muted; HUD Mute shows pressed",
    async () => {
      await createRoom(s, { playerName: EARS, roomName: `${ROOM} sound` });
      await j.expect(standings(s)).toContainText(EARS);
      await s.waitForFunction(() => window.__game !== undefined);
      await j.expect.poll(sound, slow).toMatchObject({ context: "running", gain: 0 });
      j.expect((await sound()).engines).toBeGreaterThanOrEqual(1);
      await j
        .expect(s.getByRole("button", { name: "Mute", exact: true }))
        .toHaveAttribute("aria-pressed", "true");
      j.json("sound-muted", await sound());
    },
  );

  await j.step("M unmutes: gain settles at 0.16 (40% squared)", async () => {
    await s.keyboard.press("m");
    await j
      .expect(s.getByRole("button", { name: "Mute", exact: true }))
      .toHaveAttribute("aria-pressed", "false");
    await j.expect.poll(gain, slow).toBeCloseTo(0.16, 3);
    j.json("sound-unmuted", await sound());
    await j.shot("s", "21-s-unmuted");
  });

  await j.step("HUD Mute button mutes again: gain falls to 0", async () => {
    const hudMute = s.getByRole("button", { name: "Mute", exact: true });
    await hudMute.click();
    await j.expect(hudMute).toHaveAttribute("aria-pressed", "true");
    await j.expect.poll(gain, slow).toBeLessThan(0.001);
    await j.shot("s", "22-s-hud-muted");
  });

  await j.step("after a reload the Lobby still shows 40% and Mute on", async () => {
    await s.reload();
    await s.locator(".lobby-deck").waitFor();
    await openSetupTab(s, "race");
    await j.expect(volume).toHaveValue("40");
    await j.expect(lobbyMute).toHaveAttribute("aria-pressed", "true");
    await j.aria("s", "23-s-sound-after-reload", ".sound-field");
    await j.shot("s", "23-s-sound-after-reload");
  });
});
