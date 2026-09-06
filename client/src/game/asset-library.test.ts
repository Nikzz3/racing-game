import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { CAR_VARIANTS, ROAD_HALF_WIDTH, TRACKS } from "@racing/shared";
import { createCarMesh } from "./car";
import { getMaterial, getModel, registerLibrary } from "./models";

beforeAll(async () => {
  const bytes = await readFile(
    new URL("../../public/models/rework/sunset-ridge.glb", import.meta.url),
  );
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
  // Node cannot decode browser images. Validate their embedded bytes, then leave
  // pixel decoding to the browser check while these tests exercise real meshes.
  const loader = new GLTFLoader().register((parser) => ({
    name: "test-embedded-textures",
    async loadTexture(index) {
      const definition = parser.json.textures[index];
      const image = parser.json.images[definition.source];
      expect(image.bufferView).toBeTypeOf("number");
      expect(["image/png", "image/jpeg"]).toContain(image.mimeType);
      const bytes = await parser.getDependency("bufferView", image.bufferView);
      expect(bytes.byteLength).toBeGreaterThan(1024);
      return new THREE.Texture();
    },
  }));
  const { scene } = await loader.parseAsync(buffer, "");
  registerLibrary(scene);
});

describe("Blender asset integration", () => {
  it.each(["leafy_grass", "gravel_concrete"])(
    "exports %s with color, roughness, and normal textures",
    (name) => {
      const material = getMaterial(name);
      expect(material, `Missing exported surface ${name}`).not.toBeNull();
      expect(material!.map).toBeInstanceOf(THREE.Texture);
      expect(material!.roughnessMap).toBeInstanceOf(THREE.Texture);
      expect(material!.normalMap).toBeInstanceOf(THREE.Texture);
    },
  );

  it.each(TRACKS)("textures $name gameplay shoulders", (track) => {
    const model = getModel(`track:${track.id}`)!;
    const shoulders: THREE.Mesh[] = [];
    model.traverse((part) => {
      if (part instanceof THREE.Mesh && part.name.includes("Gravel"))
        shoulders.push(part);
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

  it.each(TRACKS)(
    "shows the complete $name in its Blender preview",
    (track) => {
      const preview = getModel(`preview:${track.id}`);
      expect(preview, `Missing Blender preview for ${track.id}`).not.toBeNull();
      let asphalt: THREE.Object3D | undefined;
      preview!.traverse((part) => {
        if (part instanceof THREE.Mesh && part.name.includes("Fine_asphalt"))
          asphalt = part;
      });
      expect(asphalt).toBeDefined();
      preview!.updateMatrixWorld(true);
      const ray = new THREE.Raycaster(
        new THREE.Vector3(),
        new THREE.Vector3(0, -1, 0),
      );
      for (let index = 0; index < track.samples.length; index += 16) {
        const sample = track.samples[index];
        ray.ray.origin.set(sample.x, 10, sample.z);
        expect(
          ray.intersectObject(asphalt!)[0],
          `${track.id} preview omits sample ${index}`,
        ).toBeDefined();
      }
    },
  );

  it.each(CAR_VARIANTS)(
    "keeps %s headlight lenses clear of the body panels",
    (variant) => {
      const car = createCarMesh("lamp-test", undefined, variant);
      car.updateMatrixWorld(true);
      const ray = new THREE.Raycaster(
        new THREE.Vector3(),
        new THREE.Vector3(0, 0, -1),
      );
      const carBounds = new THREE.Box3().setFromObject(car, true);
      let samples = 0;
      car.traverse((part) => {
        if (
          !(part instanceof THREE.Mesh) ||
          !part.name.includes("Warm_headlights")
        )
          return;
        const bounds = new THREE.Box3().setFromObject(part, true);
        for (let x = bounds.min.x + 0.025; x < bounds.max.x; x += 0.025) {
          for (
            let y = bounds.min.y + 0.025;
            y < Math.min(bounds.max.y, 1);
            y += 0.025
          ) {
            ray.ray.origin.set(x, y, carBounds.max.z + 1);
            const hits = ray.intersectObject(car, true);
            const lens = hits.find(
              (hit) =>
                hit.object === part && hit.point.z > carBounds.max.z - 0.2,
            );
            if (!lens) continue;
            samples++;
            const coplanar = hits.find(
              (hit) =>
                hit.object !== part &&
                Math.abs(hit.distance - lens.distance) < 0.00001,
            );
            expect(
              coplanar?.object.name,
              `${variant} lamp shares a visible surface at ${lens.point.toArray()}`,
            ).toBeUndefined();
          }
        }
      });
      expect(samples).toBeGreaterThan(20);
    },
  );

  it.each(CAR_VARIANTS)(
    "places the %s car and its four wheel pivots on the road",
    (variant) => {
      const model = getModel(`car:${variant}`);
      expect(
        model,
        `Missing Blender car collection: ${variant}`,
      ).not.toBeNull();
      const bounds = new THREE.Box3().setFromObject(model!, true);
      const center = bounds.getCenter(new THREE.Vector3());
      expect(center.x).toBeCloseTo(0, 4);
      expect(center.z).toBeCloseTo(0, 4);
      expect(bounds.min.y).toBeCloseTo(0, 4);

      const car = createCarMesh("asset-test", undefined, variant);
      car.updateMatrixWorld(true);
      const wheels: THREE.Object3D[] = [];
      car.traverse((part) => {
        if (part.name.startsWith("wheel_") && !(part instanceof THREE.Mesh))
          wheels.push(part);
      });
      expect(
        wheels.map((wheel) => wheel.name.replace(/\d+$/, "")).sort(),
      ).toEqual([
        "wheel_front_left",
        "wheel_front_right",
        "wheel_rear_left",
        "wheel_rear_right",
      ]);
      for (const wheel of wheels) {
        const wheelBounds = new THREE.Box3().setFromObject(wheel, true);
        expect(
          wheelBounds.min.y,
          `${variant} ${wheel.name} floats above the road`,
        ).toBeCloseTo(0, 2);
        const position = wheel.getWorldPosition(new THREE.Vector3());
        expect(Math.sign(position.x)).toBe(
          wheel.name.includes("left") ? -1 : 1,
        );
        expect(Math.sign(position.z)).toBe(
          wheel.name.includes("front") ? 1 : -1,
        );
      }
      const carBounds = new THREE.Box3().setFromObject(car, true);
      expect(carBounds.max.z - carBounds.min.z).toBeCloseTo(4.2, 4);
    },
  );

  it.each(TRACKS)(
    "aligns $name asphalt with the shared driving surface",
    (track) => {
      const model = getModel(`track:${track.id}`);
      expect(model).not.toBeNull();
      const asphalt = model!.getObjectByName(`track_${track.id}_Fine_asphalt`);
      expect(asphalt).toBeInstanceOf(THREE.Mesh);
      model!.updateMatrixWorld(true);
      const ray = new THREE.Raycaster(
        new THREE.Vector3(),
        new THREE.Vector3(0, -1, 0),
      );
      // Check the full circuit's center and both driving edges, including corners.
      for (let index = 0; index < track.samples.length; index += 8) {
        const sample = track.samples[index];
        for (const offset of [
          0,
          -ROAD_HALF_WIDTH + 0.5,
          ROAD_HALF_WIDTH - 0.5,
        ]) {
          ray.ray.origin.set(
            sample.x - sample.dirZ * offset,
            5,
            sample.z + sample.dirX * offset,
          );
          const hit = ray.intersectObject(asphalt!)[0];
          expect(
            hit,
            `${track.id} sample ${index}, offset ${offset} has no road below`,
          ).toBeDefined();
          expect(hit.point.y).toBeCloseTo(0.025, 1);
        }
      }
    },
  );
});
