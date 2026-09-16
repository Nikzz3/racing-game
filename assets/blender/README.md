# Blender asset library

`sunset-ridge.blend` is the editable source. The game loads the full collection export at
`client/public/models/rework/sunset-ridge.glb`. Edit the source in Blender and export
glTF Binary through File > Export > glTF 2.0. Export the active scene with collection
hierarchy, including hidden objects, and exclude cameras and lights.

Use View > Local View > Toggle Local View to return from an isolated asset to the
complete workshop.

The library contains eight cars, five trees, three rocks, grass, two flowers, a barrier,
a cone, a start gate, a grandstand, and both circuits. Cars include separate wheel
pivots, tire tread, spokes, brake discs and calipers, grilles, lights, mirrors, cabin
details, exhausts, and accessories for each variant.
Both side mirrors have solid mounting arms connecting their housings to the cabin.
The asset integration test checks these attachment gaps on all eight cars.

The `preview:sunset-ridge` and `preview:stormhaven` collections contain exact circuit
copies on beveled terrain bases with their own trees for the track carousel. The
runtime centers and scales these collections for the showroom. Gameplay continues
to use the original `track:` collections in world coordinates.

The environment detail pass was made through Blender's UI. Rocks have weathered
surfaces, tree canopies have raised leaf clusters, trunks and branches have bark
relief, and curb edges have small bevels. Preview trees are separate from the
gameplay tree collections.

The `environment:garage` collection is the persistent lobby workshop. It contains
a worn concrete floor and painted plaster walls, beveled steel framing, ceiling panels and
strip fixtures, a slatted roller shutter, fitted tool cabinets and handles, a
workbench, spare tires, bay markings, and wall lettering. These were modeled and
given materials through Blender's visible interface. The eight bays are five metres
apart, centered along X from -17.5 to 17.5. The floor is at Z = 0 in Blender and
Y = 0 in the game. Keep this collection separate
from the staged asset library and preserve its name when exporting.

The floor and walls have separate packed 1K color, roughness, and normal maps.
Floor UVs repeat every three metres with normal strength 0.45; wall UVs repeat
every two metres with normal strength 0.30. These surfaces do not share the
circuit's coarse gravel material.

Workshop details include perforated tool panels with wrenches and screwdrivers,
a bench vice, wheeled drawer carts, coiled air hoses, wall conduit, tire racks,
oil cans, drums, labelled parts cartons, a framed workshop poster, and numbered bay boards. A dark lower
wall band, skirting, and narrow concrete slab joints give the room a visible
construction scale. The layout draws on [LISTA workshop references](https://workshop-equipment.lista.com/en/project-examples/).
Racks and tool panels use scanned scuffed blue steel at a 2.5-metre repeat;
the roller door uses weathered painted shutter maps at a two-metre repeat.

The lobby adds runtime lighting and reflections to the exported room. Its canvas
stays behind all three menu screens. All eight cars stay parked in their bays;
left/right navigation moves the camera to the selected car, and dragging orbits
the camera. Circuit selection hides the cars while keeping the room visible.
Rendering stops when the camera settles and pauses when the lobby or browser tab
is hidden. Reduced-motion mode changes the view immediately.

Both circuit previews now use `leafy_grass`, and the gameplay and preview shoulders
use `gravel_concrete`. These materials contain 1K color, roughness, and normal maps,
packed into the Blender source and embedded in the GLB. The grass has a green
multiply tint; normal strength is 0.35 on both surfaces. Shoulder UVs repeat across
the circuit instead of stretching one image over its full length. The game's ground
reuses the exported grass material with a four-metre texture repeat.

The CC0 textures are from Poly Haven:

- [Leafy Grass](https://polyhaven.com/a/leafy_grass), by Charlotte Baglioni.
- [Gravel Concrete](https://polyhaven.com/a/gravel_concrete), photographed by
  Charlotte Baglioni and processed by Dario Barresi.
- [Concrete Floor Worn 001](https://polyhaven.com/a/concrete_floor_worn_001),
  photographed by Dimitrios Savva and processed by Rico Cilliers.
- [Painted Plaster Wall](https://polyhaven.com/a/painted_plaster_wall), by Amal Kumar.
- [Blue Metal Plate](https://polyhaven.com/a/blue_metal_plate), by Rob Tuytel.
- [Painted Metal Shutter](https://polyhaven.com/a/painted_metal_shutter), photographed
  by Charlotte Baglioni, baked by Dario Barresi, and processed by Rico Cilliers.

Material assignment, shader edits, UV projection, packing, saving, and GLB exports
were performed through Blender's visible interface. Export with UVs, normals,
materials, applied modifiers, and full collection hierarchy enabled. Tangents can
remain disabled; Three.js derives them for the normal maps.

Collection names are the runtime keys, such as `car:race`, `nature:tree_oak`, and
`track:stormhaven`. Preserve those names and the four `wheel_front_left`,
`wheel_front_right`, `wheel_rear_left`, and `wheel_rear_right` object names. glTF uses
Y up and Z forward. The loader removes the cars' workshop staging offsets and scales
each car to 4.2 meters long. Track geometry stays in the shared circuit coordinates.

The first asset pass was generated by a script that has since been removed.
Subsequent car cabin, body mesh, and foliage edits were made directly in Blender
through computer use, then saved and exported through Blender's UI. The saved
`.blend` file is the source of truth; no asset-generation script is needed to build
or run the game.

`tracks.json` records the shared circuit samples used when the track source was made.
The asset integration test parses the exported GLB, checks every car's tire contact
and wheel pivots, and raycasts both roads against the shared driving surface.
