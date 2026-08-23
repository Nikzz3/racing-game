import "./style.css";
import { Net } from "./net";
import { Game } from "./game/game";
import { ReplayViewer } from "./game/replay";
import { areModelsLoaded, preloadModels } from "./game/models";
import { Lobby } from "./ui/lobby";
import type { ReplayFrame, TrackSlug } from "@racing/shared";

const app = document.getElementById("app")!;
const net = new Net();

let myId = "";
let game: Game | null = null;
let replay: ReplayViewer | null = null;
// Incremented on every "joined" and "left" so a modelsReady.then() callback can
// detect whether it has been superseded before constructing the Game.
let gameGen = 0;
// Incremented on every openReplay() call and whenever a Game supersedes a pending
// replay, so a deferred modelsReady.then() callback can detect it's stale before
// constructing the ReplayViewer.
let replayGen = 0;

/** Swap the lobby for a replay viewer that restores the lobby when closed. */
function openReplay(
  name: string,
  track: TrackSlug,
  timeMs: number,
  frames: ReplayFrame[]
): void {
  if (game) return;
  replay?.dispose();
  replay = null;
  const gen = ++replayGen;
  // Same rationale as the Game gate below: never build a ReplayViewer (and its
  // car mesh) while model preload is still in flight, or it's stuck with fallback
  // procedural assets. If already loaded, skip the microtask hop entirely so
  // opening a replay after startup feels instant. lobby.hide() is deferred to
  // here (rather than called unconditionally up front) so a still-loading state
  // leaves the player in the lobby instead of staring at a blank screen with no
  // way to cancel; the fast path hides immediately, same as before.
  const build = () => {
    if (gen !== replayGen || game) return;
    lobby.hide();
    replay = new ReplayViewer(app, name, track, timeMs, frames, () => {
      replay = null;
      lobby.show();
    });
  };
  if (areModelsLoaded()) {
    build();
  } else {
    modelsReady.then(build);
  }
}

/** The driver's identity (name + Variant), sent before entering a Room and on every Garage change. */
function sendHello(): void {
  net.send({ type: "hello", name: lobby.playerName, variant: lobby.selectedVariant });
}

const lobby = new Lobby(app, {
  onCreate: (roomName, track, difficulty) => {
    sendHello();
    net.send({ type: "createRoom", roomName, difficulty, track });
  },
  onJoin: (roomId) => {
    sendHello();
    net.send({ type: "joinRoom", roomId });
  },
  onReplay: (name, track, difficulty) => net.send({ type: "getReplay", name, track, difficulty }),
  // The server accepts hello at any time and folds the Variant into the next
  // snapshot, so a Garage change is live without leaving the Lobby.
  onVariantChange: sendHello,
  onReferenceLap: () => {
    if (game) return;
    const lap = lobby.getReferenceLap();
    if (lap) openReplay(lap.name, lap.track, lap.timeMs, lap.frames);
  },
});

net.onMessage((msg) => {
  switch (msg.type) {
    case "welcome":
      myId = msg.playerId;
      lobby.setRooms(msg.rooms);
      lobby.setLeaderboard(msg.leaderboard);
      break;
    case "rooms":
      lobby.setRooms(msg.rooms);
      break;
    case "leaderboard":
      lobby.setLeaderboard(msg.entries);
      break;
    case "joined": {
      lobby.hide();
      game?.dispose();
      game = null;
      replay?.dispose();
      replay = null;
      ++replayGen; // cancel any pending openReplay() construction; Game takes priority
      const gen = ++gameGen;
      const armed = lobby.armedPacer;
      const matchingPacer =
        armed && armed.track === msg.track && armed.difficulty === msg.difficulty
          ? armed
          : null;
      // Defer construction until the model preload settles so a Game is never
      // built with fallback procedural assets merely because a download is still
      // in progress. (preloadModels() resolves even when loads fail; a failed
      // model's fallback is the deliberate degraded mode.) If the player leaves
      // before it settles, gameGen is bumped and this callback is a no-op.
      modelsReady.then(() => {
        if (gen !== gameGen) return;
        try {
          game = new Game(
            app,
            net,
            myId,
            msg.roomName,
            () => net.send({ type: "leaveRoom" }),
            msg.difficulty,
            msg.track,
            matchingPacer,
            lobby.selectedVariant
          );
        } catch (err) {
          // e.g. WebGL context creation failure; leaveRoom makes the server
          // send "left", which restores the lobby.
          console.error("Failed to start game", err);
          net.send({ type: "leaveRoom" });
          return;
        }
        if (matchingPacer) {
          if (matchingPacer.kind === "ai") {
            // The AI Pacer's frames are already baked and memoized in the
            // lobby; hand them straight to the Game — no getReplay round trip,
            // no server involvement (ADR-0006).
            game.receiveReplayFrames(matchingPacer.frames);
          } else {
            net.send({
              type: "getReplay",
              name: matchingPacer.name,
              track: matchingPacer.track,
              difficulty: matchingPacer.difficulty,
            });
          }
        }
      });
      break;
    }
    case "left":
      ++gameGen; // cancel any pending modelsReady.then() game creation
      game?.dispose();
      game = null;
      lobby.show();
      break;
    case "replay":
      if (game) {
        game.receiveReplayFrames(msg.frames);
      } else {
        openReplay(msg.name, msg.track, msg.timeMs, msg.frames);
      }
      break;
    case "error":
      alert(msg.message);
      break;
    default:
      game?.onMessage(msg);
  }
});

// Load models and connect in parallel; both must finish before a game can start.
const modelsReady = preloadModels();
void modelsReady.then(() => lobby.paintGarageThumbnails());

try {
  const wsUrl = import.meta.env.DEV
    ? `ws://${location.hostname}:${import.meta.env.VITE_SERVER_PORT ?? "8080"}`
    : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
  await net.connect(wsUrl);
  await modelsReady;
} catch {
  const err = document.createElement("div");
  err.className = "connect-error";
  err.innerHTML =
    "Could not connect to the game server.<br/>Start it with <code>npm run dev</code> and reload.";
  document.body.appendChild(err);
}
