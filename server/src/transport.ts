import { WebSocket } from "ws";
import type { ServerMessage } from "@racing/shared";

/**
 * Backlog past which a socket counts as not draining (a stalled or too-slow
 * link). ws queues every send in process memory until the kernel takes it, so
 * without a ceiling a stalled driver grows the server by each snapshot until
 * TCP gives up, and a slow one sees positions ever further in the past.
 */
export const MAX_BUFFERED_BYTES = 64 * 1024;

/**
 * Backlog past which a socket is cut off as no longer reading. The largest
 * legitimate burst, a grid's Pacers plus a Replay (each recording at most 6000
 * frames, ~230 KB), is about 1.4 MB, so only a client that stopped reading
 * gets here, instead of growing the server's memory without bound.
 */
export const MAX_QUEUED_BYTES = 4 * 1024 * 1024;

/** Send pre-serialized JSON; broadcasts stringify once and call this per recipient. */
export function sendEncoded(socket: WebSocket, data: string): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  if (socket.bufferedAmount > MAX_QUEUED_BYTES) {
    socket.terminate();
    return;
  }
  socket.send(data, (error) => {
    if (error) console.error("Failed to send racing update:", error);
  });
}

/**
 * Send a message the next one supersedes (a position snapshot): skipped while
 * the socket is backlogged, so a lagging client catches up on the latest state
 * instead of queueing stale ones.
 */
export function sendLatest(socket: WebSocket, data: string): void {
  if (socket.bufferedAmount > MAX_BUFFERED_BYTES) return;
  sendEncoded(socket, data);
}

export function send(socket: WebSocket, message: ServerMessage): void {
  sendEncoded(socket, JSON.stringify(message));
}
