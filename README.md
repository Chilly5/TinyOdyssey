# TinyOdyssey

An animated map of mythological Greece that you zoom into: a 3D scene of small cubes, rendered through one fixed camera into pictures. Every zoom level is its own render of the same scene at a finer grain, so zooming in does not enlarge pixels, it finds more: a house gains its door, then its shutters and roof tiles.

It comes in three styles (the button, or **V**): **terraces** (clean stacked layers, like a model cut from coloured card), **pixel art**, and an earlier **painted** version in which an image model redrew the render.

Click a place to read its myth. Zoom into a town to find its streets, its market and the smaller stories nearby. Click anyone you meet, a potter, a hoplite on the wall, a merchant's donkey, to learn who they are and what they are doing, and the map follows them. Press **Sail the Odyssey** to follow Odysseus home from Troy in seventeen stops. A day lasts five minutes: at dusk the lamps come on. Turn the sound on for a song over the whole map that gives way, as you come down, to the sea, the cicadas and the talk of a town.

Inspired by [hexagonal.earth](https://hexagonal.earth/) and made the way it is. The painted style follows the isometric city maps instead: [isometric.nyc](https://isometric.nyc), [tiny.london](https://tiny.london/how/), [Pixel Singapore](https://www.yadongxie.com/blog/how-isometric-pixel-city-was-made) and [Isometric SF](https://www.justinchavez.com/blog/isometric-sf-how/).

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

**A domain of its own.** Three steps, in this order, so the address already shared never stops working:

1. At the domain's DNS, point it at GitHub Pages: four `A` records for the bare domain (`185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`), four `AAAA` records (`2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`), and a `CNAME` for `www` to `<owner>.github.io.`
2. Put the domain in a file called `CNAME` at the top of this repository (one line) and `npm run deploy`. The file goes up with the site each time; link previews use the domain from then on, and the `github.io` address redirects to it.
3. When GitHub has issued the certificate (minutes to an hour), turn on *Enforce HTTPS* in the repository's Pages settings.

Links can point at a place: `…/#olympus` opens Mount Olympus, `…/#odyssey` starts the voyage. The ids are in `src/sites.js` and `src/minor.js`. `?time=night` or `?time=day` holds the time of day still.

## How the picture is made

The method is the one [hexagonal.earth](https://hexagonal.earth/) describes in [Every "one shot" is slop](https://blog.vandesande.design/every-one-shot-is-slop): the world is a cloud of coloured points in space (pixel splats), each zoom level renders the scene again in more detail, and what the browser shows is those renders as static tiles.

1. **Real terrain.** `gen/dem.mjs` and `gen/fields.mjs`: elevation and sea depth, distance to the shore, a climate, rivers, and a smoothed copy of the high ground so that mountains are broad stepped massifs.
2. **The settled country.** `gen/plan.mjs`: a town round each great site (streets, a market, houses, sometimes a wall and a pier) and roads between places found with A*. It keeps the shapes as well as the cells, so they can be drawn again finer.
3. **The scene at one voxel to the map pixel.** `gen/region.mjs` terraces the ground, lays out fields, scatters trees and villages, and sweeps shadows across. This layout is the truth every finer level is drawn from, and where the walkers' paths and the height tiles come from.
4. **The same scene, finer.** `gen/fine.mjs` draws any part of it with 2, 4, 8 or 16 voxels to that one. Nothing is enlarged: the ground's height is asked again at the finer points and cut into the same terraces, so their edges are smooth lines; roads, walls and rivers are drawn again from their shapes; fields get their rows; and every tree, house, stall and boat rebuilds itself at that scale (`gen/stamps.mjs`: each object is built from the same random numbers at any size, with the detail that only shows when it is large). Landmark models are sampled again as finely as needed (`gen/bake.mjs`), with joints in their stone and rows of tiles on their roofs. The models themselves (`gen/landmarks.js`, from the parts in `gen/models.js` and the shapes in `gen/kit.js`) are made to be seen that large: figures with round limbs and faces, animals with knees and muzzles, fluted columns with capitals, temples with their steps, doors, friezes and the sculpture in their pediments, walls with battlements, rocks of many faces.
   - **Made in Blender.** The pieces that deserve more than simple parts are modelled in Blender by `units/assets.py` (the wooden horse at Troy, a barrel of staves on a wheeled sledge; Penelope at her loom with the shroud half woven; the bronze birds of Stymphalos) and written to `gen/assets/` as plain triangles, which `gen/assets.mjs` lays into the landmark's scene like any other part. In a Blender that is open the same builders can be looked at before they are exported (`preview("trojan_horse")`).
   - **Light.** The sun stands in the north-west. Each landmark keeps two maps of itself, what is highest on every ray of sunlight and what is highest straight overhead, and from them a roof shades the wall under its eaves, a column the floor beside it, a statue its plinth, and the whole of it the ground, the trees and the sea it stands by. Everything else (hills, houses, trees) throws its shadow through the coarse layout's shadow map.
5. **Two looks** (`gen/looks.mjs`). The same scene and camera; a look chooses the colours and the finish. *Pixel art*: hand-built colour ramps, dithered sea, mottled ground, bedded cliffs, and a dark line wherever one thing stands in front of another. *Terraces*: flat tops, lit where the land leans to the sun and dim where it turns away, the edge of each layer a tone deeper, a pale lip along every ledge, no texture and no outlines; what stands on the ground is lit by which way each face looks; shade is a cool wash over whatever it falls on, with a hard edge; and the viewer gives it more glow than the pixel look. *Pixel art* keeps its shade to one clean tone as well, and builds its cliffs of broad blocks and beds of stone rather than column by column.
6. **Tiles.** `gen/pyramid.mjs` renders the whole map at scales 1, 2 and 4 and every town, landmark and minor place at 8 and 16, each level natively, and cuts them into 512-pixel tiles. `tools/pyramid.mjs` shares the work out between the processor's cores.

### The painted version

Before that, the picture was made the way the isometric city maps are: an image model redrew the render. It is still there as the third style.

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
- **Who they are** (`src/people.js`). Every one of them can be clicked. A name, a trade, a family, something of the town they come from and what they are doing at this moment (which changes at dusk) are made, the same every time, from the number each was given and where their path lies: a road between two towns, a market, a wall, a field. The map then keeps pace with them until it is dragged away.
- **Ships** on sea routes found with A* (`gen/routes.mjs`): Odysseus, the Argo, Theseus, merchants and warships. Odysseus's galley is a sprite stack (below), so it comes about smoothly instead of snapping between headings.
- **Landmark animation.** The landmarks' moving parts: Sisyphus and his boulder, the Minotaur pacing the Labyrinth, the Clashing Rocks.
- **Sky**: clouds and their shadows, birds, Pegasus, Icarus, smoke, fire and lightning (`src/actors.js`).

The people, animals and ships are small models built and rendered in **Blender** by `units/build.py`: about 45 kinds, each from 8 or 16 headings and through its walk. People and animals are made of round shapes (limbs with joints, heads with faces and hair, robes that flare) and rendered at four sizes, the largest for the closest zoom. The towns have their children and their old people too. Ships have a hull skinned over ribs, a rail, a bellied sail in cloths, round oars and spars, a ram and a curled stern post; they are rendered at three sizes. The landmarks' moving parts are rendered there too (`units/anims.py`): `gen/anims.mjs` writes each frame out as small cubes, leaving out the ones that stand behind scenery, and Blender lights and outlines them as it does the units.

**A sprite stack** (`units/stack.py`, `draw.stack` in `src/viewer.js`). A rendered unit can face only the sixteen ways it was rendered. Odysseus's galley is kept differently: the same Blender model is cut level by level into flat pictures of what is there at that height, seen from straight above (109 of them at the finest of three sizes). Whenever the ship has turned a degree and a half, or moved an oar, the viewer draws the slices one over another into a small picture, each a little higher than the one below and all turned by the same angle, in hard pixels, two to the cube. That is the same squeeze the map's camera gives everything (0.6 for depth, 0.8 for height), so the pile sits in the picture like anything else. Beside each slice the sheet keeps which way every cube's surface faces, so the sun stays in the north-west as the ship comes about: a top is lit, a side takes one of three tones by where it now faces, and the whole throws a shadow on the water. The finished picture gets the units' dark outline and is then drawn like any sprite. Twelve oars a side pull a full stroke in eight frames, blades in the water on the way aft. Open the page with `?stacks=off` to see the rendered sprite it replaced.

**Walking behind things.** The render knows how far south everything in the picture stands. `gen/tiles.mjs` keeps that as tiles of the scenery's height (`world/occ`), every path point carries the height of its ground, and the sprite shader compares the two: the part of a walker that is behind a house, a wall, a tree or a hill is not drawn. Ships pass behind headlands the same way.

**Sound** (`src/sound.js`). A song (`src/audio/theme.mp3`) plays over everything, and everything else is kept well under it. What is heard depends on how close the view is, in three bands that fade into one another. Over the whole map, seen from high up: the song at its fullest, and the wind. Over a region: the song further back and the wind dropping, with nothing of the sea yet. Down on the ground: the sea and its waves on the shore, gulls, the murmur of a town and its market, and in the country leaves, cicadas, small birds, a woodpecker, bees, sheep; at night crickets, frogs and an owl. The wind, the town and the market are recordings (below); the rest is made in the browser from noise and oscillators, and none of it plays a tune.

**Day and night** (`src/main.js`, the last shader in `src/viewer.js`). A day is five minutes. At dusk the light warms, then the picture cools and darkens, a lamp comes on at every house and fire (their places come from the town plan), most people go indoors and the birds roost. **N** or the button holds it at day or night.

Thunder when Zeus throws, and the splash of the Cyclops's rock, are heard only once the view has come down to them: from high up there is nothing but the song and the wind. Sound is on by default. A browser lets a page make no sound until it has been clicked or a key pressed, so it starts with the visitor's first click, touch or key press (at once, where the browser already allows it). **M** or the button turns it off, and the choice is kept for the next visit.

**Counting visitors** (`src/track.js`). Off until a [PostHog](https://posthog.com) project key is put at the top of that file; with none, nothing is loaded and nothing is sent. With one, the page reports the visit and a handful of named events, each sent from the place in `src/main.js` where the thing happens: `first_interaction` (wheel, drag, touch or keys), `place_opened` (which, and whether from the map, a name, the atlas or a link), `person_met`, `followed` (a ship, Pegasus), `voyage_started` / `voyage_stop` / `voyage_finished` / `voyage_left`, `zoom_reached` (2, 4, 8, 16, 32, once each), `style_changed`, `time_changed`, `sound_toggled` and `panel_opened`. Nothing is stored in the visitor's browser (so a returning visitor counts as a new one, and no consent banner is owed), the screen is not recorded, clicks are not caught wholesale, a browser that asks not to be tracked is left alone, and a copy running on `localhost` sends nothing.

A last pass adds bloom on whatever is nearly white or hot, a contrast curve, and a tilt-shift blur towards the top and bottom of the screen. Both ease off as you zoom in.

There are two ways to show the picture. The usual one is smooth: one painted pixel to the screen pixel. Press **P**, or open the page with `?look=pixel`, for the pixel look: the picture in hard pixels two screen pixels across with a limited range of colours, on the same grid as the units over it. To make that the default for a world, run `node gen/build.mjs --overlays --look pixel`.

## Rebuilding

```
npm install                 # three.js, used only for its maths while baking models
npm run world               # sprites, units, paths, height tiles, routes -> world/   (1 minute)
npm run pyramid             # the picture, both looks, every level -> world/pixel, world/voxel   (about 16 minutes, nine jobs at a time)
```

`node gen/build.mjs --pyramid --touch athens,troy` draws just those places again, in place, after a model is reworked: only the tiles those places lie in, at every scale (a minute or so each).

That is the whole of it for the two drawn styles. `node gen/build.mjs --fine 16 --preview 23.72,37.97,60,44 --look voxel --out x.png` draws one window of the map at one scale, for looking at.

The painted style needs a GPU and several hours:

```
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

After `python tiles.py`, run `node gen/build.mjs --pyramid --styles` so the manifest lists the painted picture beside the drawn ones.

`node gen/build.mjs --refresh` redoes everything in `world/` except the picture: the paths, the height tiles, the lamps, the sprites and the labels. `node gen/build.mjs --overlays` redoes only what is drawn over the picture (sprites, the landmarks' animation, the units, the sprite stacks). Both leave the sprite sheets as PNG; `python tiles.py --sheets` packs them again.

`npm run world` alone leaves a working site that shows the plain render. It also clears `world/`, so run `python tiles.py` again afterwards to put the painting back. To build a new world beside the one being served, use `node gen/build.mjs --out world.next` and `python tiles.py --world ../world.next`, and look at it with `http://127.0.0.1:8137/?world=world.next/`.

The units and the landmarks' moving parts are made in Blender (5.x), before `npm run world`:

```
blender --background --factory-startup --python units/build.py -- --grid 8 --big     # the units -> units/out     (half a minute)
blender --background --factory-startup --python units/stack.py                       # the sprite stacks -> units/out  (ten seconds)
blender --background --factory-startup --python units/assets.py                      # the Blender-made landmark pieces -> gen/assets  (seconds; they are in the repository)
node gen/build.mjs --anims                                          # the moving parts, as cubes -> units/anims/src
blender --background --factory-startup --python units/anims.py     # rendered -> units/anims/out               (3 minutes)
blender --background --factory-startup --python units/build.py -- --only man,trireme --sheet sheet.png    # a contact sheet to look at
blender --background --factory-startup --python units/anims.py -- --only corinth,cyclops --sheet sheet.png
```

Without them the world still builds: there are no walkers, and the moving parts are flattened in the old way.

`node gen/stacks.mjs` puts freshly cut sprite stacks into a world that is already built, and touches nothing else in it.

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
| How a tree or a house looks close up | its builder in `gen/stamps.mjs` (the branch for F above 1) | pyramid |
| The colours and finish of a drawn style | `gen/looks.mjs` | pyramid |
| How far in the drawn styles go, and where | `FULL`, `SPARSE` and the places in `gen/pyramid.mjs` and `gen/build.mjs` | pyramid |
| Terrain, climate, colours, what grows where | `gen/region.mjs`, `gen/fields.mjs`, `gen/palette.mjs` | world, cond, paint, detail, tiles |
| Who walks where | `gen/life.mjs` (paths), `src/life.js` (who, how many, how fast, who stays out at night) | refresh for paths; reload for the rest |
| What the units look like | `units/build.py` | Blender, then overlays |
| Odysseus's galley, or which units are sprite stacks | `STACKS` in `units/stack.py` (the ship itself is `ship` in `units/build.py`); its light in `FS_STACK` in `src/viewer.js` | Blender (`units/stack.py`), then `node gen/stacks.mjs` |
| How a landmark's parts move | its `tick` in `gen/landmarks.js` | anims, Blender, then overlays |
| Ships, clouds, effects | `src/actors.js` | reload |
| The length of a day, the lamps | `src/main.js` | reload |
| What is heard | `src/sound.js` | reload |
| Bloom, contrast, blur, night, sea animation | `src/viewer.js` | reload |
| Page chrome and fonts | `index.html` | reload |
| The site's icon | the grid of letters in `tools/favicon.mjs` | `node tools/favicon.mjs` |

## A note on the geography of myth, and on the painting

Homer does not say where most of the Odyssey happens, and the ancient world argued about it. The map follows the identifications repeated most often since antiquity (the Strait of Messina for Scylla and Charybdis, Djerba for the Lotus-Eaters, Corfu for the Phaeacians) and says so in each description. Landmarks and towns are toy-sized on purpose, and heights are stretched about seven times.

An image model redrew every tree, wall and figure. It follows the render closely but not exactly. Treat the detail as illustration.

## Credits

Elevation and bathymetry come from the Mapzen terrain tiles hosted on the AWS Open Data registry, which combine SRTM, GMTED2010 and ETOPO1 among other sources. Full attribution: <https://github.com/tilezen/joerd/blob/master/docs/attribution.md>.

The wind is [Chergui wind in Agadir](https://freesound.org/people/clement.bernardeau/sounds/718973/) by clement.bernardeau, a light desert wind recorded south of Agadir, from [Freesound](https://freesound.org) and in the public domain (CC0); half a minute of it is looped. The voices of the towns are two more recordings from Freesound, both CC0 as well: [Crowd walla at outdoor farmers' market](https://freesound.org/people/craigsmith/sounds/675026/) by craigsmith, from the USC optical sound effects library, and [MARKET](https://freesound.org/people/SamuelGremaud/sounds/544338/) by SamuelGremaud, a village market in Provence.

Painted with [FLUX.2 klein 4B](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B) by Black Forest Labs. The sampling method is MultiDiffusion ([Bar-Tal et al.](https://arxiv.org/abs/2302.08113)) with RePaint-style holding ([Lugmayr et al.](https://arxiv.org/abs/2201.09865)), as described in the write-ups linked at the top. Units and moving parts modelled and rendered with [Blender](https://www.blender.org/).

Fonts: Pixelify Sans, Jersey 25 and GFS Didot, from Google Fonts.
