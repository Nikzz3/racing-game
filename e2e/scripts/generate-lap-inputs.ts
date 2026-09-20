import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runAutopilotLap } from "../../client/src/game/harness";

const result = runAutopilotLap({ difficulty: "medium" });
if (!result) throw new Error("autopilot failed to complete a lap");

const output = resolve(import.meta.dirname, "../lap-inputs.json");
await writeFile(output, `${JSON.stringify(result.inputs)}\n`);
console.log(
  `Wrote ${result.steps} inputs (${(result.lapTimeMs / 1000).toFixed(2)}s simulated lap)`,
);
