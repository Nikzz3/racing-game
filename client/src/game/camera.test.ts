import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { snapBehindCar, followCar } from "./scene";

describe("snapBehindCar", () => {
  it("places camera behind and above car facing +z (heading=0)", () => {
    const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1200);
    // heading=0: fx=sin(0)=0, fz=cos(0)=1 → camera lands at (0, 4.6, -10)
    snapBehindCar(camera, 0, 0, 0);

    expect(camera.position.x).toBeCloseTo(0, 5);
    expect(camera.position.y).toBeCloseTo(4.6, 5);
    expect(camera.position.z).toBeCloseTo(-10, 5);

    // Camera should face from (0,4.6,-10) toward look-ahead point (0,1.4,4)
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const expected = new THREE.Vector3(0, 1.4 - 4.6, 4 - -10).normalize();
    expect(dir.x).toBeCloseTo(expected.x, 5);
    expect(dir.y).toBeCloseTo(expected.y, 5);
    expect(dir.z).toBeCloseTo(expected.z, 5);
  });

  it("places camera behind and above car facing +x (heading=π/2)", () => {
    const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1200);
    // heading=π/2: fx=sin(π/2)=1, fz=cos(π/2)=0 → camera lands at (-10, 4.6, 0)
    snapBehindCar(camera, 0, 0, Math.PI / 2);

    expect(camera.position.x).toBeCloseTo(-10, 5);
    expect(camera.position.y).toBeCloseTo(4.6, 5);
    expect(camera.position.z).toBeCloseTo(0, 5);

    // Camera should face from (-10,4.6,0) toward look-ahead point (4,1.4,0)
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const expected = new THREE.Vector3(4 - -10, 1.4 - 4.6, 0 - 0).normalize();
    expect(dir.x).toBeCloseTo(expected.x, 5);
    expect(dir.y).toBeCloseTo(expected.y, 5);
    expect(dir.z).toBeCloseTo(expected.z, 5);
  });
});

describe("followCar", () => {
  it("converges monotonically toward the snapBehindCar target", () => {
    const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1200);
    camera.position.set(100, 100, 100);

    const ref = new THREE.PerspectiveCamera(70, 1, 0.1, 1200);
    snapBehindCar(ref, 0, 0, 0);
    const target = ref.position.clone();

    const dt = 0.016;
    let prevDist = camera.position.distanceTo(target);
    for (let i = 0; i < 120; i++) {
      followCar(camera, 0, 0, 0, dt);
      const dist = camera.position.distanceTo(target);
      expect(dist).toBeLessThan(prevDist);
      prevDist = dist;
    }
    expect(prevDist).toBeLessThan(0.01);
  });

  it("does not overshoot on a single small-dt step", () => {
    const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1200);
    // Start camera partway to the target (heading=0 target is (0,4.6,-10))
    camera.position.set(0, 4.6, -5);

    const ref = new THREE.PerspectiveCamera(70, 1, 0.1, 1200);
    snapBehindCar(ref, 0, 0, 0);
    const target = ref.position.clone();

    const distBefore = camera.position.distanceTo(target);
    followCar(camera, 0, 0, 0, 0.016);
    const distAfter = camera.position.distanceTo(target);

    expect(distAfter).toBeGreaterThan(0);
    expect(distAfter).toBeLessThan(distBefore);
  });
});
