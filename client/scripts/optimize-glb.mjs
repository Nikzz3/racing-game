// Shrinks the Blender asset-library export in place.
// Run after every Blender export: `npm run optimize:glb -w client` (see assets/blender/README.md).
//
// 1. Known source defects listed in REPAIRS are patched (see below).
//    UV sets on primitives whose material has no texture are dropped: nothing samples them.
// 2. Normal maps: Blender packs Poly Haven's 16-bit PNGs. Browsers decode every texture to
//    8 bits per channel before WebGL upload, so re-encoding at 8 bits is lossless on screen.
//    Other PNGs are re-encoded at maximum zlib effort. JPEGs are left untouched.
// 3. Identical vertex/index buffers, meshes and images are stored once (Blender exports each
//    object's mesh data separately, even when the data is identical).
// 4. Geometry buffers get EXT_meshopt_compression in its lossless mode: no quantization and no
//    filters, so decoded positions, normals, UVs and indices are bit-identical (meshopt may
//    rotate the vertex order inside a triangle, keeping its winding). The client registers
//    three's MeshoptDecoder to read it.
//
// The script is idempotent: a second run produces a byte-identical file.
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { NodeIO, PropertyType } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { dedup, prune } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
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

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
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
