import { describe, expect, it, vi } from "vitest";
import { CAR_VARIANTS } from "@racing/shared";

vi.mock("./models", async (importOriginal) => {
  const original = await importOriginal<typeof import("./models")>();
  return { ...original, getModel: vi.fn(() => null) };
});

import { getModel } from "./models";
import { createCarMesh, resolveVariant } from "./car";
import { hashString } from "../util";

describe("resolveVariant", () => {
  it("lets an explicit Variant win over the hash", () => {
    expect(resolveVariant("anyone", "taxi")).toBe("taxi");
  });

  it("falls back to the stable hash-of-player-id when absent", () => {
    const expected = CAR_VARIANTS[hashString("p1") % CAR_VARIANTS.length];
    expect(resolveVariant("p1")).toBe(expected);
    expect(resolveVariant("p1", undefined)).toBe(expected);
  });
});

describe("createCarMesh", () => {
  it("looks up the explicit Variant's model, not the hashed one", () => {
    vi.mocked(getModel).mockClear();
    createCarMesh("p1", undefined, "taxi");
    expect(getModel).toHaveBeenCalledWith("car:taxi");
  });

  it("looks up the hashed Variant's model when no Variant is given", () => {
    vi.mocked(getModel).mockClear();
    createCarMesh("p1");
    expect(getModel).toHaveBeenCalledWith(`car:${resolveVariant("p1")}`);
  });
});
