"""Hero models for the landmarks, made in Blender.

The landmark scenes are put together in gen/landmarks.js from simple parts. The pieces
that deserve better (the wooden horse at Troy, Penelope at her loom, the bronze birds of
Stymphalos) are modelled here with Blender's own tools (bevels, lathes, curves, the
figures of units/build.py) and written out as plain triangles:

  blender --background --factory-startup --python units/assets.py        -> gen/assets/<name>.json

A file holds pal (the colours, "#rrggbb"), tris (nine numbers a triangle, in the scene's
axes: x east, y up, z south towards the viewer, one unit to the landmark models' unit)
and ci (each triangle's colour, as a place in pal). gen/assets.mjs lays them into a model.

In a Blender that is open, the same builders can be looked at before they are exported:
  import importlib.util; spec = importlib.util.spec_from_file_location("assets", ".../units/assets.py")
  A = importlib.util.module_from_spec(spec); spec.loader.exec_module(A); A.preview("trojan_horse")
"""
import importlib.util
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "gen", "assets")
R = math.radians


def _units():
    """units/build.py, for its figures."""
    spec = importlib.util.spec_from_file_location("tiny_units", os.path.join(HERE, "build.py"))
    mod = importlib.util.module_from_spec(spec)
    argv, sys.argv = sys.argv, [sys.argv[0]]   # it reads its own arguments; it has none here
    try:
        spec.loader.exec_module(mod)
    finally:
        sys.argv = argv
    return mod


