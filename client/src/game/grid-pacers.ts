import type * as THREE from "three";
import type { RacePacer, RaceState } from "@racing/shared";
import { animateCar, resolveVariant } from "./car";
import { createPacerMesh, disposePacerMesh } from "./pacer";
import type { Pose } from "./pose-interpolation";
import { gridPacerPose } from "./race";
import type { RemotePosition } from "./remote";

interface GridPacer {
  pacer: RacePacer;
  mesh: THREE.Group;
  speed: number;
}

/**
 * The Pacers the server seats on a race's grid: translucent and non-colliding
 * like an armed Pacer, named, each driving its recorded lap from GO for as long
 * as it is still racing. Everyone in the Room sees the same ones.
 */
export class GridPacers {
  private readonly cars = new Map<string, GridPacer>();

  constructor(private readonly scene: THREE.Scene) {}

  /** Seat a race's Pacers, hidden until GO. Returns their models, for linking before they appear. */
  set(pacers: RacePacer[]): THREE.Object3D[] {
    this.clear();
    for (const pacer of pacers) {
      const mesh = createPacerMesh(
        pacer.name,
        resolveVariant(pacer.name, pacer.variant),
        pacer.name,
      );
      mesh.visible = false;
      this.scene.add(mesh);
      this.cars.set(pacer.id, { pacer, mesh, speed: 0 });
    }
    return [...this.cars.values()].map(({ mesh }) => mesh);
  }

  /** Draw each Pacer still racing in `race` where its lap has it at `serverNow`. */
  update(race: RaceState, serverNow: number, dt: number): void {
    for (const [id, car] of this.cars) {
      const racing = race.entrants.some((e) => e.id === id && e.status === "racing");
      const pose = racing ? gridPacerPose(car.pacer.frames, race.goT, serverNow) : null;
      car.mesh.visible = pose !== null;
      if (!pose) continue;
      car.mesh.position.set(pose.x, 0, pose.z);
      car.mesh.rotation.y = pose.heading;
      car.speed = pose.speed;
      animateCar(car.mesh, pose.speed, 0, dt);
    }
  }

  /** Where a Pacer is drawn this frame, or null while it is not. */
  pose(id: string): Pose | null {
    const car = this.cars.get(id);
    if (!car?.mesh.visible) return null;
    const { position, rotation } = car.mesh;
    return { x: position.x, z: position.z, heading: rotation.y, speed: car.speed };
  }

  /** The Pacers drawn this frame, for the circuit map. */
  positions(): RemotePosition[] {
    return [...this.cars].flatMap(([id, { mesh }]) =>
      mesh.visible ? [{ id, x: mesh.position.x, z: mesh.position.z }] : [],
    );
  }

  clear(): void {
    for (const { mesh } of this.cars.values()) {
      this.scene.remove(mesh);
      disposePacerMesh(mesh);
    }
    this.cars.clear();
  }
}
