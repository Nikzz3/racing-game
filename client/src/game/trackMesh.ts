import * as THREE from "three";
import {
  BARRIER_OFFSET,
  ROAD_HALF_WIDTH,
  nearestCenterline,
  type Track,
  type TrackSample,
} from "@racing/shared";
import { getModel, instancedFromModel } from "./models";

const BARRIER_DIST = ROAD_HALF_WIDTH + BARRIER_OFFSET;

export function buildTrack(scene: THREE.Scene, track: Track): void {
  const { samples } = track;
  const group = new THREE.Group();
  const road = getModel(`track:${track.id}`);
  if (road) {
    const surface = road.clone(true);
    // Flat, overlapping road markings receive the sunset shadows without
    // casting coplanar shadows onto the asphalt underneath.
    surface.traverse((part) => {
      if (part instanceof THREE.Mesh) part.castShadow = false;
    });
    group.add(surface);
  } else group.add(emergencyRoad(samples));
  const start = samples[0];
  const heading = Math.atan2(start.dirX, start.dirZ);
  const gate = getModel("prop:start-gate")?.clone(true);
  if (gate) {
    gate.position.set(start.x, 0, start.z);
    gate.rotation.y = heading;
    group.add(gate);
  }
  const stand = getModel("prop:grandstand");
  if (stand) {
    for (const offset of [-38, -18, 18, 38]) {
      const mesh = stand.clone(true);
      mesh.position.set(
        start.x + start.dirX * offset - start.dirZ * 24,
        0,
        start.z + start.dirZ * offset + start.dirX * 24,
      );
      mesh.rotation.y = heading + Math.PI / 2;
      group.add(mesh);
    }
  }
  const barrier = getModel("prop:barrier");
  if (barrier) group.add(instancedFromModel(barrier, barrierMatrices(samples)));
  scene.add(group);
}

/** One barrier segment per two samples, skipping spans that would cross the road. */
function barrierMatrices(samples: TrackSample[]): THREE.Matrix4[] {
  const matrices: THREE.Matrix4[] = [];
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    rotation = new THREE.Quaternion(),
    scale = new THREE.Vector3(1, 1, 1);
  const edge = (s: TrackSample, side: number, out: THREE.Vector3) =>
    out.set(s.x - s.dirZ * BARRIER_DIST * side, 0, s.z + s.dirX * BARRIER_DIST * side);
  for (const side of [-1, 1]) {
    for (let i = 0; i < samples.length; i += 2) {
      edge(samples[i], side, a);
      edge(samples[(i + 2) % samples.length], side, b);
      if (
        nearestCenterline(a.x, a.z, samples).dist < ROAD_HALF_WIDTH + 0.5 ||
        nearestCenterline(b.x, b.z, samples).dist < ROAD_HALF_WIDTH + 0.5
      )
        continue;
      const dx = b.x - a.x,
        dz = b.z - a.z;
      rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.atan2(dx, dz));
      scale.z = Math.hypot(dx, dz) + 0.12;
      matrices.push(new THREE.Matrix4().compose(a.add(b).multiplyScalar(0.5), rotation, scale));
    }
  }
  return matrices;
}

/** Keeps the circuit usable if the asset download fails. */
function emergencyRoad(samples: TrackSample[]): THREE.Mesh {
  const vertices: number[] = [],
    indices: number[] = [];
  samples.forEach((s, i) => {
    for (const side of [-1, 1])
      vertices.push(
        s.x - s.dirZ * ROAD_HALF_WIDTH * side,
        0.02,
        s.z + s.dirX * ROAD_HALF_WIDTH * side,
      );
    const a = i * 2,
      b = ((i + 1) % samples.length) * 2;
    indices.push(a, a + 1, b + 1, a, b + 1, b);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: 0x303b3d, side: THREE.DoubleSide }),
  );
  mesh.userData.owned = true;
  return mesh;
}
