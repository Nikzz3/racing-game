import { describe, it, expect } from "vitest";
import { getModel, preloadModels } from "./models";

describe("preloadModels", () => {
  it("resolves when the library cannot be fetched, leaving every model absent", async () => {
    // The Node test environment has no server, so the GLTFLoader request fails.
    await expect(preloadModels()).resolves.toBeUndefined();
    expect(getModel("car:race")).toBeNull();
    expect(getModel("nature:tree_detailed")).toBeNull();
  });
});

it("reports cached failure to later callers without retrying or leaving them loading", async () => {
  await preloadModels();
  const progress: string[] = [];
  await preloadModels((state) => progress.push(state.phase));
  expect(progress).toEqual(["error"]);
});
