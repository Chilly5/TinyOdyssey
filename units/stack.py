"""Sprite stacks: a model kept as flat slices, so that it can be turned to face any way.

Most of what moves on the map is rendered in Blender once for each compass heading (units/build.py),
and so can only face sixteen ways. A sprite stack is kept differently: the model is cut level by level
into small flat pictures of what is there at that height, seen from straight above. The map draws them
one over another, each a little higher on the screen than the one below and all turned by the same
angle (src/viewer.js, draw.stack), and the pile reads as a solid thing that comes about smoothly.

  blender --background --factory-startup --python units/stack.py -- [--only NAME,NAME] [--out DIR]

  units/out/stack_<name>.png   every slice of one model, packed onto a page
  units/out/stacks.json        where each slice is: for each size, for each frame, level by level

Blender is only needed for the models themselves, which are the ones of units/build.py; nothing is
rendered. Each is cut at several sizes (cubes to the map voxel), a coarser one for when it is seen small.

The page has two halves. In the upper a slice's pixel holds the colour of that cube of the model. The
same place in the lower half holds what the map needs to know to light the cube as the model turns (the
sun stays where it is while a ship comes about), each in a colour channel of its own so that it survives
whatever a browser does to a picture's alpha:
  red     which way its surface faces: 32 steps clockwise (as the slice is drawn) from the bow, times 8
  green   255 where nothing stands on the cube, so that its top shows
  blue    255 where its surface faces up or down more than sideways
"""
import importlib.util
import json
import math
import os
import struct
import sys
import zlib

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
arg = lambda name, dflt=None: argv[argv.index(name) + 1] if name in argv else dflt

STEP = 0.4      # a surface is sampled this far apart, in cubes of the grid it is cut into
THIN = 0.2      # a rope thinner than this (its radius, in those cubes) is left out: it would be drawn as thick as a mast
PLANK = 1.0     # how tall a strake of planking is, in the model's own cubes


def _units():
    """units/build.py, for its models."""
    spec = importlib.util.spec_from_file_location("tiny_units", os.path.join(HERE, "build.py"))
    mod = importlib.util.module_from_spec(spec)
    old, sys.argv = sys.argv, [sys.argv[0]]   # it reads its own arguments; it has none here
    try:
        spec.loader.exec_module(mod)
    finally:
        sys.argv = old
    return mod


UB = _units()

# name: (the builder in build.py, its options, its size as in build.py's UNITS, frames of its movement,
#        the sizes it is cut at: cubes of the grid to the map voxel, finest first)
STACKS = {
    # Odysseus's ship as a war galley: twelve oars a side, pulled properly (the blades go in as they are drawn
    # aft and come out for the return), and a bench of rowers for them.
    "odysseus": ("ship", {**UB.UNITS["odysseus"][1], "stroke": True, "oars": 12, "crew": 9}, UB.UNITS["odysseus"][5], 8, (4, 2, 1)),
}


def build(name, t, grid):
    """The model at one moment of its movement, without what is too thin to show at this grid (cubes to the model's cube)."""
    fn, opts = STACKS[name][:2]

    class Model(UB.Model):
        def limb(self, p0, p1, r0, r1, col, n=8, caps=True):
            if max(r0, r1) * self.stack[-1].to_scale()[0] * grid < THIN:
                return self
            return super().limb(p0, p1, r0, r1, col, n, caps)

    m = Model()
    getattr(UB, fn)(m, t, opts)
    return m


_lattice = {}


def lattice(n):
    """The points of a triangle, n steps along each side, as two weights each."""
    if n not in _lattice:
        i, j = np.meshgrid(np.arange(n + 1), np.arange(n + 1), indexing="ij")
        keep = i + j <= n
        _lattice[n] = (i[keep] / n, j[keep] / n)
    return _lattice[n]


