"""The little people, animals, ships and monsters that move about the map.

Run inside Blender, which does the modelling and the rendering:

  blender --background --factory-startup --python units/build.py -- [--only NAME,NAME] [--sheet FILE.png]
                                                                     [--out DIR] [--grid 8] [--rim self]

--grid N renders every unit at N, N/2 and N/4 pixels to the map voxel (powers of two keep their pixels in
register with the map's when it is shown in hard pixels). Each figure is outlined in a darker shade of its
own colours and its mid-tones are lifted to stand in the map's sunlight; --rim dark gives one dark line all
round instead, and --lift 1 leaves the tones as rendered.

Every unit is a small model built here, measured in cubes of about a third of a map
voxel, and posed for each frame of its walk. People and animals are made of round
shapes (limbs, balls, flared tubes: Model.limb, .ball, .tube); ships and carts of boxes. Blender renders it
through the map's own camera (looking north and down, so ground depth is
squeezed to 0.6 and height to 0.8) from each compass heading, with hard pixels
and a soft outline, and the frames are packed into sprite sheets:

  units/out/units0.png ...   the sheets
  units/out/units.json       name -> headings, frames, and where each frame is

Each unit is rendered at three sizes (its full size, a half and a quarter), so the
viewer can use one drawn for roughly the zoom it is at instead of shrinking a big one.

--sheet writes one picture of every unit instead, for looking at.
"""
import json
import math
import os
import sys
import tempfile

import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")   # or --out
MV = 0.36                       # one model cube, in map voxels: a person, 16 cubes tall, stands nearly 6 voxels high
KZ, KY = 0.6, 0.8               # the map camera
OUTLINE = (38, 30, 56)
PAGE = 2048

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
arg = lambda name, dflt=None: argv[argv.index(name) + 1] if name in argv else dflt

RIM = arg("--rim", "self")              # self | dark | none
LIFT = float(arg("--lift", "0.82"))     # below 1 brightens the mid-tones; 1 leaves the render as it comes
BIG = "--big" in argv                    # also render the people and animals at twice the grid, for the closest zoom

# ------------------------------------------------------------------ colours --
C = dict(
    skin="#e9b78a", skin2="#c98f66", tan="#b9794e", hair="#3b2a22", blond="#d9b25f", grey="#b9b4ae", white="#f5f0e3",
    cream="#e8dcc0", red="#c8402f", crimson="#9e2b2b", blue="#3f6fc0", sky="#8fbbe8", teal="#3f9a8f", purple="#7a4fb0",
    pink="#e59ab8", green="#5f9a48", olive="#7d8a4a", brown="#8a5a36", wood="#9a6a3a", wood2="#5e3d24", straw="#e0c36a",
    bronze="#c58a3c", bronze2="#96622a", gold="#f0c040", iron="#8c8c98", stone="#aaa49a", sail="#f3ebd3", fleece="#f1ede1",
    black="#2a2430", dark="#3a3040", eye="#1d1826", fire="#ff7a2a", wool2="#d9d2c0", hide="#b98a5a", bay="#7a4a2c",
    cloth="#d8c9a0", sea="#3d5a80", belly="#dfeaf2", feather="#e9e2cf", feather2="#8c6a44",
)