def _lin(hexcol):
    c = hexcol.lstrip("#")
    rgb = [int(c[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in rgb]


def _hex(lin):
    out = []
    for v in lin[:3]:
        v = max(0.0, min(1.0, v))
        s = v * 12.92 if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055
        out.append(round(s * 255))
    return "#%02x%02x%02x" % tuple(out)


class Kit:
    """The objects of one model, in a collection of their own."""

    def __init__(self, name):
        self.name = "asset_" + name
        old = bpy.data.collections.get(self.name)
        if old:
            for o in list(old.objects):
                data = o.data
                bpy.data.objects.remove(o, do_unlink=True)
                if data and data.users == 0:
                    (bpy.data.meshes if isinstance(data, bpy.types.Mesh) else bpy.data.curves).remove(data)
            bpy.data.collections.remove(old)
        self.col = bpy.data.collections.new(self.name)
        bpy.context.scene.collection.children.link(self.col)
        self.n = 0

    def mat(self, col):
        name = "asset " + col
        m = bpy.data.materials.get(name)
        if not m:
            m = bpy.data.materials.new(name)
            m.diffuse_color = (*_lin(col), 1)
            m.roughness = 1
        return m

    def _link(self, data, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.0):
        self.n += 1
        ob = bpy.data.objects.new(f"{self.name}_{self.n}", data)
        ob.location = loc
        ob.rotation_euler = Euler(rot)
        self.col.objects.link(ob)
        if bevel:
            b = ob.modifiers.new("bevel", "BEVEL")
            b.width = bevel
            b.segments = 1
            b.limit_method = "ANGLE"
        return ob

    def _mesh(self, bm, cols):
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        for c in cols:
            me.materials.append(self.mat(c))
        return me

    def box(self, size, loc, col, rot=(0, 0, 0), bevel=0.0, taper=None):
        """A box by its size and the middle of it. taper: (x, y) the top is scaled by."""
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1)
        for v in bm.verts:
            k = taper if taper and v.co.z > 0 else (1, 1)
            v.co = Vector((v.co.x * size[0] * k[0], v.co.y * size[1] * k[1], v.co.z * size[2]))
        return self._link(self._mesh(bm, [col]), loc, rot, bevel)

    def cyl(self, r, depth, loc, col, axis="Z", r2=None, sides=16, rot=(0, 0, 0), bevel=0.0):
        """A round bar (or a cone, with r2) about an axis through loc."""
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=sides, radius1=r, radius2=r if r2 is None else r2, depth=depth)
        turn = {"Z": (0, 0, 0), "X": (0, R(90), 0), "Y": (R(-90), 0, 0)}[axis]
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Euler(turn).to_matrix())
        return self._link(self._mesh(bm, [col]), loc, rot, bevel)

    def ball(self, r, loc, col, seg=16, rings=10, rot=(0, 0, 0)):
        """A ball, or an egg: r is one radius or three."""
        r = (r, r, r) if isinstance(r, (int, float)) else r
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1)
        for v in bm.verts:
            v.co = Vector((v.co.x * r[0], v.co.y * r[1], v.co.z * r[2]))
        return self._link(self._mesh(bm, [col]), loc, rot)

    def lathe(self, profile, loc, cols, sides=16, axis="Z", rot=(0, 0, 0)):
        """A shape turned about an axis: profile is [(radius, distance along the axis), ...].
        cols: one colour, or several taken in turn round it (the staves of a barrel)."""
        cols = [cols] if isinstance(cols, str) else list(cols)
        bm = bmesh.new()
        rings = []
        for r, d in profile:
            ring = []
            for i in range(sides):
                a = math.tau * i / sides
                p = (math.cos(a) * r, math.sin(a) * r, d)
                if axis == "X":
                    p = (p[2], p[0], p[1])
                elif axis == "Y":
                    p = (p[0], p[2], p[1])
                ring.append(bm.verts.new(p) if r > 1e-6 or i == 0 else ring[0])
            rings.append(ring)
        for k in range(len(rings) - 1):
            a, b = rings[k], rings[k + 1]
            for i in range(sides):
                j = (i + 1) % sides
                vs = []
                for v in (a[i], a[j], b[j], b[i]):
                    if v not in vs:
                        vs.append(v)
                if len(vs) >= 3:
                    try:
                        f = bm.faces.new(vs)
                        f.material_index = i % len(cols)
                    except ValueError:
                        pass
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        return self._link(self._mesh(bm, cols), loc, rot)

    def tube(self, pts, r, col, sides=6):
        """A rope, a bough, a tail: a round line through the points."""
        cu = bpy.data.curves.new(self.name, "CURVE")
        cu.dimensions = "3D"
        cu.bevel_depth = r
        cu.bevel_resolution = max(0, sides // 4)
        cu.use_fill_caps = True
        sp = cu.splines.new("POLY")
        sp.points.add(len(pts) - 1)
        for p, q in zip(sp.points, pts):
            p.co = (*q, 1)
        cu.materials.append(self.mat(col))
        return self._link(cu)

    def sheet(self, w, h, nx, ny, loc, colour_of, rot=(0, 0, 0), sag=0.0):
        """A cloth hanging in the XZ plane, w wide and h tall, its top edge through loc, in nx by ny squares.
        colour_of(i, j) names each square's colour (j counts down from the top)."""
        bm = bmesh.new()
        cols, grid = [], []
        for j in range(ny + 1):
            row = []
            for i in range(nx + 1):
                u, v = i / nx - 0.5, j / ny
                row.append(bm.verts.new((u * w, -math.sin(v * math.pi) * sag, -v * h)))
            grid.append(row)
        for j in range(ny):
            for i in range(nx):
                c = colour_of(i, j)
                if c not in cols:
                    cols.append(c)
                for order in ((grid[j][i], grid[j + 1][i], grid[j + 1][i + 1], grid[j][i + 1]), (grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i], grid[j][i])):
                    try:
                        f = bm.faces.new(order)   # both faces, so that it shows from behind as well
                        f.material_index = cols.index(c)
                    except ValueError:
                        pass
        return self._link(self._mesh(bm, cols), loc, rot)

    def figure(self, opts, height, loc, turn=0.0, t=0.0, builder="human"):
        """One of the units' figures (units/build.py), standing `height` tall at loc and turned (degrees) from facing +x."""
        ub = _units()
        m = ub.Model()
        getattr(ub, builder)(m, t, opts)
        top = max(v[2] for v in m.verts)
        me = ub.mesh_of(m, self.name + "_figure", height / (top * ub.MV))
        return self._link(me, loc, (0, 0, R(turn)))

    # -- out --
    def triangles(self):
        """Everything in the collection as triangles in the scene's axes, with a palette."""
        dg = bpy.context.evaluated_depsgraph_get()
        pal, tris, ci = [], [], []
        for ob in self.col.objects:
            ev = ob.evaluated_get(dg)
            me = ev.to_mesh()
            me.calc_loop_triangles()
            mw = ob.matrix_world
            cols = []
            for slot in ob.material_slots:
                h = _hex(slot.material.diffuse_color) if slot.material else "#ff00ff"
                if h not in pal:
                    pal.append(h)
                cols.append(pal.index(h))
            for t in me.loop_triangles:
                for vi in t.vertices:
                    p = mw @ me.vertices[vi].co
                    tris += [round(p.x, 4), round(p.z, 4), round(-p.y, 4)]   # Blender's z is up and its -y is towards the viewer
                ci.append(cols[t.material_index] if cols else 0)
            ev.to_mesh_clear()
        return dict(pal=pal, tris=tris, ci=ci)

    def export(self, name):
        os.makedirs(OUT, exist_ok=True)
        data = self.triangles()
        with open(os.path.join(OUT, name + ".json"), "w") as fh:
            json.dump(data, fh, separators=(",", ":"))
        return len(data["ci"])


