import * as THREE from "three";
import { CAR_VARIANTS, type Variant } from "@racing/shared";

/** Matches the eight five-metre bays authored in environment:garage. */
export function garageBayX(variant: Variant): number {
  return (
    (CAR_VARIANTS.indexOf(variant) - (CAR_VARIANTS.length - 1) / 2) * 5
  );
}

/** Only the camera moves. Retargeting starts from its current position. */
export class GarageCamera {
  readonly position = new THREE.Vector3();
  readonly target = new THREE.Vector3();
  private from = 0;
  private to = 0;
  private current = 0;
  private started = 0;
  private duration = 0;
  private initialized = false;
  private angle = 0.405;

  focus(variant: Variant, now: number, reducedMotion: boolean): void {
    this.update(now);
    this.from = this.current;
    this.to = garageBayX(variant);
    this.started = now;
    this.duration =
      !this.initialized || reducedMotion
        ? 0
        : Math.min(1600, 700 + Math.abs(this.to - this.from) * 20);
    this.initialized = true;
    this.update(now);
  }

  orbit(delta: number): void {
    this.angle = THREE.MathUtils.clamp(this.angle + delta, -0.35, 0.7);
    this.pose();
  }

  finish(): void {
    this.duration = 0;
    this.current = this.to;
    this.pose();
  }

  update(now: number): boolean {
    const t =
      this.duration === 0
        ? 1
        : THREE.MathUtils.clamp((now - this.started) / this.duration, 0, 1);
    this.current = THREE.MathUtils.lerp(
      this.from,
      this.to,
      t * t * (3 - 2 * t),
    );
    this.pose();
    return t < 1;
  }

  private pose(): void {
    this.target.set(this.current, 0.9, 0);
    this.position.set(
      THREE.MathUtils.clamp(
        this.current + Math.sin(this.angle) * 6.8,
        -19,
        20.3,
      ),
      2.65,
      Math.cos(this.angle) * 6.8,
    );
  }
}
