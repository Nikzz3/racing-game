import type { IceServer, PeerSignal, PlayerSnapshot, PoseStamp } from "@racing/shared";

/** A car pose as sent over a Direct Link: the same values the sender relays through the server. */
export interface DirectPose {
  stamp: PoseStamp;
  /** When the pose was current, on the sender's clock: the `t` of its `state`. */
  t: number;
  x: number;
  z: number;
  rot: number;
  speed: number;
}

/** `connecting` until the channel opens; `relay` once the pair gave up on a direct path. */
export type LinkState = "connecting" | "direct" | "relay";

/** Which path a remote car's drawn poses currently arrive by. */
export type PoseSource = "direct" | "relay";

type PeerConnectionFactory = (config: RTCConfiguration) => RTCPeerConnection;

interface Link {
  pc: RTCPeerConnection;
  channel: RTCDataChannel;
  state: LinkState;
  /** Candidates that arrived before the remote description they belong to. */
  pending: RTCIceCandidateInit[];
  /**
   * Local candidates gathered before our offer or answer went out. They must
   * not overtake it: the other side drops candidates for a link it lacks.
   */
  unsent: PeerSignal[] | null;
  /** Gives up on connecting, or, once failed, schedules the next attempt. */
  timeout: ReturnType<typeof setTimeout>;
  /** 1 for the first offer to this driver; counts the offering side's retries. */
  attempt: number;
}

/** Seven links is a full mesh for an eight-car Room; larger Rooms relay the rest. */
const MAX_LINKS = 7;
/** A pair still not linked by then (typically symmetric NAT without TURN) falls back to the relay. */
const LINK_TIMEOUT_MS = 15_000;
/**
 * The offering side tries again after a failure, waiting this long times the
 * attempt number: a link that dropped mid-race, or one negotiated while a
 * page was too busy to answer in time, recovers. A pair that NAT keeps apart
 * gives up for good after the last attempt.
 */
const RETRY_DELAY_MS = 5_000;
const MAX_ATTEMPTS = 4;
/** Poses are superseded every 50 ms: skip a send rather than queue behind a congested link. */
const MAX_BUFFERED_BYTES = 16 * 1024;
const POSE_FIELDS = 7;
const POSE_BYTES = POSE_FIELDS * Float64Array.BYTES_PER_ELEMENT;

export function encodePose({ stamp, t, x, z, rot, speed }: DirectPose): ArrayBuffer {
  return new Float64Array([stamp.seq, t, stamp.epoch, x, z, rot, speed]).buffer;
}

/** Peers are untrusted: anything but a pose-sized frame of finite numbers is dropped. */
export function decodePose(data: unknown): DirectPose | null {
  if (!(data instanceof ArrayBuffer) || data.byteLength !== POSE_BYTES) return null;
  const values = new Float64Array(data);
  if (!values.every(Number.isFinite)) return null;
  const [seq, t, epoch, x, z, rot, speed] = values;
  return { stamp: { seq, epoch }, t, x, z, rot, speed };
}

/** One unusable candidate (say, an unresolvable mDNS host) must not sink the link. */
async function addCandidate(pc: RTCPeerConnection, candidate: RTCIceCandidateInit): Promise<void> {
  try {
    await pc.addIceCandidate(candidate);
  } catch {
    // Other candidates may still connect; the link timeout covers the case where none do.
  }
}

/**
 * Direct Links (ADR-0009): a full mesh of WebRTC data channels between the
 * drivers in one Room, carrying only car poses. The server relays the
 * negotiation and keeps relaying every pose too, so a pair that cannot link
 * directly, or whose link drops, loses nothing but latency.
 *
 * Roles are fixed by id — the lower id offers — so the two sides never offer
 * at once. The pose channel is pre-agreed (`negotiated`, id 0), unordered and
 * never retransmitted: a lost pose is replaced 50 ms later by a newer one.
 */
export class DirectLinks {
  private readonly links = new Map<string, Link>();
  private readonly listeners = new Set<(id: string, pose: DirectPose) => void>();
  private disposed = false;
  /** Building a peer connection threw: the ICE config is unusable for every peer. */
  private unusable = false;

  constructor(
    private readonly myId: string,
    private readonly iceServers: IceServer[],
    private readonly sendSignal: (to: string, signal: PeerSignal) => void,
    private readonly createPeerConnection: PeerConnectionFactory = (config) =>
      new RTCPeerConnection(config),
  ) {}

  /** Whether this runtime can open Direct Links at all. */
  static supported(): boolean {
    return typeof RTCPeerConnection === "function";
  }

  /** Follow the Room's membership: link to new capable drivers, drop departed ones. */
  setMembers(players: PlayerSnapshot[]): void {
    if (this.disposed || this.unusable) return;
    const members = new Set(
      players.filter((player) => player.id !== this.myId && player.direct).map(({ id }) => id),
    );
    for (const id of this.links.keys()) if (!members.has(id)) this.close(id);
    for (const id of members)
      if (!this.links.has(id) && this.myId < id && this.links.size < MAX_LINKS)
        void this.offer(id, this.open(id));
  }

