"""Author the three editable Blender films from Tiny Odyssey's real models.

Run with Blender -b --python shorts/build_scenes.py, or import via Blender MCP
and call build_all(). Rendering is separate so the live editor stays responsive.
"""
import bpy
import json
import math
import pathlib
import sys
from mathutils import Vector

HERE=pathlib.Path(__file__).resolve().parent
ROOT=HERE.parent
sys.path.insert(0,str(ROOT/'units'))
import build as U
FPS=24
R=math.radians

def mat(hexcol): return U.material(hexcol)

def obj(scene,name,mesh):
    ob=bpy.data.objects.new(name,mesh);scene.collection.objects.link(ob);return ob

def box(scene,name,loc,size,col):
    m=U.Model();m.box(-size[0]/2,-size[1]/2,-size[2]/2,size[0]/2,size[1]/2,size[2]/2,col)
    ob=obj(scene,name,U.mesh_of(m,name,1/U.MV));ob.location=loc;return ob

def ball(scene,name,loc,radius,col):
    m=U.Model();m.ball(0,0,0,radius,radius,radius,col,n=12)
    ob=obj(scene,name,U.mesh_of(m,name,1/U.MV));ob.location=loc;return ob

def root(scene,name):
    ob=obj(scene,name,None);ob.empty_display_type='PLAIN_AXES';return ob

def model(scene,name,kind,opts,size=1):
    m=U.Model();getattr(U,kind)(m,0,opts)
    ob=obj(scene,name,U.mesh_of(m,name,size))
    return ob

def actor(scene,name,opts,size=1,walking=True):
    # Eight authored vertex poses preserve the same topology; no runtime handlers.
    opts={**opts,'still':not walking}
    ob=model(scene,name,'human',opts,size)
    ob.shape_key_add(name='Rest')
    for j in range(8):
        m=U.Model();U.human(m,j/8,opts)
        assert len(m.verts)==len(ob.data.vertices), (name,j)
        key=ob.shape_key_add(name=f'Pose_{j}')
        key.data.foreach_set('co',[c*U.MV*size for v in m.verts for c in v])
    return ob

def wings(scene,person,size):
    result=[]
    k=U.MV*size
    for side in [-1,1]:
        pivot=root(scene,person.name+' wing '+str(side))
        pivot.parent=person;pivot.location=(-1.8*k,side*1.5*k,10*k)
        for j in range(6):
            feather=box(scene,person.name+' attached feather',(-.05-j*.05,side*(.35+j*.39),0),(1.35-j*.08,.39,.16),'#FFF3DC')
            feather.parent=pivot
            result.append(feather)
        result.append(pivot)
    return result

def pose(ob,t,f,rate=1):
    at=(t*rate*8)%8;left=int(at);u=at-left
    for j,key in enumerate(ob.data.shape_keys.key_blocks[1:]):
        key.value=(1-u if j==left else u if j==(left+1)%8 else 0)
        key.keyframe_insert('value',frame=f)

def key(ob,f):
    ob.keyframe_insert('location',frame=f)
    ob.keyframe_insert('rotation_euler',frame=f)
    ob.keyframe_insert('scale',frame=f)

def visible(ob,on,f):
    ob.hide_render=not on;ob.keyframe_insert('hide_render',frame=f)
    ob.hide_viewport=not on;ob.keyframe_insert('hide_viewport',frame=f)

def camera(scene):
    data=bpy.data.cameras.new(scene.name+' camera');data.type='ORTHO';data.clip_end=500
    cam=obj(scene,'Camera '+scene.name,data);scene.camera=cam;return cam

def view(cam,point,scale,f,angle=(.48,-1,.55)):
    target=Vector(point)
    cam.location=target+Vector(angle)*65
    cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
    cam.data.ortho_scale=scale
    cam.keyframe_insert('location',frame=f);cam.keyframe_insert('rotation_euler',frame=f)
    cam.data.keyframe_insert('ortho_scale',frame=f)

