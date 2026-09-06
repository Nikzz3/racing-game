import * as THREE from "three";
import type { Variant } from "@racing/shared";
import { createCarMesh, disposeCarMesh } from "../game/car";
import { getModel } from "../game/models";

interface Slide {
  mesh: THREE.Group;
  from: number;
  to: number;
  started: number;
  retiring: boolean;
}

/** A live Blender car with a contact shadow and a short carousel transition. */
export class GarageStage {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
  private readonly light = new THREE.DirectionalLight(0xffce94, 4.2);
  private readonly floor = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.ShadowMaterial({ color: 0x080604, opacity: 0.42 }),
  );
  private readonly observer: ResizeObserver;
  private readonly motion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  private slides: Slide[] = [];
  private variant?: Variant;
  private active = true;
  private disposed = false;
  private animation = 0;
  private lastDraw = 0;
  private yaw: number | null = null;
  private drag: { pointerId: number; x: number } | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly interactionHost: HTMLElement,
  ) {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setClearColor(0, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const canvas = this.renderer.domElement;
    canvas.className = "garage-stage-canvas";
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;";
    host.append(canvas);
    this.camera.position.set(4.6, 2.7, 6.2);
    this.camera.lookAt(0, 0.65, 0);
    this.light.position.set(-3, 6, 5);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(1024, 1024);
    Object.assign(this.light.shadow.camera, {
      left: -7,
      right: 7,
      top: 7,
      bottom: -7,
      near: 0.1,
      far: 25,
    });
    this.light.shadow.normalBias = 0.035;
    this.scene.add(
      this.light,
      new THREE.HemisphereLight(0xe1d9f0, 0x352619, 2.0),
    );
    const rim = new THREE.DirectionalLight(0xff8d4b, 2.2);
    rim.position.set(5, 3, -5);
    this.scene.add(rim);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -0.02;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(host);
    document.addEventListener("visibilitychange", this.visibility);
    this.motion.addEventListener("change", this.motionChanged);
    host.classList.add("has-live-car");
    interactionHost.classList.add("can-rotate-car");
    interactionHost.addEventListener("pointerdown", this.pointerDown);
    interactionHost.addEventListener("pointermove", this.pointerMove);
    interactionHost.addEventListener("pointerup", this.pointerEnd);
    interactionHost.addEventListener("pointercancel", this.pointerEnd);
    interactionHost.addEventListener("lostpointercapture", this.pointerEnd);
    this.resize();
  }

  setVariant(variant: Variant, direction = 1): void {
    if (
      this.disposed ||
      this.variant === variant ||
      !getModel(`car:${variant}`)
    )
      return;
    this.variant = variant;
    this.endDrag();
    this.yaw = null;
    const now = performance.now();
    for (const slide of this.slides.filter((slide) => slide.retiring))
      this.remove(slide);
    this.slides = this.slides.filter((slide) => !slide.retiring);
    const previous = this.slides[0];
    if (previous && !this.motion.matches) {
      previous.from = this.offset(previous, now);
      previous.to = -Math.sign(direction || 1) * 9;
      previous.started = now;
      previous.retiring = true;
    } else if (previous) {
      this.remove(previous);
      this.slides = [];
    }
    const mesh = createCarMesh("showroom", undefined, variant);
    this.scene.add(mesh);
    this.slides.push({
      mesh,
      from:
        previous && !this.motion.matches ? Math.sign(direction || 1) * 9 : 0,
      to: 0,
      started: now,
      retiring: false,
    });
    this.draw(now);
    this.schedule();
  }

  setActive(active: boolean): void {
    if (!active) this.endDrag();
    this.active = active;
    cancelAnimationFrame(this.animation);
    this.animation = 0;
    if (active) {
      this.resize();
      this.schedule();
    }
  }

  private pointerDown = (event: PointerEvent): void => {
    if (
      !this.active ||
      this.disposed ||
      this.drag ||
      event.button !== 0 ||
      (event.target instanceof Element && event.target.closest("button"))
    )
      return;
    const current = this.slides.find((slide) => !slide.retiring);
    if (!current) return;
    this.yaw = current.mesh.rotation.y;
    this.drag = { pointerId: event.pointerId, x: event.clientX };
    this.interactionHost.setPointerCapture(event.pointerId);
    this.interactionHost.classList.add("is-rotating-car");
  };

  private pointerMove = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    // A drag across the stage turns the car once, at any viewport size.
    this.yaw =
      (this.yaw ?? 0) +
      ((event.clientX - this.drag.x) * Math.PI * 2) /
        Math.max(this.interactionHost.clientWidth, 1);
    this.drag.x = event.clientX;
    this.draw(performance.now());
  };

  private pointerEnd = (event: PointerEvent): void => {
    if (event.pointerId === this.drag?.pointerId) this.endDrag();
  };

  private endDrag(): void {
    const drag = this.drag;
    this.drag = null;
    this.interactionHost.classList.remove("is-rotating-car");
    if (drag && this.interactionHost.hasPointerCapture(drag.pointerId))
      this.interactionHost.releasePointerCapture(drag.pointerId);
  }

  private offset(slide: Slide, now: number): number {
    const t = this.motion.matches
      ? 1
      : Math.min(1, Math.max(0, (now - slide.started) / 620));
    return THREE.MathUtils.lerp(slide.from, slide.to, 1 - Math.pow(1 - t, 3));
  }

  private resize = (): void => {
    if (this.disposed || !this.active) return;
    const width = this.host.clientWidth,
      height = this.host.clientHeight;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    // Keep the whole car in frame on narrow portrait screens.
    this.camera.fov = this.camera.aspect < 1.25 ? 43 : 32;
    this.camera.updateProjectionMatrix();
    this.draw(performance.now());
  };

  private draw(now: number): void {
    if (!this.active || this.disposed || document.hidden) return;
    const finished = this.slides.filter(
      (slide) =>
        slide.retiring && (this.motion.matches || now - slide.started >= 620),
    );
    finished.forEach((slide) => this.remove(slide));
    this.slides = this.slides.filter((slide) => !finished.includes(slide));
    for (const slide of this.slides) {
      const offset = this.offset(slide, now);
      slide.mesh.position.set(offset * 0.803, 0, -offset * 0.595);
      if (!slide.retiring)
        slide.mesh.rotation.y =
          this.yaw ??
          (this.motion.matches ? 0 : Math.sin(now * 0.00018) * 0.12);
    }
    this.renderer.render(this.scene, this.camera);
    this.lastDraw = now;
  }

  private frame = (now: number): void => {
    this.animation = 0;
    if (!this.active || this.disposed || document.hidden) return;
    if (now - this.lastDraw >= 1000 / 30) this.draw(now);
    this.schedule();
  };
  private schedule(): void {
    if (
      !this.animation &&
      this.active &&
      !this.disposed &&
      !document.hidden &&
      !this.motion.matches
    )
      this.animation = requestAnimationFrame(this.frame);
  }
  private visibility = (): void => {
    if (document.hidden) this.endDrag();
    cancelAnimationFrame(this.animation);
    this.animation = 0;
    if (!document.hidden) {
      this.resize();
      this.schedule();
    }
  };
  private motionChanged = (): void => {
    this.setActive(this.active);
  };
  private remove(slide: Slide): void {
    this.scene.remove(slide.mesh);
    disposeCarMesh(slide.mesh);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.endDrag();
    this.interactionHost.removeEventListener("pointerdown", this.pointerDown);
    this.interactionHost.removeEventListener("pointermove", this.pointerMove);
    this.interactionHost.removeEventListener("pointerup", this.pointerEnd);
    this.interactionHost.removeEventListener("pointercancel", this.pointerEnd);
    this.interactionHost.removeEventListener(
      "lostpointercapture",
      this.pointerEnd,
    );
    this.interactionHost.classList.remove("can-rotate-car");
    cancelAnimationFrame(this.animation);
    this.observer.disconnect();
    document.removeEventListener("visibilitychange", this.visibility);
    this.motion.removeEventListener("change", this.motionChanged);
    this.slides.forEach((slide) => this.remove(slide));
    this.floor.geometry.dispose();
    this.floor.material.dispose();
    this.light.shadow.dispose();
    this.renderer.forceContextLoss();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.host.classList.remove("has-live-car");
  }
}
