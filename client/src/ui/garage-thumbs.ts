import * as THREE from "three";
import type { Variant } from "@racing/shared";
import { getModel } from "../game/models";
import { createCarMesh } from "../game/car";
import { disposeRenderer } from "../game/scene";

/** Render the same Blender cars used on the track, sharing a single temporary context. */
export function renderVariantThumbnails(
  variants: readonly Variant[],
): Map<Variant, string> {
  const images = new Map<Variant, string>();
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
  } catch {
    return images;
  }
  renderer.setSize(720, 420);
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.55;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x788472, 2.4));
  const key = new THREE.DirectionalLight(0xfff1d5, 4);
  key.position.set(-4, 7, 5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xbce0ff, 2);
  fill.position.set(4, 3, -4);
  scene.add(fill);
  const camera = new THREE.PerspectiveCamera(35, 720 / 420, 0.1, 100);
  camera.position.set(3.8, 2.9, 4.8);
  camera.lookAt(0, 0.8, 0);
  try {
    for (const variant of variants) {
      if (!getModel(`car:${variant}`)) continue;
      const car = createCarMesh("garage", undefined, variant);
      scene.add(car);
      renderer.render(scene, camera);
      images.set(variant, renderer.domElement.toDataURL("image/png"));
      scene.remove(car);
    }
  } finally {
    disposeRenderer(renderer);
  }
  return images;
}
