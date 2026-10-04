"""Draw a Track in Blender: a closed `centerline` poly curve is the whole design.

Each track lives in its own `assets/blender/tracks/<slug>.blend`, which links its
materials and preview trees from `sunset-ridge.blend` instead of copying them.
Moving a centerline point and rebuilding regenerates the road, curbs, start
line and lobby preview from the same Catmull-Rom samples the game drives on
(`rl/physics.py`, kept equal to `shared/src/track.ts` by the golden tests).

    npm run track:new -- <slug> "<Name>"   seed tracks/<slug>.blend (from the JSON if one exists)
    npm run track:export -- <slug>         write shared/src/tracks/<slug>.json and the track GLB

Inside Blender, run this file from the Text editor (or `exec` it over MCP) to
rebuild after editing the curve; `export_track()` writes the JSON and GLB.
The centerline object's custom properties hold `track_name`, `description` and
`checkpoints` (a count of evenly spaced gates, or "control-points"; ADR-0003).
"""

import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

BLENDER_DIR = (
    Path(__file__).resolve().parent
    if Path(globals().get("__file__", "")).name == "track_tools.py"
    else Path(bpy.data.filepath).resolve().parents[1]
)
REPO = BLENDER_DIR.parents[1]
LIBRARY = BLENDER_DIR / "sunset-ridge.blend"
sys.path.insert(0, str(REPO / "rl"))
from physics import BARRIER_OFFSET, ROAD_HALF_WIDTH, sample_track  # noqa: E402

CENTERLINE = "centerline"
SHOULDER_HALF_WIDTH = 11
CURB = (ROAD_HALF_WIDTH, ROAD_HALF_WIDTH + 0.8)
EDGE_LINE = (ROAD_HALF_WIDTH - 0.45, ROAD_HALF_WIDTH - 0.15)
GRAVEL_REPEAT = 4  # metres per texture tile, matching the existing circuits
PREVIEW_TREES = ("nature:tree_pineDefaultA", "nature:tree_pineDefaultB")
# Preview trees are giants so they still read when the lobby shrinks the circuit.
PREVIEW_TREE_SCALE = 36
MATERIALS = {
    "asphalt": "Fine asphalt",
    "gravel": "gravel_concrete",
    "red": "Signal vermilion",
    "rubber": "Rubber / charcoal",
    "ivory": "Warm ivory",
    "grass": "leafy_grass",
}
# Default layout for a brand-new track: a rounded rectangle to start pulling around.
SEED = [(-200, -120), (0, -140), (200, -120), (230, 0), (200, 120), (0, 140), (-200, 120), (-230, 0)]


def blender_point(x, z, height=0.0):
    """Game (x, z) on the ground plane to Blender (glTF Y-up becomes Blender Z-up, z = -y)."""
    return Vector((x, -z, height))


def slug():
    return Path(bpy.data.filepath).stem


def control_points():
    """The centerline curve's points in game coordinates, in lap order."""
    curve = bpy.data.objects[CENTERLINE]
    spline = curve.data.splines[0]
    points = []
    for point in spline.points:
        world = curve.matrix_world @ point.co.xyz
        points.append((round(world.x, 1), round(-world.y, 1)))
    return points


def offset(sample, distance):
    """A point `distance` metres to the side of a centerline sample, as in trackMesh.ts."""
    return sample["x"] - sample["dirZ"] * distance, sample["z"] + sample["dirX"] * distance


