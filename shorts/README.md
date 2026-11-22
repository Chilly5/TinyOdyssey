# Myths in Miniature

Three original animated shorts in Tiny Odyssey's own settings, with the shared block-avatar cast. Finished films are 1080 × 1920, 24 fps, H.264/AAC, with burned-in comic captions, English SRT/VTT narration captions, cover images and an accessible player page at `/shorts/`.

| Film | Duration | Story |
| --- | --- | --- |
| Nobody Did It | 35.67 s | Odysseus's Nobody trick, escape beneath the sheep, and disastrous boast |
| Flight Mode | 35.38 s | Daedalus's warning, Icarus's ascent, melting wax and fall |
| Almost There | 37.58 s | Sisyphus's endless struggle, retold as a progress bar that never finishes |

The cave, labyrinth and Corinth hillside are exported directly from `gen/landmarks.js`. Actors use `units/build.py`; shots, camera cuts, flight, falling feathers, the getaway and boulder are keyed in `tiny-odyssey-shorts.blend`. All three films are editable scenes with named timeline markers. Workbench rendering keeps the flat illustrated look of the map. The production is an original humorous adaptation, with modern jokes and invented dialogue.

Primary story references: [Homer, Odyssey IX](https://www.theoi.com/Text/HomerOdyssey9.html), [Ovid, Metamorphoses VIII](https://www.theoi.com/Text/OvidMetamorphoses8.html), [Homer, Odyssey XI](https://www.theoi.com/Text/HomerOdyssey11.html). No modern translation was copied into the script. Narration uses Microsoft's `en-US-GuyNeural` synthesized voice through edge-tts. The electronic score and effects are generated here from oscillators and noise, with no third-party recordings.

## Rebuild

Use Blender 5.2 and Python with `edge-tts`, `imageio-ffmpeg`, `numpy` and `Pillow` installed. The text renderer uses Arial on Windows and falls back to DejaVu Sans on Linux.

```text
node shorts/export_sets.mjs
python shorts/prepare_audio.py
blender -b --factory-startup --python-exit-code 1 -P shorts/build_scenes.py
blender -b shorts/tiny-odyssey-shorts.blend --python-exit-code 1 -P shorts/render_scenes.py
python shorts/finish.py
```

`render_scenes.py -- --preview` renders the midpoint of each shot; `finish.py --preview` makes caption review images. Rendering resumes from existing PNGs; use `-- --overwrite` after an animation change. `--only nobody,icarus,sisyphus` selects films for either rendering or encoding. `work/` contains the cached narration, timing, audio mix, raw frames and review images and is intentionally excluded from Git. The `.blend`, scripts, captions, covers and finished MP4s are committed. Deployment copies only web-ready files.

## Cast validation

The 23 humanoid costume variants passed the Blender asset QA render profile with no errors. Each has 228–680 triangles, unit object scale and no inconsistent normals. The shared shape is a broad cuboid torso, separate rectangular arms and legs, a square head, and a simple face. Greek colours, clothing and tools remain distinct; the same builder supplies ship crews and hoplite sprite stacks. `art/block-cast.blend` contains the complete humanoid lineup; `art/review/cast-qa.json` records every metric and warning.

Accepted render-only warnings: solid-colour materials do not need UV maps; legacy jars/crowns keep duplicated cap vertices and cone tips with zero-area faces; separate touching smile segments retain hidden opposing faces; the harpy's deliberately angled pose extends slightly below the origin. These do not affect the raster sprite/film outputs. The models reproduce a Roblox-like aesthetic; they are not an R15 skeleton or Roblox marketplace upload package. Rounded animals, boats and architectural props retain their existing design.

The map's terraces and pixel-art styles are regenerated from the new geometry. The pre-existing painted style remains its historical painted illustration, while its live character overlays use the new cast.

The six film actors, including both characters' attached feather assemblies, also pass the render profile (`art/review/shorts-qa.json`). Their accepted warnings are solid-colour materials without UVs, hidden opposing faces between touching feather or face segments, and nonzero ground heights for flight, walking bob and standing on the hillside. Review images cover all 23 costumes and the midpoint of every film shot. Finished movies are decoded in full and checked for portrait dimensions, frame count, duration and audio peak.