def lin(c):
    c = c.lstrip("#")
    rgb = [int(c[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in rgb]


_mats = {}


def material(col):
    col = C.get(col, col)
    if col not in _mats:
        m = bpy.data.materials.new(col)
        m.diffuse_color = (*lin(col), 1)
        m.roughness = 1
        _mats[col] = m
    return _mats[col]


# ------------------------------------------------------------------- shapes --
class Model:
    """A list of solids in model cubes: x forward, y to the left, z up."""

    def __init__(self):
        self.verts, self.faces, self.cols = [], [], []
        self.smooth = set()   # the faces that belong to a curved surface, to be shaded as one
        self.stack = [Matrix.Identity(4)]

    def push(self, m):
        self.stack.append(self.stack[-1] @ m)
        return self

    def pop(self):
        self.stack.pop()
        return self

    def at(self, x=0, y=0, z=0, rx=0, ry=0, rz=0, s=1):
        """Enter a frame moved to (x, y, z), turned (degrees) about its own origin, and scaled."""
        m = Matrix.Translation((x, y, z))
        for ang, axis in ((rz, "Z"), (ry, "Y"), (rx, "X")):
            if ang:
                m = m @ Matrix.Rotation(math.radians(ang), 4, axis)
        if s != 1:
            m = m @ Matrix.Scale(s, 4)
        return self.push(m)

    def _add(self, pts, faces, col):
        m = self.stack[-1]
        n = len(self.verts)
        self.verts += [tuple(m @ Vector(p)) for p in pts]
        self.faces += [tuple(n + i for i in f) for f in faces]
        self.cols += [col] * len(faces)

    def box(self, x0, y0, z0, x1, y1, z1, col):
        """A box by two corners."""
        p = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        self._add(p, f, col)
        return self

    def cube(self, x, y, z, sx, sy, sz, col):
        """A box by the middle of its base and its size."""
        return self.box(x - sx / 2, y - sy / 2, z, x + sx / 2, y + sy / 2, z + sz, col)

    def _round(self, pts, faces, col):
        k = len(self.faces)
        self._add(pts, faces, col)
        self.smooth.update(range(k, len(self.faces)))

    def ball(self, x, y, z, rx, ry, rz, col, n=10):
        """A ball, or an egg: its middle and its three radii."""
        rings = max(4, n // 2 + 1)
        pts = [(x, y, z - rz)]
        for j in range(1, rings):
            t = math.pi * j / rings
            for i in range(n):
                a = math.tau * i / n
                pts.append((x + math.sin(t) * math.cos(a) * rx, y + math.sin(t) * math.sin(a) * ry, z - math.cos(t) * rz))
        pts.append((x, y, z + rz))
        top = len(pts) - 1
        faces = []
        for i in range(n):
            j = (i + 1) % n
            faces.append((0, 1 + j, 1 + i))
            faces.append((top, top - n + i, top - n + j))
        for r in range(rings - 2):
            a0, b0 = 1 + r * n, 1 + (r + 1) * n
            for i in range(n):
                j = (i + 1) % n
                faces.append((a0 + i, a0 + j, b0 + j, b0 + i))
        self._round(pts, faces, col)
        return self

    def limb(self, p0, p1, r0, r1, col, n=8, caps=True):
        """A round bar from p0 to p1, r0 thick at p0 and r1 at p1, its ends rounded off."""
        a, b = Vector(p0), Vector(p1)
        d = b - a
        if d.length < 1e-6:
            return self.ball(p0[0], p0[1], p0[2], r0, r0, r0, col, n)
        d.normalize()
        u = d.orthogonal().normalized()
        v = d.cross(u)
        pts = []
        for p, r in ((a, r0), (b, r1)):
            for i in range(n):
                t = math.tau * i / n
                pts.append(tuple(p + (u * math.cos(t) + v * math.sin(t)) * r))
        self._round(pts, [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)], col)
        if caps:
            if r0 > 0.05:
                self.ball(p0[0], p0[1], p0[2], r0, r0, r0, col, n)
            if r1 > 0.05:
                self.ball(p1[0], p1[1], p1[2], r1, r1, r1, col, n)
        return self

    def tube(self, x, y, z, rings, col, n=12):
        """A stack of ovals about the upright through (x, y): rings is [(rx, ry, height), ...] from the
        bottom up. A robe, a torso, a jar. Closed flat at both ends."""
        ring = lambda rx, ry, h: [(x + math.cos(math.tau * (i + 0.5) / n) * rx, y + math.sin(math.tau * (i + 0.5) / n) * ry, z + h) for i in range(n)]
        pts = [p for r in rings for p in ring(*r)]
        faces = []
        for r in range(len(rings) - 1):
            a0, b0 = r * n, (r + 1) * n
            for i in range(n):
                j = (i + 1) % n
                faces.append((a0 + i, a0 + j, b0 + j, b0 + i))
        self._round(pts, faces, col)
        self._add(ring(*rings[0]), [tuple(range(n - 1, -1, -1))], col)
        self._add(ring(*rings[-1]), [tuple(range(n))], col)
        return self

    def loft(self, rings, col, flip=False, smooth=True):
        """A skin stretched over a row of rings, each the same number of points going round the same way
        (the planking of a hull over its ribs, a sail over its ropes). flip turns it to face the other way."""
        n = len(rings[0])
        pts = [tuple(p) for r in rings for p in r]
        faces = []
        for k in range(len(rings) - 1):
            a0, b0 = k * n, (k + 1) * n
            for i in range(n - 1):
                q = (a0 + i, a0 + i + 1, b0 + i + 1, b0 + i)
                faces.append(q[::-1] if flip else q)
        (self._round if smooth else self._add)(pts, faces, col)
        return self

    def prism(self, x, y, z, r0, r1, h, col, n=8, axis="Z"):
        """A many-sided column (or cone) standing on (x, y, z); axis Y lays it on its side as a disc."""
        pts, faces = [], []
        for k, (r, zz) in enumerate(((r0, 0), (r1, h))):
            for i in range(n):
                a = (i + 0.5) / n * math.tau
                p = (math.cos(a) * r, math.sin(a) * r, zz)
                pts.append(p)
        if axis == "Y":
            pts = [(p[0], p[2], p[1]) for p in pts]
        pts = [(x + p[0], y + p[1], z + p[2]) for p in pts]
        for i in range(n):
            j = (i + 1) % n
            faces.append((i, j, n + j, n + i) if axis == "Z" else (i, n + i, n + j, j))
        faces.append(tuple(range(n - 1, -1, -1)) if axis == "Z" else tuple(range(n)))
        faces.append(tuple(range(n, 2 * n)) if axis == "Z" else tuple(range(2 * n - 1, n - 1, -1)))
        self._add(pts, faces, col)
        return self


# -------------------------------------------------------------------- people --
def human(m, t, o):
    """A person about 16 cubes tall, facing +x. t is the place in the stride, 0..1.
    Round-limbed: legs with a knee, a robe or a tunic that flares, a head with a face and hair."""
    walk = o.get("still", False) is False
    sw = math.sin(t * math.tau) * (30 if walk else 0) * o.get("stride", 1)
    bob = (abs(math.cos(t * math.tau)) * 0.5 if walk else 0) + o.get("lift", 0)
    skin, tunic = o.get("skin", "skin"), o.get("tunic", "white")
    legs = o.get("legs", skin)
    long_ = o.get("long", False)     # a robe to the ankles
    m.at(0, 0, bob)
    # legs: a thigh, a shin that trails as the leg goes back, a foot
    for side, a in ((1, sw), (-1, -sw)):
        m.at(0, side * 1.25, 6.2, ry=-a if not long_ else -a * 0.4)
        knee = max(0.0, -a) * 0.03
        m.limb((0, 0, 0), (0.3 + knee, 0, -3.0), 1.05, 0.9, legs)
        m.limb((0.3 + knee, 0, -3.0), (-knee * 1.6, 0, -5.45), 0.9, 0.72, legs)
        m.ball(0.55 - knee * 1.6, 0, -5.55, 1.3, 0.85, 0.6, o.get("shoes", "wood2"))
        m.pop()
    # body
    if long_:
        m.tube(0, 0, 0, [(2.05, 2.95, 0.9), (1.9, 2.8, 4.0), (1.65, 2.5, 7.2)], tunic)
    else:
        m.tube(0, 0, 0, [(2.0, 2.95, 4.0), (1.65, 2.55, 7.2)], tunic)
    chest = o.get("chest", tunic)
    m.tube(0, 0, 0, [(1.6, 2.45, 6.9), (1.78, 2.72, 9.6), (1.62, 2.62, 10.7), (0.9, 1.3, 11.5)], chest)
    if o.get("belt"):
        m.tube(0, 0, 0, [(1.76, 2.66, 6.75), (1.76, 2.66, 7.55)], o["belt"])
    if o.get("cloak"):
        m.ball(-1.75, 0, 7.4, 0.9, 2.75, 4.1, o["cloak"])
    if o.get("pack"):
        m.ball(-2.5, 0, 8.4, 1.15, 1.8, 2.0, o["pack"])
    # arms
    pose = o.get("arms", "swing")
    for side, a in ((1, -sw), (-1, sw)):
        if o.get("noarm") == side:   # left off, to be hung on separately and moved (units/assets.py)
            continue
        ang = a
        if pose == "up" or (pose == "rightup" and side == -1):
            ang = 165 + (math.sin(t * math.tau) * 12 if o.get("still") else 0)
        elif pose == "carry" or (pose == "hold" and side == -1):
            ang = 70
        elif pose == "stick" and side == -1:   # leaning on a walking stick, planted a little ahead
            ang = 20 + math.sin(t * math.tau) * 6
        elif pose == "work":
            ang = 95 + math.sin(t * math.tau) * 55
        m.at(0, side * 3.3, 10.6, ry=-ang)
        sleeve = o.get("sleeve", skin)
        m.limb((0, 0, 0), (0, 0, -2.6), 0.88, 0.74, sleeve)
        m.limb((0, 0, -2.6), (0.3, 0, -4.8), 0.74, 0.62, sleeve)
        m.ball(0.3, 0, -5.3, 0.74, 0.74, 0.8, skin)
        if side == -1:   # the right hand holds things
            if o.get("spear"):
                m.limb((0.65, 0, -7), (0.65, 0, 9), 0.34, 0.3, "wood2", 6)
                m.prism(0.65, 0, 9, 0.62, 0.0, 2.7, "iron", 6)
            if o.get("staff"):
                m.limb((0.65, 0, -10.5 if pose != "work" else -3), (0.65, 0, 8), 0.36, 0.32, o["staff"], 6)
                m.ball(0.65, 0, 8.3, 0.6, 0.6, 0.6, o["staff"], 8)
            if o.get("crook"):
                m.limb((0.65, 0, -10.5), (0.65, 0, 7.6), 0.36, 0.32, "wood", 6)
                m.limb((0.65, 0, 7.6), (1.5, 0, 8.6), 0.32, 0.3, "wood", 6)
                m.limb((1.5, 0, 8.6), (2.4, 0, 7.9), 0.3, 0.28, "wood", 6)
                m.limb((2.4, 0, 7.9), (2.3, 0, 6.6), 0.28, 0.22, "wood", 6)
            if o.get("hoe"):
                m.limb((-0.3, 0, -5.05), (9, 0, -5.05), 0.34, 0.3, "wood", 6)
                m.box(8.2, -1.2, -7.2, 9, 1.2, -4.7, "iron")
            if o.get("club"):
                m.limb((0, 0, 0.5), (0, 0, -5.6), 0.6, 0.62, "wood2", 6)
                m.limb((0, 0, -5.6), (0, 0, -10.8), 0.8, 1.3, "wood", 8)
            if o.get("bow"):
                for k in range(-4, 5):
                    m.box(1.2 + (16 - k * k) * 0.09, -0.3, -5 + k * 1.3 - 0.7, 1.9 + (16 - k * k) * 0.09, 0.3, -5 + k * 1.3 + 0.7, "wood")
            if o.get("lyre"):
                m.ball(1.5, 0, -7.0, 1.4, 0.55, 0.6, "gold", 8)
                m.limb((0.5, 0, -6.6), (0.3, 0, -3.4), 0.3, 0.24, "gold", 6)
                m.limb((2.5, 0, -6.6), (2.7, 0, -3.4), 0.3, 0.24, "gold", 6)
                m.limb((0.2, 0, -3.5), (2.8, 0, -3.5), 0.22, 0.22, "gold", 6)
            if o.get("sword"):
                m.box(0.3, -0.25, -5.4, 6.5, 0.25, -4.6, "iron")
        elif o.get("shield"):
            m.prism(0, 0.9, -3.4, 3.4, 3.1, 0.8, o["shield"], 14, "Y")
            m.prism(0, 1.6, -3.4, 1.2, 0.8, 0.6, o.get("boss", "gold"), 10, "Y")
        m.pop()
    # head
    hz = 11.3
    m.limb((0, 0, hz - 0.5), (0, 0, hz + 0.4), 0.8, 0.8, skin, 8, False)
    m.ball(0, 0, hz + 1.95, 1.95, 1.95, 2.0, skin, 12)
    if not o.get("eye1"):
        for sd in (1, -1):
            m.ball(1.74, sd * 0.85, hz + 2.2, 0.3, 0.36, 0.42, "eye", 6)
    hair = o.get("hair", "hair")
    if hair and not o.get("helmet"):
        m.ball(-0.28, 0, hz + 2.5, 2.1, 2.12, 1.9, hair, 12)
        if o.get("longhair"):
            m.ball(-1.45, 0, hz + 0.7, 1.05, 1.9, 1.9, hair, 10)
    if o.get("beard"):
        m.ball(1.45, 0, hz + 0.35, 0.8, 1.3, 1.05, o["beard"], 8)
    if o.get("helmet"):
        m.ball(-0.1, 0, hz + 2.55, 2.3, 2.3, 2.15, o["helmet"], 12)
        m.box(1.8, -0.4, hz + 0.5, 2.35, 0.4, hz + 2.3, o["helmet"])           # the nose guard
        for sd in (1, -1):
            m.box(0.6, sd * 1.9 - 0.3, hz + 0.2, 2.0, sd * 1.9 + 0.3, hz + 1.8, o["helmet"])   # the cheek pieces
        if o.get("crest"):   # a plume arching from the brow to the nape
            for k in range(8):
                a = math.radians(35 + k * 22)
                m.cube(math.cos(a) * 2.75 - 0.1, 0, hz + 2.3 + math.sin(a) * 2.6, 1.25, 0.9, 1.5 + math.sin(a) * 0.5, o["crest"])
    if o.get("hat"):
        m.prism(0, 0, hz + 3.75, 4.3, 4.1, 0.5, o["hat"], 14)
        m.tube(0, 0, hz + 4.2, [(2.0, 2.0, 0), (1.6, 1.6, 1.0), (0.9, 0.9, 1.6)], o["hat"], 10)
    if o.get("crown"):
        m.tube(0, 0, hz + 3.3, [(1.95, 1.95, 0), (1.95, 1.95, 0.7)], o["crown"], 12)
        for k in range(8):
            a = math.tau * k / 8
            m.prism(math.cos(a) * 1.75, math.sin(a) * 1.75, hz + 3.9, 0.45, 0.0, 1.2, o["crown"], 5)
    if o.get("horns"):
        for sd in (1, -1):
            m.limb((0.5, sd * 1.3, hz + 3.5), (0.9, sd * 2.0, hz + 4.9), 0.45, 0.3, o["horns"], 6)
            m.limb((0.9, sd * 2.0, hz + 4.9), (1.5, sd * 1.8, hz + 5.9), 0.3, 0.08, o["horns"], 6)
    if o.get("eye1"):   # a Cyclops: one eye in the middle
        m.ball(1.6, 0, hz + 2.3, 0.6, 1.1, 0.8, "white", 8)
        m.ball(1.95, 0, hz + 2.3, 0.3, 0.5, 0.5, "eye", 6)
    if o.get("jar"):    # carried on the head
        m.tube(0, 0, hz + 4.4, [(1.2, 1.2, 0), (2.2, 2.2, 2.2), (2.1, 2.1, 3.2), (1.2, 1.2, 4.2), (1.5, 1.5, 5.0)], o["jar"], 10)
    if o.get("basket"):
        m.tube(0, 0, hz + 4.4, [(2.4, 2.4, 0), (3.1, 3.1, 2.2)], "straw", 12)
        m.ball(0, 0, hz + 6.6, 2.5, 2.5, 1.0, o["basket"], 10)
    if o.get("tail"):
        m.limb((-1.6, 0, 6.7), (-3.2, 0, 7.0), 0.5, 0.42, o["tail"], 6)
        m.limb((-3.2, 0, 7.0), (-3.4, 0, 9.1), 0.42, 0.3, o["tail"], 6)
    if o.get("wings"):
        fl = math.sin(t * math.tau) * 35
        for sd in (1, -1):
            m.at(-1.8, sd * 1.5, 10, rx=sd * (-25 - fl))
            m.box(-1.2, 0 if sd > 0 else -9, -0.5, 2.4, 9 if sd > 0 else 0, 0.5, o["wings"])
            m.box(-2.6, sd * 2 if sd > 0 else -8, -0.5, -1.2, 8 if sd > 0 else sd * 2, 0.4, o.get("wings2", o["wings"]))
            m.pop()
    m.pop()


# ------------------------------------------------------------------- animals --
def beast(m, t, o):
    """A four-legged animal facing +x. Sizes in cubes. A barrel of a body, a chest and a rump, legs with
    a joint, a neck, a head with a muzzle."""
    L, W, H, lh = o.get("len", 10), o.get("wide", 4), o.get("deep", 4), o.get("leg", 4)
    body, legc = o.get("body", "fleece"), o.get("legs", o.get("body", "fleece"))
    walk = not o.get("still")
    sw = math.sin(t * math.tau) * (28 if walk else 0)
    bob = abs(math.cos(t * math.tau)) * 0.4 if walk else 0
    m.at(0, 0, bob)
    lt = o.get("legw", 1.4)
    for fx, sd, a in ((L / 2 - 1.5, 1, sw), (L / 2 - 1.5, -1, -sw), (-L / 2 + 1.5, 1, -sw), (-L / 2 + 1.5, -1, sw)):
        m.at(fx, sd * (W / 2 - lt * 0.62), lh + 0.4, ry=-a)
        back = -0.35 if fx < 0 else 0.25
        m.limb((0, 0, 0.4), (back, 0, -lh * 0.5), lt * 0.62, lt * 0.42, legc, 7)
        m.limb((back, 0, -lh * 0.5), (0, 0, -lh - 0.05), lt * 0.42, lt * 0.36, legc, 7)
        m.ball(0.15, 0, -lh, lt * 0.5, lt * 0.44, 0.42, o.get("hoof", legc), 7)
        m.pop()
    cz = lh + H / 2
    m.ball(0, 0, cz, L / 2 * 0.98, W / 2 * 1.02, H / 2 * 1.04, body, 12)
    m.ball(L * 0.24, 0, cz + H * 0.03, L * 0.27, W / 2 * 1.06, H / 2 * 1.1, body, 10)
    m.ball(-L * 0.25, 0, cz + H * 0.02, L * 0.26, W / 2 * 1.04, H / 2 * 1.07, body, 10)
    if o.get("wool"):
        m.ball(-0.1, 0, cz + 0.45, L / 2 + 0.45, W / 2 + 0.55, H / 2 + 0.5, o["wool"], 12)
        for k in range(6):
            a = k * 2.4
            m.ball(-L * 0.32 + k * L * 0.13, math.sin(a) * W * 0.22, lh + H + 0.3 + math.cos(a) * 0.2, L * 0.15, W * 0.3, H * 0.22, o["wool"], 8)
    if o.get("saddle"):
        m.box(-2, -W / 2 - 0.2, lh + H - 0.2, 2, W / 2 + 0.2, lh + H + 0.5, o["saddle"])
    if o.get("packs"):
        for sd in (1, -1):
            m.ball(0, sd * (W / 2 + 0.5), lh + H * 0.6, 2.3, 1.15, H * 0.5, o["packs"], 8)
        m.box(-0.5, -W / 2 - 0.4, lh + H - 0.2, 0.5, W / 2 + 0.4, lh + H + 0.35, "wood2")   # the strap over its back
    top = lh + H
    if o.get("torso"):   # a centaur: a man from the waist up where the neck would be
        m.at(L / 2 - 1.6, 0, top - 7)
        human(m, t, {**o["torso"], "still": True, "legs": body, "stride": 0})
        m.pop()
    elif not o.get("nohead"):
        nk, up = o.get("neck", 2), o.get("headup", 1.5)
        hx = L / 2 + o.get("reach", 1.2)
        hw, hl, hh = o.get("headw", W * 0.72), o.get("headl", 3.2), o.get("headh", 3)
        nod = math.sin(t * math.tau * 2) * 0.3 if walk else 0
        hz = top - hh + up + nk + nod
        head = o.get("head", body)
        m.limb((L / 2 - 1.6, 0, top - H * 0.42), (hx - hl * 0.25, 0, hz + hh * 0.45), min(W, H) * 0.42, hw * 0.4, o.get("neckc", body), 8)
        m.ball(hx, 0, hz + hh / 2, hl / 2 * 1.05, hw / 2, hh / 2, head, 10)
        sl = o.get("snoutl", 1.3) if o.get("snout") else 0.7
        m.ball(hx + hl / 2 + sl * 0.25, 0, hz + hh * 0.36, sl * 0.7 + 0.45, max(0.5, hw / 2 - 0.4), hh * 0.34, o.get("snout") or head, 8)
        for sd in (1, -1):
            m.ball(hx + hl * 0.2, sd * hw * 0.46, hz + hh * 0.68, 0.34, 0.2, 0.36, "eye", 6)
        if o.get("ears"):
            for sd in (1, -1):
                m.prism(hx - hl * 0.3, sd * hw * 0.4, hz + hh * 0.85, 0.5, 0.05, o.get("earh", 1.2) + 0.4, o["ears"], 5)
        if o.get("horns"):
            for sd in (1, -1):
                if o.get("hornstyle") == "wide":
                    m.limb((hx - 0.2, sd * hw * 0.4, hz + hh - 0.3), (hx - 0.2, sd * (hw / 2 + 1.7), hz + hh + 0.2), 0.45, 0.36, o["horns"], 6)
                    m.limb((hx - 0.2, sd * (hw / 2 + 1.7), hz + hh + 0.2), (hx + 0.3, sd * (hw / 2 + 1.9), hz + hh + 1.9), 0.36, 0.08, o["horns"], 6)
                else:
                    hn = o.get("hornh", 2)
                    m.limb((hx - 1.0, sd * (hw / 2 - 0.5), hz + hh - 0.2), (hx - 1.5, sd * (hw / 2 - 0.3), hz + hh + hn * 0.6), 0.4, 0.3, o["horns"], 6)
                    m.limb((hx - 1.5, sd * (hw / 2 - 0.3), hz + hh + hn * 0.6), (hx - 2.3, sd * (hw / 2 - 0.1), hz + hh + hn), 0.3, 0.08, o["horns"], 6)
                    if o.get("antlers"):
                        m.limb((hx - 1.4, sd * (hw / 2 - 0.4), hz + hh + 1.2), (hx - 1.0, sd * (hw / 2 + 0.5), hz + hh + 3.4), 0.3, 0.2, o["horns"], 6)
                        m.limb((hx - 1.2, sd * (hw / 2 + 0.1), hz + hh + 2.4), (hx + 0.9, sd * (hw / 2 + 0.3), hz + hh + 3.3), 0.24, 0.08, o["horns"], 5)
                        m.limb((hx - 1.0, sd * (hw / 2 + 0.5), hz + hh + 3.4), (hx - 2.4, sd * (hw / 2 + 0.9), hz + hh + 4.6), 0.2, 0.06, o["horns"], 5)
                        m.limb((hx - 1.0, sd * (hw / 2 + 0.5), hz + hh + 3.4), (hx + 0.2, sd * (hw / 2 + 0.8), hz + hh + 4.8), 0.2, 0.06, o["horns"], 5)
        if o.get("tusks"):
            for sd in (1, -1):
                m.prism(hx + hl / 2 + 0.9, sd * (hw / 2 - 0.5), hz + 0.7, 0.34, 0.04, 1.7, "white", 5)
        if o.get("beak"):
            m.box(hx + hl / 2, -0.8, hz + 0.6, hx + hl / 2 + 1.8, 0.8, hz + 1.9, o["beak"])
            m.box(hx + hl / 2 + 1.0, -0.6, hz - 0.2, hx + hl / 2 + 1.8, 0.6, hz + 0.8, o["beak"])
        if o.get("mane"):   # down the back of the neck, in tufts
            for k in range(6):
                u = k / 5
                m.ball(L / 2 - 1.9 + (hx - hl * 0.35 - L / 2 + 1.9) * u - 0.5, 0, top - 0.1 + (hz + hh * 0.9 - top + 0.1) * u + 0.3, 0.75, 0.5, 0.95, o["mane"], 6)
        if o.get("ruff"):   # a lion's mane, all round
            m.ball(L / 2 - 0.6, 0, (top - H * 0.5 + hz + hh) / 2 + 0.2, 2.0, hw / 2 + 1.2, (hz + hh - top + H * 0.6) / 2 + 0.9, o["ruff"], 10)
    if o.get("tail"):
        tl = o.get("taill", 3)
        # A long tail hangs behind (the angle is how steeply); past a right angle it is a short one held up, as a goat's or a deer's is.
        ta = o.get("tailang", 55)
        m.at(-L / 2 + 0.3, 0, top - H * 0.3, ry=(ta if ta > 90 else -ta) + (math.sin(t * math.tau * 2) * 10 if walk else 0))
        m.limb((0, 0, 0), (-tl, 0, 0), 0.5, 0.32, o["tail"], 6)
        if o.get("tuft"):
            m.ball(-tl - 0.5, 0, 0, 0.95, 0.75, 0.75, o["tuft"], 7)
        m.pop()
    if o.get("wings"):
        fl = math.sin(t * math.tau)
        span = o.get("span", 11)
        for sd in (1, -1):
            m.at(0.5, sd * (W / 2 - 0.4), top, rx=sd * (-12 - fl * 34))
            y0, y1 = (0, span) if sd > 0 else (-span, 0)
            m.box(-1.5, y0, -0.4, 3.2, y1, 0.5, o["wings"])
            m.box(-3.8, y0 + (2 if sd > 0 else 0), -0.4, -1.5, y1 - (0 if sd > 0 else 2), 0.4, o.get("wings2", o["wings"]))
            m.box(-5.6, y0 + (5 if sd > 0 else 0), -0.4, -3.8, y1 - (0 if sd > 0 else 5), 0.3, o.get("wings2", o["wings"]))
            m.pop()
    if o.get("rider"):
        m.at(-0.5, 0, top - 4.6)
        human(m, 0, {**o["rider"], "still": True, "arms": o["rider"].get("arms", "hold")})
        m.pop()
    m.pop()


def bird(m, t, o):
    """A big bird on the wing, facing +x: a body, a head and beak, a fanned tail, and wings in two joints
    that beat, with the long feathers spread at their tips."""
    fl = math.sin(t * math.tau)
    body = o.get("body", "feather2")
    tips = o.get("tips", body)
    m.ball(0, 0, 1.1, 3.3, 1.35, 1.2, body, 10)
    m.ball(1.4, 0, 0.8, 1.9, 1.15, 0.9, o.get("breast", body), 8)
    m.ball(3.5, 0, 1.6, 1.15, 1.0, 1.0, o.get("head", "white"), 8)
    m.prism(4.4, 0, 1.45, 0.5, 0.0, 1.7, o.get("beak", "gold"), 5, "Z")
    m.at(4.3, 0, 1.5, ry=90)
    m.prism(0, 0, 0, 0.5, 0.05, 1.8, o.get("beak", "gold"), 5)
    m.pop()
    for sd in (1, -1):
        m.ball(3.9, sd * 0.75, 1.85, 0.22, 0.16, 0.22, "eye", 5)
    for k in range(-2, 3):   # the tail, a fan
        m.at(-2.9, 0, 1.0, rz=k * 13)
        m.box(-3.0, -0.55, -0.12, 0.2, 0.55, 0.12, o.get("tail", body) if k % 2 == 0 else tips)
        m.pop()
    span = o.get("span", 8)
    for sd in (1, -1):
        m.at(0.3, sd * 1.0, 1.6, rx=sd * (-fl * 34))
        y0, y1 = (0, span * 0.52) if sd > 0 else (-span * 0.52, 0)
        m.box(-1.9, y0, -0.25, 2.3, y1, 0.3, body)                       # the arm of the wing
        m.at(0.2, sd * span * 0.5, 0, rx=sd * (-fl * 22))               # the hand, which bends further
        z0, z1 = (0, span * 0.5) if sd > 0 else (-span * 0.5, 0)
        m.box(-1.5, z0, -0.2, 1.9, z1, 0.25, body)
        for k in range(5):                                               # the flight feathers, spread
            m.at(1.5 - k * 0.75, sd * span * 0.44, 0, rz=sd * (-12 + k * 9))
            m.box(-0.33, 0 if sd > 0 else -span * 0.26, -0.1, 0.33, span * 0.26 if sd > 0 else 0, 0.1, tips if k % 2 == 0 else body)
            m.pop()
        m.pop()
        for k in range(4):                                               # the trailing edge
            m.box(-2.9, sd * (0.5 + k * span * 0.12) - 0.42, -0.1, -1.7, sd * (0.5 + k * span * 0.12) + 0.42, 0.12, tips if k % 2 else body)
        m.pop()


# --------------------------------------------------------------------- ships --
def _hull(m, L, beam, hull, trim, deck, depth=1.6, base=3.0, rise=24.0):
    """The skin of a hull L long: ribs from stern to stem, each from one rail round under the keel to the
    other; a rail in the ship's colour; a deck. Returns half_width(x) and sheer(x), the rail's line."""
    n = 16
    half = lambda u: beam * max(0.0, 1 - abs(u) ** 2.6) ** 0.7 + 0.5
    sheer = lambda u: base + rise * max(0.0, abs(u) - 0.55) ** 1.6
    ribs, planks = [], []
    for k in range(n + 1):
        u = -1 + 2 * k / n
        x, hw, zs = u * L / 2, half(u), sheer(u)
        keel = -depth * (1 - 0.5 * abs(u) ** 3)
        rib = []
        for a in range(-4, 5):   # from the port rail, down round the keel, up to the starboard rail
            v = a / 4
            rib.append((x, -math.sin(v * math.pi / 2) * hw, keel + (zs - keel) * (1 - math.cos(v * math.pi / 2)) ** 0.8))
        ribs.append(rib)
        planks.append((x, hw, zs))
    m.loft(ribs, hull, flip=True)
    for sd in (1, -1):   # the rail: a band outside, its top, a band inside
        band = [[(x, sd * (hw + 0.22), zs - 0.2), (x, sd * (hw + 0.3), zs + 1.9), (x, sd * (hw - 0.45), zs + 1.9), (x, sd * (hw - 0.5), zs - 0.2)] for x, hw, zs in planks]
        m.loft(band, trim, flip=sd < 0, smooth=False)
    m.loft([[(x, hw - 0.5, zs - 0.15), (x, 0, zs + 0.05), (x, -hw + 0.5, zs - 0.15)] for x, hw, zs in planks], deck, smooth=False)
    return half, sheer


def ship(m, t, o):
    """A galley, bow towards +x. Lengths in cubes; t rows the oars."""
    L = o.get("len", 56)
    hull, trim, deck = o.get("hull", "wood2"), o.get("trim", "red"), o.get("deck", "wood")
    beam = o.get("beam", 7)
    half, sheer = _hull(m, L, beam, hull, trim, deck)
    at = lambda x: (half(2 * x / L), sheer(2 * x / L))
    # The stern post, curling up and forward over the helmsman, its end split like a fan; the stem post at the bow.
    curl = [(-L / 2 + 0.6, 0, 6), (-L / 2 - 1.6, 0, 10.5), (-L / 2 - 1.4, 0, 15), (-L / 2 + 1.2, 0, 18.4), (-L / 2 + 4.6, 0, 19.2)]
    for a, b in zip(curl, curl[1:]):
        m.limb(a, b, 1.0, 0.85, hull, 7)
    for dy in (-1.3, 0, 1.3):
        m.limb(curl[-1], (curl[-1][0] + 2.6, dy, curl[-1][2] - 0.6 - abs(dy) * 0.3), 0.6, 0.25, trim, 6)
    stem = [(L / 2 - 1.2, 0, 5), (L / 2 + 1.0, 0, 9.5), (L / 2 + 0.4, 0, 13), (L / 2 - 1.6, 0, 14.6)]
    for a, b in zip(stem, stem[1:]):
        m.limb(a, b, 0.95, 0.75, hull, 7)
    if o.get("ram", True):   # the bronze ram at the waterline, three-finned
        m.limb((L / 2 - 2.5, 0, 0.3), (L / 2 + 6.2, 0, -0.2), 1.5, 0.5, "bronze", 8)
        for dz in (-0.9, 0, 0.9):
            m.box(L / 2 + 2.5, -1.25, -0.2 + dz - 0.22, L / 2 + 6.4, 1.25, -0.2 + dz + 0.22, "bronze")
    for sd in (1, -1):       # the painted eye
        hw, zs = at(L / 2 - 6.5)
        m.ball(L / 2 - 6.5, sd * (hw + 0.1), zs - 1.3, 1.6, 0.3, 1.0, "white", 8)
        m.ball(L / 2 - 6.2, sd * (hw + 0.28), zs - 1.3, 0.6, 0.2, 0.6, "eye", 6)
    if o.get("shields"):
        for j in range(int((L - 20) / 3.4) + 1):   # hung along the rail, bow to stern
            x = -L / 2 + 10 + j * 3.4
            hw, zs = at(x)
            for sd in (1, -1):
                m.prism(x, sd * (hw + 0.35) - (0.5 if sd < 0 else 0), zs + 0.6, 1.6, 1.4, 0.5, o["shields"][j % len(o["shields"])], 12, "Y")
                m.prism(x, sd * (hw + 0.6) - (0.3 if sd < 0 else 0), zs + 0.6, 0.5, 0.3, 0.3, "gold", 8, "Y")
    # oars: round looms and flat blades, rowed together
    if o.get("oars", 0):
        ph = math.sin(t * math.tau)
        k = o["oars"]
        # stroke: the blades go into the water as they are drawn aft and are lifted clear for the return
        # (units/stack.py asks for it; without it the oars are held up and only swing).
        dip = -(16 + 8 * math.cos(t * math.tau)) if o.get("stroke") else 18 + abs(ph) * 6
        for i in range(k):
            x = -L * 0.3 + i * (L * 0.56 / max(1, k - 1))
            hw, zs = at(x)
            for sd in (1, -1):
                m.at(x, sd * hw, zs + 0.3, rz=sd * (ph * 24), rx=sd * dip)
                m.limb((0, 0, 0), (0, sd * 9.4, 0), 0.32, 0.28, "wood", 6)
                m.ball(0, sd * 10.4, 0, 0.75, 1.5, 0.22, "wood", 6)
                m.pop()
    for sd in (1, -1):       # the steering oars, one on each quarter
        hw, zs = at(-L / 2 + 5)
        m.at(-L / 2 + 5, sd * (hw + 0.2), zs + 2, rx=sd * 24, ry=-18)
        m.limb((0, 0, 2.5), (0, 0, -8), 0.4, 0.36, "wood", 6)
        m.ball(0, 0, -9.3, 1.1, 0.25, 2.0, "wood", 6)
        m.pop()
    # mast, yard, sail and its ropes
    if o.get("mast", True):
        mx = o.get("mastx", 2)
        mh = o.get("masth", 30)
        m.limb((mx, 0, 2.6), (mx, 0, 3 + mh + 2.5), 0.85, 0.5, "wood2", 8)
        yw = o.get("yard", beam * 2.3)
        m.limb((mx + 0.6, -yw, mh + 0.6), (mx + 0.6, yw, mh + 0.6), 0.5, 0.5, "wood2", 7)
        sail = o.get("sail", "sail")
        if sail:
            rows, cols_ = 6, 6
            sh = (mh - 9) / rows
            for r in range(rows):       # cloth by cloth, bellied out towards the bow, deepest in the middle
                band = []
                for edge in (r, r + 1):
                    v = edge / rows
                    line = []
                    for c in range(cols_ + 1):
                        w = c / cols_ * 2 - 1
                        bulge = (3.6 * math.sin(v * math.pi) + 0.5) * (1 - 0.35 * w * w)
                        line.append((mx + 0.9 + bulge, w * (yw - 0.6) * (1 - 0.06 * v), mh - edge * sh))
                    band.append(line)
                m.loft(band, o["stripe"] if o.get("stripe") and r % 2 else sail)
            if o.get("device"):       # an emblem on the sail
                m.ball(mx + 4.5, 0, mh - 3.1 * sh, 0.5, 3.2, 3.2, o["device"], 12)
            for sd in (1, -1):        # the sheets, from the foot of the sail to the rail
                hw, zs = at(mx - 8)
                m.limb((mx + 1.3, sd * (yw - 1), mh - rows * sh), (mx - 8, sd * hw, zs + 1.5), 0.12, 0.12, "cloth", 4, False)
        else:
            m.limb((mx + 0.7, -yw + 1, mh - 0.4), (mx + 0.7, yw - 1, mh - 0.4), 0.95, 0.95, "sail", 7)   # furled
        m.limb((mx, 0, 3 + mh + 1), (L / 2 - 1, 0, 9), 0.12, 0.12, "cloth", 4, False)      # the forestay
        m.limb((mx, 0, 3 + mh + 1), (-L / 2 + 2, 0, 9.5), 0.12, 0.12, "cloth", 4, False)   # the backstay
        m.box(mx - 3.8, -0.15, 3 + mh + 0.6, mx - 0.4, 0.15, 3 + mh + 2.4, o.get("flag", trim))
    # crew: heads and shoulders along the benches
    for i in range(o.get("crew", 0)):
        x = -L * 0.3 + (i + 0.5) * (L * 0.56 / o["crew"])
        hw, zs = at(x)
        for sd in (1, -1):
            y = sd * min(2.6, hw - 1.6)
            m.ball(x, y, zs + 1.3, 1.0, 1.2, 1.4, ("cream", "red", "blue", "cream")[i % 4], 7)
            m.ball(x, y, zs + 3.2, 0.9, 0.9, 0.95, "skin", 7)
            m.ball(x - 0.15, y, zs + 3.5, 0.95, 0.95, 0.8, "hair", 7)
    if o.get("captain"):
        hw, zs = at(-L / 2 + 8)
        m.at(-L / 2 + 8, 0, zs, s=0.62)
        human(m, 0, {**o["captain"], "still": True})
        m.pop()
    if o.get("cargo"):          # jars, and a sack or two
        for i, c in enumerate(o["cargo"]):
            x, y = -6 + i * 4.5, (i % 2 - 0.5) * 3
            hw, zs = at(x)
            if i % 3 == 2:
                m.ball(x, y, zs + 1.1, 2.0, 1.6, 1.2, c, 8)
            else:
                m.tube(x, y, zs, [(0.7, 0.7, 0), (1.9, 1.9, 1.6), (1.7, 1.7, 2.6), (0.8, 0.8, 3.4), (1.0, 1.0, 3.9)], c, 10)


def skiff(m, t, o):
    """A fishing boat with one man in it, pulling on the oars."""
    hull, trim = o.get("hull", "wood"), o.get("trim", "blue")
    half, sheer = _hull(m, 20, 3.1, hull, trim, "wood2", depth=1.0, base=2.3, rise=9.0)
    m.box(-1.2, -2.6, 2.2, 0.2, 2.6, 2.6, "wood2")     # the thwart he sits on
    ph = math.sin(t * math.tau)
    for sd in (1, -1):
        m.at(0.5, sd * 3.2, 3.0, rz=sd * (ph * 26), rx=sd * 16)
        m.limb((0, 0, 0), (0, sd * 5.6, 0), 0.26, 0.22, "wood", 6)
        m.ball(0, sd * 6.3, 0, 0.5, 1.0, 0.18, "wood", 6)
        m.pop()
    m.tube(5.2, 0, 2.3, [(1.0, 1.0, 0), (1.4, 1.4, 1.1), (1.2, 1.2, 1.4)], "straw", 8)   # the basket for the catch
    m.ball(5.2, 0, 3.6, 1.0, 1.0, 0.35, "iron", 6)
    m.at(-1.0, 0, 2.2, s=0.66)
    human(m, 0, dict(tunic=o.get("tunic", "cream"), hat="straw", still=True, arms="carry", legs=o.get("tunic", "cream")))
    m.pop()


def cart(m, t, o):
    """An ox and the cart it pulls."""
    m.at(7, 0, 0)
    beast(m, t, OX)
    m.pop()
    m.box(-10, -3.4, 4.2, 1, 3.4, 5.2, "wood")
    m.box(-10, -3.4, 5.2, 1, -2.8, 8.2, "wood2")
    m.box(-10, 2.8, 5.2, 1, 3.4, 8.2, "wood2")
    m.box(-10, -3.4, 5.2, -9.4, 3.4, 8.2, "wood2")
    for i, c in enumerate(o.get("load", ("straw", "straw", "straw"))):
        m.box(-9 + i * 3.2, -2.6, 5.2, -6.2 + i * 3.2, 2.6, 8.6 + (i % 2), c)
    m.box(1, -0.5, 4.4, 5, 0.5, 5.2, "wood2")             # the pole
    rot = t * 360
    for sd in (1, -1):
        m.at(-4.5, sd * 3.9, 3.6, ry=rot)
        m.prism(0, -0.4, 0, 3.6, 3.6, 0.8, "wood2", 8, "Y")
        m.box(-3.2, -0.5, -0.4, 3.2, 0.5, 0.4, "wood")
        m.box(-0.4, -0.5, -3.2, 0.4, 0.5, 3.2, "wood")
        m.pop()


def chariot(m, t, o):
    """Two horses and a car with a driver."""
    for sd in (1, -1):
        m.at(8, sd * 3, 0)
        beast(m, (t + (0.5 if sd < 0 else 0)) % 1, {**HORSE, "body": "white" if sd > 0 else "bay"})
        m.pop()
    m.box(-7, -3.2, 4, -1, 3.2, 5, "wood")
    m.box(-2, -3.2, 5, -1, 3.2, 9, o.get("car", "red"))
    m.box(-7, -3.2, 5, -1, -2.6, 8, o.get("car", "red"))
    m.box(-7, 2.6, 5, -1, 3.2, 8, o.get("car", "red"))
    m.box(-1, -0.4, 4.6, 5, 0.4, 5.4, "wood2")
    rot = t * 360
    for sd in (1, -1):
        m.at(-4, sd * 3.8, 3.6, ry=rot)
        m.prism(0, -0.4, 0, 3.6, 3.6, 0.8, "wood2", 8, "Y")
        m.box(-3.2, -0.5, -0.4, 3.2, 0.5, 0.4, "gold")
        m.box(-0.4, -0.5, -3.2, 0.4, 0.5, 3.2, "gold")
        m.pop()
    m.at(-4.2, 0, 5, s=0.9)
    human(m, 0, {**o.get("driver", {}), "still": True, "arms": "carry"})
    m.pop()


SHEEP = dict(len=8, wide=4.4, deep=3.6, leg=2.6, body="fleece", wool="fleece", legs="black", head="black", headw=2.6, headl=2.6, headh=2.6, neck=0, headup=1.2, ears="black", earh=0.8, reach=1.0)
GOAT = dict(len=8, wide=3.4, deep=3.2, leg=3.4, body="wool2", legs="hide", head="wool2", headw=2.4, headl=2.6, headh=2.6, neck=1, horns="wood2", hornh=2.4, tail="wool2", taill=1.4, tailang=120, snout="hide", snoutl=0.8)
OX = dict(len=13, wide=5.4, deep=5.4, leg=4.4, legw=1.8, body="hide", legs="hide", head="hide", headw=4, headl=3.6, headh=3.6, neck=0, headup=1.0, horns="white", hornstyle="wide", snout="cream", tail="hide", taill=4, tuft="wood2", tailang=85, hoof="wood2")
HORSE = dict(len=12, wide=4, deep=4.6, leg=6.4, legw=1.4, body="bay", head="bay", headw=2.6, headl=4.4, headh=2.8, neck=4.4, headup=1.8, reach=2.4, mane="black", tail="black", taill=4.5, tailang=75, ears="bay", earh=1, hoof="black", snout="bay", snoutl=0.6)
DONKEY = dict(len=10, wide=3.6, deep=4, leg=4.8, body="grey", legs="grey", head="grey", headw=2.6, headl=3.8, headh=2.8, neck=3, headup=1.6, reach=2, ears="grey", earh=2.4, tail="dark", taill=3, tailang=80, snout="white", snoutl=0.8, hoof="dark")

HOPLITE = dict(tunic="crimson", chest="bronze", helmet="bronze", crest="red", shield="bronze", boss="crimson", spear=True, cloak="crimson", hair=None, shoes="bronze2", arms="hold")

UNITS = {
    # name: (builder, options, pixels per map voxel, headings, frames[, size: 1 is life size beside the people])
    "man": (human, dict(tunic="cream", belt="wood2"), 12, 8, 4),
    "man2": (human, dict(tunic="brown", hat="straw", pack="cloth", staff="wood"), 12, 8, 4),
    "woman": (human, dict(tunic="blue", long=True, longhair=True, jar="bronze2", arms="rightup", skin="skin"), 12, 8, 4),
    "woman2": (human, dict(tunic="red", long=True, longhair=True, hair="blond", basket="green", arms="rightup"), 12, 8, 4),
    "farmer": (human, dict(tunic="olive", hat="straw", hoe=True, arms="hold", skin="skin2"), 12, 8, 4),
    "farmer_work": (human, dict(tunic="olive", hat="straw", hoe=True, arms="work", skin="skin2", still=True), 12, 8, 4),
    "shepherd": (human, dict(tunic="cloth", cloak="brown", crook=True, arms="hold", beard="hair"), 12, 8, 4),
    "hoplite": (human, HOPLITE, 12, 8, 4),
    # the young and the old: the same figure, smaller (a child's head is big for its body) or with a stick
    "boy": (human, dict(tunic="straw", belt="wood2", hair="hair", stride=1.3), 12, 8, 4, 0.66),
    "girl": (human, dict(tunic="pink", long=True, longhair=True, hair="blond", belt="white"), 12, 8, 4, 0.66),
    "elder": (human, dict(tunic="grey", long=True, cloak="brown", hair="white", beard="white", staff="wood2", arms="stick", stride=0.6), 12, 8, 4, 0.94),
    "elder_woman": (human, dict(tunic="dark", long=True, longhair=True, hair="grey", cloak="purple", basket="cloth", arms="rightup", stride=0.6), 12, 8, 4, 0.92),
    "archer": (human, dict(tunic="green", bow=True, arms="hold", belt="wood2", hair="blond", longhair=True), 12, 8, 4),
    "priest": (human, dict(tunic="white", long=True, belt="gold", staff="gold", arms="hold", beard="grey", hair="grey"), 12, 8, 4),
    "merchant": (human, dict(tunic="purple", long=True, belt="gold", hat="red", beard="hair"), 12, 8, 4),
    "runner": (human, dict(tunic="white", chest="skin", sleeve="skin", stride=1.5), 12, 8, 4),
    "dancer": (human, dict(tunic="pink", long=True, longhair=True, hair="blond", arms="up", still=True), 12, 8, 4),
    "bard": (human, dict(tunic="sky", long=True, lyre=True, arms="hold", beard="grey", hair="grey", crown="green"), 12, 8, 4),
    "heracles": (human, dict(tunic="straw", chest="skin2", skin="skin2", sleeve="skin2", club=True, arms="hold", beard="hair", cloak="straw", helmet="straw"), 12, 8, 4, 1.25),
    "satyr": (human, dict(tunic="bay", legs="bay", chest="skin2", skin="skin2", sleeve="skin2", horns="wood2", beard="hair", tail="bay", shoes="black"), 12, 8, 4),
    "cyclops": (human, dict(tunic="hide", chest="tan", skin="tan", sleeve="tan", eye1=True, club=True, arms="hold", hair="hair", beard="hair"), 12, 8, 4, 2.2),
    "talos": (human, dict(tunic="bronze2", chest="bronze", skin="bronze", sleeve="bronze", legs="bronze", hair="bronze2", helmet="bronze2", crest="gold", shoes="bronze2", sword=True, arms="hold"), 12, 8, 4, 2.6),
    "harpy": (human, dict(tunic="purple", long=True, skin="grey", sleeve="grey", hair="black", longhair=True, wings="dark", wings2="purple", still=True, arms="carry", lift=0), 12, 8, 2),
    "sheep": (beast, SHEEP, 12, 8, 4),
    "goat": (beast, GOAT, 12, 8, 4),
    "ox": (beast, OX, 12, 8, 4),
    "bull": (beast, {**OX, "body": "white", "legs": "white", "head": "white", "horns": "gold", "tail": "white"}, 12, 8, 4),
    "horse": (beast, HORSE, 12, 8, 4),
    "horse_white": (beast, {**HORSE, "body": "white", "head": "white", "ears": "white", "snout": "white", "mane": "grey", "tail": "grey"}, 12, 8, 4),
    "donkey": (beast, {**DONKEY, "packs": "cloth"}, 12, 8, 4),
    "deer": (beast, dict(len=9, wide=3, deep=3.4, leg=5.6, legw=1.1, body="hide", legs="hide", head="hide", headw=2.2, headl=3, headh=2.4, neck=3.4, headup=1.6, reach=1.8, horns="cream", antlers=True, ears="hide", tail="white", taill=1.2, tailang=120, snout="dark", snoutl=0.5), 12, 8, 4),
    "boar": (beast, dict(len=10, wide=4.6, deep=5, leg=2.8, body="dark", legs="black", head="dark", headw=3.6, headl=3.6, headh=3.6, neck=0, headup=0.2, snout="black", snoutl=1.6, tusks=True, mane="black", ears="black", tail="black", taill=1.6, tailang=110), 12, 8, 4),
    "wolf": (beast, dict(len=10, wide=3, deep=3.4, leg=4.2, legw=1.1, body="iron", legs="iron", head="iron", headw=2.6, headl=3, headh=2.6, neck=1, headup=1.2, snout="grey", snoutl=1.6, ears="dark", earh=1.4, tail="dark", taill=4, tailang=40), 12, 8, 4),
    "lion": (beast, dict(len=12, wide=4.2, deep=4.2, leg=4, legw=1.5, body="straw", legs="straw", head="straw", headw=3.4, headl=3.2, headh=3.4, neck=1, headup=1.4, snout="cream", snoutl=1.2, ruff="bay", ears="bay", tail="straw", taill=5, tuft="bay", tailang=50), 12, 8, 4),
    "rider": (beast, {**HORSE, "saddle": "red", "rider": dict(HOPLITE, shield=None)}, 12, 8, 4),
    "centaur": (beast, {**HORSE, "nohead": False, "torso": dict(tunic="bay", chest="skin2", skin="skin2", sleeve="skin2", bow=True, arms="hold", beard="hair")}, 12, 8, 4),
    "oxcart": (cart, dict(load=("straw", "bronze2", "straw")), 12, 8, 4),
    "chariot": (chariot, dict(driver=dict(HOPLITE, shield=None, spear=False)), 12, 8, 4),
    "griffin": (beast, dict(len=12, wide=4.2, deep=4.4, leg=4.2, legw=1.5, body="straw", legs="straw", head="white", headw=3, headl=3, headh=3.2, neck=2.4, headup=1.6, reach=1.6, beak="gold", ears="white", earh=1.4, tail="straw", taill=5, tuft="bay", tailang=40, wings="white", wings2="feather2", span=13, still=True), 12, 8, 4),
    "pegasus": (beast, {**HORSE, "body": "white", "head": "white", "ears": "white", "snout": "white", "mane": "sky", "tail": "sky", "wings": "white", "wings2": "feather", "span": 14, "hoof": "gold"}, 12, 8, 4),
    "eagle": (bird, dict(body="feather2", head="white", tail="white", tips="dark", span=9), 12, 8, 4),
    "trireme": (ship, dict(len=60, oars=9, crew=7, shields=("bronze", "red", "white", "blue"), stripe="red", captain=HOPLITE), 6, 16, 2, 2.0),
    "merchant_ship": (ship, dict(len=46, beam=8.5, oars=0, ram=False, hull="bay", trim="blue", sail="cream", cargo=("bronze2", "red", "bronze2", "cloth"), masth=28, captain=dict(tunic="purple", long=True)), 6, 16, 1, 1.9),
    "merchant_ship2": (ship, dict(len=42, beam=8, oars=0, ram=False, hull="wood2", trim="teal", sail="sail", stripe="teal", cargo=("cloth", "bronze2", "green"), masth=26), 6, 16, 1, 1.9),
    "odysseus": (ship, dict(len=54, oars=7, crew=6, trim="red", sail="sail", device="red", shields=("bronze",), captain=dict(tunic="red", cloak="blue", beard="hair", helmet="bronze")), 6, 16, 2, 2.1),
    "argo": (ship, dict(len=58, oars=8, crew=7, hull="bay", trim="gold", sail="sky", device="gold", shields=("gold", "bronze"), captain=dict(tunic="white", cloak="purple", hair="blond")), 6, 16, 2, 2.0),
    "theseus": (ship, dict(len=50, oars=6, crew=5, hull="dark", trim="crimson", sail="black", captain=dict(tunic="blue", hair="hair")), 6, 16, 2, 2.0),
    "skiff": (skiff, dict(), 12, 8, 4),
    "skiff2": (skiff, dict(hull="wood2", trim="red", tunic="olive"), 12, 8, 4),
}


# ------------------------------------------------------------------ rendering --
def setup():
    sc = bpy.context.scene
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.image_settings.compression = 0
    sc.render.resolution_percentage = 100
    try:
        sc.view_settings.view_transform = "Standard"
    except TypeError:
        pass
    sc.display.render_aa = "OFF"
    sh = sc.display.shading
    sh.light = "STUDIO"
    sh.studio_light = arg("--studio", "outdoor.sl")
    sh.color_type = "MATERIAL"
    sh.show_shadows = False
    sh.show_cavity = True
    sh.cavity_type = "WORLD"
    sh.cavity_ridge_factor = 1.2
    sh.cavity_valley_factor = 1.0
    sh.show_object_outline = False
    sh.show_specular_highlight = False
    sh.use_world_space_lighting = True
    sh.studiolight_rotate_z = math.radians(float(arg("--light", "110")))
    cam = bpy.data.cameras.new("cam")
    cam.type = "ORTHO"
    cam.clip_end = 2000
    ob = bpy.data.objects.new("cam", cam)
    sc.collection.objects.link(ob)
    sc.camera = ob
    return sc, ob


def mesh_of(model, name, size=1):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(c * MV * size for c in v) for v in model.verts], [], model.faces)
    names = sorted(set(model.cols))
    for n in names:
        me.materials.append(material(n))
    me.polygons.foreach_set("material_index", [names.index(c) for c in model.cols])
    me.polygons.foreach_set("use_smooth", [i in model.smooth for i in range(len(model.faces))])
    me.update()
    return me


