import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import { CAR_VARIANTS, ROAD_HALF_WIDTH, TRACKS } from "@racing/shared";
import { animateCar, createCarMesh } from "./car";
import { createAssetLoader, getMaterial, getModel, registerLibrary } from "./models";
import { garageBayX } from "../ui/garage-camera";

beforeAll(async () => {
  const bytes = await readFile(
    new URL("../../public/models/rework/sunset-ridge.glb", import.meta.url),
  );
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  // Node cannot decode browser images. Validate their embedded bytes, then leave
  // pixel decoding to the browser check while these tests exercise real meshes.
  const loader = createAssetLoader().register((parser) => ({
    name: "test-embedded-textures",
    async loadTexture(index) {
      const definition = parser.json.textures[index];
      const image = parser.json.images[definition.source];
      expect(image.bufferView).toBeTypeOf("number");
      expect(["image/png", "image/jpeg"]).toContain(image.mimeType);
      const imageBytes = await parser.getDependency("bufferView", image.bufferView);
      const signature = Array.from(
        new Uint8Array(imageBytes).slice(0, image.mimeType === "image/png" ? 8 : 3),
      );
      expect(signature).toEqual(
        image.mimeType === "image/png" ? [137, 80, 78, 71, 13, 10, 26, 10] : [255, 216, 255],
      );
      return new THREE.Texture();
    },
  }));
  const { scene } = await loader.parseAsync(buffer, "");
  registerLibrary(scene);
});

