import { describe, it, expect } from "vitest";
import { areModelsLoaded, getModel, preloadModels } from "./models";

// Run the "false before load" test before anything calls preloadModels()
// (vitest runs tests in file order; module state starts fresh per test file).
describe("areModelsLoaded", () => {
  it("returns false before preloadModels() has been called", () => {
    expect(areModelsLoaded()).toBe(false);
  });

  it("returns true after preloadModels() resolves, even when all fetches fail", async () => {
    // In the Node test environment the GLTFLoader cannot reach the game server,
    // so every loadAsync() rejects. preloadModels() catches individual failures
    // and resolves after all attempts finish. The flag must be set regardless.
    await preloadModels();
    expect(areModelsLoaded()).toBe(true);
  });

  it("getModel returns null for any key when models are unavailable", () => {
    // All loads failed in the Node environment — the models map stays empty.
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
