// electron-builder afterPack hook: ad-hoc sign the macOS bundle when no real
// signing identity is configured.
//
// electron-builder skips signing entirely without a Developer ID certificate.
// On Apple Silicon a bundle with no signature at all is what makes Gatekeeper show
// "is damaged and can't be opened" (only Move to Trash offered). An ad-hoc
// signature (`codesign --sign -`) needs no Apple account and turns that into the
// "Apple could not verify" dialog, which users can override under
// System Settings → Privacy & Security → Open Anyway (or `xattr -cr` the app).
// Real signing + notarization (CSC_LINK / APPLE_* secrets) remains the proper fix;
// when those are present electron-builder signs itself and this hook does nothing.
const { execFileSync } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const path = require("node:path");

// Marker the running app reads (see UNSIGNED_MARKER in src/main.ts): an ad-hoc
// signed bundle can never be updated in place by Squirrel.Mac, so the updater
// skips the download and sends the player to the releases page instead.
const UNSIGNED_MARKER = "unsigned-build";

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  if (process.env.CSC_LINK || process.env.CSC_NAME) return; // real identity in play
  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  console.log(`  • ad-hoc signing (no certificate configured)  file=${appPath}`);
  // Written before signing so the seal covers it.
  writeFileSync(path.join(appPath, "Contents", "Resources", UNSIGNED_MARKER), "");
  // --deep is deprecated for distribution signing but is the pragmatic way to cover
  // the nested Electron frameworks and helpers with an ad-hoc identity.
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
};
