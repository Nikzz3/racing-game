import * as THREE from "three";
import {
  BARRIER_OFFSET,
  ROAD_HALF_WIDTH,
  TRACKS,
  nearestCenterline,
  type TrackSample,
} from "@racing/shared";
import { getModel, instancedFromModel } from "./models";

export function buildTrack(
  scene: THREE.Scene,
  samples: TrackSample[],
): THREE.Group {
  const group = new THREE.Group();
  const track = TRACKS.find(
    (track) =>
      track.samples === samples ||
      (track.samples[0].x === samples[0].x &&
        track.samples[0].z === samples[0].z),
  );
  const road = getModel(`track:${track?.id}`);
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
  if (barrier) {
    const matrices: THREE.Matrix4[] = [];
    for (const side of [-1, 1]) {
      for (let i = 0; i < samples.length; i += 2) {
        const points = [samples[i], samples[(i + 2) % samples.length]].map(
          (s) =>
            new THREE.Vector3(
              s.x - s.dirZ * (ROAD_HALF_WIDTH + BARRIER_OFFSET) * side,
              0,
              s.z + s.dirX * (ROAD_HALF_WIDTH + BARRIER_OFFSET) * side,
            ),
        );
        if (
          points.some(
            (p) =>
              nearestCenterline(p.x, p.z, samples).dist < ROAD_HALF_WIDTH + 0.5,
          )
        )
          continue;
        const delta = points[1].clone().sub(points[0]);
        const q = new THREE.Quaternion().setFromAxisAngle(
          THREE.Object3D.DEFAULT_UP,
          Math.atan2(delta.x, delta.z),
        );
        matrices.push(
          new THREE.Matrix4().compose(
            points[0].add(points[1]).multiplyScalar(0.5),
            q,
            new THREE.Vector3(1, 1, delta.length() + 0.12),
          ),
        );
      }
    }
    group.add(instancedFromModel(barrier, matrices));
  }
  scene.add(group);
  return group;
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
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: 0x303b3d, side: THREE.DoubleSide }),
  );
  mesh.userData.owned = true;
  return mesh;
}
