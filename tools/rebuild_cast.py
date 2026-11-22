"""Rebuild the block cast and every derived map representation.

python tools/rebuild_cast.py --blender /path/to/blender [--jobs 8]
Run against an existing world; preserves painted tiles, routes and place data.
"""
import argparse
import pathlib
import subprocess

p = argparse.ArgumentParser()
p.add_argument('--blender', required=True)
p.add_argument('--jobs', default='8')
a = p.parse_args()
root = pathlib.Path(__file__).resolve().parents[1]
assert (root / 'world/manifest.json').is_file(), 'Build the world first'
logs = root / 'art/review/build-logs'
logs.mkdir(parents=True, exist_ok=True)
commands = [
    ('units', [a.blender, '-b', '--factory-startup', '--python-exit-code', '1', '-P', 'units/build.py', '--', '--grid', '8', '--big']),
    ('stacks', [a.blender, '-b', '--factory-startup', '--python-exit-code', '1', '-P', 'units/stack.py']),
    ('assets', [a.blender, '-b', '--factory-startup', '--python-exit-code', '1', '-P', 'units/assets.py', '--', '--only', 'penelope,cyclops_body,cyclops_arm']),
    ('animation-geometry', ['node', 'gen/build.mjs', '--anims']),
    ('animation-sheets', [a.blender, '-b', '--factory-startup', '--python-exit-code', '1', '-P', 'units/anims.py']),
    ('overlays', ['node', 'gen/build.mjs', '--overlays']),
    ('terrain-pyramid', ['node', 'tools/pyramid.mjs', '--jobs', a.jobs]),
]
for name, cmd in commands:
    print(f'START {name}', flush=True)
    with (logs / (name + '.log')).open('w', encoding='utf-8') as log:
        subprocess.run(cmd, cwd=root, stdout=log, stderr=subprocess.STDOUT, check=True)
    print(f'DONE {name}', flush=True)
print('Cast and map rebuilt.', flush=True)
