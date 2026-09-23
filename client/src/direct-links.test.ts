import { afterEach, describe, expect, it, vi } from "vitest";
import { RTCPeerConnection as NodePeerConnection } from "node-datachannel/polyfill";
import type { PeerSignal, PlayerSnapshot } from "@racing/shared";
import { decodePose, DirectLinks, encodePose, type DirectPose } from "./direct-links";

const createPeerConnection = (config: RTCConfiguration) =>
  new NodePeerConnection(config) as unknown as RTCPeerConnection;

function member(id: string, direct = true): PlayerSnapshot {
  return {
    id,
    name: id,
    x: 0,
    y: 0,
    z: 0,
    rot: 0,
    speed: 0,
    laps: 0,
    lastLapMs: null,
    bestLapMs: null,
    lapStartT: null,
    nextCheckpoint: 0,
    spawns: 0,
    ...(direct && { direct: true as const }),
  };
}

const pose = (seq: number): DirectPose => ({
  stamp: { seq, sentAt: 1000 + seq * 50, epoch: 0 },
  x: 12.5,
  z: -3.25,
  rot: 1.5,
  speed: 42,
});

interface Room {
  drivers: Map<string, DirectLinks>;
  signals: Array<{ from: string; to: string; signal: PeerSignal }>;
}

/** Drivers whose signals travel through an in-memory stand-in for the server relay. */
function room(ids: string[], deliver = true): Room {
  const drivers = new Map<string, DirectLinks>();
  const signals: Room["signals"] = [];
  for (const id of ids)
    drivers.set(
      id,
      new DirectLinks(
        id,
        [],
        (to, signal) => {
          signals.push({ from: id, to, signal });
          if (deliver) setTimeout(() => void drivers.get(to)?.receiveSignal(id, signal));
        },
        createPeerConnection,
      ),
    );
  return { drivers, signals };
}

/** ICE on a loaded CI runner can take seconds; vi.waitFor's default is one. */
const LINKED = { timeout: 10_000 };

let open: DirectLinks[] = [];
function track(target: Room): Room {
  open.push(...target.drivers.values());
  return target;
}
afterEach(() => {
  for (const links of open) links.dispose();
  open = [];
  vi.useRealTimers();
});

describe("DirectLinks", () => {
  it("links two drivers and carries poses between them over the data channel", async () => {
    const { drivers } = track(room(["a", "b"]));
    const received: Array<[string, DirectPose]> = [];
    drivers.get("b")!.onPose((id, sent) => received.push([id, sent]));
    const members = [member("a"), member("b")];
    for (const links of drivers.values()) links.setMembers(members);

    await vi.waitFor(() => {
      expect(drivers.get("a")!.states()).toEqual({ b: "direct" });
      expect(drivers.get("b")!.states()).toEqual({ a: "direct" });
    }, LINKED);
    await vi.waitFor(() => {
      drivers.get("a")!.broadcast(pose(1));
      expect(received).toContainEqual(["a", pose(1)]);
    });
  });

  it("fully meshes three drivers, each pair offered only by its lower id", async () => {
    const target = track(room(["a", "b", "c"]));
    const members = ["a", "b", "c"].map((id) => member(id));
    for (const links of target.drivers.values()) links.setMembers(members);
    await vi.waitFor(() => {
      expect(target.drivers.get("a")!.states()).toEqual({ b: "direct", c: "direct" });
      expect(target.drivers.get("b")!.states()).toEqual({ a: "direct", c: "direct" });
      expect(target.drivers.get("c")!.states()).toEqual({ a: "direct", b: "direct" });
    }, LINKED);
    const offers = target.signals.filter(
      ({ signal }) => signal.kind === "description" && signal.type === "offer",
    );
    expect(offers.map(({ from, to }) => `${from}->${to}`).sort()).toEqual(["a->b", "a->c", "b->c"]);
    // Candidates never overtake the description they belong to: the receiver
    // drops candidates for a link it has not opened yet.
    for (const pair of ["a->b", "a->c", "b->c", "b->a", "c->a", "c->b"]) {
      const first = target.signals.find(({ from, to }) => `${from}->${to}` === pair);
      expect(first?.signal.kind).toBe("description");
    }
  });

  it("never links to a driver whose client did not offer Direct Links", () => {
    const { drivers, signals } = track(room(["a", "b"]));
    drivers.get("a")!.setMembers([member("a"), member("b", false)]);
    expect(drivers.get("a")!.states()).toEqual({});
    expect(signals).toEqual([]);
  });

  it("closes the link when the other driver leaves the Room", async () => {
    const { drivers } = track(room(["a", "b"]));
    for (const links of drivers.values()) links.setMembers([member("a"), member("b")]);
    await vi.waitFor(() => expect(drivers.get("a")!.states()).toEqual({ b: "direct" }), LINKED);
    drivers.get("a")!.setMembers([member("a")]);
    expect(drivers.get("a")!.states()).toEqual({});
    await vi.waitFor(() => expect(drivers.get("b")!.states()).toEqual({ a: "relay" }), LINKED);
  });

  it("falls back to the relay when the pair never connects", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { drivers, signals } = track(room(["a", "b"], false));
    drivers.get("a")!.setMembers([member("a"), member("b")]);
    await vi.waitFor(() => expect(signals.length).toBeGreaterThan(0));
    expect(drivers.get("a")!.states()).toEqual({ b: "connecting" });
    vi.advanceTimersByTime(15_000);
    expect(drivers.get("a")!.states()).toEqual({ b: "relay" });
    // A failed pair is remembered, not re-offered on every snapshot.
    const sent = signals.length;
    drivers.get("a")!.setMembers([member("a"), member("b")]);
    expect(signals.length).toBe(sent);
  });

  it("ignores an offer from a driver whose id says it should answer", async () => {
    const { drivers, signals } = track(room(["a", "b"], false));
    await drivers.get("a")!.receiveSignal("b", { kind: "description", type: "offer", sdp: "v=0" });
    expect(drivers.get("a")!.states()).toEqual({});
    expect(signals).toEqual([]);
  });

  it("stops sending and receiving once disposed", async () => {
    const { drivers } = track(room(["a", "b"]));
    const received = vi.fn();
    drivers.get("b")!.onPose(received);
    for (const links of drivers.values()) links.setMembers([member("a"), member("b")]);
    await vi.waitFor(() => expect(drivers.get("b")!.states()).toEqual({ a: "direct" }), LINKED);
    drivers.get("b")!.dispose();
    expect(drivers.get("b")!.states()).toEqual({});
    drivers.get("a")!.broadcast(pose(2));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(received).not.toHaveBeenCalled();
  });
});

describe("pose frames", () => {
  it("round-trip every field", () => {
    expect(decodePose(encodePose(pose(9)))).toEqual(pose(9));
  });

  it("reject anything but a pose-sized frame of finite numbers", () => {
    expect(decodePose("{}")).toBeNull();
    expect(decodePose(new ArrayBuffer(48))).toBeNull();
    const bad = new Float64Array(encodePose(pose(1)));
    bad[3] = Number.NaN;
    expect(decodePose(bad.buffer)).toBeNull();
  });
});
