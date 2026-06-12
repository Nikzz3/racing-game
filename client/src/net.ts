import type { ClientMessage, ServerMessage } from "@racing/shared";

export class Net {
  private ws: WebSocket | null = null;
  private listeners: ((msg: ServerMessage) => void)[] = [];

  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("Could not connect to game server"));
      ws.onmessage = (e) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        for (const l of this.listeners) l(msg);
      };
    });
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  onMessage(cb: (msg: ServerMessage) => void): void {
    this.listeners.push(cb);
  }
}