def original_set(scene,name,scale=10,loc=(0,0,0)):
    data=json.loads((HERE/'work'/f'{name}.json').read_text())
    p,c=data['positions'],data['colors']
    verts=[(p[i]*scale,-p[i+2]*scale,p[i+1]*scale) for i in range(0,len(p),3)]
    mesh=bpy.data.meshes.new(name+' original mesh')
    mesh.from_pydata(verts,[],[tuple(range(i,i+3)) for i in range(0,len(verts),3)])
    colors={};indices=[]
    for i in range(0,len(c),9):
        color=tuple(round(float(v),5) for v in c[i:i+3])
        if color not in colors:
            colors[color]=len(colors)
            m=bpy.data.materials.new(name+' stone '+str(len(colors)))
            m.diffuse_color=(*color,1)
            bsdf=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
            bsdf.inputs['Base Color'].default_value=(*color,1)
            bsdf.inputs['Roughness'].default_value=.9
            mesh.materials.append(m)
        indices.append(colors[color])
    mesh.polygons.foreach_set('material_index',indices);mesh.update()
    ob=obj(scene,'Tiny Odyssey / '+name,mesh);ob.location=loc
    ob['source']='gen/landmarks.js / '+name
    return ob

def set_scene(sid):
    scene=bpy.data.scenes.new('SHORT / '+sid)
    bpy.context.window.scene=scene
    scene.render.engine='BLENDER_WORKBENCH'
    scene.render.resolution_x=1080;scene.render.resolution_y=1920;scene.render.resolution_percentage=100
    scene.render.fps=FPS;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB'
    scene.render.image_settings.compression=15
    scene.render.film_transparent=False
    scene.view_settings.view_transform='Standard';scene.view_settings.look='None'
    scene.display.render_aa='16'
    sh=scene.display.shading;sh.light='STUDIO';sh.studio_light='outdoor.sl';sh.color_type='MATERIAL'
    sh.show_shadows=True;sh.show_cavity=True;sh.cavity_type='BOTH'
    sh.cavity_ridge_factor=.7;sh.cavity_valley_factor=.7
    sh.curvature_ridge_factor=.35;sh.curvature_valley_factor=.5
    sh.show_object_outline=False;sh.show_specular_highlight=True
    sh.background_type='WORLD';scene.world=bpy.data.worlds.new(sid+' sky');scene.world.color=(.17,.35,.43)
    sh.use_world_space_lighting=True;sh.studiolight_rotate_z=R(110)
    box(scene,'Aegean Sea',(0,0,-2.2),(400,400,.5),'#478CBA')
    # The map's familiar terraced terrain, with warm limestone exposed at the rim.
    for level,(w,d) in enumerate([(48,38),(43,34),(38,30)]):
        box(scene,'Terrace '+str(level),(0,4,-1.41+level*.56),(w,d,.58),['#9C906E','#C6B48A','#9DAF74'][level])
    for i in range(24):
        x=-36+(i*11.3)%80;y=-26+(i*7.8)%16
        box(scene,'Sea glint '+str(i),(x,y,-1.9),(.6+(i%5)*.5,.12,.025),'#87CBCD')
    return scene

