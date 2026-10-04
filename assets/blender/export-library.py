"""Run in Blender's Python console to export the library with batched car details.

exec(compile(open('/absolute/path/to/assets/blender/export-library.py').read(),
             'export-library.py', 'exec'))

Save your source first. This batches details in memory, exports, then reloads the saved source.
Editable component objects are preserved in the saved source.
"""
from pathlib import Path
import bpy

source_path = Path(bpy.data.filepath)
if source_path.name != 'sunset-ridge.blend' or bpy.data.is_dirty:
    raise RuntimeError('Save sunset-ridge.blend before exporting.')
output = source_path.parents[2] / 'client/public/models/rework/sunset-ridge.glb'
try:
    for collection in bpy.data.collections:
        if not collection.name.startswith('car:'):
            continue
        groups = {}
        for obj in list(collection.objects):
            if obj.type != 'MESH' or obj.parent or any(key in obj.name for key in (
                'Sculpted body shell', 'Cabin coachwork', 'mirror_mount_',
                'Mirror housing', 'Windscreen',
            )):
                continue
            bpy.context.view_layer.objects.active = obj
            for modifier in list(obj.modifiers):
                bpy.ops.object.modifier_apply(modifier=modifier.name)
            groups.setdefault(obj.data.materials[0].name, []).append(obj)
        for material, objects in groups.items():
            bpy.ops.object.select_all(action='DESELECT')
            for obj in objects:
                obj.select_set(True)
            bpy.context.view_layer.objects.active = objects[0]
            if len(objects) > 1:
                bpy.ops.object.join()
            label = 'Warm_headlights' if material == 'Automotive LED headlamps' else material
            objects[0].name = collection.name.replace(':', '_') + '_' + label
    bpy.ops.export_scene.gltf(
        filepath=str(output), export_format='GLB', use_selection=False,
        use_visible=False, use_renderable=False, use_active_scene=True,
        export_cameras=False, export_lights=False, export_apply=True,
        export_extras=True, export_hierarchy_full_collections=True,
        export_animations=False,
    )
finally:
    bpy.ops.wm.open_mainfile(filepath=str(source_path))
print(f'Exported {output}. Run npm run optimize:glb -w client next.')
