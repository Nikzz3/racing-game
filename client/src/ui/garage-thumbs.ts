import * as THREE from "three";
import type { Variant } from "@racing/shared";
import { getModel } from "../game/models";

const THUMB_WIDTH = 220;
const THUMB_HEIGHT = 150;

/**
 * Renders a 3/4-angle snapshot of each Variant's preloaded GLB to a PNG data
 * URL, sharing one offscreen WebGL renderer — no asset cost beyond
 * preloadModels(). A Variant whose model is missing (failed preload) is left
 * out of the result; an environment without WebGL yields an empty map.
 */
export function renderVariantThumbnails(variants: readonly Variant[]): Map<Variant, string> {
  const shots = new Map<Variant, string>();
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  } catch {
    return shots;
  }
  renderer.setSize(THUMB_WIDTH, THUMB_HEIGHT);

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 1.4));
  const sun = new THREE.DirectionalLight(0xfff0dd, 2.2);
  sun.position.set(3, 5, 2);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(35, THUMB_WIDTH / THUMB_HEIGHT, 0.1, 100);
  const stage = new THREE.Group();
  scene.add(stage);

  for (const variant of variants) {
    const model = getModel(`car:${variant}`);
    if (!model) continue;
    stage.clear();
    stage.add(model.clone(true));
    const box = new THREE.Box3().setFromObject(stage);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    camera.position.set(center.x + size * 0.9, center.y + size * 0.6, center.z + size * 0.9);
    camera.lookAt(center);
    renderer.render(scene, camera);
    shots.set(variant, renderer.domElement.toDataURL());
  }

  renderer.dispose();
  return shots;
}