def strip(samples, inner, outer, height, segments=None, uv_repeat=None):
    """Quads between two side offsets. Continuous ribbons share vertices between segments;
    `segments` selects individual pieces (curbs, dashes). Faces point up."""
    n = len(samples)
    verts, faces, uvs = [], [], []
    lengths = [0.0]
    for i in range(n):
        a, b = samples[i], samples[(i + 1) % n]
        lengths.append(lengths[-1] + math.hypot(b["x"] - a["x"], b["z"] - a["z"]))

    def edge(i):
        sample = samples[i % n]
        return [blender_point(*offset(sample, d), height) for d in (inner, outer)]

    def up(quad):
        a, b, c = (verts[k] for k in quad[:3])
        return quad if (b - a).cross(c - a).z > 0 else quad[::-1]

    if segments is None:
        # n + 1 rows: the closing row repeats sample 0 so the texture does not smear back.
        for i in range(n + 1):
            verts.extend(edge(i))
            if uv_repeat:
                uvs.extend((lengths[i] / uv_repeat, d / uv_repeat) for d in (inner, outer))
        faces = [up((2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2)) for i in range(n)]
    else:
        for i in segments:
            base = len(verts)
            verts.extend(edge(i) + edge(i + 1)[::-1])
            faces.append(up((base, base + 1, base + 2, base + 3)))
    return verts, faces, uvs


def checkerboard(samples, squares=14, rows=2):
    """The start/finish line: alternating squares across the road at sample 0."""
    start = samples[0]
    forward = Vector((start["dirX"], -start["dirZ"], 0))
    side = Vector((-start["dirZ"], -start["dirX"], 0))
    size = 2 * ROAD_HALF_WIDTH / squares
    origin = blender_point(start["x"], start["z"], 0.05) - side * ROAD_HALF_WIDTH
    pieces = {"rubber": ([], []), "ivory": ([], [])}
    for row in range(rows):
        for column in range(squares):
            verts, faces = pieces["rubber" if (row + column) % 2 else "ivory"]
            corner = origin + side * column * size + forward * (row - rows / 2) * size
            base = len(verts)
            verts.extend([corner, corner + side * size, corner + side * size + forward * size, corner + forward * size])
            faces.append((base, base + 1, base + 2, base + 3))
    for verts, faces in pieces.values():
        for k, face in enumerate(faces):
            a, b, c = (verts[i] for i in face[:3])
            if (b - a).cross(c - a).z < 0:
                faces[k] = face[::-1]
    return pieces


def mesh_object(name, material, parts, collection):
    verts, faces, uvs = [], [], []
    for part_verts, part_faces, *part_uvs in parts:
        base = len(verts)
        verts.extend(part_verts)
        faces.extend(tuple(base + i for i in face) for face in part_faces)
        uvs.extend(part_uvs[0] if part_uvs else [])
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    if uvs:
        layer = mesh.uv_layers.new(name="UVMap")
        for loop in mesh.loops:
            layer.data[loop.index].uv = uvs[loop.vertex_index]
    mesh.materials.append(bpy.data.materials[material])
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    return obj


def fresh_collection(name):
    collection = bpy.data.collections.get(name)
    if collection is None:
        collection = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(collection)
    for obj in list(collection.objects):
        data = obj.data
        bpy.data.objects.remove(obj)
        if data is not None and data.library is None and data.users == 0:
            bpy.data.meshes.remove(data)
    return collection