def build_nobody(scene,timeline):
    original_set(scene,'cyclops',10,(0,2,0))
    hero=actor(scene,'Odysseus',dict(tunic='red',cloak='blue',beard='hair',belt='gold'),.65)
    giant=actor(scene,'Polyphemus',dict(tunic='hide',chest='tan',skin='tan',sleeve='tan',eye1=True,hair='hair',beard='hair',belt='wood2'),1.7,False)
    giant.location=(1,0,0);giant.rotation_euler.z=-math.pi/2
    patch=box(scene,'Bandage',(1.28,0,8.48),(.22,1.65,.9),'#F5EAD2');patch.parent=giant
    sheep=model(scene,'Getaway sheep','beast',U.SHEEP,1.8)
    ship=model(scene,'Odysseus galley','ship',U.UNITS['odysseus'][1],.6)
    ship.location=(9,-21,-1.7)
    rock=ball(scene,'Angry giant rock',(8,0,3),2,'#756E8C')
    helper=actor(scene,'Neighbour',dict(tunic='olive',skin='skin2',beard='hair',belt='wood2'),1.15,False)
    helper.location=(-12,2,0);helper.rotation_euler.z=-math.pi/2
    cam=camera(scene)
    for f,beat,u,t in frames(timeline):
        i=beat['index'];hero.location=(2,-9,0);hero.rotation_euler=(0,0,-R(70));hero.scale=(1,1,1)
        giant.rotation_euler=(0,0,-math.pi/2)
        if i==1: giant.rotation_euler.z=-math.pi/2-.1*math.sin(t*3)
        if i==3: giant.rotation_euler.x=.08*math.sin(u*20)
        sheep.location=(5,-10,0);sheep.rotation_euler.z=math.pi
        visible(sheep,i==5,f);visible(patch,i>=3,f);visible(helper,i==4,f)
        visible(rock,i>=7,f)
        if i==4: helper.location=(-7-u*5,0,0)
        if i==5:
            sheep.location.x=7-u*11
            hero.location=(sheep.location.x-.4,-10,.45);hero.rotation_euler=(R(80),0,-math.pi/2)
        if i>=6:
            hero.location=(11+u*.5,-21,-.35);hero.rotation_euler=(0,0,-R(85));hero.scale=(.75,.75,.75)
            ship.location=(8.5+u*.5,-21,-1.7)
        rock.location=(1+u*10,-u*20,3+math.sin(u*math.pi)*13)
        pose(hero,t,f,.65);pose(giant,t,f,.23);pose(helper,t,f,.3)
        for ob in [hero,giant,sheep,ship,rock,helper]:key(ob,f)
        shots=[((1,-3,6),26),((1,-2,6),22),((2,-9,2.5),9),((1,-.5,7.1),14),((-3,-1,6),25),((1,-10,2),16),((8.5,-20,2.8),17),((5,-10,5),35)]
        target,scale=shots[i]
        view(cam,target,scale*(1-.045*u),f,angle=(.35,-1,.34) if i in [2,3,5] else (.48,-1,.52))
    return scene

def build_icarus(scene,timeline):
    original_set(scene,'labyrinth',10,(0,13,0))
    hero=actor(scene,'Icarus',dict(tunic='red',skin='skin',hair='blond',belt='gold',arms='carry'),.68,False)
    dad=actor(scene,'Daedalus',dict(tunic='purple',beard='grey',hair='grey',belt='gold',arms='carry'),.7,False)
    hero_wings=wings(scene,hero,.68);dad_wings=wings(scene,dad,.7)
    sun=ball(scene,'The sun',(3,-9,25.5),3.3,'#FFD166')
    feathers=[]
    for i in range(14): feathers.append(box(scene,'Loose feather '+str(i),(0,0,0),(.16,.22,.95),'#FFF3DC'))
    splashes=[]
    for i in range(12): splashes.append(box(scene,'Splash '+str(i),(0,0,-1.6),(.25,.25,1),'#C6F9F4'))
    cam=camera(scene)
    for f,beat,u,t in frames(timeline):
        i=beat['index'];z=5.5
        if i==3:z=8+u*9
        elif i==4:z=17+u*2
        elif i==5:z=19-(u*u)*23
        hero.location=(1,-20,z+.2*math.sin(t*3))
        hero.rotation_euler=(0,0,-math.pi/2)
        if i==5:hero.rotation_euler.y=u*R(145)
        dad.location=(-4,-17,5+.15*math.sin(t*2));dad.rotation_euler=(0,0,-R(80))
        if i>=6:dad.rotation_euler.x=R(23)
        visible(hero,i<6 and not(i==5 and u>.92),f)
        for group,owner in [(hero_wings,hero),(dad_wings,dad)]:
            for part in group:
                visible(part,owner==dad or i<4 or (i==4 and u<.5),f)
                if part.type=='EMPTY':
                    side=-1 if part.name.endswith('-1') else 1
                    part.rotation_euler.x=side*(-.25+math.sin(t*7)*.45)
                    part.keyframe_insert('rotation_euler',frame=f)
        pose(hero,t,f,1.5);pose(dad,t,f,.65);key(hero,f);key(dad,f)
        for j,feather in enumerate(feathers):
            a=j*2.4;feather.location=(1+math.cos(a)*(1+u*5),-20+math.sin(a)*(1+u*3),z+2-j*.14-u*6)
            feather.rotation_euler=(u*4+j,u*3,j)
            visible(feather,i==4 or (i==5 and u<.75),f);key(feather,f)
        for j,sp in enumerate(splashes):
            a=j*math.tau/12;radius=.5+u*5
            sp.location=(1+math.cos(a)*radius,-20+math.sin(a)*radius,-1.5+math.sin(u*math.pi)*(1+j%3)*.7)
            sp.rotation_euler=(math.cos(a)*.5,math.sin(a)*.5,a)
            visible(sp,i==6 and u<.8,f);key(sp,f)
        shots=[((1,-9,8),14),((-1,-7,6.8),22),((-4,-6,7.8),13),((1,-8,z+3.4),18),((1,-9,21),18),((1,-9,10),31),((-2,-8,2.5),25),((-4,-6,6.5),18)]
        target,scale=shots[i];view(cam,(target[0],target[1]-11,target[2]),scale*(1-.03*u),f,(.25,-1,.36))
    return scene

