import type {
  ReplayFrame,
  ServerMessage,
  TrackSlug,
  Variant,
} from "@racing/shared";
import { Net } from "./net";
import { Game } from "./game/game";
import { ReplayViewer } from "./game/replay";
import { preloadModels } from "./game/models";
import { Lobby } from "./ui/lobby";

/** Owns transitions between lobby, live driving and replay playback. */
export class RacingApp {
  private readonly net = new Net();
  private readonly lobby: Lobby;
  private readonly assets = preloadModels();
  private view: Game | ReplayViewer | null = null;
  private playerId = "";
  private revision = 0;
  private connectionAttempt = 0;
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
        if (lap)
          void this.openReplay(
            lap.name,
            lap.track,
            lap.timeMs,
            lap.frames,
            lap.variant,
          );
      },
    });
    this.net.onMessage((message) => void this.receive(message));
    this.net.onStatus((state) => {
      this.lobby.setConnection(state);
      if (state === "offline") {
        this.returnToLobby();
        this.showError(
          "Connection lost. Reconnect to return to the grid.",
          true,
        );
      }
    });
    void this.assets.then(() => this.lobby.paintGarageThumbnails());
  }
  async start(): Promise<void> {
    const attempt = ++this.connectionAttempt;
    this.notice?.remove();
    this.notice = null;
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const host = import.meta.env.DEV
      ? `${location.hostname}:${import.meta.env.VITE_SERVER_PORT ?? "8080"}`
      : location.host;
    try {
      await this.net.connect(`${protocol}://${host}`);
    } catch (error) {
      if (
        attempt !== this.connectionAttempt ||
        (error instanceof DOMException && error.name === "AbortError")
      )
        return;
      this.showError(
        "The racing server is unavailable. Try connecting again.",
        true,
      );
    }
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
          choice?.track === message.track &&
          choice.difficulty === message.difficulty
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
          );
          this.view = game;
          this.joining = false;
          if (pacer?.kind === "ai")
            game.receiveReplayFrames(pacer.frames, pacer.variant);
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
      this.view = new ReplayViewer(
        this.root,
        name,
        track,
        time,
        frames,
        variant,
        () => this.returnToLobby(),
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
