import type { ClientMessage, ServerMessage } from "@racing/shared";
export type ConnectionState = "connected" | "connecting" | "offline";

export class Net {
  private socket: WebSocket | null = null;
  private cancelConnection: (() => void) | null = null;
  private readonly messages = new Set<(message: ServerMessage) => void>();
  private readonly statuses = new Set<(state: ConnectionState) => void>();
  private status(state: ConnectionState): void {
    this.statuses.forEach((callback) => callback(state));
  }
  connect(url: string): Promise<void> {
    this.cancelConnection?.();
    const previous = this.socket;
    this.socket = null;
    previous?.close();
    this.status("connecting");
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      this.socket = socket;
      let settled = false;
      const settle = (error?: Error): void => {
        if (settled) return;
        settled = true;
        if (this.cancelConnection === cancel) this.cancelConnection = null;
        if (error) reject(error);
        else resolve();
      };
      const cancel = (): void =>
        settle(new DOMException("Connection superseded", "AbortError"));
      this.cancelConnection = cancel;
      socket.addEventListener("open", () => {
        if (this.socket !== socket) return;
        settle();
        this.status("connected");
      });
      socket.addEventListener("error", () => {
        if (this.socket !== socket) return;
        settle(new Error("The racing server is unavailable."));
      });
      socket.addEventListener("close", () => {
        if (this.socket !== socket) return;
        settle(new Error("The connection closed."));
        this.status("offline");
      });
      socket.addEventListener("message", (event) => {
        if (this.socket !== socket || typeof event.data !== "string") return;
        let data: unknown;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }
        if (typeof (data as { type?: unknown })?.type !== "string") return;
        for (const callback of this.messages) callback(data as ServerMessage);
      });
    });
  }
  send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify(message));
  }
  onMessage(callback: (message: ServerMessage) => void): () => void {
    this.messages.add(callback);
    return () => this.messages.delete(callback);
  }
  onStatus(callback: (state: ConnectionState) => void): () => void {
    this.statuses.add(callback);
    return () => this.statuses.delete(callback);
  }
}
