"""Export the saved library, batching static surfaces and each wheel independently.

Run in Blender: exec(open('/absolute/path/to/assets/blender/export-library.py').read())
The saved source keeps its editable components and modifiers; batching is temporary.
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
            if obj.type != 'MESH':
                continue
            bpy.context.view_layer.objects.active = obj
            for modifier in list(obj.modifiers):
                bpy.ops.object.modifier_apply(modifier=modifier.name)
            # Keep lamps and bodywork identifiable, and never join across moving pivots.
            key = (obj.parent, tuple(m.name for m in obj.data.materials),
                   bool(obj.get('authored_bodywork')), 'Warm_headlights' in obj.name)
            groups.setdefault(key, []).append(obj)
        for (parent, materials, bodywork, headlight), objects in groups.items():
            bpy.ops.object.select_all(action='DESELECT')
            for obj in objects:
                obj.hide_set(False)
                obj.select_set(True)
            bpy.context.view_layer.objects.active = objects[0]
            if len(objects) > 1:
                bpy.ops.object.join()
            label = 'Warm_headlights' if headlight else materials[0]
            objects[0].name = collection.name.replace(':', '_') + '_' + label
            objects[0]['authored_bodywork'] = bodywork
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
