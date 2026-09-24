// Shrinks the Blender asset-library export in place.
// Run after every Blender export: `npm run optimize:glb -w client` (see assets/blender/README.md).
//
// 1. Known source defects listed in REPAIRS are patched (see below).
//    UV sets on primitives whose material has no texture are dropped: nothing samples them.
// 2. Over-dense nature models (the scattered trees) are simplified with meshoptimizer to
//    about the size of the light ones, keeping their flat shading. This is the one lossy step.
// 3. Normal maps: Blender packs Poly Haven's 16-bit PNGs. Browsers decode every texture to
//    8 bits per channel before WebGL upload, so re-encoding at 8 bits is lossless on screen.
//    Other PNGs are re-encoded at maximum zlib effort. JPEGs are left untouched.
// 4. Identical vertex/index buffers, meshes and images are stored once (Blender exports each
//    object's mesh data separately, even when the data is identical).
// 5. Geometry buffers get EXT_meshopt_compression in its lossless mode: no quantization and no
//    filters, so decoded positions, normals, UVs and indices are bit-identical (meshopt may
//    rotate the vertex order inside a triangle, keeping its winding). The client registers
//    three's MeshoptDecoder to read it.
//
// The script is idempotent: a second run produces a byte-identical file.
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { NodeIO, Primitive, PropertyType } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { dedup, prune, simplifyPrimitive, weldPrimitive } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

const DEFAULT_PATH = fileURLToPath(
  new URL("../public/models/rework/sunset-ridge.glb", import.meta.url),
);
// Anything denser than this is almost certainly a modifier applied by mistake in Blender.
const DENSE_MESH_VERTICES = 100_000;

// Defects in sunset-ridge.blend, patched until the source is fixed. Each repair only runs
// while `node` is still denser than DENSE_MESH_VERTICES, so it becomes a no-op once
// the .blend is corrected and can then be deleted.
const REPAIRS = [
  {
    // Since the garage-lobby export (7c932e6), the race car's front-left rim is ~730k
    // triangles of spiky, corrupted geometry, 4 cm larger than the rim it replaced. Its
    // other three rims are the clean 1,876-triangle part. The rear-left rim is the same
    // left-hand mesh; the front-left node's own transform only turns it by one spoke (45°).
    node: "car_race_Brushed alloy",
    useMeshOf: "car_race_Brushed alloy.001",
  },
];

const [input = DEFAULT_PATH, output = input] = process.argv.slice(2);

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "meshopt.encoder": MeshoptEncoder,
  "meshopt.decoder": MeshoptDecoder,
});

const before = (await stat(input)).size;
const document = await io.read(input);
const root = document.getRoot();
const vertexCount = (mesh) =>
  (mesh?.listPrimitives() ?? []).reduce(
    (sum, primitive) => sum + (primitive.getAttribute("POSITION")?.getCount() ?? 0),
    0,
  );
const findNode = (name) => root.listNodes().find((node) => node.getName() === name);

for (const repair of REPAIRS) {
  const target = findNode(repair.node);
  const source = findNode(repair.useMeshOf)?.getMesh();
  if (!target || !source || vertexCount(target.getMesh()) <= DENSE_MESH_VERTICES) continue;
  console.log(
    `repair: ${repair.node} (${vertexCount(target.getMesh()).toLocaleString("en")} vertices) ` +
      `now uses the mesh of ${repair.useMeshOf} (${vertexCount(source).toLocaleString("en")}).`,
  );
  target.setMesh(source);
}

// Nature models are scattered by the hundred, so their triangles are paid per instance in
// both the colour and the shadow pass. Three of the five trees are ~12,700 triangles; any
// nature model over NATURE_SIMPLIFY_ABOVE triangles is simplified to about
// NATURE_TARGET_TRIANGLES, the size of the two light pines. The output sits far below the
// threshold, so a second run leaves it alone. The library's nature meshes are flat-shaded
// (every triangle has its own normals), which leaves no shared corners for the simplifier
// to collapse; so the normals are dropped, corners are welded by position, and flat normals
// are rebuilt from the simplified faces.
const NATURE_SIMPLIFY_ABOVE = 6_000;
const NATURE_TARGET_TRIANGLES = 3_000;
// Stops the simplifier early rather than dent a silhouette: a fraction of each mesh's size.
const NATURE_MAX_ERROR = 0.05;

const triangleCount = (mesh) =>
  mesh
    .listPrimitives()
    .reduce(
      (sum, primitive) =>
        sum + (primitive.getIndices() ?? primitive.getAttribute("POSITION")).getCount() / 3,
      0,
    );
