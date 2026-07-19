import "./style.css";
import { Net } from "./net";
import { Game } from "./game/game";
import { ReplayViewer } from "./game/replay";
import { preloadModels } from "./game/models";
import { Lobby } from "./ui/lobby";
import { buildReferenceLap } from "./game/reference-lap";
import type { ReplayFrame, TrackSlug } from "@racing/shared";
import policy from "../../rl/policy.json";

const app = document.getElementById("app")!;
const net = new Net();

let myId = "";
let game: Game | null = null;
let replay: ReplayViewer | null = null;
// Incremented on every "joined" and "left" so a modelsReady.then() callback can
// detect whether it has been superseded before constructing the Game.
let gameGen = 0;

/** Swap the lobby for a replay viewer that restores the lobby when closed. */
function openReplay(
  name: string,
  track: TrackSlug,
  timeMs: number,
  frames: ReplayFrame[]
): void {
  if (game) return;
  replay?.dispose();
  lobby.hide();
  replay = new ReplayViewer(app, name, track, timeMs, frames, () => {
    replay = null;
    lobby.show();
  });
}

const lobby = new Lobby(app, {
  onCreate: (roomName, track, difficulty) => {
    net.send({ type: "hello", name: lobby.playerName });
    net.send({ type: "createRoom", roomName, difficulty, track });
  },
  onJoin: (roomId) => {
    net.send({ type: "hello", name: lobby.playerName });
    net.send({ type: "joinRoom", roomId });
  },
  onReplay: (name, track, difficulty) => net.send({ type: "getReplay", name, track, difficulty }),
  onReferenceLap: () => {
    if (game) return;
    const lap = buildReferenceLap(policy);
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
        game = new Game(
          app,
          net,
          myId,
          msg.roomName,
          () => net.send({ type: "leaveRoom" }),
          msg.difficulty,
          msg.track,
          matchingPacer
        );
        if (matchingPacer) {
          net.send({
            type: "getReplay",
            name: matchingPacer.name,
            track: matchingPacer.track,
            difficulty: matchingPacer.difficulty,
          });
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

try {
  const wsUrl = import.meta.env.DEV
    ? `ws://${location.hostname}:8080`
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
