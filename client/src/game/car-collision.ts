import type { Pose } from "./pose-interpolation";

/** Footprint every Variant collides with: the length models are scaled to, and about their width. */
export const CAR_HALF_LENGTH = 2.1;
export const CAR_HALF_WIDTH = 0.95;

/** Another player's car as this client draws it this frame. */
export interface CarObstacle extends Readonly<Pose> {
  /**
   * ±1: which way to separate when the two cars sit exactly on top of each other
   * (e.g. both spawned on the same grid slot). The two clients must pick opposite
   * sides, or each pushes its own car the same way and they leapfrog forever.
   */
  readonly side: 1 | -1;
}

export interface CarContact {
  /** Unit normal pointing from the obstacle towards the car. */
  nx: number;
  nz: number;
  /** How far the car must move along the normal to stop overlapping. */
  depth: number;
}

/**
 * Separating-axis test between two car footprints (oriented rectangles on the
 * ground plane). Returns the shortest way out for `car`, or null when they do
 * not overlap.
 */
export function carContact(car: Readonly<Pose>, other: CarObstacle): CarContact | null {
  const dx = car.x - other.x;
  const dz = car.z - other.z;
  const reach = CAR_HALF_LENGTH * 2 + CAR_HALF_WIDTH * 2;
  if (dx * dx + dz * dz > reach * reach) return null;
  const axes = [...carAxes(car.heading), ...carAxes(other.heading)];
  let best: CarContact | null = null;
  for (const [ax, az] of axes) {
    const along = dx * ax + dz * az;
    const depth =
      projectedRadius(car.heading, ax, az) +
      projectedRadius(other.heading, ax, az) -
      Math.abs(along);
    if (depth <= 0) return null;
    if (best && depth >= best.depth) continue;
    // An exact overlap has no direction to part along. Orient the axis the same way
    // on both clients (each may hold it negated) so opposite `side`s part the cars.
    const sign =
      along === 0 ? other.side * (ax > 0 || (ax === 0 && az > 0) ? 1 : -1) : Math.sign(along);
    best = { nx: ax * sign, nz: az * sign, depth };
  }
  return best;
}

/** Forward and right unit vectors for a heading (forward is +z at heading 0). */
function carAxes(heading: number): [number, number][] {
  const sin = Math.sin(heading);
  const cos = Math.cos(heading);
  return [
    [sin, cos],
    [cos, -sin],
  ];
}

function projectedRadius(heading: number, ax: number, az: number): number {
  const sin = Math.sin(heading);
  const cos = Math.cos(heading);
  return (
    CAR_HALF_LENGTH * Math.abs(sin * ax + cos * az) + CAR_HALF_WIDTH * Math.abs(cos * ax - sin * az)
  );
}
