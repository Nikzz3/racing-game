import * as THREE from "three";
import {
  BARRIER_OFFSET,
  nearestCenterline,
  ROAD_HALF_WIDTH,
  type TrackSample,
} from "@racing/shared";

/** Builds the full track (road, markings, barriers, start gate) and adds it to the scene. */
export function buildTrack(scene: THREE.Scene, samples: TrackSample[]): THREE.Group {
  const group = new THREE.Group();
  group.add(buildRoad(samples));
  group.add(buildEdgeLines(samples));
  group.add(buildCenterDashes(samples));
  group.add(buildBarriers(samples));
  group.add(buildStartLine(samples));
  group.add(buildStartGate(samples));
  scene.add(group);
  return group;
}

function leftNormal(s: TrackSample): { nx: number; nz: number } {
  return { nx: -s.dirZ, nz: s.dirX };
}

function buildRoad(samples: TrackSample[]): THREE.Mesh {
  const n = samples.length;
  const positions = new Float32Array(n * 2 * 3);
  const indices: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    const { nx, nz } = leftNormal(s);
    positions.set([s.x + nx * ROAD_HALF_WIDTH, 0.02, s.z + nz * ROAD_HALF_WIDTH], i * 6);
    positions.set([s.x - nx * ROAD_HALF_WIDTH, 0.02, s.z - nz * ROAD_HALF_WIDTH], i * 6 + 3);
    const a = i * 2;
    const b = i * 2 + 1;
    const c = ((i + 1) % n) * 2;
    const d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({ color: 0x2e2e36, side: THREE.DoubleSide })
  );
  mesh.receiveShadow = true;
  return mesh;
}

/** Quad strip between consecutive samples at a lateral offset from the centerline. */
function addStripSegment(
  positions: number[],
  indices: number[],
  fromIdx: number,
  toIdx: number,
  offset: number,
  width: number,
  y: number,
  samples: TrackSample[]
): void {
  const n = samples.length;
  for (let i = fromIdx; i <= toIdx; i++) {
    const s = samples[i % n];
    const { nx, nz } = leftNormal(s);
    const base = positions.length / 3;
    positions.push(
      s.x + nx * (offset + width / 2), y, s.z + nz * (offset + width / 2),
      s.x + nx * (offset - width / 2), y, s.z + nz * (offset - width / 2)
    );
    if (i < toIdx) {
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }
}

function stripsToMesh(positions: number[], indices: number[], color: number): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })
  );
}

function buildEdgeLines(samples: TrackSample[]): THREE.Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const n = samples.length;
  for (const offset of [ROAD_HALF_WIDTH - 0.5, -(ROAD_HALF_WIDTH - 0.5)]) {
    addStripSegment(positions, indices, 0, n, offset, 0.35, 0.04, samples);
  }
  return stripsToMesh(positions, indices, 0xe8e8e8);
}

function buildCenterDashes(samples: TrackSample[]): THREE.Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const n = samples.length;
  for (let i = 0; i < n; i += 8) {
    addStripSegment(positions, indices, i, Math.min(i + 3, n - 1), 0, 0.3, 0.04, samples);
  }
  return stripsToMesh(positions, indices, 0xcccccc);
}

