import {
  JEV_TRACK,
  JEV_VARIANT,
  type ClientMessage,
  type RacePacer,
  type RaceState,
  type ReplayFrame,
  type ServerMessage,
  type TrackSlug,
  type Variant,
} from "@racing/shared";
import { Net } from "./net";
import { Game } from "./game/game";
import { JEV_LAP } from "./game/jev-lap";
import type { JevRecording } from "./game/jev-recording";
import { ReplayViewer } from "./game/replay";
import { preloadModels } from "./game/models";
import { Sound } from "./game/sound";
import { SoundSettings } from "./game/sound-settings";
import { Lobby } from "./ui/lobby";
import { LoadingScreen } from "./ui/loading-screen";

/** Owns transitions between lobby, live driving and replay playback. */
export class RacingApp {
  private readonly net = new Net();
  private readonly sound = new Sound(new SoundSettings());
  private readonly lobby: Lobby;
  private readonly assets: Promise<void>;
  private view: Game | ReplayViewer | null = null;
  private playerId = "";
  private revision = 0;
  private connectionAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private connected = false;
  /** From asking to enter a Room until its Game exists; Create, Join and Daily wait meanwhile. */
  private joining = false;
  /**
   * The Replay the Lobby asked for. Only its reply opens the viewer: a Pacer's or
   * Rival's asked for in a Room can arrive after leaving it.
   */
  private lobbyReplay: { name: string; track: TrackSlug } | null = null;
  private notice: HTMLElement | null = null;
  /**
   * The Room's latest race and its grid Pacers. A driver joining mid-race is sent
   * both right after `joined`, before the Game exists to take them.
   */
  private race: RaceState | null = null;
  private racePacers: RacePacer[] = [];
  /** The Variant the server holds for this driver, which their own car must match. */
  private variant: Variant | undefined;

  constructor(private readonly root: HTMLElement) {
    this.lobby = new Lobby(
      root,
      {
        onCreate: (roomName, track, difficulty) =>
          this.enterRoom({ type: "createRoom", roomName, track, difficulty }),
        onJoin: (roomId) => this.enterRoom({ type: "joinRoom", roomId }),
        onReplay: (name, track, difficulty) => {
          this.lobbyReplay = { name, track };
          this.net.send({ type: "getReplay", name, track, difficulty });
        },
        onVariantChange: () => this.hello(),
        onNameChange: () => this.requestStandings(),
        onReferenceLap: () => {
          const lap = this.lobby.getReferenceLap();
          if (lap) void this.openReplay(lap.name, lap.track, lap.timeMs, lap.frames, lap.variant);
        },
        onJevLap: () => void this.openJevLap(),
        onDaily: () => this.enterRoom({ type: "joinDaily" }),
      },
      this.sound.settings,
    );
    this.net.onMessage((message) => void this.receive(message));
    this.net.onStatus((state) => {
      const wasConnected = this.connected;
      this.connected = state === "connected";
      this.lobby.setConnection(state);
      if (state === "offline") {
        // Replays, the AI Record and the Jev Lap need no server and play on.
        if (this.view instanceof Game || this.joining) this.returnToLobby();
        // A connection that never opened is reported by start() instead.
        if (wasConnected) this.scheduleReconnect("Connection lost.");
      }
      this.paintStartable();
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
  /** Sends one createRoom, joinRoom or joinDaily at a time, answered by joined or error. */
  private enterRoom(
    message: Extract<ClientMessage, { type: "createRoom" | "joinRoom" | "joinDaily" }>,
  ): void {
    if (!this.connected || this.joining) return;
    this.setJoining(true);
    this.lobbyReplay = null;
    this.hello();
    this.net.send(message);
  }
  private setJoining(joining: boolean): void {
    this.joining = joining;
    this.paintStartable();
  }
  private paintStartable(): void {
    this.lobby.setStartable(this.connected && !this.joining);
  }
  private hello(): void {
    this.variant = this.lobby.selectedVariant;
    this.net.send({ type: "hello", name: this.lobby.playerName, variant: this.variant });
  }
  /** Medals, unlocks and the Rival all derive from the driver name's Standings. */
  private requestStandings(): void {
    this.net.send({ type: "getStandings", name: this.lobby.playerName });
  }
  private returnToLobby(): void {
    this.revision++;
    this.setJoining(false);
    this.race = null;
    this.racePacers = [];
    this.view?.dispose();
    this.view = null;
    this.lobby.show();
  }
  private async receive(message: ServerMessage): Promise<void> {
    switch (message.type) {
      case "welcome":
        // Only a server that got this far resets the backoff: one that accepts and
        // drops every connection keeps being retried ever more slowly.
        this.reconnectDelay = 1000;
        this.playerId = message.playerId;
        this.lobby.setRooms(message.rooms);
        this.lobby.setLeaderboard(message.leaderboard);
        this.lobby.setDaily(message.daily);
        this.requestStandings();
        return;
      case "daily":
        this.lobby.setDaily(message.board);
        return;
      case "standings":
        // A lap finished under a name the driver has since changed reports the old name.
        if (message.name !== this.lobby.playerName) return;
        this.lobby.setStandings(message.standings);
        if (this.view instanceof Game) this.view.setStandings(message.standings, message.afterLap);
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
        // How the server turns down a createRoom, joinRoom or joinDaily.
        this.setJoining(false);
        this.showError(message.message);
        return;
      case "race":
        this.race = message.race;
        if (this.view instanceof Game) this.view.onMessage(message);
        return;
      case "racePacers":
        this.racePacers = message.pacers;
        if (this.view instanceof Game) this.view.onMessage(message);
        return;
      case "replay": {
        if (this.view instanceof Game) {
          this.view.receiveReplayFrames(message.frames, message.variant, message.name);
          return;
        }
        const asked = this.lobbyReplay;
        if (asked?.name !== message.name || asked.track !== message.track) return;
        this.lobbyReplay = null;
        await this.openReplay(
          message.name,
          message.track,
          message.timeMs,
          message.frames,
          message.variant,
        );
        return;
      }
      case "joined": {
        this.returnToLobby();
        this.setJoining(true);
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
            // A Daily Room forces its Variant; the Garage choice stays saved for other Rooms.
            message.daily?.variant ?? this.variant,
            this.lobby.steering,
            message.daily?.scene,
            this.sound,
          );
          this.view = game;
          this.setJoining(false);
          game.setStandings(this.lobby.standings);
          if (this.race) {
            game.onMessage({ type: "racePacers", pacers: this.racePacers });
            game.onMessage({ type: "race", race: this.race });
          }
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
    jev?: JevRecording,
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
        jev,
      );
    } catch (error) {
      console.error("Replay view could not start", error);
      this.returnToLobby();
      this.showError("The replay could not start. Please try again.");
    }
  }
  /** Replays the bundled Jev Lap in Jev's car, with Jev's decisions alongside. */
  private async openJevLap(): Promise<void> {
    const lap = JEV_LAP;
    if (lap) await this.openReplay("Jev", JEV_TRACK, lap.timeMs, lap.frames, JEV_VARIANT, lap);
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
