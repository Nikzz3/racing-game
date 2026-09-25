import { describe, expect, it } from "vitest";
import {
  CHECKPOINT_RADIUS,
  jevDrivingState,
  nearestCenterline,
  SUNSET_RIDGE,
  type JevPose,
  type JevUnavailableReason,
} from "@racing/shared";
import { SPAWN_SAMPLE } from "./harness";
import { JevLiveRun, type JevLiveAnswer } from "./jev-live-run";
import { CarPhysics, PHYSICS_STEP } from "./physics";

interface Sent {
  pose: JevPose;
  seq: number;
}

function setup(): { run: JevLiveRun; sent: Sent[] } {
  const sent: Sent[] = [];
  const run = new JevLiveRun((pose, seq) => sent.push({ pose, seq }));
  return { run, sent };
}

type Answer = Pick<JevLiveAnswer & { type: "jevDecision" }, "accelerate" | "left">;

function decision(seq: number, answer: Partial<Answer> = {}): JevLiveAnswer {
  return {
    type: "jevDecision",
    seq,
    accelerate: 1,
    left: 0.5,
    pedalConfidence: 0.9,
    steerConfidence: 0.1,
    latencyMs: 240,
    model: "jev-test",
    ...answer,
  };
}

function refusal(seq: number, reason: JevUnavailableReason): JevLiveAnswer {
  return { type: "jevUnavailable", seq, reason };
}

/** Frames of exactly one physics step keep run time exact. */
function tickMs(run: JevLiveRun, ms: number): void {
  for (let i = 0; i < Math.round(ms / (PHYSICS_STEP * 1000)); i++) run.tick(PHYSICS_STEP);
}

/** A stand-in for Jev like the server's stub: aims at the road centre ahead and cruises. */
function fakeJev(cruise: number): (pose: JevPose) => Answer {
  const { samples } = SUNSET_RIDGE;
  return (pose) => {
    const { index } = nearestCenterline(pose.x, pose.z, samples);
    const target = samples[(index + 6) % samples.length];
    const turn = Math.atan2(target.x - pose.x, target.z - pose.z) - pose.heading;
    const bearing = Math.atan2(Math.sin(turn), Math.cos(turn));
    return {
      accelerate: pose.speed < cruise ? 0.9 : 0.2,
      left: Math.max(0, Math.min(1, 0.5 + bearing * 2)),
    };
  };
}

/** Drives at 60 Hz, each request answered by `jev` once `latencyMs` of run time has passed. */
function drive(
  run: JevLiveRun,
  sent: Sent[],
  jev: (pose: JevPose) => Answer,
  { latencyMs = 250, seconds = 150, onTick = () => {} } = {},
): void {
  const inbox: { at: number; answer: JevLiveAnswer }[] = [];
  let asked = 0;
  for (let i = 0; i < seconds * 60 && !run.ended; i++) {
    run.tick(1 / 60);
    onTick();
    for (; asked < sent.length; asked++) {
      const { pose, seq } = sent[asked];
      inbox.push({ at: run.timeMs + latencyMs, answer: decision(seq, jev(pose)) });
    }
    while (inbox.length > 0 && inbox[0].at <= run.timeMs) run.receive(inbox.shift()!.answer);
  }
}

