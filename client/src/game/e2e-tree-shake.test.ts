import { afterEach, describe, expect, it } from "vitest";
import { build } from "vite";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let outputDirectory: string | undefined;

afterEach(async () => {
  if (outputDirectory) await rm(outputDirectory, { recursive: true, force: true });
});

describe("production build", () => {
  it("tree-shakes every window.__game reference", async () => {
    outputDirectory = await mkdtemp(join(tmpdir(), "racing-client-build-"));
    await build({ root: join(import.meta.dirname, "../.."), logLevel: "silent", build: { outDir: outputDirectory } });
    const assets = await readdir(join(outputDirectory, "assets"));
    const javascript = await Promise.all(
      assets.filter((name) => name.endsWith(".js")).map((name) => readFile(join(outputDirectory!, "assets", name), "utf8"))
    );
    expect(javascript.join("\n")).not.toContain("__game");
  });
});
