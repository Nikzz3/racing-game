import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
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

describe("createCarMesh fitting", () => {
  it("fits each library model once and gives every car the same fit", () => {
    const source = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 8), new THREE.MeshStandardMaterial());
    shell.position.y = -0.5;
    source.add(shell);
    vi.mocked(getModel).mockReturnValue(source);
    const measure = vi.spyOn(THREE.Box3.prototype, "setFromObject");
    try {
      const [first, second] = [createCarMesh("a", undefined, "taxi"), createCarMesh("b")];
      expect(measure).toHaveBeenCalledOnce();
      for (const car of [first, second]) {
        const body = car.children[0];
        expect(body.scale.x).toBeCloseTo(4.2 / 8, 12);
        expect(body.position.y).toBeCloseTo(1 * (4.2 / 8), 12);
      }
    } finally {
      measure.mockRestore();
      vi.mocked(getModel).mockReset().mockReturnValue(null);
    }
  });
});
