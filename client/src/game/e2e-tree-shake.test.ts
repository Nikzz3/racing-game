import { afterEach, describe, expect, it } from "vitest";
import { build } from "vite";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let outputDirectory: string | undefined;

afterEach(async () => {
  if (!outputDirectory) return;

  await rm(outputDirectory, { recursive: true, force: true });
  outputDirectory = undefined;
});

describe("production build", () => {
  it("tree-shakes every window.__game reference", async () => {
    const buildDirectory = await mkdtemp(join(tmpdir(), "racing-client-build-"));
    outputDirectory = buildDirectory;
    await build({
      root: join(import.meta.dirname, "../.."),
      logLevel: "silent",
      build: { outDir: buildDirectory },
    });
    const assets = await readdir(join(buildDirectory, "assets"));
    const javascript = await Promise.all(
      assets
        .filter((name) => name.endsWith(".js"))
        .map((name) => readFile(join(buildDirectory, "assets", name), "utf8")),
    );
    expect(javascript.join("\n")).not.toContain("__game");
  });
});
