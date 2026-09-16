import { WebSocket } from "ws";
import type { ServerMessage } from "@racing/shared";

/** Send pre-serialized JSON; broadcasts stringify once and call this per recipient. */
export function sendEncoded(socket: WebSocket, data: string): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(data, (error) => {
    if (error) console.error("Failed to send racing update:", error);
  });
}

export function send(socket: WebSocket, message: ServerMessage): void {
  sendEncoded(socket, JSON.stringify(message));
}
