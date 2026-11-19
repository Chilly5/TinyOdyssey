# TinyOdyssey

An animated, interactive diorama of mythological Greece, built on a hex grid and drawn as pixel art in the browser.

Pan and zoom around the Mediterranean from Tunisia to the Bosporus. Click a place to read its myth. Press **Sail the Odyssey** to follow Odysseus home from Troy in seventeen stops.

Inspired by [hexagonal.earth](https://hexagonal.earth/).

## Run it

It is a static site with no build step. Any web server will do:

```
npm start            # http://127.0.0.1:8137/  (needs only Node)
```

Opening `index.html` straight from disk will not work, because browsers refuse to load JavaScript modules from `file://`.

## Share it

Upload the folder to any static host. `index.html`, `src/` and `data/` are all that is needed.

- **GitHub Pages**: push the repository, then Settings → Pages → deploy from the `main` branch root.
- **Netlify, Vercel, Cloudflare Pages**: point them at the repository with no build command and `/` as the output folder.

Links can point at a place: `…/#olympus` opens Mount Olympus, `…/#odyssey` starts the voyage. The ids are in `src/sites.js`.

## How it works

**The land is real.** `tools/build-terrain.mjs` downloads open elevation and sea-depth tiles for 10°E to 30.9°E, 32.3°N to 42.3°N and samples them onto 95,090 hexes about 5 km across. Each hex stores three bytes: how much of it is land, how high, and how deep the sea is. The result is `data/terrain.js` (370 KB), so the site makes no data requests at run time.

**The world is generated from it at load.** `src/grid.js` decides land and sea, reopens straits the hexes would close (the Hellespont, the Bosporus, Messina), terraces the heights, and assigns a climate from latitude, altitude, rain shadow and noise. `src/terrain.js` turns each land hex into a column and scatters olives, cypresses, pines, crags and villages on it. About 1.1 million triangles, split into chunks so off-screen regions are skipped.

**The sea is one shader.** `src/water.js` bakes a distance-to-shore field and the real bathymetry into a texture. The shader bands the colour by depth, lays turquoise shallows along the coast, and animates surf, wave strokes and whitecaps.

**The myths are modelled by hand.** `src/landmarks.js` builds about fifty sites from boxes, cylinders and faceted blobs (`src/kit.js`, `src/models.js`): the Parthenon, the Labyrinth with its Minotaur, Scylla's six heads, the Cyclops throwing rocks. `src/actors.js` adds what moves across the map: clouds, ships, Pegasus, Icarus, dolphins, a sea monster. Ships find their way with A* over the water hexes (`src/nav.js`), so no route crosses land.

**The look is a pipeline.** `src/view.js` renders the scene at about 380 rows with an orthographic camera, then scales it up with hard pixel edges. The camera snaps to that coarse pixel grid and the leftover sub-pixel offset is applied during the upscale, which keeps the terrain from shimmering as you pan. A last pass adds the tilt-shift blur.

Rendering uses [three.js](https://threejs.org/), loaded from a CDN in `src/three.js`.

## Changing things

| To change | Edit |
| --- | --- |
| Places, their text, the voyage stops | `src/sites.js` |
| What a landmark looks like | `src/landmarks.js` |
| Map extent or hex size | `src/config.js`, then `npm run terrain` |
| Colours of land and trees | `src/terrain.js` |
| Colours and motion of the sea | `src/water.js` |
| Page chrome and fonts | `index.html` |

`npm run artifact` writes `dist/artifact/index.html`, the page without its HTML wrapper, for hosts that supply their own.

## A note on the geography of myth

Homer does not say where most of the Odyssey happens, and the ancient world argued about it. The map follows the identifications repeated most often since antiquity (the Strait of Messina for Scylla and Charybdis, Djerba for the Lotus-Eaters, Corfu for the Phaeacians) and says so in each description.

## Credits

Elevation and bathymetry come from the Mapzen terrain tiles hosted on the AWS Open Data registry, which combine SRTM, GMTED2010 and ETOPO1 among other sources. Full attribution: <https://github.com/tilezen/joerd/blob/master/docs/attribution.md>.

Fonts: Pixelify Sans, Jersey 25 and GFS Didot, from Google Fonts.