function buildBarriers(samples: TrackSample[]): THREE.Group {
  const group = new THREE.Group();
  const n = samples.length;
  const step = 2;
  const wallDist = ROAD_HALF_WIDTH + BARRIER_OFFSET;

  // Each barrier segment spans the gap between two consecutive offset edge
  // points, stretched to fit. Dropping a fixed-length box at each sample (the
  // old approach) left gaps on the outside of sharp turns, where the offset
  // edge stretches, and overlapping, clipping boxes on the inside, where it
  // bunches up; spanning the actual gap keeps the wall continuous through any
  // curvature.
  const geo = new THREE.BoxGeometry(0.4, 0.9, 1);
  const redMats: THREE.Matrix4[] = [];
  const whiteMats: THREE.Matrix4[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const center = new THREE.Vector3();
  const scale = new THREE.Vector3();

  // Never let a barrier sit on the drivable road: on a corner tighter than the
  // offset distance the inner edge folds back over itself, dropping offset
  // points onto (or across) the tarmac. Any point closer to the centerline than
  // this is treated as folded and its segments are dropped, leaving a small gap
  // at the apex — the physical wall in physics.ts still stops the car there.
  const minClearance = ROAD_HALF_WIDTH + 0.5;

  for (const side of [1, -1]) {
    // Offset edge points (plus each point's distance to the nearest centerline
    // sample), wrapping past the end so the loop closes.
    const pts: THREE.Vector3[] = [];
    const onRoad: boolean[] = [];
    for (let k = 0; k <= Math.floor(n / step); k++) {
      const s = samples[(k * step) % n];
      const { nx, nz } = leftNormal(s);
      const px = s.x + nx * wallDist * side;
      const pz = s.z + nz * wallDist * side;
      pts.push(new THREE.Vector3(px, 0.45, pz));
      onRoad.push(nearestCenterline(px, pz, samples).dist < minClearance);
    }
    for (let j = 0; j < pts.length - 1; j++) {
      // Drop the segment if either endpoint has folded onto the road.
      if (onRoad[j] || onRoad[j + 1]) continue;
      const a = pts[j];
      const b = pts[j + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-4) continue;
      center.set((a.x + b.x) / 2, 0.45, (a.z + b.z) / 2);
      q.setFromAxisAngle(up, Math.atan2(dx, dz));
      // Slight overlap hides seams at the joints between segments.
      scale.set(1, 1, len + 0.15);
      const m = new THREE.Matrix4().compose(center, q, scale);
      // Alternate colors along the track, opposite phase per side for a classic look.
      const isRed = (j + (side === 1 ? 0 : 1)) % 2 === 0;
      (isRed ? redMats : whiteMats).push(m);
    }
  }

  for (const [mats, color] of [
    [redMats, 0xd8453c],
    [whiteMats, 0xf0f0f0],
  ] as const) {
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color }), mats.length);
    mats.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

function buildStartLine(samples: TrackSample[]): THREE.Group {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 32;
  const ctx = canvas.getContext("2d")!;
  const cell = 16;
  for (let cx = 0; cx < canvas.width / cell; cx++) {
    for (let cy = 0; cy < canvas.height / cell; cy++) {
      ctx.fillStyle = (cx + cy) % 2 === 0 ? "#f5f5f5" : "#111111";
      ctx.fillRect(cx * cell, cy * cell, cell, cell);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);

  const s = samples[0];
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(ROAD_HALF_WIDTH * 2, 3.4),
    new THREE.MeshBasicMaterial({ map: tex })
  );
  mesh.rotation.x = -Math.PI / 2;
  // Wrapping in a group keeps the plane flat while yawing it to the track direction.
  const holder = new THREE.Group();
  holder.add(mesh);
  holder.position.set(s.x, 0.05, s.z);
  holder.rotation.y = Math.atan2(s.dirX, s.dirZ);
  return holder;
}

function buildStartGate(samples: TrackSample[]): THREE.Group {
  const group = new THREE.Group();
  const s = samples[0];
  const postMat = new THREE.MeshLambertMaterial({ color: 0x222630 });
  const postGeo = new THREE.CylinderGeometry(0.35, 0.35, 7, 10);
  const width = ROAD_HALF_WIDTH + 2.5;

  for (const side of [1, -1]) {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(side * width, 3.5, 0);
    post.castShadow = true;
    group.add(post);
  }
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(width * 2 + 0.7, 1.3, 0.3),
    new THREE.MeshLambertMaterial({ color: 0xd8453c })
  );
  banner.position.y = 6.6;
  banner.castShadow = true;
  group.add(banner);

  group.position.set(s.x, 0, s.z);
  group.rotation.y = Math.atan2(s.dirX, s.dirZ);
  return group;
}