describe("JevLiveRun requests", () => {
  it("asks about the spawn pose and keeps exactly one request in flight", () => {
    const { run, sent } = setup();
    expect(run.phase).toBe("asking");
    tickMs(run, 2000);
    expect(sent).toHaveLength(1);
    const spawn = new CarPhysics("medium", SUNSET_RIDGE.samples);
    spawn.spawnAtSample(SPAWN_SAMPLE, 0);
    expect(sent[0].pose).toEqual({ x: spawn.x, z: spawn.z, heading: spawn.heading, speed: 0 });
  });

  it("applies a decision on arrival and shows what Jev judged", () => {
    const { run, sent } = setup();
    run.tick(PHYSICS_STEP);
    run.receive(decision(sent[0].seq, { accelerate: 0.2, left: 0.8 }));
    expect(run.phase).toBe("driving");
    expect(run.input).toMatchObject({ throttle: 0, brake: 1 });
    expect(run.input.steer).toBeCloseTo(0.6, 9);
    expect(run.decisions).toBe(1);
    expect(run.latest).toEqual({
      decision: { accelerate: 0.2, left: 0.8, pedalConfidence: 0.9, steerConfidence: 0.1 },
      model: "jev-test",
      seen: jevDrivingState(sent[0].pose, SUNSET_RIDGE).bend_ahead,
      latencyMs: 240,
    });
  });

  it("asks about the pose predicted for when the answer lands, holding the current input", () => {
    const { run, sent } = setup();
    const twin = new CarPhysics("medium", SUNSET_RIDGE.samples);
    twin.spawnAtSample(SPAWN_SAMPLE, 0);
    const idle = { throttle: 0, brake: 0, steer: 0 };
    run.tick(PHYSICS_STEP);
    twin.advance(PHYSICS_STEP, idle);
    run.receive(decision(sent[0].seq, { accelerate: 1, left: 0.7 }));
    while (sent.length < 2) {
      run.tick(PHYSICS_STEP);
      twin.advance(PHYSICS_STEP, run.input);
    }
    // The first round trip opens TypeSafe's connection and stays out of the estimate.
    expect(run.predictionMs).toBe(250);
    expect(sent[1].pose).toEqual(twin.predict(0.25, run.input));
    expect(sent[1].pose.speed).toBeGreaterThan(run.car.speed + 10);
  });

  it("predicts by a moving average of measured round trips, not the server's latency", () => {
    const { run, sent } = setup();
    run.tick(PHYSICS_STEP);
    tickMs(run, 700);
    run.receive(decision(sent[0].seq, { accelerate: 0 }));
    expect(run.predictionMs).toBe(250);
    tickMs(run, 300);
    run.receive(decision(sent[1].seq, { accelerate: 0 }));
    expect(run.predictionMs).toBeCloseTo(250 + (300 - 250) * 0.25, 9);
  });

  it("keeps the car's time when frames come too slowly for the physics to keep up", () => {
    const { run, sent } = setup();
    // At 5 fps a frame runs out of physics steps: 0.6 s of frames simulate 0.2 s.
    const slowFrames = (n: number) => {
      for (let i = 0; i < n; i++) run.tick(0.2);
    };
    slowFrames(3);
    expect(run.timeMs).toBeCloseTo(200, 9);
    run.receive(decision(sent[0].seq, { accelerate: 0 }));
    slowFrames(3);
    run.receive(decision(sent[1].seq, { accelerate: 0 }));
    // So the prediction covers the 200 ms the car drove during the round trip, not 600.
    expect(run.predictionMs).toBeCloseTo(250 + (200 - 250) * 0.25, 9);
  });

  it("paces requests to one per decision interval even when answers come back at once", () => {
    const { run, sent } = setup();
    run.tick(PHYSICS_STEP);
    run.receive(decision(sent[0].seq));
    expect(sent).toHaveLength(1);
    tickMs(run, 90);
    expect(sent).toHaveLength(1);
    tickMs(run, 10);
    expect(sent).toHaveLength(2);
    run.receive(decision(sent[1].seq));
    tickMs(run, 90);
    expect(sent).toHaveLength(2);
  });

  it("ignores answers to anything but the pending request", () => {
    const { run, sent } = setup();
    run.tick(PHYSICS_STEP);
    run.receive(decision(sent[0].seq + 1));
    run.receive(decision(sent[0].seq - 1));
    expect(run.decisions).toBe(0);
    expect(run.input).toEqual({ throttle: 0, brake: 0, steer: 0 });
  });

  it("gives up on a lost answer, retries, and ignores it if it turns up late", () => {
    const { run, sent } = setup();
    run.tick(PHYSICS_STEP);
    run.receive(decision(sent[0].seq, { accelerate: 1 }));
    tickMs(run, 100);
    expect(sent).toHaveLength(2);
    tickMs(run, 2990);
    expect(sent).toHaveLength(2);
    tickMs(run, 10);
    expect(run.holding).toBe("timeout");
    tickMs(run, 100);
    expect(sent).toHaveLength(3);
    run.receive(decision(sent[1].seq, { accelerate: 0 }));
    expect(run.decisions).toBe(1);
    expect(run.input.throttle).toBe(1);
  });

  it("holds the last input through refusals, backing off, until the next decision", () => {
    const { run, sent } = setup();
    run.tick(PHYSICS_STEP);
    run.receive(decision(sent[0].seq, { accelerate: 1, left: 0.9 }));
    const held = { ...run.input };
    tickMs(run, 100);
    run.receive(refusal(sent[1].seq, "busy"));
    expect(run.holding).toBe("busy");
    expect(run.input).toEqual(held);
    tickMs(run, 90);
    expect(sent).toHaveLength(2);
    tickMs(run, 10);
    expect(sent).toHaveLength(3);
    run.receive(refusal(sent[2].seq, "rateLimited"));
    expect(run.holding).toBe("rateLimited");
    tickMs(run, 190);
    expect(sent).toHaveLength(3);
    tickMs(run, 10);
    expect(sent).toHaveLength(4);
    run.receive(refusal(sent[3].seq, "failed"));
    tickMs(run, 400);
    expect(sent).toHaveLength(5);
    run.receive(decision(sent[4].seq, { accelerate: 0 }));
    expect(run.holding).toBeNull();
    expect(run.input.brake).toBe(1);
    run.receive(refusal(sent[4].seq, "failed"));
    tickMs(run, 100);
    run.receive(refusal(sent[5].seq, "failed"));
    tickMs(run, 90);
    expect(sent).toHaveLength(6);
    tickMs(run, 10);
    expect(sent).toHaveLength(7);
  });

  it("stops for good when the server has no Jev", () => {
    const { run, sent } = setup();
    run.tick(PHYSICS_STEP);
    run.receive(refusal(sent[0].seq, "disabled"));
    expect(run.phase).toBe("unavailable");
    tickMs(run, 5000);
    expect(sent).toHaveLength(1);
  });

  it("stands still and asks nothing while paused, but applies the answer in flight", () => {
    const { run, sent } = setup();
    tickMs(run, 200);
    run.paused = true;
    run.receive(decision(sent[0].seq));
    tickMs(run, 1000);
    expect(run.decisions).toBe(1);
    expect(sent).toHaveLength(1);
    expect(run.timeMs).toBeCloseTo(200, 9);
    expect(run.car.speed).toBe(0);
    run.paused = false;
    run.tick(PHYSICS_STEP);
    expect(sent).toHaveLength(2);
  });
});

