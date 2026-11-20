"""The landmarks' moving parts: Sisyphus and his boulder, the Cyclops, the Clashing Rocks.

Run inside Blender, after `node gen/build.mjs --anims` has written units/anims/src:

  blender --background --factory-startup --python units/anims.py -- [--only corinth,cyclops] [--sheet FILE.png]

Each file in units/anims/src is one landmark's animation: for every frame, the
small cubes that make up the parts that move, less the ones that stand behind
scenery (see gen/anims.mjs). The cubes are built and rendered here just as the
units are in build.py: through the map's camera, lit by the same studio light,
with hard pixels, a few flat shades to the colour and an outline in a darker
shade of the figure's own colours. Each frame is then cut into its separate
pieces (a bird, a rock, a giant), and the pieces are packed into sheets:

  units/anims/out/anim0.png ...   the sheets
  units/anims/out/anims.json      for each landmark: its rectangle on the map, and for each size
                                  the pieces and where each frame puts them

Everything is rendered at several sizes (8, 4 and 2 pixels to the map pixel), as the
units are, so the viewer can draw one made for about the zoom it is at. Each size has
sheets of its own, so only the one in use need be fetched. Landmarks whose moving
parts are very large (the Clashing Rocks, Scylla) stop at 4: at 8 they would fill a
dozen sheets, and things that size do not need it.

--sheet writes a few frames of every landmark side by side instead, for looking at.
"""
import glob
import json
import math
import os
import sys
import tempfile

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build as B   # the units' own script: the camera, the light, the colours, the outline

SRC = os.path.join(HERE, "anims", "src")
OUT = os.path.join(HERE, "anims", "out")
SIZES = (8, 4, 2)   # pixels to the map pixel
LIMIT = 9e6         # the most picture one landmark may take at its largest size, in pixels
MAXPX = 8000        # the largest picture to ask Blender for at once, each way
PAGE = 2048
FAR = 4000          # how far back the camera stands, map pixels
KZ, KY = B.KZ, B.KY


def hexof(c):
    r, g, b = (c >> 16) & 255, (c >> 8) & 255, c & 255
    if c >> 24:   # parts that glow (fire, lava, a ghost) are lit from within: a shade brighter than their paint
        r, g, b = (min(255, int(v * 1.12 + 14)) for v in (r, g, b))
    return f"#{r:02x}{g:02x}{b:02x}"


# A cube, as the camera can see it: its top and its south face. (East and west faces are edge-on.)
FACES = np.array([[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]], np.float32) * 0.5


def mesh_of(frame, pal, q, name):
    """One frame's cubes as a mesh, in map pixels: x east, y north, z up."""
    v = np.asarray(frame["vox"], np.int32).reshape(-1, 4)
    n = len(v)
    me = bpy.data.meshes.new(name)
    if n == 0:
        return me
    mid = np.stack([v[:, 0] + 0.5, -v[:, 1], v[:, 2]], 1).astype(np.float32)
    co = (mid[:, None, :] + FACES[None]) / q
    me.vertices.add(n * 8)
    me.vertices.foreach_set("co", co.ravel())
    me.loops.add(n * 8)
    me.loops.foreach_set("vertex_index", np.arange(n * 8, dtype=np.int32))
    me.polygons.add(n * 2)
    me.polygons.foreach_set("loop_start", np.arange(0, n * 8, 4, dtype=np.int32))
    try:
        me.polygons.foreach_set("loop_total", np.full(n * 2, 4, np.int32))
    except Exception:
        pass   # newer Blenders work it out from loop_start
    used = np.unique(v[:, 3])
    for k in used:
        me.materials.append(B.material(hexof(pal[k])))
    me.polygons.foreach_set("material_index", np.repeat(np.searchsorted(used, v[:, 3]), 2).astype(np.int32))
    me.update(calc_edges=True)
    return me