describe("Blender asset integration", () => {
  it.each([
    // optimize-glb.mjs simplifies the three broadleaf trees from 12,684 triangles.
    ["tree_default", 2992],
    ["tree_detailed", 2994],
    ["tree_oak", 2994],
    ["tree_pineDefaultA", 3788],
    ["tree_pineDefaultB", 3668],
  ] as const)(
    "renders %s as one surface without dropping authored triangles",
    (name, triangles) => {
      const meshes: THREE.Mesh[] = [];
      getModel(`nature:${name}`)!.traverse((part) => {
        if (part instanceof THREE.Mesh) meshes.push(part);
      });
      expect(meshes).toHaveLength(1);
      expect(meshes[0].geometry.index!.count / 3).toBe(triangles);
      expect(meshes[0].geometry.getAttribute("color").count).toBe(
        meshes[0].geometry.getAttribute("position").count,
      );
    },
  );

  // Every car is drawn in the garage and in races, so a stray modifier costs every frame.
  it.each(CAR_VARIANTS)("keeps the %s car at a real-time triangle budget", (variant) => {
    let triangles = 0;
    getModel(`car:${variant}`)!.traverse((part) => {
      if (part instanceof THREE.Mesh) triangles += part.geometry.index!.count / 3;
    });
    expect(triangles).toBeLessThan(100_000);
  });

  it.each(CAR_VARIANTS)("avoids a full-scene refraction pass for %s glass", (variant) => {
    getModel(`car:${variant}`)!.traverse((part) => {
      if (!(part instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(part.material) ? part.material : [part.material]) {
        if (material instanceof THREE.MeshPhysicalMaterial) {
          expect(material.transmission, material.name).toBe(0);
        }
      }
    });
  });

  it("gives every car a distinct body silhouette at the game's common length", () => {
    const profiles = CAR_VARIANTS.map((variant) => {
      const car = createCarMesh("silhouette-test", undefined, variant);
      car.updateMatrixWorld(true);
      const vertices: THREE.Vector3[] = [];
      car.traverse((part) => {
        if (!(part instanceof THREE.Mesh)) return;
        if (!part.userData.authored_bodywork && !part.parent?.userData.authored_bodywork) return;
        const positions = part.geometry.getAttribute("position");
        for (let index = 0; index < positions.count; index++) {
          vertices.push(
            new THREE.Vector3()
              .fromBufferAttribute(positions, index)
              .applyMatrix4(part.matrixWorld),
          );
        }
      });
      expect(vertices.length, `${variant} is missing authored coachwork`).toBeGreaterThan(100);
      // Sample the roof/hood/deck outline, rather than comparing bounding boxes:
      // a coupe and sedan can share outer dimensions while having different bodies.
      const profile = Array.from({ length: 8 }, (_, index) => {
        const z = -1.4 + index * 0.4;
        return Math.max(...vertices.filter((v) => Math.abs(v.z - z) < 0.24).map((v) => v.y));
      });
      expect(profile.every(Number.isFinite)).toBe(true);
      return { variant, profile };
    });
    for (let i = 0; i < profiles.length; i++) {
      for (let j = i + 1; j < profiles.length; j++) {
        expect(
          Math.hypot(
            ...profiles[i].profile.map((height, index) => height - profiles[j].profile[index]),
          ),
          `${profiles[i].variant} and ${profiles[j].variant} share a silhouette`,
        ).toBeGreaterThan(0.04);
      }
    }
  });

  it("exports a garage with a floor at the car's tire contact height", () => {
    const garage = getModel("environment:garage");
    expect(garage, "Missing lobby garage collection").not.toBeNull();
    garage!.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(garage!, true);
    expect(bounds.min.x).toBeLessThan(-9);
    expect(bounds.max.x).toBeGreaterThan(9);
    expect(bounds.max.y).toBeGreaterThan(6);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0));
    for (const variant of CAR_VARIANTS) {
      ray.ray.origin.x = garageBayX(variant);
      const floor = ray.intersectObject(garage!, true)[0];
      expect(floor, `No floor under ${variant}`).toBeDefined();
      expect(floor.point.y).toBeCloseTo(0, 3);
    }
    ray.ray.origin.set(0, 2, 0);
    ray.ray.direction.set(0, 0, -1);
    expect(ray.intersectObject(garage!, true)[0]?.distance).toBeLessThan(8);
  });

  it.each([
    "leafy_grass",
    "gravel_concrete",
    "concrete_floor_worn_001",
    "painted_plaster_wall",
    "blue_metal_plate",
    "painted_metal_shutter",
  ])("exports %s with color, roughness, and normal textures", (name) => {
    const material = getMaterial(name);
    expect(material, `Missing exported surface ${name}`).not.toBeNull();
    expect(material!.map).toBeInstanceOf(THREE.Texture);
    expect(material!.roughnessMap).toBeInstanceOf(THREE.Texture);
    expect(material!.normalMap).toBeInstanceOf(THREE.Texture);
  });

  it.each(TRACKS)("textures $name gameplay shoulders", (track) => {
    const model = getModel(`track:${track.id}`)!;
    const shoulders: THREE.Mesh[] = [];
    model.traverse((part) => {
      if (part instanceof THREE.Mesh && part.name.includes("Gravel")) shoulders.push(part);
    });
    expect(shoulders.length).toBeGreaterThan(0);
    for (const shoulder of shoulders) {
      expect(shoulder.material).toBe(getMaterial("gravel_concrete"));
      const uv = shoulder.geometry.getAttribute("uv");
      expect(uv).toBeDefined();
      let min = Infinity,
        max = -Infinity;
      for (let index = 0; index < uv.count; index++) {
        min = Math.min(min, uv.getX(index));
        max = Math.max(max, uv.getX(index));
      }
      expect(max - min, "Gravel must repeat across the circuit").toBeGreaterThan(100);
    }
  });

  it.each(TRACKS)("shows the complete $name in its Blender preview", (track) => {
    const preview = getModel(`preview:${track.id}`);
    expect(preview, `Missing Blender preview for ${track.id}`).not.toBeNull();
    let asphalt: THREE.Object3D | undefined;
    preview!.traverse((part) => {
      if (part instanceof THREE.Mesh && part.name.includes("Fine_asphalt")) asphalt = part;
    });
    expect(asphalt).toBeDefined();
    preview!.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    for (let index = 0; index < track.samples.length; index += 16) {
      const sample = track.samples[index];
      ray.ray.origin.set(sample.x, 10, sample.z);
      expect(
        ray.intersectObject(asphalt!)[0],
        `${track.id} preview omits sample ${index}`,
      ).toBeDefined();
    }
  });

  it.each(CAR_VARIANTS)("keeps %s headlight lenses clear of the body panels", (variant) => {
    const car = createCarMesh("lamp-test", undefined, variant);
    car.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
    const carBounds = new THREE.Box3().setFromObject(car, true);
    let samples = 0;
    const lampSides = new Set<number>();
    car.traverse((part) => {
      if (
        !(part instanceof THREE.Mesh) ||
        !(part.name.includes("Warm_headlights") || part.parent?.name.includes("Warm_headlights"))
      )
        return;
      const bounds = new THREE.Box3().setFromObject(part, true);
      for (let x = bounds.min.x + 0.025; x < bounds.max.x; x += 0.025) {
        for (let y = bounds.min.y + 0.025; y < Math.min(bounds.max.y, 1); y += 0.025) {
          ray.ray.origin.set(x, y, carBounds.max.z + 1);
          // Most grid points lie between the two lamps. Reject those against
          // the small lamp mesh before raycasting the detailed vehicle interior.
          ray.far = Infinity;
          const lens = ray
            .intersectObject(part, false)
            .find((hit) => hit.point.z > carBounds.max.z - 1.1);
          if (!lens) continue;
          ray.far = lens.distance + 0.00001;
          const hits = ray.intersectObject(car, true);
          samples++;
          lampSides.add(Math.sign(lens.point.x));
          const coplanar = hits.find(
            (hit) => hit.object !== part && Math.abs(hit.distance - lens.distance) < 0.00001,
          );
          expect(
            coplanar?.object.name,
            `${variant} lamp shares a visible surface at ${lens.point.toArray().join(", ")}`,
          ).toBeUndefined();
        }
      }
    });
    expect(samples).toBeGreaterThan(1);
    expect([...lampSides].sort((a, b) => a - b)).toEqual([-1, 1]);
  });

  it.each(CAR_VARIANTS)("places the %s car and its four wheel pivots on the road", (variant) => {
    const model = getModel(`car:${variant}`);
    expect(model, `Missing Blender car collection: ${variant}`).not.toBeNull();
    const bounds = new THREE.Box3().setFromObject(model!, true);
    const center = bounds.getCenter(new THREE.Vector3());
    expect(center.x).toBeCloseTo(0, 4);
    expect(center.z).toBeCloseTo(0, 4);
    expect(bounds.min.y).toBeCloseTo(0, 4);

    const car = createCarMesh("asset-test", undefined, variant);
    car.updateMatrixWorld(true);
    const wheels: THREE.Object3D[] = [];
    car.traverse((part) => {
      if (part.name.startsWith("wheel_") && !(part instanceof THREE.Mesh)) wheels.push(part);
    });
    expect(wheels.map((wheel) => wheel.name.replace(/\d+$/, "")).sort()).toEqual([
      "wheel_front_left",
      "wheel_front_right",
      "wheel_rear_left",
      "wheel_rear_right",
    ]);
    for (const wheel of wheels) {
      const wheelBounds = new THREE.Box3().setFromObject(wheel, true);
      expect(wheelBounds.min.y, `${variant} ${wheel.name} floats above the road`).toBeCloseTo(0, 2);
      const position = wheel.getWorldPosition(new THREE.Vector3());
      expect(Math.sign(position.x)).toBe(wheel.name.includes("left") ? -1 : 1);
      expect(Math.sign(position.z)).toBe(wheel.name.includes("front") ? 1 : -1);
    }
    const tireRadius =
      new THREE.Box3().setFromObject(wheels[0], true).getSize(new THREE.Vector3()).y / 2;
    animateCar(car, 3, 0.5, 0.1);
    expect(wheels[0].rotation.x).toBeCloseTo(0.3 / tireRadius, 3);
    for (const wheel of wheels.filter((part) => part.name.includes("front"))) {
      expect(wheel.rotation.y).toBeCloseTo(0.225);
    }
    // Restore the wheels before checking static vehicle dimensions.
    animateCar(car, -3, 0, 0.1);
    const carBounds = new THREE.Box3().setFromObject(car, true);
    expect(carBounds.max.z - carBounds.min.z).toBeCloseTo(4.2, 4);
  });

  it.each(TRACKS)("aligns $name asphalt with the shared driving surface", (track) => {
    const model = getModel(`track:${track.id}`);
    expect(model).not.toBeNull();
    const asphalt = model!.getObjectByName(`track_${track.id}_Fine_asphalt`);
    expect(asphalt).toBeInstanceOf(THREE.Mesh);
    model!.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    // Check the full circuit's center and both driving edges, including corners.
    for (let index = 0; index < track.samples.length; index += 8) {
      const sample = track.samples[index];
      for (const offset of [0, -ROAD_HALF_WIDTH + 0.5, ROAD_HALF_WIDTH - 0.5]) {
        ray.ray.origin.set(sample.x - sample.dirZ * offset, 5, sample.z + sample.dirX * offset);
        const hit = ray.intersectObject(asphalt!)[0];
        expect(
          hit,
          `${track.id} sample ${index}, offset ${offset} has no road below`,
        ).toBeDefined();
        expect(hit.point.y).toBeCloseTo(0.025, 1);
      }
    }
  });
});