# ----------------------------------------------------------------- the models --
W1, W2, W3, WD = "#a8743f", "#8f5f33", "#c08a4e", "#4f321e"   # planks pale and dark, and the darkest wood
BRONZE, GOLD, ROPE, CLAY = "#c1803d", "#f0c040", "#d9c69a", "#b9794e"


def trojan_horse(k):
    """The wooden horse: a barrel of staves on four posts, a plank neck and a long head, on a wheeled sledge.
    It faces +x; its feet are on z = 0. About 1.1 long and 1.5 tall."""
    # The sledge: planks across two beams, four solid wheels with battens, a tow rope lying ahead.
    for i in range(10):
        k.box((0.1, 0.52, 0.034), (-0.45 + i * 0.1, 0, 0.237), W3 if i % 2 else W1, bevel=0.004)
    for sy in (-1, 1):
        k.box((1.06, 0.05, 0.05), (0, sy * 0.2, 0.196), W2, bevel=0.005)
    for sx in (-0.34, 0.34):
        k.cyl(0.02, 0.62, (sx, 0, 0.115), WD, "Y", sides=10)
        for sy in (-1, 1):
            k.cyl(0.115, 0.05, (sx, sy * 0.285, 0.115), W2, "Y", sides=22, bevel=0.006)
            k.cyl(0.036, 0.075, (sx, sy * 0.29, 0.115), BRONZE, "Y", sides=10)
            for a in (0, 90):
                k.box((0.21, 0.012, 0.03), (sx, sy * 0.313, 0.115), W3, rot=(0, R(a + 20), 0))
    k.tube([(0.52, 0.08, 0.2), (0.66, 0.1, 0.06), (0.85, 0.02, 0.02), (1.0, -0.09, 0.02), (1.16, -0.05, 0.02)], 0.012, ROPE)
    # Four legs: square posts, each with a knee band and a dark hoof, braced fore and aft.
    for sx in (-0.26, 0.27):
        for sy in (-0.115, 0.115):
            lean = R(-5 if sx > 0 else 4)
            k.box((0.075, 0.075, 0.44), (sx, sy, 0.47), W2, rot=(0, lean, 0), bevel=0.006)
            k.box((0.095, 0.095, 0.055), (sx - 0.018 * (1 if sx > 0 else -1), sy, 0.28), WD, bevel=0.006)
            k.box((0.09, 0.09, 0.04), (sx, sy, 0.5), W3, bevel=0.004)
    for sy in (-0.115, 0.115):
        k.box((0.5, 0.03, 0.035), (0.0, sy, 0.4), W1, bevel=0.003)
    # The belly: a barrel, its staves in three tones, three bronze hoops, and the trapdoor the Greeks came out of.
    k.lathe([(0.001, -0.42), (0.135, -0.41), (0.178, -0.2), (0.192, 0.0), (0.18, 0.2), (0.14, 0.41), (0.001, 0.42)], (0, 0, 0.83), (W1, W3, W2), sides=18, axis="X")
    for x, r in ((-0.27, 0.172), (0.0, 0.196), (0.27, 0.174)):
        k.cyl(r, 0.03, (x, 0, 0.83), BRONZE, "X", sides=18)
    k.box((0.2, 0.014, 0.15), (-0.04, -0.186, 0.82), WD, rot=(R(8), 0, 0), bevel=0.003)
    for x in (-0.11, 0.03):
        k.box((0.022, 0.02, 0.03), (x, -0.19, 0.9), BRONZE)
    # The neck: six slabs of plank stepping up and forward, a mane of short dark boards along the back of it.
    for i in range(6):
        u = i / 5
        k.box((0.2 - 0.045 * u, 0.17 - 0.03 * u, 0.085), (0.3 + 0.2 * u, 0, 0.93 + 0.36 * u), W1 if i % 2 else W3, rot=(0, R(-32), 0), bevel=0.005)
        k.box((0.035, 0.035, 0.11), (0.2 + 0.21 * u, 0, 1.02 + 0.37 * u), WD, rot=(0, R(-32), 0), bevel=0.003)
    # The head: a long wedge with a paler muzzle, a jaw, an eye ringed in bronze, pricked ears, a forelock.
    k.box((0.36, 0.125, 0.15), (0.64, 0, 1.33), W2, rot=(0, R(24), 0), bevel=0.008, taper=(0.82, 0.8))
    k.box((0.13, 0.11, 0.115), (0.8, 0, 1.25), W3, rot=(0, R(24), 0), bevel=0.008)
    k.box((0.26, 0.1, 0.03), (0.68, 0, 1.235), WD, rot=(0, R(24), 0), bevel=0.003)
    for sy in (-1, 1):
        k.cyl(0.03, 0.02, (0.56, sy * 0.062, 1.385), BRONZE, "Y", sides=12)
        k.cyl(0.017, 0.03, (0.56, sy * 0.066, 1.385), "#1d1826", "Y", sides=10)
        k.cyl(0.03, 0.11, (0.47, sy * 0.045, 1.5), W1, "Z", r2=0.004, sides=4, rot=(0, R(-12), 0))
        k.cyl(0.012, 0.02, (0.845, sy * 0.04, 1.26), "#1d1826", "Y", sides=8)
    k.box((0.05, 0.05, 0.08), (0.52, 0, 1.47), WD, rot=(0, R(24), 0), bevel=0.003)
    # A halter of rope, and a tail of rope ends.
    k.tube([(0.74, -0.07, 1.33), (0.75, -0.07, 1.23), (0.75, 0.07, 1.23), (0.74, 0.07, 1.33), (0.74, -0.07, 1.33)], 0.008, ROPE)
    k.tube([(0.74, -0.07, 1.3), (0.6, -0.085, 1.2), (0.45, -0.1, 1.04), (0.36, -0.14, 0.9)], 0.007, ROPE)
    for i in range(5):
        y = (i - 2) * 0.012
        k.tube([(-0.41, y, 0.9), (-0.5, y * 1.6, 0.93), (-0.56, y * 2.2, 0.8), (-0.575 - 0.01 * (i % 2), y * 2.6, 0.5 + 0.03 * (i % 3))], 0.011, ROPE if i % 2 else "#bfa877")
    # A ladder left against its side.
    for sx in (-0.2, -0.08):
        k.tube([(sx, -0.5, 0.02), (sx, -0.2, 0.74)], 0.012, W3)
    for j in range(5):
        u = (j + 0.6) / 5.4
        k.tube([(-0.2, -0.5 + 0.3 * u, 0.02 + 0.72 * u), (-0.08, -0.5 + 0.3 * u, 0.02 + 0.72 * u)], 0.009, W1)


