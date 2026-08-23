import { describe, expect, it } from "vitest";
import { asVariant, CAR_VARIANTS, isVariant } from "@racing/shared";

describe("asVariant", () => {
  it("passes every known Variant through unchanged", () => {
    for (const v of CAR_VARIANTS) {
      expect(asVariant(v)).toBe(v);
    }
  });

  it("normalizes unknown values to absent, never a specific car", () => {
    expect(asVariant("batmobile")).toBeUndefined();
    expect(asVariant("")).toBeUndefined();
    expect(asVariant("TAXI")).toBeUndefined();
    expect(asVariant(3)).toBeUndefined();
    expect(asVariant({})).toBeUndefined();
    expect(asVariant(["taxi"])).toBeUndefined();
  });

  it("normalizes omitted values (undefined / null) to absent", () => {
    expect(asVariant(undefined)).toBeUndefined();
    expect(asVariant(null)).toBeUndefined();
  });
});

describe("isVariant", () => {
  it("narrows valid strings and rejects everything else", () => {
    expect(isVariant("taxi")).toBe(true);
    expect(isVariant("van")).toBe(true);
    expect(isVariant("tank")).toBe(false);
    expect(isVariant(undefined)).toBe(false);
  });
});