def render_unit(sc, cam, name, tmp, q):
    """Every heading and frame of one unit at q pixels per map voxel, rendered together in a grid."""
    fn, opts, _, heads, nframes = UNITS[name][:5]
    size = UNITS[name][5] if len(UNITS[name]) > 5 else 1
    meshes = []
    rad, top, low = 1.0, 1.0, 0.0
    for f in range(nframes):
        m = Model()
        fn(m, f / nframes, opts)
        me = mesh_of(m, f"{name}{f}", size)
        meshes.append(me)
        for v in me.vertices:
            rad = max(rad, math.hypot(v.co.x, v.co.y))
            top = max(top, v.co.z)
            low = min(low, v.co.z)
    cw = int(math.ceil((2 * rad * q + 8) / 2) * 2)
    above = int(math.ceil((top * KY + rad * KZ) * q)) + 4
    below = int(math.ceil((rad * KZ - low * KY) * q)) + 4
    ch = above + below
    W, H = cw * heads, ch * nframes
    sc.render.resolution_x, sc.render.resolution_y = W, H
    cam.data.ortho_scale = max(W, H) / q
    tx, tz = W / (2 * q), -H / (2 * KY * q)
    e = math.asin(KZ)
    cam.location = (tx, -400 * math.cos(e), tz + 400 * math.sin(e))
    cam.rotation_euler = (math.pi / 2 - e, 0, 0)
    objs = []
    for f in range(nframes):
        for h in range(heads):
            ob = bpy.data.objects.new(f"u{f}_{h}", meshes[f])
            ob.location = ((h + 0.5) * cw / q, 0, -(f * ch + above) / (KY * q))
            ob.rotation_euler = (0, 0, -h * math.tau / heads)   # heading 0 east, then clockwise as seen on the map
            sc.collection.objects.link(ob)
            objs.append(ob)
    path = os.path.join(tmp, name + ".png")
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
    frames = []
    for f in range(nframes):
        for h in range(heads):
            cell = px[f * ch:(f + 1) * ch, h * cw:(h + 1) * cw].copy()
            frames.append(finish(cell, cw / 2, above))
    return frames


