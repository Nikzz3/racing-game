/**
 * Runs assets/blender/track_tools.py in a headless Blender.
 *
 * Usage: npm run track:new -- <slug> "<Name>"   create assets/blender/tracks/<slug>.blend
 *        npm run track:export -- <slug>         write the track's JSON and GLB from its .blend
 *
 * Set BLENDER to the Blender binary if it is not the macOS default or on PATH.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MAC_BLENDER = "/Applications/Blender.app/Contents/MacOS/Blender";
const blender = process.env.BLENDER ?? (existsSync(MAC_BLENDER) ? MAC_BLENDER : "blender");
const tools = `${ROOT}assets/blender/track_tools.py`;

const [command, slug, name = ""] = process.argv.slice(2);
if (!slug || (command !== "new" && command !== "export")) {
  console.error('Usage: blender-track.ts new <slug> "<Name>" | export <slug>');
  process.exit(1);
}
const file = command === "export" ? [`${ROOT}assets/blender/tracks/${slug}.blend`] : [];
const { status } = spawnSync(
  blender,
  [
    "-b",
    "--factory-startup",
    ...file,
    "--python",
    tools,
    "--python-exit-code",
    "1",
    "--",
    command,
    slug,
    name,
  ],
  { stdio: "inherit" },
);
process.exit(status ?? 1);
