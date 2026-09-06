import * as THREE from "three";
import type { TrackSlug } from "@racing/shared";
import { getModel } from "../game/models";

/** Displays the miniature circuit authored in Blender. Cached geometry stays shared. */
export class TrackStage {
  private readonly renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
  });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(34, 1, 0.1, 80);
  private readonly observer: ResizeObserver;
  private readonly motion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  private readonly light = new THREE.DirectionalLight(0xffd2a2, 3.2);
  private model?: THREE.Group;
  private slug?: TrackSlug;
  private active = true;
  private disposed = false;
  private animation = 0;
  private started = 0;
  private direction = 1;

  constructor(private readonly host: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setClearColor(0, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const canvas = this.renderer.domElement;
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
    host.append(canvas);
    this.camera.position.set(0, 7.5, 9.5);
    this.camera.lookAt(0, 0, 0);
    this.light.position.set(-3, 8, 4);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(1024, 1024);
    this.light.shadow.normalBias = 0.04;
    Object.assign(this.light.shadow.camera, {
      left: -5,
      right: 5,
      top: 5,
      bottom: -5,
      near: 0.1,
      far: 30,
    });
    this.scene.add(
      this.light,
      new THREE.HemisphereLight(0xe5e7fa, 0x342319, 1.3),
    );
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(host);
    document.addEventListener("visibilitychange", this.visibility);
    this.motion.addEventListener("change", this.resize);
    this.resize();
  }

  setTrack(slug: TrackSlug, direction = 1): void {
    if (this.disposed || this.slug === slug) return;
    const source = getModel(`preview:${slug}`);
    if (!source) return;
    if (this.model) this.scene.remove(this.model);
    const contents = source.clone(true);
    const bounds = new THREE.Box3().setFromObject(contents, true);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    contents.position.sub(center);
    const model = new THREE.Group();
    model.add(contents);
    model.scale.setScalar(6.2 / Math.max(size.x, size.z, 1));
    this.scene.add(model);
    this.model = model;
    this.slug = slug;
    this.direction = Math.sign(direction || 1);
    this.started = performance.now();
    this.host.classList.add("has-live-track");
    this.resize();
  }

  setActive(active: boolean): void {
    this.active = active;
    cancelAnimationFrame(this.animation);
    this.animation = 0;
    if (active) this.resize();
  }

  private resize = (): void => {
    if (
      !this.active ||
      this.disposed ||
      !this.host.clientWidth ||
      !this.host.clientHeight
    )
      return;
    this.renderer.setSize(this.host.clientWidth, this.host.clientHeight, false);
    this.camera.aspect = this.host.clientWidth / this.host.clientHeight;
    this.camera.fov = this.camera.aspect < 1 ? 52 : 34;
    this.camera.updateProjectionMatrix();
    this.draw(performance.now());
  };

  private draw = (now: number): void => {
    cancelAnimationFrame(this.animation);
    this.animation = 0;
    if (!this.active || this.disposed || document.hidden) return;
    const progress = this.motion.matches
      ? 1
      : Math.min(1, (now - this.started) / 750);
    const remaining = Math.pow(1 - progress, 3);
    if (this.model) {
      this.model.position.x = remaining * 7 * this.direction;
      this.model.rotation.y = -0.14 + remaining * 0.2 * this.direction;
    }
    this.renderer.render(this.scene, this.camera);
    if (progress < 1) this.animation = requestAnimationFrame(this.draw);
  };
  private visibility = (): void => {
    if (!document.hidden) this.resize();
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.animation);
    this.observer.disconnect();
    document.removeEventListener("visibilitychange", this.visibility);
    this.motion.removeEventListener("change", this.resize);
    this.light.shadow.dispose();
    this.renderer.forceContextLoss();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.host.classList.remove("has-live-track");
  }
}
