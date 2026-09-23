import { describe, expect, it, vi } from "vitest";
import { E2eSeam, E2E_DT, type E2eGameBindings } from "./e2e-seam";
import type { CarInput } from "./input";

const SEND_INTERVAL_MS = 50;

const INPUTS: CarInput[] = [
  { throttle: 1, brake: 0, steer: -0.25 },
  { throttle: 0, brake: 1, steer: 0.5 },
  { throttle: 1, brake: 0, steer: 0 },
];

function createBindings(): E2eGameBindings {
  return {
    step: vi.fn(),
    localState: () => ({
      position: { x: 1, z: 2 },
      heading: 3,
      speed: 4,
      checkpoint: 1,
      lap: { laps: 0, active: true },
    }),
    remotePositions: () => [
      { id: "remote-b", x: 5, z: 6 },
      { id: "remote-a", x: 7, z: 8 },
    ],
    sendState: vi.fn(),
    playerVariants: () => ({
      me: "race",
      "remote-a": "taxi",
      "remote-b": "van",
    }),
    pacerVariant: () => "taxi",
    pacerState: () => null,
    linkStates: () => ({ "remote-a": "direct" }),
    poseSources: () => ({ "remote-a": "direct", "remote-b": "relay" }),
  };
}

describe("E2eSeam", () => {
  it("consumes the budgeted number of inputs with dt pinned to 1/60", () => {
    const game = createBindings();
    const seam = new E2eSeam(game, SEND_INTERVAL_MS);
    seam.inject(INPUTS);

    seam.stepFrame(2);
    expect(game.step).toHaveBeenNthCalledWith(1, E2E_DT, INPUTS[0]);
    expect(game.step).toHaveBeenNthCalledWith(2, E2E_DT, INPUTS[1]);
    expect(seam.state()).toMatchObject({ injectionFinished: false });

    seam.stepFrame(2);
    expect(game.step).toHaveBeenCalledTimes(3);
    expect(seam.state()).toMatchObject({ injectionFinished: true });
  });

  it("never advances more steps than the caller's real-time budget allows", () => {
    const game = createBindings();
    const seam = new E2eSeam(game, SEND_INTERVAL_MS);
    seam.inject(INPUTS);

    // A budget of 0 stalls the seam: simulating ahead of the server's wall clock
    // is what makes laps come back implausible.
    expect(seam.stepFrame(0)).toBe(0);
    expect(game.step).not.toHaveBeenCalled();

    expect(seam.stepFrame(1)).toBe(1);
    expect(game.step).toHaveBeenCalledTimes(1);

    // A budget larger than the remaining inputs stops at the last input.
    expect(seam.stepFrame(99)).toBe(2);
    expect(game.step).toHaveBeenCalledTimes(3);
  });

  it("spends real elapsed time on fixed steps and paces sends off simulated time", () => {
    const game = createBindings();
    const seam = new E2eSeam(game, SEND_INTERVAL_MS);
    const held: CarInput[] = Array.from({ length: 10 }, () => INPUTS[0]);
    seam.inject(held);

    // Less than one step of real time buys no steps, so no simulated time passes.
    expect(seam.advance(E2E_DT / 2)).toBe(0);
    expect(game.step).not.toHaveBeenCalled();
    expect(game.sendState).not.toHaveBeenCalled();

    // The leftover carries over, and the 4 steps of simulated time (66.7ms) clear
    // one send interval, with the remainder held back for the next frame.
    expect(seam.advance(E2E_DT * 4)).toBe(E2E_DT * 4);
    expect(game.step).toHaveBeenCalledTimes(4);
    expect(game.sendState).toHaveBeenCalledTimes(1);

    expect(seam.advance(E2E_DT * 4)).toBe(E2E_DT * 4);
    expect(game.step).toHaveBeenCalledTimes(8);
    expect(game.sendState).toHaveBeenCalledTimes(2);
  });

  it("stamps each send with the page clock the simulation had reached", () => {
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const game = createBindings();
    const seam = new E2eSeam(game, SEND_INTERVAL_MS);
    seam.inject(Array.from({ length: 12 }, () => INPUTS[0]));
    // One slow frame delivers 12 steps (200 ms) in a single burst: the stamps
    // still space its four sends by simulated time, not by when they left.
    now = 1200;
    seam.advance(E2E_DT * 12);
    const stamps = vi.mocked(game.sendState).mock.calls.map(([sentAt]) => sentAt);
    expect(stamps).toHaveLength(4);
    stamps.forEach((sentAt, index) => expect(sentAt).toBeCloseTo(1050 + index * 50));
    vi.restoreAllMocks();
  });

  it("sends intermediate positions during a slow render frame", () => {
    const game = createBindings();
    let position = 0;
    const sent: number[] = [];
    game.step = () => {
      position++;
    };
    game.sendState = () => {
      sent.push(position);
    };
    const seam = new E2eSeam(game, SEND_INTERVAL_MS);
    seam.inject(Array.from({ length: 30 }, () => INPUTS[0]));

    seam.advance(E2E_DT * 12);

    // Each checkpoint along the path must be observable even at five FPS.
    expect(sent).toEqual([3, 6, 9, 12]);
  });

  it("sends the final injected pose when it falls between send intervals", () => {
    const game = createBindings();
    let position = 0;
    const sent: number[] = [];
    game.step = () => {
      position++;
    };
    game.sendState = () => {
      sent.push(position);
    };
    const seam = new E2eSeam(game, SEND_INTERVAL_MS);
    seam.inject(Array.from({ length: 4 }, () => INPUTS[0]));
    seam.advance(E2E_DT * 4);
    expect(sent).toEqual([3, 4]);
  });

  it("bounds browser catch-up and drops the backlog it cannot spend", () => {
    const game = createBindings();
    const seam = new E2eSeam(game, SEND_INTERVAL_MS);
    seam.inject(Array.from({ length: 30 }, () => INPUTS[0]));
    expect(seam.advance(E2E_DT * 12, 3)).toBe(E2E_DT * 3);
    expect(game.step).toHaveBeenCalledTimes(3);
    expect(game.sendState).toHaveBeenCalledTimes(1);
    // A frame that took no real time buys no steps: carrying the slow frame's
    // backlog here would simulate ahead of the wall clock and the server would
    // reject the lap as implausible.
    expect(seam.advance(0, 3)).toBe(0);
    expect(game.step).toHaveBeenCalledTimes(3);
    // Fractional leftovers under one step still carry.
    expect(seam.advance(E2E_DT * 2.5, 3)).toBe(E2E_DT * 2);
    expect(seam.advance(E2E_DT * 0.6, 3)).toBe(E2E_DT);
  });

  it("restarts cleanly and produces exactly equal trajectories for equal inputs", () => {
    let x = 0;
    const game = createBindings();
    game.step = (_dt, input) => {
      x += input.throttle - input.brake;
    };
    game.localState = () => ({
      position: { x, z: x * 2 },
      heading: x / 3,
      speed: x,
      checkpoint: 0,
      lap: { laps: 0, active: false },
    });
    const seam = new E2eSeam(game, SEND_INTERVAL_MS);

    seam.inject(INPUTS);
    while (!seam.state().injectionFinished) seam.stepFrame(1);
    const first = seam.trajectory();

    x = 0;
    seam.inject(INPUTS);
    while (!seam.state().injectionFinished) seam.stepFrame(1);
    expect(seam.trajectory()).toEqual(first);
  });

  it("surfaces local state, sorted remote ids, and lap submission completion", () => {
    const game = createBindings();
    const seam = new E2eSeam(game, SEND_INTERVAL_MS);
    seam.inject([]);
    seam.recordLapSubmission(1);

    expect(seam.state()).toMatchObject({
      position: { x: 1, z: 2 },
      heading: 3,
      speed: 4,
      checkpoint: 1,
      lap: { laps: 0, active: true },
      remotePlayerIds: ["remote-a", "remote-b"],
      remotePositions: { "remote-a": { x: 7, z: 8 }, "remote-b": { x: 5, z: 6 } },
      variants: { me: "race", "remote-a": "taxi", "remote-b": "van" },
      pacerVariant: "taxi",
      links: { "remote-a": "direct" },
      poseSources: { "remote-a": "direct", "remote-b": "relay" },
      injectionFinished: true,
      lapSubmitted: true,
      serverLaps: 1,
    });
  });

  it("surfaces the Pacer overlay's state and null when no Pacer is armed", () => {
    const game = createBindings();
    const seam = new E2eSeam(game, SEND_INTERVAL_MS);
    expect(seam.state().pacer).toBeNull();

    game.pacerState = () => ({
      frameCount: 1429,
      playing: true,
      visible: true,
      opacity: 0.5,
    });
    expect(seam.state().pacer).toEqual({
      frameCount: 1429,
      playing: true,
      visible: true,
      opacity: 0.5,
    });
  });
});