def build_sisyphus(scene,timeline):
    original_set(scene,'sisyphus',10)
    hero=actor(scene,'Sisyphus',dict(tunic='cream',skin='skin2',hair='hair',beard='hair',belt='wood2',arms='carry'),.65)
    stone=ball(scene,'The stone',(0,0,0),2.0,'#AAA49A')
    cam=camera(scene)
    for f,beat,u,t in frames(timeline):
        i=beat['index']
        progress=[.82,.14,.30+.36*u,.66+.23*u,.89-.79*u*u,.10,.10,.10+.12*u][i]
        man_progress=progress-.22
        if i in [4,5]:man_progress=.67
        if i==6:man_progress=.67-.79*u
        stone.location=(-9.5+15*progress-1.25,.5,12*progress+1.56)
        stone.rotation_euler.y=-progress*8
        hero.location=(-9.5+15*man_progress,-.8,max(0,12*man_progress))
        hero.rotation_euler=(0,R(8),math.pi if i==6 else 0)
        if i==5:hero.rotation_euler.y=-R(8)
        pose(hero,t,f,.8 if i in [2,3,7] else .22);key(hero,f);key(stone,f)
        shots=[((1,-1,11),17),((-7,-1,4),23),((hero.location.x+1,-1,hero.location.z+3),17),((2,-1,11.2),14),((-1,0,7),26),((hero.location.x,-1,hero.location.z+2.3),11),((-2,-1,7),27),((-7,-1,3.2),17)]
        target,scale=shots[i];view(cam,target,scale*(1-.04*u),f,(.43,-1,.42))
    return scene

def frames(timeline):
    f=1
    for beat in timeline['timeline']:
        for j in range(beat['frames']):
            yield f,beat,j/max(1,beat['frames']-1),(f-1)/FPS
            f+=1

def linear_actions():
    for action in bpy.data.actions:
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for fc in bag.fcurves:
                        discrete=fc.data_path in ['hide_render','hide_viewport']
                        for k in fc.keyframe_points:k.interpolation='CONSTANT' if discrete else 'LINEAR'

def build_all():
    result=[]
    for sid,fn in [('nobody',build_nobody),('icarus',build_icarus),('sisyphus',build_sisyphus)]:
        timeline=json.loads((HERE/'work'/sid/'timeline.json').read_text())
        scene=set_scene(sid);fn(scene,timeline)
        scene.frame_start=1;scene.frame_end=sum(b['frames'] for b in timeline['timeline'])
        scene.render.filepath=str(HERE/'work'/sid/'frames')+'/'
        scene['story_source']=timeline['source'];scene['caption_file']=sid+'.srt'
        for beat in timeline['timeline']:
            marker=scene.timeline_markers.new(beat['caption'].replace('\n',' / '),frame=round(beat['start']*FPS)+1)
        scene.frame_set(1)
        result.append({'id':sid,'frames':scene.frame_end,'objects':len(scene.objects),'duration':timeline['duration']})
    linear_actions()
    bpy.context.window.scene=bpy.data.scenes['SHORT / nobody']
    bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'tiny-odyssey-shorts.blend'))
    print(json.dumps(result))
    return result

if __name__=='__main__':build_all()
