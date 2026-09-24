import type { ReplayFrame, ServerMessage, TrackSlug, Variant } from "@racing/shared";
import { Net } from "./net";
import { Game } from "./game/game";
import { ReplayViewer } from "./game/replay";
import { preloadModels } from "./game/models";
import { Lobby } from "./ui/lobby";
import { LoadingScreen } from "./ui/loading-screen";

/** Owns transitions between lobby, live driving and replay playback. */
export class RacingApp {
  private readonly net = new Net();
  private readonly lobby: Lobby;
  private readonly assets: Promise<void>;
  private view: Game | ReplayViewer | null = null;
  private playerId = "";
  private revision = 0;
  private connectionAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private joining = false;
  private notice: HTMLElement | null = null;

  constructor(private readonly root: HTMLElement) {
    this.lobby = new Lobby(root, {
      onCreate: (roomName, track, difficulty) => {
        this.hello();
        this.net.send({ type: "createRoom", roomName, track, difficulty });
      },
      onJoin: (roomId) => {
        this.hello();
        this.net.send({ type: "joinRoom", roomId });
      },
      onReplay: (name, track, difficulty) =>
        this.net.send({ type: "getReplay", name, track, difficulty }),
      onVariantChange: () => this.hello(),
      onReferenceLap: () => {
        const lap = this.lobby.getReferenceLap();
        if (lap) void this.openReplay(lap.name, lap.track, lap.timeMs, lap.frames, lap.variant);
      },
    });
    this.net.onMessage((message) => void this.receive(message));
    this.net.onStatus((state) => {
      this.lobby.setConnection(state);
      if (state === "offline") {
        this.returnToLobby();
        this.scheduleReconnect("Connection lost.");
      }
    });
    const loading = new LoadingScreen(root);
    let assetFailure = false;
    this.assets = preloadModels((progress) => {
      assetFailure = progress.phase === "error";
      loading.update(progress);
    });
    void this.assets.then(async () => {
      // Give the opening status a frame before creating GPU resources.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      try {
        const garageReady = this.lobby.paintGarageThumbnails();
        if (assetFailure) return;
        if (!garageReady) {
          loading.fail(
            "The 3D garage could not start on this device. You can still choose a car and race.",
          );
          return;
        }
        // GarageStage draws synchronously. Reveal it after the browser presents it.
        requestAnimationFrame(() => loading.dismiss());
      } catch (error) {
        console.error("Garage could not start", error);
        loading.fail("The garage could not open. Try again or continue without 3D.");
      }
    });
  }
  async start(): Promise<void> {
    const attempt = ++this.connectionAttempt;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.notice?.remove();
    this.notice = null;
    try {
      await this.net.connect(resolveServerUrl());
      if (attempt === this.connectionAttempt) this.reconnectDelay = 1000;
    } catch (error) {
      if (
        attempt !== this.connectionAttempt ||
        (error instanceof DOMException && error.name === "AbortError")
      )
        return;
      this.scheduleReconnect("The racing server is unavailable.");
    }
  }
  private scheduleReconnect(message: string): void {
    // A failed attempt can report both an offline status and a rejected promise.
    if (this.reconnectTimer !== null) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(delay * 2, 30_000);
    this.showError(`${message} Reconnecting automatically in ${delay / 1000} seconds.`, true);
    this.reconnectTimer = setTimeout(() => void this.start(), delay);
  }
  private hello(): void {
    this.net.send({
      type: "hello",
      name: this.lobby.playerName,
      variant: this.lobby.selectedVariant,
    });
  }
  private returnToLobby(): void {
    this.revision++;
    this.joining = false;
    this.view?.dispose();
    this.view = null;
    this.lobby.show();
  }
  private async receive(message: ServerMessage): Promise<void> {
    switch (message.type) {
      case "welcome":
        this.playerId = message.playerId;
        this.lobby.setRooms(message.rooms);
        this.lobby.setLeaderboard(message.leaderboard);
        return;
      case "rooms":
        this.lobby.setRooms(message.rooms);
        return;
      case "leaderboard":
        this.lobby.setLeaderboard(message.entries);
        return;
      case "left":
        this.returnToLobby();
        return;
      case "error":
        this.showError(message.message);
        return;
      case "replay":
        if (this.view instanceof Game)
          this.view.receiveReplayFrames(message.frames, message.variant);
        else if (!this.joining)
          await this.openReplay(
            message.name,
            message.track,
            message.timeMs,
            message.frames,
            message.variant,
          );
        return;
      case "joined": {
        this.returnToLobby();
        this.joining = true;
        const revision = this.revision;
        const choice = this.lobby.armedPacer;
        const pacer =
          choice?.track === message.track && choice.difficulty === message.difficulty
            ? choice
            : null;
        await this.assets;
        if (revision !== this.revision) return;
        try {
          this.lobby.hide();
          const game = new Game(
            this.root,
            this.net,
            this.playerId,
            message.roomName,
            () => this.net.send({ type: "leaveRoom" }),
            message.difficulty,
            message.track,
            pacer,
            this.lobby.selectedVariant,
            this.lobby.steering,
          );
          this.view = game;
          this.joining = false;
          if (pacer?.kind === "ai") game.receiveReplayFrames(pacer.frames, pacer.variant);
          if (pacer?.kind === "replay")
            this.net.send({
              type: "getReplay",
              name: pacer.name,
              track: pacer.track,
              difficulty: pacer.difficulty,
            });
        } catch (error) {
          console.error("Race view could not start", error);
          this.net.send({ type: "leaveRoom" });
          this.returnToLobby();
          this.showError("The race view could not start. Please try again.");
        }
        return;
      }
      default:
        if (this.view instanceof Game) this.view.onMessage(message);
    }
  }
  private async openReplay(
    name: string,
    track: TrackSlug,
    time: number,
    frames: ReplayFrame[],
    variant?: Variant,
  ): Promise<void> {
    if (this.view instanceof Game || this.joining || frames.length < 2) return;
    const revision = ++this.revision;
    this.view?.dispose();
    this.view = null;
    await this.assets;
    if (revision !== this.revision) return;
    try {
      this.lobby.hide();
      this.view = new ReplayViewer(this.root, name, track, time, frames, variant, () =>
        this.returnToLobby(),
      );
    } catch (error) {
      console.error("Replay view could not start", error);
      this.returnToLobby();
      this.showError("The replay could not start. Please try again.");
    }
  }
  private showError(message: string, reconnect = false): void {
    this.notice?.remove();
    const notice = document.createElement("div");
    notice.className = "connect-error";
    notice.role = "alert";
    notice.textContent = message;
    const button = document.createElement("button");
    button.textContent = reconnect ? "Reconnect" : "Dismiss";
    button.onclick = () => {
      notice.remove();
      if (reconnect) void this.start();
    };
    notice.append(button);
    this.root.append(notice);
    this.notice = notice;
  }
}

/**
 * The desktop (Electron) build injects `window.desktop.serverUrl` from its preload script
 * because the page origin there (`app://bundle`) says nothing about where the server is.
 * In the browser the server is the same host that served the page (or the dev server's
 * sibling port).
 */
export function resolveServerUrl(): string {
  const injected = window.desktop?.serverUrl;
  if (injected) return injected;
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const host = import.meta.env.DEV
    ? `${location.hostname}:${import.meta.env.VITE_SERVER_PORT ?? "8080"}`
    : location.host;
  return `${protocol}://${host}`;
}
