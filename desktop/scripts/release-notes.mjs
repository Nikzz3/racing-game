// Print the Markdown body for the GitHub release of a desktop tag.
//
// Usage: node desktop/scripts/release-notes.mjs v0.2.0 > notes.md
//
// The download links are derived from the `artifactName` template in
// electron-builder.yml (`Sunset-Ridge-Racing-${version}-${os}-${arch}.${ext}`), so
// keep the two in sync. electron-builder renders `${os}` as mac/win/linux and
// `${arch}` as x64/arm64 on macOS, x64 on Windows and x86_64 for the AppImage.
// Needs a full clone: it walks tags and history via git.
import { execFileSync } from "node:child_process";

const REPO = "https://github.com/Nikzz3/racing-game";
// Paths whose commits count as "desktop work" for a first release, when there is
// no previous tag to diff against and the whole history would be noise.
const DESKTOP_PATHS = ["desktop", ".github/workflows/desktop.yml"];

const tag = process.argv[2];
if (!tag || !/^v\d+\.\d+\.\d+/.test(tag)) {
  console.error("usage: release-notes.mjs v<major>.<minor>.<patch>");
  process.exit(2);
}
const version = tag.slice(1);

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function previousTag() {
  try {
    return git("describe", "--tags", "--abbrev=0", "--match", "v*", `${tag}^`);
  } catch {
    return null; // first release: nothing before this tag
  }
}

// Non-merge commits as [shortSha, subject], newest first.
function commits(range, paths = []) {
  const out = git("log", "--no-merges", "--format=%h%x00%s", range, "--", ...paths);
  return out === "" ? [] : out.split("\n").map((line) => line.split("\0"));
}

function bullet([sha, subject]) {
  return `- ${subject} ([${sha}](${REPO}/commit/${sha}))`;
}

const asset = (os, arch, ext) => `Sunset-Ridge-Racing-${version}-${os}-${arch}.${ext}`;
const link = (file) => `[${file}](${REPO}/releases/download/${tag}/${file})`;

const downloads = [
  ["macOS (Apple Silicon)", asset("mac", "arm64", "dmg")],
  ["macOS (Intel)", asset("mac", "x64", "dmg")],
  ["Windows (x64)", asset("win", "x64", "exe")],
  ["Linux (x64 AppImage)", asset("linux", "x86_64", "AppImage")],
];

const prev = previousTag();
const lines = [];

lines.push(`Sunset Ridge Racing ${version} for macOS, Windows and Linux. Installed apps pick this release up automatically once it is published.`);
lines.push("");
lines.push("## Downloads");
lines.push("");
lines.push("| Platform | File |");
lines.push("| --- | --- |");
for (const [platform, file] of downloads) {
  lines.push(`| ${platform} | ${link(file)} |`);
}
lines.push("");
lines.push("- **macOS:** builds are unsigned, so right-click the app and choose **Open** on first launch.");
lines.push("- **Windows:** if SmartScreen appears, click **More info → Run anyway**.");
lines.push("- **Linux:** `chmod +x` the AppImage and run it; works on Bazzite and SteamOS (add it to Steam as a non-Steam game for Game Mode).");
lines.push("");
lines.push("## What's Changed");
lines.push("");

if (prev) {
  const list = commits(`${prev}..${tag}`);
  lines.push(...(list.length ? list.map(bullet) : ["- No commits since the previous release."]));
  lines.push("");
  lines.push(`**Full Changelog**: ${REPO}/compare/${prev}...${tag}`);
} else {
  lines.push(
    "First desktop release. The browser game is wrapped in Electron and shipped as native installers with in-app updates; the commits below are the ones that built that.",
  );
  lines.push("");
  lines.push(...commits(tag, DESKTOP_PATHS).map(bullet));
}

process.stdout.write(lines.join("\n") + "\n");
