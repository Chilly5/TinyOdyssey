"""Render isolated views of every humanoid for the cast review sheet.
blender -b --factory-startup -P units/review_cast.py
"""
import bpy
import pathlib
import sys
from mathutils import Vector
HERE=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import build as U
assert bpy.app.background, 'Run this review in background Blender'
out=HERE.parent/'shorts/work/cast'
out.mkdir(parents=True,exist_ok=True)
scene,cam=U.setup()
scene.render.resolution_x=512;scene.render.resolution_y=512
scene.display.render_aa='16';scene.render.film_transparent=False
scene.display.shading.background_type='WORLD'
scene.world.color=(.06,.095,.13)
for name,u in U.UNITS.items():
    if u[0] is not U.human:continue
    m=U.Model();U.human(m,0,{**u[1],'still':True})
    mesh=U.mesh_of(m,name);ob=bpy.data.objects.new(name,mesh);scene.collection.objects.link(ob)
    lo=Vector(tuple(min(v.co[i] for v in mesh.vertices) for i in range(3)))
    hi=Vector(tuple(max(v.co[i] for v in mesh.vertices) for i in range(3)))
    center=(lo+hi)/2
    cam.location=center+Vector((18,-11,10))
    cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler()
    cam.data.ortho_scale=max(hi.z-lo.z,hi.x-lo.x,hi.y-lo.y)*1.4
    scene.render.filepath=str(out/(name+'.png'));bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(ob,do_unlink=True)
print('Cast review images:',out)