describe("JevLiveRun lap", () => {
  it("times the lap between start-line crossings and records it on that time base", () => {
    const { run, sent } = setup();
    let startedAt = 0;
    drive(run, sent, fakeJev(30), {
      onTick: () => {
        if (startedAt === 0 && run.lapTimeMs !== null) startedAt = run.timeMs - run.lapTimeMs;
      },
    });
    expect(run.phase).toBe("finished");
    const recording = run.recording!;
    expect(recording.model).toBe("jev-test");
    expect(run.lapTimeMs).toBe(recording.timeMs);
    expect(Math.abs(run.timeMs - startedAt - recording.timeMs)).toBeLessThanOrEqual(0.5);
    expect(recording.timeMs).toBeGreaterThan(40_000);

    const { frames, decisions } = recording;
    const cp0 = SUNSET_RIDGE.checkpoints[0];
    for (const [, x, z] of [frames[0], frames.at(-1)!])
      expect(Math.hypot(x - cp0.x, z - cp0.z)).toBeLessThanOrEqual(CHECKPOINT_RADIUS + 0.01);
    expect(frames[0][0]).toBe(0);
    expect(frames.at(-1)![0]).toBe(recording.timeMs);
    const gaps = frames.slice(1, -1).map((frame, i) => frame[0] - frames[i][0]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(15);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(34);
    expect(frames[1][1]).toBe(Math.round(frames[1][1] * 100) / 100);

    // The decision in force at the line opens the lap; the rest follow on the same clock.
    expect(decisions[0][0]).toBe(0);
    expect(decisions.length).toBeGreaterThan(recording.timeMs / 300);
    expect(decisions.length).toBeLessThan(run.decisions);
    for (let i = 1; i < decisions.length; i++)
      expect(decisions[i][0]).toBeGreaterThanOrEqual(decisions[i - 1][0]);
    expect(decisions.at(-1)![0]).toBeLessThanOrEqual(recording.timeMs);
  });

  it("stops asking once the lap is done and brings the car to rest", () => {
    const { run, sent } = setup();
    drive(run, sent, fakeJev(30));
    const asked = sent.length;
    tickMs(run, 10_000);
    expect(sent).toHaveLength(asked);
    expect(Math.abs(run.car.speed)).toBeLessThan(0.5);
    expect(run.phase).toBe("finished");
  });

  it("is lost after 20 s without reaching the next Checkpoint", () => {
    const { run, sent } = setup();
    drive(run, sent, () => ({ accelerate: 0, left: 0.5 }));
    expect(run.phase).toBe("lost");
    expect(run.timeMs).toBeGreaterThan(20_000);
    expect(run.timeMs).toBeLessThan(20_100);
    expect(run.recording).toBeNull();
  });

  it("is lost when the run outlasts two minutes", () => {
    const { run, sent } = setup();
    drive(run, sent, fakeJev(9));
    expect(run.phase).toBe("lost");
    expect(run.timeMs).toBeGreaterThan(120_000);
    expect(run.timeMs).toBeLessThan(120_100);
  });

  it("drives again from the spawn with a fresh request", () => {
    const { run, sent } = setup();
    drive(run, sent, fakeJev(30));
    const last = sent.at(-1)!.seq;
    run.restart();
    expect(run.phase).toBe("asking");
    expect([run.decisions, run.timeMs, run.lapTimeMs, run.recording]).toEqual([0, 0, null, null]);
    run.tick(PHYSICS_STEP);
    expect(sent.at(-1)!.seq).toBeGreaterThan(last);
    expect(sent.at(-1)!.pose.speed).toBe(0);
  });
});