def voxelize(m, grid):
    """Every cube of the grid that a surface of the model passes through, from the waterline up.
    Returns (which face fills each cube, -1 for none: [z][y][x]; the grid's corner; each face's normal).
    Where two faces meet in a cube the one made later has it: the parts of a model are put on in that order
    (the eye over the hull, the shield over the rail)."""
    V = np.array(m.verts, np.float64) * grid
    lo = np.floor(V.min(0)).astype(int) - 1
    hi = np.ceil(V.max(0)).astype(int) + 2
    lo[2] = 0
    size = hi - lo
    A, B, C, F, normals = [], [], [], [], []
    for fi, face in enumerate(m.faces):
        P = V[list(face)]
        nrm = np.zeros(3)
        for i in range(len(P)):   # Newell's sum: right for a face of any number of corners
            p, q = P[i], P[(i + 1) % len(P)]
            nrm += ((p[1] - q[1]) * (p[2] + q[2]), (p[2] - q[2]) * (p[0] + q[0]), (p[0] - q[0]) * (p[1] + q[1]))
        normals.append(nrm / (np.linalg.norm(nrm) or 1))
        for k in range(1, len(P) - 1):
            A.append(P[0]); B.append(P[k]); C.append(P[k + 1]); F.append(fi)
    A, B, C, F = np.array(A), np.array(B), np.array(C), np.array(F)
    longest = np.maximum(np.linalg.norm(B - A, axis=1), np.maximum(np.linalg.norm(C - A, axis=1), np.linalg.norm(C - B, axis=1)))
    steps = np.maximum(1, np.ceil(longest / STEP)).astype(int)
    owner = np.full(size[2] * size[1] * size[0], -1, np.int32)
    for n in np.unique(steps):
        pick = steps == n
        u, v = lattice(int(n))
        a, b, c = A[pick][:, None, :], B[pick][:, None, :], C[pick][:, None, :]
        Q = a + u[None, :, None] * (b - a) + v[None, :, None] * (c - a)
        I = np.floor(Q).astype(int) - lo
        f = np.repeat(F[pick], len(u))
        I = I.reshape(-1, 3)
        ok = (Q.reshape(-1, 3)[:, 2] >= 0) & (I >= 0).all(1) & (I < size).all(1)
        I, f = I[ok], f[ok]
        np.maximum.at(owner, (I[:, 2] * size[1] + I[:, 1]) * size[0] + I[:, 0], f)
    return owner.reshape(size[2], size[1], size[0]), lo, np.array(normals)


def slices(m, grid, planks=()):
    """The model as pictures, from the waterline up: a list of (colours, notes, x, y), the picture's corner
    measured from the model's own middle. In a picture the bow is to the right and the port side at the top.
    planks: the colours that are planking, to be shown strake by strake."""
    owner, lo, normals = voxelize(m, grid)
    names = sorted(set(m.cols))
    pal = np.array([[int(UB.C.get(c, c).lstrip("#")[i:i + 2], 16) for i in (0, 2, 4)] for c in names], np.uint8)
    face_col = np.array([names.index(c) for c in m.cols])
    planked = [i for i, c in enumerate(names) if c in planks]
    # Which way each face looks, as the slice is drawn (y down the picture is the model's starboard).
    turn = np.round(np.arctan2(-normals[:, 1], normals[:, 0]) / math.tau * 32).astype(int) % 32
    flat = np.abs(normals[:, 2]) > 0.75
    solid = owner >= 0
    while len(solid) and not solid[-1].any():
        owner, solid = owner[:-1], solid[:-1]
    out = []
    for k in range(len(owner)):
        o, s = owner[k], solid[k]
        if not s.any():
            out.append(None)
            continue
        # A top shows where nothing stands on the cube, nor on the four beside it: a cube with a neighbour that
        # goes on up is a step in a leaning side (a bellied sail, the flare of the hull), and is lit as a side.
        over = solid[k + 1] if k + 1 < len(owner) else np.zeros_like(s)
        open_top = s & ~(over | np.roll(over, 1, 0) | np.roll(over, -1, 0) | np.roll(over, 1, 1) | np.roll(over, -1, 1))
        img, note = np.zeros((*s.shape, 4), np.uint8), np.zeros((*s.shape, 4), np.uint8)
        rgb = pal[face_col[o[s]]]
        if int(k / grid / PLANK) % 2:   # the strakes of the hull, one a shade darker than the next
            rgb = np.where(np.isin(face_col[o[s]], planked)[:, None], (rgb * 0.88).astype(np.uint8), rgb)
        img[s, :3] = rgb
        img[s, 3] = 255
        note[s, 0] = turn[o[s]] * 8
        note[s, 1] = np.where(open_top[s], 255, 0)
        note[s, 2] = np.where(flat[o[s]], 255, 0)
        note[s, 3] = 255
        img, note = img[::-1], note[::-1]   # the grid's y runs to port; the picture's runs down
        ys, xs = np.where(img[..., 3] > 0)
        x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
        out.append((np.ascontiguousarray(img[y0:y1, x0:x1]), np.ascontiguousarray(note[y0:y1, x0:x1]), int(x0 + lo[0]), int(y0 - (s.shape[0] + lo[1]))))
    return out


