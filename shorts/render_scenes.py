"""Render saved film scenes. Pass --preview for one midpoint per shot."""
import bpy
import json
import pathlib
import sys
HERE=pathlib.Path(__file__).resolve().parent
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
preview='--preview' in args
ids=args[args.index('--only')+1].split(',') if '--only' in args else ['nobody','icarus','sisyphus']
for sid in ids:
    scene=bpy.data.scenes['SHORT / '+sid]
    bpy.context.window.scene=scene
    folder=HERE/'work'/sid/('preview' if preview else 'frames')
    folder.mkdir(parents=True,exist_ok=True)
    scene.render.resolution_percentage=50 if preview else 100
    timeline=json.loads((HERE/'work'/sid/'timeline.json').read_text())
    frames=[round((b['start']+b['duration']*.5)*24)+1 for b in timeline['timeline']] if preview else range(1,scene.frame_end+1)
    for f in frames:
        dest=folder/f'{f:06}.png'
        if dest.exists() and '--overwrite' not in args:continue
        scene.frame_set(f);scene.render.filepath=str(dest)
        bpy.ops.render.render(write_still=True)
    print('COMPLETE',sid,'preview' if preview else 'full',flush=True)
