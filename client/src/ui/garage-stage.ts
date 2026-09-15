import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import { CAR_VARIANTS, type Variant } from "@racing/shared";
import { createCarMesh, disposeCarMesh } from "../game/car";
import { getModel } from "../game/models";
import { CHEAP_RENDER } from "../game/scene";
import { GarageCamera, garageBayX } from "./garage-camera";

/** Persistent Blender workshop behind the lobby's car and circuit controls. */
export class GarageStage {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
  private readonly light = new THREE.DirectionalLight(0xffe2c2, 2.1);
  private readonly floor = new THREE.Mesh(
    new THREE.PlaneGeometry(50, 30),
    new THREE.ShadowMaterial({ color: 0x080604, opacity: 0.42 }),
  );
  private readonly observer: ResizeObserver;
  private readonly reflection: THREE.WebGLRenderTarget;
  private readonly rig = new GarageCamera();
  private readonly cars = new THREE.Group();
  private readonly contactGeometry = new THREE.PlaneGeometry(3.5, 4.8);
  private readonly contactMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexShader: `varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `varying vec2 vUv;
      void main() {
        float opacity = 0.42 * (1.0 - smoothstep(0.15, 0.5, length(vUv - 0.5)));
        gl_FragColor = vec4(0.025, 0.03, 0.04, opacity);
      }`,
  });
  private screen: "garage" | "track" | "settings" = "garage";
  private readonly motion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  private variant?: Variant;
  private active = true;
  private disposed = false;
  private animation = 0;
  private lastDraw = 0;
  private travelling = false;
  private drag: { pointerId: number; x: number } | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly interactionHost: HTMLElement,
  ) {
    // Same e2e trade as the race scene: under software WebGL the shadow pass and
    // MSAA make every carousel step, and so every Playwright click, seconds long.
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: !CHEAP_RENDER,
    });
    this.renderer.setPixelRatio(
      CHEAP_RENDER ? 1 : Math.min(devicePixelRatio, 1.5),
    );
    this.renderer.setClearColor(0, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = !CHEAP_RENDER;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const canvas = this.renderer.domElement;
    canvas.className = "garage-stage-canvas";
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;";
    host.append(canvas);
    this.camera.position.set(5, 2.8, 7.6);
    this.camera.lookAt(0, 1, 0);
    const environment = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.reflection = pmrem.fromScene(environment, 0.04);
    this.scene.environment = this.reflection.texture;
    this.scene.environmentIntensity = 0.35;
    environment.dispose();
    pmrem.dispose();
    this.light.position.set(-3, 6, 5);
    this.light.castShadow = !CHEAP_RENDER;
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
      new THREE.HemisphereLight(0xe1e8f0, 0x352619, 0.75),
    );
    const rim = new THREE.DirectionalLight(0xffb87e, 0.8);
    rim.position.set(5, 3, -5);
    this.scene.add(rim);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -0.02;
    this.floor.receiveShadow = true;
    const garage = getModel("environment:garage");
    if (garage) {
      this.scene.add(garage.clone(true));
      this.scene.background = new THREE.Color(0x323b43);
      host.classList.add("has-garage-environment");
      // Match the authored ceiling fixtures without adding six shadow passes.
      RectAreaLightUniformsLib.init();
      const ceiling = new THREE.RectAreaLight(0xe2edff, 3, 36, 5);
      ceiling.position.set(0, 6.4, 0);
      ceiling.lookAt(0, 0, 0);
      const bench = new THREE.PointLight(0xffdfad, 10, 7, 2);
      bench.position.set(-11.4, 2, -5.8);
      this.scene.add(ceiling, bench);
    } else {
      this.scene.add(this.floor);
    }
    for (const variant of CAR_VARIANTS) {
      if (!getModel(`car:${variant}`)) continue;
      const car = createCarMesh(`garage-${variant}`, undefined, variant);
      car.position.x = garageBayX(variant);
      // Soft contact occlusion also grounds the parked cars in software WebGL.
      const contact = new THREE.Mesh(this.contactGeometry, this.contactMaterial);
      contact.rotation.x = -Math.PI / 2;
      contact.position.y = 0.013;
      car.add(contact);
      this.cars.add(car);
    }
    this.scene.add(this.cars);
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

  setVariant(variant: Variant): void {
    if (
      this.disposed ||
      this.variant === variant ||
      !getModel(`car:${variant}`)
    )
      return;
    this.variant = variant;
    this.endDrag();
    const now = performance.now();
    this.rig.focus(variant, now, this.motion.matches);
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

  setScreen(screen: "garage" | "track" | "settings"): void {
    this.endDrag();
    this.screen = screen;
    this.draw(performance.now());
  }

  private pointerDown = (event: PointerEvent): void => {
    if (
      !this.active ||
      this.screen !== "garage" ||
      this.disposed ||
      this.drag ||
      event.button !== 0 ||
      (event.target instanceof Element && event.target.closest("button"))
    )
      return;
    if (!this.variant) return;
    this.drag = { pointerId: event.pointerId, x: event.clientX };
    this.interactionHost.setPointerCapture(event.pointerId);
    this.interactionHost.classList.add("is-rotating-car");
  };

  private pointerMove = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    this.rig.orbit(
      ((event.clientX - this.drag.x) * 2) /
        Math.max(this.interactionHost.clientWidth, 1),
    );
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

  private resize = (): void => {
    if (this.disposed || !this.active) return;
    const width = this.host.clientWidth,
      height = this.host.clientHeight;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    // Preserve a 40-degree horizontal view so long cars fit on tall phones.
    this.camera.fov = Math.max(
      42,
      THREE.MathUtils.radToDeg(
        2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(20)) / this.camera.aspect),
      ),
    );
    this.camera.updateProjectionMatrix();
    this.draw(performance.now());
  };

  private draw(now: number): void {
    if (!this.active || this.disposed || document.hidden) return;
    this.travelling = this.rig.update(now);
    this.camera.position.copy(this.rig.position);
    this.camera.lookAt(this.rig.target);
    this.cars.visible = this.screen !== "track";
    // Keep the contact-shadow pass centered on the selected bay.
    this.light.position.set(this.rig.target.x - 3, 6, 5);
    this.light.target.position.set(this.rig.target.x, 0, 0);
    this.light.target.updateMatrixWorld();
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
      this.travelling &&
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
    if (this.motion.matches) this.rig.finish();
    this.setActive(this.active);
  };
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
    for (const car of this.cars.children) {
      if (car instanceof THREE.Group) disposeCarMesh(car);
    }
    this.floor.geometry.dispose();
    this.floor.material.dispose();
    this.contactGeometry.dispose();
    this.contactMaterial.dispose();
    this.reflection.dispose();
    this.light.shadow.dispose();
    this.renderer.forceContextLoss();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.host.classList.remove("has-live-car");
    this.host.classList.remove("has-garage-environment");
  }
}
