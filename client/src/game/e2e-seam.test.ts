import { describe, expect, it, vi } from "vitest";
import { E2eSeam, E2E_DT, type E2eGameBindings } from "./e2e-seam";
import type { CarInput } from "./input";

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
      rotation: 3,
      velocity: 4,
      checkpoint: 1,
      lap: { laps: 0, active: true },
    }),
    remotePlayerIds: () => ["remote-b", "remote-a"],
    playerVariants: () => ({ me: "race", "remote-a": "taxi", "remote-b": "van" }),
    pacerVariant: () => "taxi",
  };
}

describe("E2eSeam", () => {
  it("consumes multiple inputs per animation frame with dt pinned to 1/60", () => {
    const game = createBindings();
    const seam = new E2eSeam(game);
    seam.inject(INPUTS, { stepsPerFrame: 2 });

    seam.stepFrame();
    expect(game.step).toHaveBeenNthCalledWith(1, E2E_DT, INPUTS[0]);
    expect(game.step).toHaveBeenNthCalledWith(2, E2E_DT, INPUTS[1]);
    expect(seam.state()).toMatchObject({ frame: 2, inputCount: 3, injectionFinished: false });

    seam.stepFrame();
    expect(game.step).toHaveBeenCalledTimes(3);
    expect(seam.state()).toMatchObject({ frame: 3, injectionFinished: true });
  });

  it("never advances more steps than the caller's real-time budget allows", () => {
    const game = createBindings();
    const seam = new E2eSeam(game);
    seam.inject(INPUTS, { stepsPerFrame: 2 });

    // A budget of 0 stalls the seam: simulating ahead of the server's wall clock
    // is what makes laps come back implausible.
    expect(seam.stepFrame(0)).toBe(0);
    expect(game.step).not.toHaveBeenCalled();

    expect(seam.stepFrame(1)).toBe(1);
    expect(game.step).toHaveBeenCalledTimes(1);

    // stepsPerFrame still caps a budget larger than the batch.
    expect(seam.stepFrame(99)).toBe(2);
    expect(game.step).toHaveBeenCalledTimes(3);
  });

  it("restarts cleanly and produces exactly equal trajectories for equal inputs", () => {
    let x = 0;
    const game = createBindings();
    game.step = (_dt, input) => {
      x += input.throttle - input.brake;
    };
    game.localState = () => ({
      position: { x, z: x * 2 },
      rotation: x / 3,
      velocity: x,
      checkpoint: 0,
      lap: { laps: 0, active: false },
    });
    const seam = new E2eSeam(game);

    seam.inject(INPUTS);
    while (!seam.state().injectionFinished) seam.stepFrame();
    const first = seam.trajectory();

    x = 0;
    seam.inject(INPUTS);
    while (!seam.state().injectionFinished) seam.stepFrame();
    expect(seam.trajectory()).toEqual(first);
  });

  it("surfaces local state, sorted remote ids, and lap submission completion", () => {
    const game = createBindings();
    const seam = new E2eSeam(game);
    seam.inject([]);
    seam.recordLapSubmission(42_000, 1);

    expect(seam.state()).toMatchObject({
      position: { x: 1, z: 2 },
      rotation: 3,
      velocity: 4,
      checkpoint: 1,
      lap: { laps: 0, active: true },
      remotePlayerIds: ["remote-a", "remote-b"],
      variants: { me: "race", "remote-a": "taxi", "remote-b": "van" },
      pacerVariant: "taxi",
      injectionFinished: true,
      lapSubmitted: true,
      serverLapMs: 42_000,
      serverLaps: 1,
    });
  });

  it("rejects invalid step multipliers", () => {
    const seam = new E2eSeam(createBindings());
    expect(() => seam.inject(INPUTS, { stepsPerFrame: 0 })).toThrow(/positive integer/);
    expect(() => seam.inject(INPUTS, { stepsPerFrame: 1.5 })).toThrow(/positive integer/);
  });
});