def pieces(cell, grain):
    """Cut a frame into its separate pieces. Returns [(pixels, x, y)], x and y from the frame's corner."""
    h, w = cell.shape[:2]
    a = cell[..., 3] > 0
    if not a.any():
        return []
    gh, gw = -(-h // grain), -(-w // grain)
    occ = np.zeros((gh * grain, gw * grain), bool)
    occ[:h, :w] = a
    occ = occ.reshape(gh, grain, gw, grain).any((1, 3))
    lab = np.where(occ, np.arange(1, occ.size + 1).reshape(occ.shape), 0)
    while True:   # every square takes the largest number among its neighbours until nothing changes
        p = np.pad(lab, 1)
        m = np.maximum.reduce([p[1:-1, 1:-1], p[:-2, 1:-1], p[2:, 1:-1], p[1:-1, :-2], p[1:-1, 2:], p[:-2, :-2], p[:-2, 2:], p[2:, :-2], p[2:, 2:]])
        m = np.where(occ, m, 0)
        if (m == lab).all():
            break
        lab = m
    out = []
    for k in np.unique(lab[lab > 0]):
        ys, xs = np.where(lab == k)
        y0, y1, x0, x1 = ys.min() * grain, min(h, (ys.max() + 1) * grain), xs.min() * grain, min(w, (xs.max() + 1) * grain)
        part = cell[y0:y1, x0:x1].copy()
        mine = np.repeat(np.repeat(lab[ys.min():ys.max() + 1, xs.min():xs.max() + 1] == k, grain, 0), grain, 1)[:y1 - y0, :x1 - x0]
        part[~mine] = 0
        py, px = np.where(part[..., 3] > 0)
        if len(px) == 0:
            continue
        out.append((np.ascontiguousarray(part[py.min():py.max() + 1, px.min():px.max() + 1]), int(x0 + px.min()), int(y0 + py.min())))
    return out


def render(sc, cam, data, q, tmp):
    """Every distinct frame of one landmark at q pixels to the map pixel: {frame number: [(pixels, x, y)]}."""
    x0, y0, x1, y1 = data["box"]
    cw, ch = (x1 - x0) * q, (y1 - y0) * q
    todo = [f for f, fr in enumerate(data["frames"]) if "same" not in fr]
    cols, rows = max(1, MAXPX // cw), max(1, MAXPX // ch)
    done = {}
    for start in range(0, len(todo), cols * rows):
        chunk = todo[start:start + cols * rows]
        nc = min(cols, len(chunk))
        nr = -(-len(chunk) // nc)
        W, H = nc * cw, nr * ch
        sc.render.resolution_x, sc.render.resolution_y = W, H
        cam.data.ortho_scale = max(W, H) / q
        e = math.asin(KZ)
        # Well back: a sheet of frames is hundreds of map pixels tall, and its top rows must not end up behind the camera.
        cam.data.clip_start, cam.data.clip_end = 1, 3 * FAR
        cam.location = (W / (2 * q), -FAR * math.cos(e), -H / (2 * KY * q) + FAR * math.sin(e))
        cam.rotation_euler = (math.pi / 2 - e, 0, 0)
        objs, meshes = [], []
        for i, f in enumerate(chunk):
            me = mesh_of(data["frames"][f], data["pal"], data["q"], f"a{f}")
            ob = bpy.data.objects.new(f"a{f}", me)
            # Its frame's corner of the picture, less the part of a row the box's top edge is off the cubes' grid.
            ob.location = ((i % nc) * cw / q, 0, -((i // nc) * ch) / (KY * q) + data["lift"] / KY)
            sc.collection.objects.link(ob)
            objs.append(ob)
            meshes.append(me)
        path = os.path.join(tmp, f"{data['id']}_{q}.png")
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(path)
        px = np.empty(W * H * 4, np.float32)
        img.pixels.foreach_get(px)
        bpy.data.images.remove(img)
        px = (px.reshape(H, W, 4)[::-1] * 255 + 0.5).astype(np.uint8)
        for ob in objs:
            bpy.data.objects.remove(ob, do_unlink=True)
        for me in meshes:
            bpy.data.meshes.remove(me)
        for i, f in enumerate(chunk):
            cell = px[(i // nc) * ch:(i // nc + 1) * ch, (i % nc) * cw:(i % nc + 1) * cw].copy()
            B.shade(cell)
            done[f] = pieces(cell, max(4, q))
    return done


def main():
    out = os.path.abspath(B.arg("--out", OUT))
    only = B.arg("--only")
    sheet = B.arg("--sheet")
    sc, cam = B.setup()
    tmp = tempfile.mkdtemp(prefix="anims_")
    files = sorted(f for f in glob.glob(os.path.join(SRC, "*.json")) if os.path.basename(f) != "events.json")
    if only:
        files = [f for f in files if os.path.splitext(os.path.basename(f))[0] in only.split(",")]

    if sheet:   # four frames of each, in a row, on the colour of dry ground
        rows = []
        for path in files:
            data = json.load(open(path))
            q = SIZES[0]
            got = render(sc, cam, data, q, tmp)
            x0, y0, x1, y1 = data["box"]
            keys = sorted(got)
            pick = [keys[len(keys) * k // 4] for k in range(4)]
            row = np.zeros(((y1 - y0) * q, (x1 - x0) * q * 4 + 18, 4), np.uint8)
            for i, f in enumerate(pick):
                for p, x, y in got[f]:
                    dst = row[y:y + p.shape[0], i * ((x1 - x0) * q + 6) + x:i * ((x1 - x0) * q + 6) + x + p.shape[1]]
                    dst[:] = np.where(p[..., 3:] > 0, p, dst)
            rows.append(row)
            print("anim", data["id"], flush=True)
        Wd = max(r.shape[1] for r in rows)
        pic = np.zeros((sum(r.shape[0] for r in rows), Wd, 4), np.uint8)
        pic[..., :3] = (196, 170, 120)
        pic[..., 3] = 255
        y = 0
        for r in rows:
            a = r[..., 3:4] > 0
            pic[y:y + r.shape[0], :r.shape[1]] = np.where(a, r, pic[y:y + r.shape[0], :r.shape[1]])
            y += r.shape[0]
        B.save_png(pic, os.path.abspath(sheet))
        print("sheet", sheet, pic.shape)
        return

    os.makedirs(out, exist_ok=True)
    for old in glob.glob(os.path.join(out, "anim*.png")):
        os.remove(old)
    pages, anims = [], []
    page, x, y, shelf = None, 2, 2, 0
    for path in files:
        data = json.load(open(path))
        sets = []
        # The second size first: four times its area says whether the largest size is affordable.
        second = render(sc, cam, data, SIZES[1], tmp)
        area = sum(p.shape[0] * p.shape[1] for f in second for p, _, _ in second[f]) * (SIZES[0] / SIZES[1]) ** 2
        sizes = SIZES if area <= LIMIT else SIZES[1:]
        for q in sizes:
            got = second if q == SIZES[1] else render(sc, cam, data, q, tmp)
            first = len(pages)
            page = None   # every size of every landmark starts a sheet of its own: the viewer fetches only what it is drawing
            sprites, seen, frames = [], {}, []
            order = sorted(((p, f, i) for f in got for i, (p, _, _) in enumerate(got[f])), key=lambda t: -t[0].shape[0])
            where = {}
            for p, f, i in order:
                h, w = p.shape[:2]
                key = (w, h, p.tobytes())
                if key not in seen:
                    if page is None or x + w + 2 > PAGE:
                        x, y, shelf = 2, y + shelf + 2, 0
                    if page is None or y + h + 2 > PAGE:
                        page = np.zeros((PAGE, PAGE, 4), np.uint8)
                        pages.append([page, 0])
                        x, y, shelf = 2, 2, 0
                    page[y:y + h, x:x + w] = p
                    seen[key] = len(sprites)
                    sprites.append([len(pages) - 1 - first, x, y, w, h])
                    x += w + 2
                    shelf = max(shelf, h)
                    pages[-1][1] = max(pages[-1][1], y + shelf + 2)
                where[(f, i)] = seen[key]
            for f, fr in enumerate(data["frames"]):
                src = fr.get("same", f)
                flat = []
                for i, (_, px_, py_) in enumerate(got[src]):
                    flat += [where[(src, i)], px_, py_]
                frames.append(flat)
            sets.append(dict(q=q, page=first, pages=len(pages) - first, sprites=sprites, frames=frames))
        anims.append(dict(id=data["id"], fps=data["fps"], n=data["n"], box=data["box"], sets=sets))
        print("anim", data["id"], " ".join(f"{t['q']}:{t['pages']}" for t in sets), flush=True)
    files_out = []
    for k, (pg, used) in enumerate(pages):
        name = f"anim{k}.png"
        used = int(min(PAGE, max(4, used)))
        B.save_png(pg[:used], os.path.join(out, name))
        files_out.append(dict(file=name, w=PAGE, h=used))
    with open(os.path.join(out, "anims.json"), "w") as fh:
        json.dump(dict(pages=files_out, anims=anims), fh, separators=(",", ":"))
    print(f"{len(anims)} landmarks on {len(pages)} sheet(s)")


main()