def shade(cell):
    """Hard alpha, the map's sunlight, a few flat shades to the colour, and an outline. In place."""
    a = cell[..., 3] > 127
    cell[..., 3] = np.where(a, 255, 0)
    if LIFT != 1:   # the map is painted in full sun; lift the figures' mid-tones to stand in the same light
        cell[..., :3] = (255 * (cell[..., :3] / 255.0) ** LIFT * np.array([1.04, 1.0, 0.94]) + 0.5).clip(0, 255).astype(np.uint8)
    cell[..., :3] = (cell[..., :3] >> 3 << 3) | 4   # a few flat shades per colour, as pixel art has
    cell[~a, :3] = 0
    pad = np.pad(a, 1)
    edge = ~pad[1:-1, 1:-1] & (pad[:-2, 1:-1] | pad[2:, 1:-1] | pad[1:-1, :-2] | pad[1:-1, 2:])
    if RIM == "self":   # a darker, slightly bluer shade of whatever the line runs along
        rgb = np.pad(cell[..., :3].astype(np.float32), ((1, 1), (1, 1), (0, 0)))
        cnt = pad.astype(np.float32)
        tot = rgb[:-2, 1:-1] + rgb[2:, 1:-1] + rgb[1:-1, :-2] + rgb[1:-1, 2:]
        n = (cnt[:-2, 1:-1] + cnt[2:, 1:-1] + cnt[1:-1, :-2] + cnt[1:-1, 2:])[..., None]
        line = tot / np.maximum(n, 1) * np.array([0.5, 0.48, 0.58], np.float32)
        cell[edge, :3] = line[edge].astype(np.uint8)
        cell[edge, 3] = 255
    elif RIM != "none":
        cell[edge] = (*OUTLINE, 255)


