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