def write_png(path, arr):
    """Written here and not by Blender, so that every byte is as it was set."""
    h, w = arr.shape[:2]
    raw = b"".join(b"\x00" + arr[y].tobytes() for y in range(h))
    chunk = lambda tag, data: struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    with open(path, "wb") as fh:
        fh.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def make(name):
    """One model, cut and packed. Returns what the map needs to know about it."""
    _, _, size, nframes, grids = STACKS[name]
    rects, seen, sets = [], {}, []   # rects: (colours, notes, x from the middle, y from the middle), as they are met
    for r in grids:
        grid = r * UB.MV * size   # cubes of the grid to the model's cube
        frames, reach, tall, half = [], 0.0, 0, [0.0, 0.0]
        for f in range(nframes):
            # Frame 0 is the one for lying still: the oars level and clear of the water, at the middle of their return.
            levels = []
            for sl in slices(build(name, (f / nframes + 0.5) % 1, grid), grid, (STACKS[name][1].get("hull", "wood2"),)):
                if sl is None:
                    levels.append(-1)
                    continue
                px, note, ox, oy = sl
                h, w = px.shape[:2]
                key = (w, h, ox, oy, px.tobytes(), note.tobytes())
                if key not in seen:      # most levels are the same in every frame: only the oars move
                    seen[key] = len(rects)
                    rects.append((px, note, ox, oy))
                levels.append(seen[key])
                reach = max(reach, *(math.hypot(x, y) for x in (ox, ox + w) for y in (oy, oy + h)))
                half = [max(half[0], abs(ox), abs(ox + w)), max(half[1], abs(oy), abs(oy + h))]
            tall = max(tall, len(levels))
            frames.append(levels)
        sets.append(dict(r=r, n=tall, reach=round(reach / r, 3), half=[round(half[0] / r, 3), round(half[1] / r, 3)], frames=frames))
        print(f"stack {name}: {r} to the map voxel, {tall} levels", flush=True)

    # Pack them on shelves, tallest first, with a clear pixel between (the map reads them unsmoothed).
    order = sorted(range(len(rects)), key=lambda i: -rects[i][0].shape[0])
    area = sum((rects[i][0].shape[0] + 2) * (rects[i][0].shape[1] + 2) for i in order)
    W = 1024 if area < 900_000 else 2048
    at, x, y, shelf = {}, 1, 1, 0
    for i in order:
        h, w = rects[i][0].shape[:2]
        if x + w + 1 > W:
            x, y, shelf = 1, y + shelf + 1, 0
        at[i] = (x, y)
        x += w + 1
        shelf = max(shelf, h)
    H = y + shelf + 1
    page = np.zeros((H * 2, W, 4), np.uint8)   # the colours, and under them the notes
    for i, (x, y) in at.items():
        px, note = rects[i][:2]
        page[y:y + px.shape[0], x:x + px.shape[1]] = px
        page[H + y:H + y + px.shape[0], x:x + px.shape[1]] = note
    file = f"stack_{name}.png"
    write_png(os.path.join(OUT, file), page)
    print(f"stack {name}: {len(rects)} slices on {W} x {H * 2}", flush=True)
    # notes: how far below a slice its notes are. rects: x, y, width, height on the page, then x and y from the model's middle.
    return dict(file=file, w=W, h=int(H * 2), notes=int(H), frames=nframes, sets=sets,
                rects=[[at[i][0], at[i][1], rects[i][0].shape[1], rects[i][0].shape[0], rects[i][2], rects[i][3]] for i in range(len(rects))])


def main():
    global OUT
    OUT = os.path.abspath(arg("--out", OUT))
    os.makedirs(OUT, exist_ok=True)
    only = arg("--only")
    done = {n: make(n) for n in (only.split(",") if only else STACKS)}
    path = os.path.join(OUT, "stacks.json")
    if only and os.path.exists(path):   # keep the ones that were not asked for
        with open(path) as fh:
            done = {**json.load(fh), **done}
    with open(path, "w") as fh:
        json.dump(done, fh, separators=(",", ":"))


if __name__ == "__main__":
    main()
