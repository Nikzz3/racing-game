import { describe, expect, it } from "vitest";
import { CAR_VARIANTS } from "@racing/shared";
import { GarageCamera, garageBayX } from "./garage-camera";

describe("garage camera", () => {
  it("starts at the saved car and travels smoothly to the next parked car", () => {
    const rig = new GarageCamera();
    rig.focus("race", 0, false);
    expect(rig.target.x).toBe(garageBayX("race"));
    rig.focus("race-future", 100, false);
    expect(rig.target.x).toBe(garageBayX("race"));
    expect(rig.update(500)).toBe(true);
    expect(rig.target.x).toBeGreaterThan(garageBayX("race"));
    expect(rig.target.x).toBeLessThan(garageBayX("race-future"));
    expect(rig.update(2000)).toBe(false);
    expect(rig.target.x).toBe(garageBayX("race-future"));
  });

  it("retargets rapid clicks without jumping back to the previous bay", () => {
    const rig = new GarageCamera();
    rig.focus("race", 0, false);
    rig.focus("van", 0, false);
    rig.update(600);
    const current = rig.position.clone();
    rig.focus("taxi", 600, false);
    expect(rig.position.distanceTo(current)).toBeLessThan(0.0001);
    rig.update(3000);
    expect(rig.target.x).toBe(garageBayX("taxi"));
  });

  it("switches immediately for reduced motion and can finish a running trip", () => {
    const rig = new GarageCamera();
    rig.focus("race", 0, true);
    rig.focus("van", 10, true);
    expect(rig.update(10)).toBe(false);
    expect(rig.target.x).toBe(garageBayX("van"));
    rig.focus("race", 20, false);
    rig.finish();
    expect(rig.update(21)).toBe(false);
    expect(rig.target.x).toBe(garageBayX("race"));
  });

  it.each(CAR_VARIANTS)("keeps the camera inside the garage when orbiting %s", (variant) => {
    const rig = new GarageCamera();
    rig.focus(variant, 0, false);
    for (const delta of [-10, 20]) {
      rig.orbit(delta);
      expect(rig.target.x).toBe(garageBayX(variant));
      expect(rig.position.x).toBeGreaterThan(-20);
      expect(rig.position.x).toBeLessThan(21.6);
      expect(rig.position.z).toBeGreaterThan(4);
    }
  });
});