// Untextured, uncoloured triangles whose three corners always share one normal: rebuilding
// flat normals after simplification then loses nothing.
function isFlatShaded(primitive) {
  const semantics = primitive.listSemantics().sort().join();
  const indices = primitive.getIndices()?.getArray();
  const normals = primitive.getAttribute("NORMAL")?.getArray();
  if (primitive.getMode() !== Primitive.Mode.TRIANGLES || semantics !== "NORMAL,POSITION")
    return false;
  if (!indices || !normals || primitive.listTargets().length > 0) return false;
  for (let corner = 0; corner < indices.length; corner++) {
    const first = indices[corner - (corner % 3)] * 3;
    for (let axis = 0; axis < 3; axis++)
      if (normals[indices[corner] * 3 + axis] !== normals[first + axis]) return false;
  }
  return true;
}

function simplifyFlatShaded(primitive, ratio) {
  primitive.setAttribute("NORMAL", null);
  weldPrimitive(primitive);
  simplifyPrimitive(primitive, {
    simplifier: MeshoptSimplifier,
    ratio,
    error: NATURE_MAX_ERROR,
  });
  const indices = primitive.getIndices().getArray();
  const source = primitive.getAttribute("POSITION").getArray();
  const positions = new Float32Array(indices.length * 3);
  const normals = new Float32Array(indices.length * 3);
  for (let corner = 0; corner < indices.length; corner++) {
    positions.set(source.subarray(indices[corner] * 3, indices[corner] * 3 + 3), corner * 3);
  }
  for (let face = 0; face < positions.length; face += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = positions.subarray(face, face + 9);
    const [ux, uy, uz, vx, vy, vz] = [bx - ax, by - ay, bz - az, cx - ax, cy - ay, cz - az];
    const normal = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const length = Math.hypot(...normal);
    for (let corner = 0; corner < 9; corner += 3)
      normals.set(length > 0 ? normal.map((n) => n / length) : [0, 1, 0], face + corner);
  }
  const accessor = (array) => document.createAccessor().setType("VEC3").setArray(array);
  primitive
    .setIndices(null)
    .setAttribute("POSITION", accessor(positions))
    .setAttribute("NORMAL", accessor(normals));
  // Corners that share a position and a face normal become one vertex again, as in the export.
  weldPrimitive(primitive);
}

const simplifiedMeshes = new Set();
for (const model of root.listNodes()) {
  if (!model.getName().startsWith("nature:")) continue;
  const meshes = new Set();
  model.traverse((node) => node.getMesh() && meshes.add(node.getMesh()));
  const triangles = [...meshes].reduce((sum, mesh) => sum + triangleCount(mesh), 0);
  if (triangles <= NATURE_SIMPLIFY_ABOVE) continue;
  const ratio = NATURE_TARGET_TRIANGLES / triangles;
  for (const mesh of meshes) {
    if (simplifiedMeshes.has(mesh)) continue;
    simplifiedMeshes.add(mesh);
    for (const primitive of mesh.listPrimitives()) {
      if (isFlatShaded(primitive)) simplifyFlatShaded(primitive, ratio);
      else console.warn(`warning: ${mesh.getName()} is not flat-shaded; not simplified.`);
    }
  }
  const after = [...meshes].reduce((sum, mesh) => sum + triangleCount(mesh), 0);
  console.log(
    `simplify: ${model.getName()} ${triangles.toLocaleString("en")} -> ` +
      `${after.toLocaleString("en")} triangles.`,
  );
}

// Drop the data the repairs orphaned, plus vertex attributes no material reads (UVs on
// untextured surfaces; COLOR_0 and NORMAL stay). Nodes and extras stay as exported.
await document.transform(
  prune({
    propertyTypes: [PropertyType.MESH, PropertyType.PRIMITIVE, PropertyType.ACCESSOR],
    keepLeaves: true,
    keepAttributes: false,
    keepExtras: true,
  }),
);

for (const texture of root.listTextures()) {
  if (texture.getMimeType() !== "image/png") continue;
  const image = texture.getImage();
  if (!image) continue;
  const encoded = await sharp(image)
    .toColourspace("srgb") // 16-bit "rgb16" -> 8-bit "srgb"; channel values are not remapped.
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
    .toBuffer();
  if (encoded.byteLength < image.byteLength) texture.setImage(new Uint8Array(encoded));
}

await document.transform(
  // Materials are looked up by name at runtime, so only merge unnamed data.
  dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.TEXTURE] }),
);

document
  .createExtension(EXTMeshoptCompression)
  .setRequired(true)
  // Despite its name, QUANTIZE is the filter-free mode: it stores the data as given.
  .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });

for (const node of root.listNodes()) {
  const vertices = vertexCount(node.getMesh());
  if (vertices > DENSE_MESH_VERTICES) {
    console.warn(
      `warning: ${node.getName()} has ${vertices.toLocaleString("en")} vertices; ` +
        "check its Blender modifiers before shipping.",
    );
  }
}

await io.write(output, document);
const after = (await stat(output)).size;
const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;
console.log(`${output}: ${mb(before)} -> ${mb(after)}`);
