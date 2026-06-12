import * as THREE from "three";
import {
  BARRIER_OFFSET,
  ROAD_HALF_WIDTH,
  TRACK_SAMPLES,
  type TrackSample,
} from "@racing/shared";

/** Builds the full track (road, markings, barriers, start gate) and adds it to the scene. */
export function buildTrack(scene: THREE.Scene): THREE.Group {
  const group = new THREE.Group();
  group.add(buildRoad());
  group.add(buildEdgeLines());
  group.add(buildCenterDashes());
  group.add(buildBarriers());
  group.add(buildStartLine());
  group.add(buildStartGate());
  scene.add(group);
  return group;
}

function leftNormal(s: TrackSample): { nx: number; nz: number } {
  return { nx: -s.dirZ, nz: s.dirX };
}

function buildRoad(): THREE.Mesh {
  const n = TRACK_SAMPLES.length;
  const positions = new Float32Array(n * 2 * 3);
  const indices: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = TRACK_SAMPLES[i];
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
  y: number
): void {
  const n = TRACK_SAMPLES.length;
  for (let i = fromIdx; i <= toIdx; i++) {
    const s = TRACK_SAMPLES[i % n];
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

function buildEdgeLines(): THREE.Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const n = TRACK_SAMPLES.length;
  for (const offset of [ROAD_HALF_WIDTH - 0.5, -(ROAD_HALF_WIDTH - 0.5)]) {
    addStripSegment(positions, indices, 0, n, offset, 0.35, 0.04);
  }
  return stripsToMesh(positions, indices, 0xe8e8e8);
}

function buildCenterDashes(): THREE.Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const n = TRACK_SAMPLES.length;
  for (let i = 0; i < n; i += 8) {
    addStripSegment(positions, indices, i, Math.min(i + 3, n - 1), 0, 0.3, 0.04);
  }
  return stripsToMesh(positions, indices, 0xcccccc);
}

function buildBarriers(): THREE.Group {
  const group = new THREE.Group();
  const n = TRACK_SAMPLES.length;
  const step = 2;
  const segCount = Math.floor(n / step);
  const segLen = 5.4;
  const geo = new THREE.BoxGeometry(0.4, 0.9, segLen);

  const red = new THREE.InstancedMesh(
    geo,
    new THREE.MeshLambertMaterial({ color: 0xd8453c }),
    segCount
  );
  const white = new THREE.InstancedMesh(
    geo,
    new THREE.MeshLambertMaterial({ color: 0xf0f0f0 }),
    segCount
  );
  let redIdx = 0;
  let whiteIdx = 0;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const wallDist = ROAD_HALF_WIDTH + BARRIER_OFFSET;

  for (let k = 0; k < segCount; k++) {
    const s = TRACK_SAMPLES[k * step];
    const { nx, nz } = leftNormal(s);
    const yaw = Math.atan2(s.dirX, s.dirZ);
    q.setFromAxisAngle(up, yaw);
    for (const side of [1, -1]) {
      m.compose(
        new THREE.Vector3(s.x + nx * wallDist * side, 0.45, s.z + nz * wallDist * side),
        q,
        new THREE.Vector3(1, 1, 1)
      );
      // Alternate colors along the track, opposite phase per side for a classic look.
      const isRed = (k + (side === 1 ? 0 : 1)) % 2 === 0;
      if (isRed) red.setMatrixAt(redIdx++, m);
      else white.setMatrixAt(whiteIdx++, m);
    }
  }
  red.count = redIdx;
  white.count = whiteIdx;
  red.castShadow = white.castShadow = true;
  red.receiveShadow = white.receiveShadow = true;
  group.add(red, white);
  return group;
}

function buildStartLine(): THREE.Group {
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

  const s = TRACK_SAMPLES[0];
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

function buildStartGate(): THREE.Group {
  const group = new THREE.Group();
  const s = TRACK_SAMPLES[0];
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
