import * as THREE from "three";
import type { Variant } from "@racing/shared";
import { getModel } from "../game/models";
import { createCarMesh } from "../game/car";
import { disposeRenderer } from "../game/scene";
import { renderQuality } from "../game/quality";

/**
 * Render the same Blender cars used on the track, sharing a single temporary context.
 * Creating the context and drawing each car are separate `defer` steps, so the work can
 * wait for idle time. Each image reaches `onImage` as an object URL once the browser has
 * encoded it.
 */
export function renderVariantThumbnails(
  variants: readonly Variant[],
  onImage: (variant: Variant, url: string) => void,
  defer: (step: () => void) => void,
): void {
  const queue = variants.filter((variant) => getModel(`car:${variant}`));
  let renderer: THREE.WebGLRenderer;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 720 / 420, 0.1, 100);
  const setup = (): void => {
    try {
      // Eight still frames: MSAA is worth it on any GPU, just not in software.
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: renderQuality().tier !== "low",
        preserveDrawingBuffer: true,
      });
    } catch {
      return;
    }
    renderer.setSize(720, 420);
    renderer.setPixelRatio(1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.55;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x788472, 2.4));
    const key = new THREE.DirectionalLight(0xfff1d5, 4);
    key.position.set(-4, 7, 5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xbce0ff, 2);
    fill.position.set(4, 3, -4);
    scene.add(fill);
    camera.position.set(3.8, 2.9, 4.8);
    camera.lookAt(0, 0.8, 0);
    defer(next);
  };
  const next = (): void => {
    const variant = queue.shift();
    if (!variant) {
      disposeRenderer(renderer);
      return;
    }
    try {
      const car = createCarMesh("garage", undefined, variant);
      scene.add(car);
      renderer.render(scene, camera);
      scene.remove(car);
      // toBlob copies the canvas now; only the PNG encoding happens later.
      renderer.domElement.toBlob((blob) => {
        if (blob) onImage(variant, URL.createObjectURL(blob));
      });
    } catch (error) {
      console.error("Car previews could not render", error);
      disposeRenderer(renderer);
      return;
    }
    defer(next);
  };
  defer(setup);
}
