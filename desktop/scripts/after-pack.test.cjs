// Covers the build-side half of the unsigned-build marker contract: the hook must
// drop `unsigned-build` into Contents/Resources exactly when it ad-hoc signs, and
// write it before signing so the seal covers it. The runtime half (main.ts reading
// the marker) has no harness; see the README.

const assert = require("node:assert/strict");
const { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const afterPack = require("./after-pack.cjs");
const MARKER = "unsigned-build";

function fakeBundle() {
  const appOutDir = mkdtempSync(path.join(os.tmpdir(), "after-pack-"));
  const appPath = path.join(appOutDir, "Sunset Ridge Racing.app");
  mkdirSync(path.join(appPath, "Contents", "Resources"), { recursive: true });
  return { appOutDir, appPath, marker: path.join(appPath, "Contents", "Resources", MARKER) };
}

// A stand-in `codesign` that records whether the marker already existed when it ran.
function stubCodesign(appPath) {
  const bin = mkdtempSync(path.join(os.tmpdir(), "codesign-stub-"));
  const log = path.join(bin, "codesign.log");
  const script = path.join(bin, "codesign");
  writeFileSync(
    script,
    `#!/bin/sh\nif [ -e "${path.join(appPath, "Contents", "Resources", MARKER)}" ]; then echo marker-present; else echo marker-absent; fi > "${log}"\n`,
    { mode: 0o755 },
  );
  return { bin, log };
}

function context(appOutDir, platform = "darwin") {
  return {
    electronPlatformName: platform,
    appOutDir,
    packager: { appInfo: { productFilename: "Sunset Ridge Racing" } },
  };
}

async function withEnv(overrides, fn) {
  const saved = { PATH: process.env.PATH, CSC_LINK: process.env.CSC_LINK, CSC_NAME: process.env.CSC_NAME };
  delete process.env.CSC_LINK;
  delete process.env.CSC_NAME;
  Object.assign(process.env, overrides);
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("writes the marker before ad-hoc signing when no certificate is configured", async () => {
  const { appOutDir, appPath, marker } = fakeBundle();
  const { bin, log } = stubCodesign(appPath);
  await withEnv({ PATH: `${bin}${path.delimiter}${process.env.PATH}` }, () => afterPack(context(appOutDir)));
  assert.ok(existsSync(marker), "marker file should exist");
  assert.equal(readFileSync(log, "utf8").trim(), "marker-present", "codesign must run after the marker is written");
});

test("leaves signed builds unmarked", async () => {
  const { appOutDir, appPath, marker } = fakeBundle();
  const { bin, log } = stubCodesign(appPath);
  await withEnv({ PATH: `${bin}${path.delimiter}${process.env.PATH}`, CSC_LINK: "/certs/dev-id.p12" }, () =>
    afterPack(context(appOutDir)),
  );
  assert.ok(!existsSync(marker), "signed builds must not carry the marker");
  assert.ok(!existsSync(log), "codesign is electron-builder's job for signed builds");
});

test("does nothing for non-mac platforms", async () => {
  const { appOutDir, appPath, marker } = fakeBundle();
  const { bin, log } = stubCodesign(appPath);
  await withEnv({ PATH: `${bin}${path.delimiter}${process.env.PATH}` }, () => afterPack(context(appOutDir, "linux")));
  assert.ok(!existsSync(marker));
  assert.ok(!existsSync(log));
});