def penelope(k):
    """Penelope at the loom: an upright loom with the shroud half woven, its warp weighted with clay,
    a basket of wool, and Penelope reaching up to the cloth. The loom faces -y (the viewer), 0.36 wide."""
    for sx in (-1, 1):
        k.box((0.032, 0.032, 0.47), (sx * 0.17, 0, 0.235), W2, bevel=0.004)
        k.box((0.05, 0.16, 0.026), (sx * 0.17, 0, 0.013), WD, bevel=0.004)
        k.box((0.02, 0.07, 0.02), (sx * 0.17, -0.03, 0.3), W1, rot=(R(35), 0, 0))
    k.cyl(0.02, 0.4, (0, 0, 0.455), W1, "X", sides=10)
    k.cyl(0.03, 0.3, (0, 0, 0.455), "#8a5fbf", "X", sides=12)   # the cloth already woven, rolled on the beam
    purple, gold, cream = "#8a5fbf", "#e8c35a", "#efe6d0"

    def weave(i, j):   # a border, a band of meander, a plain field
        if i in (0, 13) or j == 0:
            return gold
        if j in (3, 4) and (i + j) % 3 != 0:
            return gold if (i // 2 + j) % 2 else cream
        return purple if (i + j) % 7 else "#7a4fb0"
    k.sheet(0.28, 0.17, 14, 7, (0, -0.02, 0.44), weave)
    for i in range(15):   # the warp below the cloth, and its weights in two rows
        x = -0.133 + i * 0.019
        k.box((0.004, 0.004, 0.2), (x, -0.02 + (0.012 if i % 2 else 0), 0.17), cream)
        k.ball((0.011, 0.011, 0.016), (x, -0.02 + (0.012 if i % 2 else 0), 0.06 + (0.02 if i % 2 else 0)), CLAY, seg=8, rings=5)
    k.cyl(0.008, 0.37, (0, -0.045, 0.21), W1, "X", sides=8)
    k.cyl(0.007, 0.37, (0, 0.0, 0.13), W3, "X", sides=8)
    # A basket of wool and a stool.
    k.lathe([(0.001, 0), (0.05, 0), (0.075, 0.07), (0.07, 0.085), (0.001, 0.08)], (0.3, -0.1, 0), ("#c9a35a", "#b08a45"), sides=14)
    for dx, dy, c in ((0, 0, cream), (0.03, 0.02, purple), (-0.03, 0.015, gold), (0.005, -0.03, cream)):
        k.ball(0.028, (0.3 + dx, -0.1 + dy, 0.095), c, seg=8, rings=6)
    k.box((0.1, 0.1, 0.014), (-0.33, -0.2, 0.11), W1, bevel=0.003)
    for sx in (-1, 1):
        for sy in (-1, 1):
            k.cyl(0.01, 0.11, (-0.33 + sx * 0.035, -0.2 + sy * 0.035, 0.055), W2, sides=6)
    # Penelope, in profile to the viewer, her right hand at the cloth.
    k.figure(dict(tunic="blue", long=True, longhair=True, hair="hair", belt="gold", crown="gold", arms="rightup", still=True, skin="skin"), 0.36, (-0.2, -0.16, 0), turn=38)


def cyclops_body(k):
    """Polyphemus, a unit tall, facing -y (the viewer), without the arm he throws with: that is cyclops_arm,
    hung from the shoulder at x = +0.216, z = 0.693 and swung by the landmark's own animation."""
    k.figure(dict(tunic="hide", chest="tan", skin="tan", sleeve="tan", eye1=True, hair="hair", beard="hair", belt="wood2", still=True, noarm=1), 1.0, (0, 0, 0), turn=-90)


def cyclops_arm(k):
    """His throwing arm, hanging from the origin: upper arm, forearm and an open hand to hold a boulder."""
    tan = "#b9794e"
    k.tube([(0, 0, 0), (0.0, -0.012, -0.17)], 0.058, tan, sides=8)
    k.tube([(0.0, -0.012, -0.17), (0.0, -0.03, -0.315)], 0.047, tan, sides=8)
    k.ball(0.062, (0, 0, 0), tan, seg=10, rings=6)
    k.ball((0.052, 0.05, 0.056), (0.0, -0.034, -0.35), tan, seg=10, rings=6)


def bird_body(k):
    """A bronze bird of Stymphalos, without its wings: it flies towards -y (the viewer when unturned),
    its middle at the origin. The wings are bird_wing_l and bird_wing_r, hinged at x = -/+0.03."""
    dark, mid, pale = "#7a4e27", "#b9772f", "#e0a84a"
    k.ball((0.055, 0.13, 0.05), (0, 0, 0), mid, seg=12, rings=8)
    k.ball((0.045, 0.06, 0.038), (0, -0.04, -0.02), pale, seg=10, rings=6)            # the breast
    k.ball((0.038, 0.045, 0.036), (0, -0.14, 0.02), dark, seg=10, rings=6)            # the head
    k.cyl(0.016, 0.1, (0, -0.215, 0.012), GOLD, "Y", r2=0.002, sides=6, rot=(R(8), 0, R(180)))   # a long bronze beak
    for sx in (-1, 1):
        k.ball(0.009, (sx * 0.026, -0.155, 0.032), "#d02a1e", seg=6, rings=4)         # a red eye
    k.cyl(0.012, 0.05, (0, -0.13, 0.06), pale, "Z", r2=0.002, sides=4, rot=(R(-35), 0, 0))   # a crest
    for i in range(5):                                                                # the tail, a fan of five feathers
        a = (i - 2) * 0.24
        k.box((0.022, 0.13, 0.006), (math.sin(a) * 0.07, 0.17 + math.cos(a) * 0.02, 0.0), dark if i % 2 else mid, rot=(0, 0, -a))
    for sx in (-1, 1):                                                                # talons tucked under
        k.cyl(0.006, 0.05, (sx * 0.018, 0.02, -0.055), GOLD, "Y", sides=5)


def _wing(k, side):
    dark, mid, pale = "#7a4e27", "#b9772f", "#e0a84a"
    k.box((0.16, 0.085, 0.012), (side * 0.085, -0.005, 0.0), mid, bevel=0.003)        # the arm of the wing
    for i in range(7):                                                                 # flight feathers, longer towards the tip
        u = i / 6
        length = 0.11 + 0.07 * u
        k.box((0.03, length, 0.006), (side * (0.035 + 0.045 * i), 0.05 + length / 2 - 0.02, -0.002), dark if i % 2 else pale, rot=(0, 0, -side * (0.1 + 0.45 * u)))
    k.box((0.14, 0.03, 0.009), (side * 0.24, -0.02, 0.0), dark, rot=(0, 0, -side * 0.35))   # the leading edge to the tip


def bird_wing_r(k):
    """Its right wing, from the hinge at the origin out along +x."""
    _wing(k, 1)


def bird_wing_l(k):
    _wing(k, -1)


MODELS = dict(trojan_horse=trojan_horse, penelope=penelope, cyclops_body=cyclops_body, cyclops_arm=cyclops_arm, bird_body=bird_body, bird_wing_r=bird_wing_r, bird_wing_l=bird_wing_l)


def preview(name):
    """Build one model into the open scene, to be looked at. Returns its collection's name."""
    k = Kit(name)
    MODELS[name](k)
    return k.name


def clear(name):
    """Take a previewed model out of the scene again."""
    k = Kit(name)
    bpy.data.collections.remove(k.col)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    only = argv[argv.index("--only") + 1].split(",") if "--only" in argv else list(MODELS)
    for name in only:
        k = Kit(name)
        MODELS[name](k)
        print(f"asset {name}: {k.export(name)} triangles", flush=True)
        bpy.data.collections.remove(k.col)


if __name__ == "__main__":
    main()