def finish(cell, ax, ay):
    """shade(), then cropped to what is there. Returns (pixels, anchor x, anchor y)."""
    shade(cell)
    solid = cell[..., 3] > 0
    ys, xs = np.where(solid)
    if len(xs) == 0:
        return np.zeros((1, 1, 4), np.uint8), 0, 0
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    return cell[y0:y1, x0:x1], ax - x0, ay - y0


def save_png(arr, path):
    h, w = arr.shape[:2]
    img = bpy.data.images.new("out", w, h, alpha=True)
    img.pixels.foreach_set((arr[::-1].astype(np.float32) / 255).ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def main():
    global OUT
    OUT = os.path.abspath(arg("--out", OUT))
    grid = int(arg("--grid", "0"))
    sc, cam = setup()
    only = arg("--only")
    names = only.split(",") if only else list(UNITS)
    tmp = tempfile.mkdtemp(prefix="units_")
    sheet = arg("--sheet")
    done = {}
    for n in names:
        q = grid or UNITS[n][2]
        small = UNITS[n][0] not in (ship,)   # a ship at the largest size would fill pages by itself
        sizes = [q] if sheet else ([q * 2, q, q // 2, q // 4] if small and BIG else [q, q // 2, q // 4])
        done[n] = {k: render_unit(sc, cam, n, tmp, k) for k in sizes}
        print("unit", n, flush=True)

    if sheet:   # one row per unit: heading 0..N of frame 0, then the frames of heading 1
        rows = []
        for n in names:
            heads, nfr = UNITS[n][3], UNITS[n][4]
            fr = done[n][grid or UNITS[n][2]]
            pick = [fr[h] for h in range(0, heads, max(1, heads // 8))] + [fr[f * heads + 1] for f in range(1, nfr)]
            hh = max(p[0].shape[0] for p in pick) + 4
            row = np.zeros((hh, sum(p[0].shape[1] + 6 for p in pick), 4), np.uint8)
            x = 0
            for p, _, _ in pick:
                row[hh - 2 - p.shape[0]:hh - 2, x:x + p.shape[1]] = p
                x += p.shape[1] + 6
            rows.append(row)
        Wd = max(r.shape[1] for r in rows)
        out = np.zeros((sum(r.shape[0] for r in rows), Wd, 4), np.uint8)
        out[..., :3] = (196, 170, 120)
        out[..., 3] = 255
        y = 0
        for r in rows:
            a = r[..., 3:4] > 0
            out[y:y + r.shape[0], :r.shape[1]] = np.where(a, r, out[y:y + r.shape[0], :r.shape[1]])
            y += r.shape[0]
        save_png(out, os.path.abspath(sheet))
        print("sheet", sheet, out.shape)
        return

    # Pack every frame onto pages, tallest first, on shelves.
    os.makedirs(OUT, exist_ok=True)
    items, meta = [], {}
    for n in names:
        meta[n] = dict(heads=UNITS[n][3], frames=UNITS[n][4], sets=[])
        for q in sorted(done[n], reverse=True):
            at = [None] * len(done[n][q])
            meta[n]["sets"].append(dict(q=q, at=at))
            for i, (p, ax, ay) in enumerate(done[n][q]):
                items.append((at, i, p, ax, ay))
    items.sort(key=lambda it: -it[2].shape[0])
    pages = []
    seen = {}
    page, x, y, shelf = None, 2, 2, 0
    for at, i, p, ax, ay in items:
        h, w = p.shape[:2]
        key = (w, h, round(float(ax), 2), round(float(ay), 2), p.tobytes())
        if key in seen:      # two frames that came out the same share one picture
            at[i] = seen[key]
            continue
        if page is None or x + w + 2 > PAGE:
            x, y, shelf = 2, y + shelf + 2, 0
        if page is None or y + h + 2 > PAGE:
            page = np.zeros((PAGE, PAGE, 4), np.uint8)
            pages.append(page)
            x, y, shelf = 2, 2, 0
        page[y:y + h, x:x + w] = p
        seen[key] = at[i] = [len(pages) - 1, x, y, w, h, round(float(ax), 2), round(float(ay), 2)]
        x += w + 2
        shelf = max(shelf, h)
    files = []
    for k, pg in enumerate(pages):
        used = PAGE if k < len(pages) - 1 else min(PAGE, y + shelf + 2)
        name = f"units{k}.png"
        save_png(pg[:used], os.path.join(OUT, name))
        files.append(dict(file=name, w=PAGE, h=int(used)))
    with open(os.path.join(OUT, "units.json"), "w") as fh:
        json.dump(dict(pages=files, units=meta), fh, separators=(",", ":"))
    print(f"packed {len(items)} frames ({len(seen)} distinct) onto {len(pages)} page(s)")


if __name__ == "__main__":
    main()
