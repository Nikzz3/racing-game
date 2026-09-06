import { WebSocket } from "ws";
import type { ServerMessage } from "@racing/shared";

/** Isolate failed sockets so one disconnected driver cannot interrupt a broadcast. */
export function sendEncoded(socket: WebSocket, data: string): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(data, (error) => {
      if (error) console.error("Failed to send racing update:", error);
    });
  } catch (error) {
    console.error("Failed to send racing update:", error);
  }
}

export function send(socket: WebSocket, message: ServerMessage): void {
  sendEncoded(socket, JSON.stringify(message));
}
