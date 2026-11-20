# TinyOdyssey

An animated voxel-art map of mythological Greece. It is one picture, 47,424 × 18,652 pixels across the whole map, with all the land painted again at twice that scale and the towns and landmarks at four times, and the closer you zoom the more there is to see.

Click a place to read its myth. Zoom into a town to find its streets, its market and the smaller stories nearby. Press **Sail the Odyssey** to follow Odysseus home from Troy in seventeen stops. A day lasts five minutes: at dusk the lamps come on. Turn the sound on for the sea, the birds and a lyre where the Muses are.

Inspired by [hexagonal.earth](https://hexagonal.earth/), and made the way the isometric city maps are: [isometric.nyc](https://isometric.nyc), [tiny.london](https://tiny.london/how/), [Pixel Singapore](https://www.yadongxie.com/blog/how-isometric-pixel-city-was-made) and [Isometric SF](https://www.justinchavez.com/blog/isometric-sf-how/).

## Run it

```
npm start            # http://127.0.0.1:8137/  (needs only Node)
```

Opening `index.html` straight from disk will not work: browsers refuse to load JavaScript modules and image tiles from `file://`.

`world/` is not in this branch: it is built (see Rebuilding), and large. The finished site, world and all, is the `gh-pages` branch.

## Share it

It is a static site: `index.html`, `src/`, `world/` and `preview.jpg`, with no build command. A visitor downloads only the tiles they look at.

```
npm run deploy       # copies those into dist/ and pushes them as the gh-pages branch, which GitHub Pages serves
```

The branch is replaced on every deploy rather than added to, so the repository does not fill up with old pictures. Any other static host (Netlify, Cloudflare Pages) can be given the same `dist/` folder: `node tools/deploy.mjs --dry` makes it without pushing.

Links can point at a place: `…/#olympus` opens Mount Olympus, `…/#odyssey` starts the voyage. The ids are in `src/sites.js` and `src/minor.js`. `?time=night` or `?time=day` holds the time of day still.

## How the picture is made

Those city maps render a real 3D model of a city through one fixed camera and have an image model redraw the render in a chosen style. Mythological Greece has no 3D scan, so here the model is built first.

1. **Real terrain.** `gen/dem.mjs` assembles elevation and sea depth for 10°E to 30.9°E, 32.3°N to 42.3°N. `gen/fields.mjs` works out distance to the shore, a climate, the rivers, and a smoothed copy of the high ground: heights are stretched about seven times, and real relief stretched that much is a forest of needles, so mountains are drawn from the smoothed copy as broad stepped massifs.
2. **The settled country.** `gen/plan.mjs` wraps a town round each great site (streets, a market, houses in rows, sometimes a wall and a pier) and joins the places with roads found over the ground with A*.
3. **The render.** `gen/region.mjs` terraces the ground, lays out fields, scatters trees and villages, sweeps shadows across, and flattens everything to pixels through a camera that looks north and down. The landmarks (`gen/landmarks.js`, and `gen/minor.js` for the small ones) are built from simple solids. This is a complete small map on its own, 11,856 × 4,663 pixels.
4. **What the painter is shown.** `gen/cond.mjs` exports that render without landmarks, plus every landmark sampled four times finer so its columns and figures have real shapes.
5. **The painting.** `paint/paint.py` has FLUX.2 klein 4B redraw the render four times larger as voxel art.
   - The whole map is one shared canvas. At each of the four denoising steps the model runs on overlapping 1024-pixel windows, each shown its own crop of the render, and the windows' answers are averaged where they overlap. Every other step uses a grid shifted by half a stride, so no seam sits in the same place twice.
   - The prompt says how to draw, never what: "draw exactly what the render shows … add nothing". Naming things makes the model add them. It says nothing about colour either, for the same reason.
   - What stands at each great landmark is in `paint/hints.json`. Only one window, centred on the landmark, is told, and its answer outweighs its neighbours there.
   - Open sea is held at the render, so nothing can be invented in it.
6. **A closer look.** `paint/detail.py` paints the towns, landmarks and minor places again at 8 pixels to the map pixel, and their cores at 16. Each level is drawn from the one below: the model is shown that picture enlarged and softened and told to redraw it sharp without moving anything.
   - The open country is the first exception (`detail.py --level 8 --all`). Redrawn from an enlargement it only comes back smoother, so it is painted afresh from the render, exactly as the base was but at twice the scale, where a tree is twice as many pixels across and gets twice the cubes. The places already painted are held still, so the new country grows up to them without a join. Wherever a finer level exists, the coarser tiles are made from it, so this painting is also what you see zoomed out.
   - The minor places are the second. At the base scale each is a small thing in a large window, and the model guesses what it is (a boar comes back as a hut). `paint/minor.py` paints each one afresh at the 8 level, from the render, told what it is (its `paint` line in `src/minor.js`), changing only the landmark's own outline. `--only olympia --say "…"` does the same for one of the great places.
   - When the render changes under a finished picture (a place is moved), `detail.py --level 8 --all --over --box X,Y,W,H` paints that rectangle again and keeps it as a correction laid over the rest.
7. **Tiles.** `paint/tiles.py` gives each painting the broad colour of the level below it (the model draws shapes well and drifts in colour), puts the render's own sea back round the land, marks water in each pixel's alpha for the animation, makes the coarser tiles from the finer ones so zooming never changes what is there, and cuts 512-pixel WebP tiles.

## How it moves

The viewer (`src/viewer.js`) is a small WebGL deep-zoom renderer with no dependencies. On top of the still picture it draws:

- **The sea**, animated in a shader: surf running up the shore, swell lines that follow the coast, glints on open water.
- **The little people** (`src/life.js`): travellers, carts and soldiers on the roads, townsfolk in the streets and markets, shepherds with their flocks, farmers in the fields, fishing boats, the watch round the walls, and creatures that keep to their own country (centaurs on Pelion, satyrs in Arcadia, Talos on his rounds of Crete). They follow paths laid out by `gen/life.mjs`.
- **Ships** on sea routes found with A* (`gen/routes.mjs`): Odysseus, the Argo, Theseus, merchants and warships.
- **Landmark animation.** The landmarks' moving parts: Sisyphus and his boulder, the Minotaur pacing the Labyrinth, the Clashing Rocks.
- **Sky**: clouds and their shadows, birds, Pegasus, Icarus, smoke, fire and lightning (`src/actors.js`).

The people, animals and ships are small voxel models built and rendered in **Blender** by `units/build.py`: about 45 kinds, each from 8 or 16 headings and through its walk, at three sizes. The landmarks' moving parts are rendered there too (`units/anims.py`): `gen/anims.mjs` writes each frame out as small cubes, leaving out the ones that stand behind scenery, and Blender lights and outlines them as it does the units.

**Walking behind things.** The render knows how far south everything in the picture stands. `gen/tiles.mjs` keeps that as tiles of the scenery's height (`world/occ`), every path point carries the height of its ground, and the sprite shader compares the two: the part of a walker that is behind a house, a wall, a tree or a hill is not drawn. Ships pass behind headlands the same way.

**Day and night** (`src/main.js`, the last shader in `src/viewer.js`). A day is five minutes. At dusk the light warms, then the picture cools and darkens, a lamp comes on at every house and fire (their places come from the town plan), most people go indoors and the birds roost. **N** or the button holds it at day or night.

**Sound** (`src/sound.js`) is made in the browser from noise and a few oscillators, so there is nothing to download: sea and wind according to what is in view, birds by day and crickets by night, gulls on the coast, a town's murmur, a lyre where there is music, thunder when Zeus throws. It is off until asked for (**M** or the button).

A last pass adds bloom on whatever is nearly white or hot, a contrast curve, and a tilt-shift blur towards the top and bottom of the screen. Both ease off as you zoom in.

There are two ways to show the picture. The usual one is smooth: one painted pixel to the screen pixel. Press **P**, or open the page with `?look=pixel`, for the pixel look: the picture in hard pixels two screen pixels across with a limited range of colours, on the same grid as the units over it. To make that the default for a world, run `node gen/build.mjs --overlays --look pixel`.

## Rebuilding

```
npm install                 # three.js, used only for its maths while baking models
npm run world               # the render, sprites, units, paths, routes -> world/   (1 minute)
npm run cond                # what the painter is shown -> paint/work/cond          (1 minute)
node gen/build.mjs --spots  # the places to paint in finer detail -> paint/work/spots.json
cd paint
python paint.py --out work/base     # the painting                   (about 80 minutes on an RTX 5080)
python detail.py --level 8          # towns and landmarks, finer     (about 25 minutes)
python detail.py --level 8 --all    # the open country, finer        (about 4 hours)
python minor.py                     # the minor places, put right    (about 5 minutes)
python detail.py --level 16         # the towns' cores, finer still  (about 70 minutes)
python tiles.py                     # tiles -> world/tiles, and world/manifest.json   (about 20 minutes)
```

`node gen/build.mjs --refresh` redoes everything in `world/` except the picture: the paths, the height tiles, the lamps, the sprites and the labels. `node gen/build.mjs --overlays` redoes only what is drawn over the picture (sprites, the landmarks' animation, the units). Both leave the sprite sheets as PNG; `python tiles.py --sheets` packs them again.

`npm run world` alone leaves a working site that shows the plain render. It also clears `world/`, so run `python tiles.py` again afterwards to put the painting back. To build a new world beside the one being served, use `node gen/build.mjs --out world.next` and `python tiles.py --world ../world.next`, and look at it with `http://127.0.0.1:8137/?world=world.next/`.

The units and the landmarks' moving parts are made in Blender (5.x), before `npm run world`:

```
blender --background --factory-startup --python units/build.py     # the units -> units/out                    (2 minutes)
node gen/build.mjs --anims                                          # the moving parts, as cubes -> units/anims/src
blender --background --factory-startup --python units/anims.py     # rendered -> units/anims/out               (3 minutes)
blender --background --factory-startup --python units/build.py -- --only man,trireme --sheet sheet.png    # a contact sheet to look at
blender --background --factory-startup --python units/anims.py -- --only corinth,cyclops --sheet sheet.png
```

Without them the world still builds: there are no walkers, and the moving parts are flattened in the old way.

The painter needs an NVIDIA card with about 10 GB of free memory and its own Python environment:

```
cd paint
uv venv --python 3.12 .venv
uv pip install --python .venv/Scripts/python.exe torch torchvision --index-url https://download.pytorch.org/whl/cu128
uv pip install --python .venv/Scripts/python.exe -r requirements.txt
```

The model (15 GB, Apache 2.0 licence) is kept in `paint/.models`. `paint.py` does not go online by default; set `HF_HUB_OFFLINE=0` for the first run so it can download.

Useful while tuning:

```
python paint.py --region 29696,7680,3072,2048 --out work/test --preview    # paint one rectangle, write work/test/paint.png
python review_landmarks.py athens rhodes                                   # paint landmarks alone, into work/lm_0.png
python try_prompts.py work/p.png athens 29696,8704                         # one window per line of prompts.txt, side by side
python detail.py --level 8 --only athens --plan                            # count the windows a finer level would take
python minor.py --only calydon,aulis --sheet work/m.png                    # repaint some minor places and look at them
python tiles.py --preview work/x.png --at 61400,16700,2048,1536 --level 8  # one rectangle of the finished picture
python paint.py --resume                                                   # carry on after an interruption
```

## Changing things

| To change | Edit | Then |
| --- | --- | --- |
| Places, their text, the voyage stops | `src/sites.js`, `src/minor.js` | everything under Rebuilding if a place moved |
| Which sites have towns, and how big | `town` and `walls` in `src/sites.js` | world, cond, spots, paint, detail, tiles |
| What a landmark is made of | `gen/landmarks.js`, `gen/minor.js`, `gen/models.js` | world, cond, paint, detail, tiles |
| What the painter is told about a landmark | `paint/hints.json`; for a minor place, its `paint` line in `src/minor.js` | paint, detail, tiles (minor places: cond, minor, tiles) |
| The painting's style | the prompts at the top of `paint/paint.py` and `paint/detail.py` | paint, detail, tiles |
| Terrain, climate, colours, what grows where | `gen/region.mjs`, `gen/fields.mjs`, `gen/palette.mjs` | world, cond, paint, detail, tiles |
| Who walks where | `gen/life.mjs` (paths), `src/life.js` (who, how many, how fast, who stays out at night) | refresh for paths; reload for the rest |
| What the units look like | `units/build.py` | Blender, then overlays |
| How a landmark's parts move | its `tick` in `gen/landmarks.js` | anims, Blender, then overlays |
| Ships, clouds, effects | `src/actors.js` | reload |
| The length of a day, the lamps | `src/main.js` | reload |
| What is heard | `src/sound.js` | reload |
| Bloom, contrast, blur, night, sea animation | `src/viewer.js` | reload |
| Page chrome and fonts | `index.html` | reload |

## A note on the geography of myth, and on the painting

Homer does not say where most of the Odyssey happens, and the ancient world argued about it. The map follows the identifications repeated most often since antiquity (the Strait of Messina for Scylla and Charybdis, Djerba for the Lotus-Eaters, Corfu for the Phaeacians) and says so in each description. Landmarks and towns are toy-sized on purpose, and heights are stretched about seven times.

An image model redrew every tree, wall and figure. It follows the render closely but not exactly. Treat the detail as illustration.

## Credits

Elevation and bathymetry come from the Mapzen terrain tiles hosted on the AWS Open Data registry, which combine SRTM, GMTED2010 and ETOPO1 among other sources. Full attribution: <https://github.com/tilezen/joerd/blob/master/docs/attribution.md>.

Painted with [FLUX.2 klein 4B](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B) by Black Forest Labs. The sampling method is MultiDiffusion ([Bar-Tal et al.](https://arxiv.org/abs/2302.08113)) with RePaint-style holding ([Lugmayr et al.](https://arxiv.org/abs/2201.09865)), as described in the write-ups linked at the top. Units and moving parts modelled and rendered with [Blender](https://www.blender.org/).

Fonts: Pixelify Sans, Jersey 25 and GFS Didot, from Google Fonts.