  async receiveSignal(from: string, signal: PeerSignal): Promise<void> {
    if (this.disposed || this.unusable || from === this.myId) return;
    let link = this.links.get(from);
    try {
      if (signal.kind === "candidate") {
        if (!link) return;
        const candidate: RTCIceCandidateInit = {
          candidate: signal.candidate,
          sdpMid: signal.sdpMid,
          sdpMLineIndex: signal.sdpMLineIndex,
        };
        if (link.pc.remoteDescription) await addCandidate(link.pc, candidate);
        else link.pending.push(candidate);
        return;
      }
      if (signal.type === "offer") {
        // Only the higher id answers; a repeat offer means the peer started over.
        if (this.myId < from) return;
        if (link) this.close(from);
        if (this.links.size >= MAX_LINKS) return;
        link = this.open(from) ?? undefined;
        if (!link) return;
        await this.accept(link, { type: "offer", sdp: signal.sdp });
        const answer = await link.pc.createAnswer();
        await link.pc.setLocalDescription(answer);
        this.describe(from, link, "answer", answer.sdp);
      } else if (link?.pc.signalingState === "have-local-offer") {
        await this.accept(link, { type: "answer", sdp: signal.sdp });
      }
    } catch (error) {
      console.warn(`Direct Link to ${from} failed; using the relay`, error);
      if (link) this.fail(from, link);
    }
  }

  /** Send a pose to every linked driver; the caller relays it through the server as well. */
  broadcast(pose: DirectPose): void {
    let data: ArrayBuffer | null = null;
    for (const { state, channel } of this.links.values()) {
      if (state !== "direct" || channel.readyState !== "open") continue;
      if (channel.bufferedAmount > MAX_BUFFERED_BYTES) continue;
      data ??= encodePose(pose);
      try {
        channel.send(data);
      } catch {
        // A channel closing under us reports through onclose; the relay has this pose.
      }
    }
  }

  onPose(callback: (id: string, pose: DirectPose) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  states(): Record<string, LinkState> {
    return Object.fromEntries([...this.links].map(([id, link]) => [id, link.state]));
  }

  dispose(): void {
    this.disposed = true;
    for (const id of this.links.keys()) this.close(id);
    this.listeners.clear();
  }

  /**
   * Start a link, or null when a peer connection cannot be built at all. That
   * throws synchronously (a malformed ICE server, say) and would do so for every
   * peer, so Direct Links stand down and every pair stays on the relay.
   */
  private open(id: string, attempt = 1): Link | null {
    let pc: RTCPeerConnection | undefined;
    let channel: RTCDataChannel;
    try {
      pc = this.createPeerConnection({ iceServers: this.iceServers });
      channel = pc.createDataChannel("poses", {
        negotiated: true,
        id: 0,
        ordered: false,
        maxRetransmits: 0,
      });
    } catch (error) {
      console.warn("Direct Links unavailable; using the relay", error);
      pc?.close();
      this.unusable = true;
      return null;
    }
    channel.binaryType = "arraybuffer";
    const link: Link = {
      pc,
      channel,
      state: "connecting",
      pending: [],
      unsent: [],
      timeout: setTimeout(() => this.fail(id, link), LINK_TIMEOUT_MS),
      attempt,
    };
    pc.onicecandidate = ({ candidate }) => {
      if (!candidate?.candidate || this.links.get(id) !== link) return;
      const signal: PeerSignal = {
        kind: "candidate",
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid ?? null,
        sdpMLineIndex: candidate.sdpMLineIndex ?? null,
      };
      if (link.unsent) link.unsent.push(signal);
      else this.sendSignal(id, signal);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") this.fail(id, link);
    };
    channel.onopen = () => {
      if (this.links.get(id) !== link) return;
      clearTimeout(link.timeout);
      link.state = "direct";
    };
    channel.onclose = () => this.fail(id, link);
    channel.onmessage = ({ data }: MessageEvent) => {
      const pose = decodePose(data);
      if (!pose || this.links.get(id) !== link) return;
      for (const listener of this.listeners) listener(id, pose);
    };
    this.links.set(id, link);
    return link;
  }

  private async offer(id: string, link: Link | null): Promise<void> {
    if (!link) return;
    try {
      const offer = await link.pc.createOffer();
      await link.pc.setLocalDescription(offer);
      this.describe(id, link, "offer", offer.sdp);
    } catch (error) {
      console.warn(`Direct Link to ${id} failed; using the relay`, error);
      this.fail(id, link);
    }
  }

  /** Send our offer or answer, then the candidates gathered while it was being made. */
  private describe(id: string, link: Link, type: "offer" | "answer", sdp = ""): void {
    if (this.links.get(id) !== link) return;
    this.sendSignal(id, { kind: "description", type, sdp });
    for (const signal of link.unsent ?? []) this.sendSignal(id, signal);
    link.unsent = null;
  }

  private async accept(link: Link, description: RTCSessionDescriptionInit): Promise<void> {
    await link.pc.setRemoteDescription(description);
    for (const candidate of link.pending.splice(0)) await addCandidate(link.pc, candidate);
  }

  /**
   * Give up on this attempt but remember the pair, so a snapshot does not
   * re-offer it; the offering side schedules its own retry instead.
   */
  private fail(id: string, link: Link): void {
    if (this.links.get(id) !== link || link.state === "relay") return;
    link.state = "relay";
    this.shutdown(link);
    if (this.myId > id || link.attempt >= MAX_ATTEMPTS) return;
    link.timeout = setTimeout(() => {
      if (this.links.get(id) === link) void this.offer(id, this.open(id, link.attempt + 1));
    }, RETRY_DELAY_MS * link.attempt);
  }

  private close(id: string): void {
    const link = this.links.get(id);
    if (!link) return;
    this.links.delete(id);
    this.shutdown(link);
  }

  private shutdown(link: Link): void {
    clearTimeout(link.timeout);
    link.pc.onicecandidate = null;
    link.pc.onconnectionstatechange = null;
    link.channel.onopen = null;
    link.channel.onclose = null;
    link.channel.onmessage = null;
    link.pending = [];
    link.unsent = null;
    link.pc.close();
  }
}