def island(samples, collection, name):
    """The lobby diorama's beveled grass base, 30 m beyond the circuit on every side."""
    xs = [s["x"] for s in samples]
    zs = [s["z"] for s in samples]
    lo, hi = blender_point(min(xs) - 30, max(zs) + 30), blender_point(max(xs) + 30, min(zs) - 30)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=(hi.x - lo.x, hi.y - lo.y, 12), verts=bm.verts)
    bmesh.ops.translate(bm, vec=((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, -6.15), verts=bm.verts)
    bmesh.ops.bevel(bm, geom=bm.edges[:], offset=4, segments=3, affect="EDGES")
    uv = bm.loops.layers.uv.new("UVMap")
    for face in bm.faces:
        for loop in face.loops:
            loop[uv].uv = (loop.vert.co.x / 16, loop.vert.co.y / 16)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(bpy.data.materials[MATERIALS["grass"]])
    collection.objects.link(bpy.data.objects.new(name, mesh))


def tree_spots(samples, count=8):
    """Deterministic, spread-out spots well clear of the road for the preview trees."""
    xs = [s["x"] for s in samples]
    zs = [s["z"] for s in samples]
    spots, seed = [], 7
    for _ in range(4000):
        seed = (seed * 1103515245 + 12345) % 2**31
        x = min(xs) - 10 + (seed % 10_000) / 10_000 * (max(xs) - min(xs) + 20)
        seed = (seed * 1103515245 + 12345) % 2**31
        z = min(zs) - 10 + (seed % 10_000) / 10_000 * (max(zs) - min(zs) + 20)
        clear = min(math.hypot(x - s["x"], z - s["z"]) for s in samples[::4])
        if clear > 35 and all(math.hypot(x - a, z - b) > 70 for a, b in spots):
            spots.append((x, z))
            if len(spots) == count:
                break
    return spots


def plant_trees(samples, collection):
    for index, (x, z) in enumerate(tree_spots(samples)):
        source = bpy.data.collections[PREVIEW_TREES[index % len(PREVIEW_TREES)]]
        # Linked objects outside the scene are never evaluated, so their matrix_world is
        # identity; the unparented library parts carry their placement in matrix_basis.
        meshes = [obj for obj in source.all_objects if obj.type == "MESH"]
        base = Vector((
            sum(obj.matrix_basis.translation.x for obj in meshes) / len(meshes),
            sum(obj.matrix_basis.translation.y for obj in meshes) / len(meshes),
            min((obj.matrix_basis @ Vector(corner)).z for obj in meshes for corner in obj.bound_box),
        ))
        place = Matrix.Translation(blender_point(x, z)) @ Matrix.Rotation(index * 1.7, 4, "Z")
        place = place @ Matrix.Scale(PREVIEW_TREE_SCALE, 4) @ Matrix.Translation(-base)
        for obj in meshes:
            tree = bpy.data.objects.new(f"{obj.name}.preview", obj.data)
            tree.matrix_world = place @ obj.matrix_basis
            collection.objects.link(tree)


def link_library():
    """Link the shared materials and preview trees. Unused links are dropped on save,
    so every build links them again; linking what is already linked is a no-op."""
    with bpy.data.libraries.load(str(LIBRARY), link=True, relative=True) as (available, linked):
        linked.materials = list(MATERIALS.values())
        linked.collections = list(PREVIEW_TREES)


def build():
    """Regenerate `track:<slug>` and `preview:<slug>` from the centerline curve."""
    link_library()
    name = slug()
    samples = sample_track(control_points())
    n = len(samples)
    track = fresh_collection(f"track:{name}")
    preview = fresh_collection(f"preview:{name}")
    start = checkerboard(samples)
    surfaces = {
        "Fine asphalt": (MATERIALS["asphalt"], [strip(samples, -ROAD_HALF_WIDTH, ROAD_HALF_WIDTH, 0.025)]),
        "Gravel shoulder": (
            MATERIALS["gravel"],
            [strip(samples, -SHOULDER_HALF_WIDTH, SHOULDER_HALF_WIDTH, 0.005, uv_repeat=GRAVEL_REPEAT)],
        ),
        "Signal vermilion": (
            MATERIALS["red"],
            [strip(samples, *CURB, 0.063, range(0, n, 2)), strip(samples, -CURB[1], -CURB[0], 0.063, range(0, n, 2))],
        ),
        "Warm ivory": (
            MATERIALS["ivory"],
            [
                strip(samples, *CURB, 0.063, range(1, n, 2)),
                strip(samples, -CURB[1], -CURB[0], 0.063, range(1, n, 2)),
                strip(samples, *EDGE_LINE, 0.042),
                strip(samples, -EDGE_LINE[1], -EDGE_LINE[0], 0.042),
                strip(samples, -0.15, 0.15, 0.042, range(0, n, 3)),
                start["ivory"],
            ],
        ),
        "Rubber": (MATERIALS["rubber"], [start["rubber"]]),
    }
    for label, (material, parts) in surfaces.items():
        obj = mesh_object(f"track_{name}_{label}", material, parts, track)
        copy = bpy.data.objects.new(f"{obj.name}.preview", obj.data)
        preview.objects.link(copy)
    island(samples, preview, f"{name} diorama island")
    plant_trees(samples, preview)
    print(f"Built {name}: {len(control_points())} control points, barrier {ROAD_HALF_WIDTH + BARRIER_OFFSET} m off centre")


def write_json():
    curve = bpy.data.objects[CENTERLINE]
    name = slug()
    points = ",\n".join(f"    [{x:g}, {z:g}]" for x, z in control_points())
    path = REPO / "shared/src/tracks" / f"{name}.json"
    path.write_text(
        "{\n"
        f'  "id": "{name}",\n'
        f'  "name": {json.dumps(curve["track_name"])},\n'
        f'  "description": {json.dumps(curve["description"])},\n'
        f'  "checkpoints": {json.dumps(curve["checkpoints"])},\n'
        f'  "controlPoints": [\n{points}\n  ]\n'
        "}\n"
    )
    print(f"Wrote {path.relative_to(REPO)}")


def export_track():
    """Rebuild, save, and write the JSON the game reads plus the GLB it renders."""
    build()
    write_json()
    bpy.ops.wm.save_mainfile()
    output = REPO / "client/public/models/tracks" / f"{slug()}.glb"
    output.parent.mkdir(parents=True, exist_ok=True)
    curve = bpy.data.objects[CENTERLINE]
    homes = list(curve.users_collection)
    for home in homes:
        home.objects.unlink(curve)
    try:
        # Textures stay in the library; the game swaps in its materials by name (models.ts).
        bpy.ops.export_scene.gltf(
            filepath=str(output), export_format="GLB", use_selection=False,
            use_visible=False, use_renderable=False, use_active_scene=True,
            export_cameras=False, export_lights=False, export_apply=True,
            export_extras=True, export_hierarchy_full_collections=True,
            export_animations=False, export_image_format="NONE",
        )
    finally:
        for home in homes:
            home.objects.link(curve)
    print(f"Exported {output.relative_to(REPO)} ({output.stat().st_size // 1024} KB)")


def new_track(name, title):
    """Create tracks/<name>.blend with a centerline seeded from its JSON, or a default loop."""
    path = BLENDER_DIR / "tracks" / f"{name}.blend"
    if path.exists():
        raise RuntimeError(f"{path} already exists; open it instead.")
    source = REPO / "shared/src/tracks" / f"{name}.json"
    data = json.loads(source.read_text()) if source.exists() else {}
    bpy.ops.wm.read_homefile(use_empty=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(path))
    curve_data = bpy.data.curves.new(CENTERLINE, "CURVE")
    spline = curve_data.splines.new("POLY")
    points = data.get("controlPoints", SEED)
    spline.points.add(len(points) - 1)
    for point, (x, z) in zip(spline.points, points):
        point.co = (*blender_point(x, z, 0.5), 1)
    spline.use_cyclic_u = True
    curve = bpy.data.objects.new(CENTERLINE, curve_data)
    curve["track_name"] = data.get("name", title or name.replace("-", " ").title())
    curve["description"] = data.get("description", "")
    curve["checkpoints"] = data.get("checkpoints", 12)
    design = bpy.data.collections.new("design")
    bpy.context.scene.collection.children.link(design)
    design.objects.link(curve)
    build()
    bpy.ops.wm.save_mainfile()
    print(f"Created {path.relative_to(REPO)}")


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    command = args[0] if args else "build"
    if command == "new":
        new_track(args[1], args[2] if len(args) > 2 else "")
    elif command == "export":
        export_track()
    elif command == "build":
        build()
    else:
        raise SystemExit(f"Unknown command {command!r}: use new, build or export.")
