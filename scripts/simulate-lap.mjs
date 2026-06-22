// Drive a synthetic car through the track via the live server, then exit.
// Use to smoke-test sector splits end-to-end without a browser.
import WebSocket from "ws";
import { CHECKPOINTS, NUM_CHECKPOINTS } from "../shared/src/track.ts";

const NAME = process.argv[2] ?? "TestBot";
const DIFFICULTY = process.argv[3] ?? "medium";
const URL = process.argv[4] ?? "ws://localhost:8080";

function log(...args) {
  console.log("[client]", ...args);
}

function send(ws, msg) {
  ws.send(JSON.stringify(msg));
}

async function main() {
  const ws = new WebSocket(URL);
  await new Promise((res, rej) => {
    ws.once("open", res);
    ws.once("error", rej);
  });
  log("connected");

  let welcomed = false;
  const seen = [];
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === "snapshot") return;
    seen.push(msg);
    if (msg.type === "welcome") welcomed = true;
    log("recv", msg);
  });

  while (!welcomed) await new Promise((res) => setTimeout(res, 50));
  send(ws, { type: "hello", name: NAME });
  send(ws, { type: "createRoom", roomName: "Test", difficulty: DIFFICULTY });
  log("waiting for joined…");
  await new Promise((res) => setTimeout(res, 500));

  const cpDelayMs = [
    1100, 1200, 1000, 1100,
    1300, 1100, 1200, 1300,
    900, 1100, 1000, 1200,
  ];

  const start = CHECKPOINTS[0];
  log("→ CP0 start");
  send(ws, { type: "state", x: start.x, y: 0, z: start.z, rot: 0, speed: 0 });
  await new Promise((res) => setTimeout(res, 300));

  for (let i = 1; i <= NUM_CHECKPOINTS; i++) {
    await new Promise((res) => setTimeout(res, cpDelayMs[i - 1]));
    const cp = CHECKPOINTS[i % NUM_CHECKPOINTS];
    log(`→ CP${i % NUM_CHECKPOINTS}`);
    send(ws, { type: "state", x: cp.x, y: 0, z: cp.z, rot: 0, speed: 30 });
  }

  await new Promise((res) => setTimeout(res, 800));
  ws.close();
  log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
