"""Put the finished picture together and cut it into the tile pyramid the site loads.

  python tiles.py                                   -> ../world/tiles and ../world/manifest.json
  python tiles.py --world ../world.next             the same, into another folder
  python tiles.py --preview x.png --at X,Y,W,H --level 8    one rectangle of the picture, for looking at
  python tiles.py --sheets [--world ../world.next]  only repack the sprite sheets (after gen/build.mjs --refresh or --overlays)

The picture has up to three levels of detail:

  base (4 picture pixels per map pixel)   the whole map, from paint.py (work/base)
  8 and 16                                round towns, landmarks and minor places, from detail.py (work/d8, work/d16)
  8, the open country                     all the rest of the land, painted afresh by detail.py --all (work/c8)
  8, corrections                          patches painted again after the render changed, by detail.py --over (work/f8)
  8, the minor places themselves          painted afresh from the render by minor.py (work/m8), laid over the rest

What this step adds to the paintings:

  * Sharpness. The model's pictures are a little soft at full size, so they are sharpened.
  * Colour. The model draws shapes well and drifts in colour (it likes its grass greener and its
    sea paler). So each painting keeps its own fine detail but takes its broad colour, the average
    over a few dozen pixels, from the level below it; the base takes it from the render.
  * The sea. Open water is not the model's. It is the render's own sea, enlarged with smooth
    contours and no new colours, so anything imagined out at sea is simply covered. Within a few
    pixels of the shore the painting decides where the waterline runs.
  * What each pixel is, in its alpha, for the viewer's animated water: 0 nothing, 254 sea, 253 river, 255 land.
  * Agreement between levels. Where a finer level exists, the coarser tiles above it are made from
    it by halving, so zooming in never changes what is there.
"""
import argparse
import json
import shutil
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

from paint import HERE, CELL, Render, gauss

TILE = 512
STORE = 1024   # detail paintings are kept in squares this size
SHORE = 12     # pixels from land within which the painting decides what is water
QUALITY = 80
BASE_COLOUR = (20.0, 0.85)    # blur in pixels, and how far to pull the base painting's broad colour to the render's
DETAIL_COLOUR = (14.0, 0.9)   # the same for a finer level against the level below
SHARPEN = (1.2, 0.9)          # the model's pictures are a little soft at full size: unsharp mask radius and amount


def up(t, k, mode="bicubic"):
    if mode == "nearest":
        return F.interpolate(t, scale_factor=k, mode="nearest")
    return F.interpolate(t, scale_factor=k, mode=mode, align_corners=False)


def recolour(img, ref, mask, sigma, amount):
    """Give img the broad colour of ref wherever mask is set, keeping img's own detail. (3, H, W) floats."""
    m = mask[None, None].float()
    den = gauss(m, sigma).clamp(min=1e-3)
    lo = lambda t: gauss(t[None] * m, sigma)[0] / den[0]
    return torch.where(mask[None], (img + amount * (lo(ref) - lo(img))).clamp(0, 1), img)


def sharpen(img):
    """Unsharp mask of a (3, H, W) float image."""
    sigma, amount = SHARPEN
    return (img + amount * (img - gauss(img[None], sigma)[0])).clamp(0, 1)


class Composer:
    """The base level: the painting on land, the render's sea round it."""

    def __init__(self, render, src, device):
        self.r = render
        self.dev = device
        self.k = render.k
        self.rgb = np.load(src / "paint.npy", mmap_mode="r")
        plan = torch.load(src / "plan.pt")
        self.paint = plan["paint"].numpy()
        self.rx, self.ry, self.rw, self.rh = plan["region"]
        p = render.pad
        self.kind = np.pad(render.kind, ((p, p + 2), (p, p)), mode="edge")

    def shown(self, X0, Y0, X1, Y1):
        """What the painter was shown for a rectangle (which may run off the picture's edge)."""
        r = self.r
        x0, y0, x1, y1 = max(0, X0), max(0, Y0), min(r.W, X1), min(r.H, Y1)
        if x0 >= x1 or y0 >= y1:
            return torch.zeros((3, Y1 - Y0, X1 - X0), device=self.dev)
        t = r.window(x0, y0, x1 - x0, y1 - y0)[None]
        return F.pad(t, (x0 - X0, X1 - x1, y0 - Y0, Y1 - y1), mode="replicate")[0]

    def block(self, x0, y0, w, h):
        """RGBA uint8 (h, w, 4) for a rectangle of the base picture."""
        r, k, dev = self.r, self.k, self.dev
        m = 64  # margin, so blurs and the shore band are right at the block's edge
        X0, Y0, X1, Y1 = x0 - m, y0 - m, x0 + w + m, y0 + h + m
        sx0, sy0 = X0 // k - 2, Y0 // k - 2
        sx1, sy1 = -(-X1 // k) + 2, -(-Y1 // k) + 2
        p = r.pad
        # Clamp the source rectangle to the padded arrays (the picture's border repeats outwards).
        ys = np.clip(np.arange(sy0, sy1) + p, 0, self.kind.shape[0] - 1)
        xs = np.clip(np.arange(sx0, sx1) + p, 0, self.kind.shape[1] - 1)
        kind = torch.from_numpy(self.kind[np.ix_(ys, xs)]).to(dev)
        rgb1 = torch.from_numpy(r.rgb[np.ix_(ys, xs)]).to(dev).permute(2, 0, 1).float() / 255
        ox, oy = X0 - sx0 * k, Y0 - sy0 * k
        H, W = Y1 - Y0, X1 - X0
        cut = lambda t: t[..., oy:oy + H, ox:ox + W]

        # What the render says each pixel is, with smooth outlines.
        cls = torch.stack([(kind == 255) | (kind == 253), kind == 254, kind == 0]).float()[None]
        soft = cut(gauss(up(cls, k), 1.5))[0]
        which = soft.argmax(0)
        land, empty = which == 0, which == 2
        river = cut(up((kind == 253).float()[None, None], k))[0, 0] > 0.5
        for c in r.cuts:  # landmarks standing in the sea are land too
            ix0, ix1 = max(X0, c["x"]), min(X1, c["x"] + c["w"])
            iy0, iy1 = max(Y0, c["y"]), min(Y1, c["y"] + c["h"])
            if ix0 < ix1 and iy0 < iy1:
                a = c["t"][3, iy0 - c["y"]:iy1 - c["y"], ix0 - c["x"]:ix1 - c["x"]].float() > 0.3
                land[iy0 - Y0:iy1 - Y0, ix0 - X0:ix1 - X0] |= a
        empty &= ~land
        near = F.max_pool2d(land[None, None].float(), 2 * SHORE + 1, 1, SHORE)[0, 0] > 0

        # The sea, enlarged: follow a smoothed version, but only ever use a colour the render has nearby.
        sea1 = (kind == 254).float()[None, None]
        num = gauss(up(rgb1[None] * sea1, k), 2.5)
        den = gauss(up(sea1, k), 2.5).clamp(min=1e-3)
        want = cut(num / den)[0]
        best = torch.full((H, W), 1e9, device=dev)
        sea_rgb = torch.zeros((3, H, W), device=dev)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                cand = cut(up(torch.roll(rgb1, (dy, dx), (1, 2))[None], k, "nearest"))[0]
                ok = cut(up(torch.roll(sea1, (dy, dx), (2, 3)), k, "nearest"))[0, 0]
                cost = ((cand - want) ** 2).sum(0) + (1 - ok) * 1e3
                better = cost < best
                best = torch.where(better, cost, best)
                sea_rgb = torch.where(better, cand, sea_rgb)

        # The painting, where there is one.
        ai = torch.zeros((3, H, W), device=dev)
        painted = torch.zeros((H, W), dtype=torch.bool, device=dev)
        ax0, ax1 = max(X0, self.rx), min(X1, self.rx + self.rw)
        ay0, ay1 = max(Y0, self.ry), min(Y1, self.ry + self.rh)
        if ax0 < ax1 and ay0 < ay1:
            src = np.ascontiguousarray(self.rgb[ay0 - self.ry:ay1 - self.ry, ax0 - self.rx:ax1 - self.rx])
            ai[:, ay0 - Y0:ay1 - Y0, ax0 - X0:ax1 - X0] = torch.from_numpy(src).to(dev).permute(2, 0, 1).float() / 255
            cy = (torch.arange(ay0, ay1, device=dev) - self.ry) // CELL
            cx = (torch.arange(ax0, ax1, device=dev) - self.rx) // CELL
            cells = torch.from_numpy(self.paint).to(dev)
            painted[ay0 - Y0:ay1 - Y0, ax0 - X0:ax1 - X0] = cells[cy][:, cx]
        if bool(painted.any()):
            ai = recolour(ai, self.shown(X0, Y0, X1, Y1), painted, *BASE_COLOUR)
        rr, gg, bb = ai
        mx, mn = ai.max(0).values, ai.min(0).values
        watery = (bb >= rr + 0.08) & (bb >= gg - 0.06) & (gg >= rr - 0.02) & ((mx - mn) > 0.2 * mx)
        if bool(painted.any()):
            ai = sharpen(ai)

        sea = ~empty & (~painted | (~land & (~near | watery)))
        s = gauss(sea[None, None].float(), 0.8)[0, 0]
        out = ai * (1 - s) + sea_rgb * s
        alpha = torch.full((H, W), 255, dtype=torch.uint8, device=dev)
        alpha[river & watery & land] = 253
        alpha[s > 0.5] = 254
        alpha[empty] = 0
        out = torch.cat([(out.clamp(0, 1) * 255 + 0.5).byte(), alpha[None]])
        return out[:, m:m + h, m:m + w].permute(1, 2, 0).cpu().numpy()


class Store:
    """A finer painting, kept as squares: RGB is the painting, alpha how much of it to use (0 none)."""

    def __init__(self, folder):
        self.dir = Path(folder)
        self.have = {tuple(int(v) for v in f.stem.split("_")) for f in self.dir.glob("*.png")} if self.dir.exists() else set()
        self.cache = {}

    def put(self, tx, ty, rgba):
        self.dir.mkdir(parents=True, exist_ok=True)
        Image.fromarray(rgba).save(self.dir / f"{tx}_{ty}.png", compress_level=1)
        self.have.add((tx, ty))
        self.cache[(tx, ty)] = rgba

    def blend(self, x0, y0, rgba):
        """Lay a patch over what is stored, wherever the patch is the more opaque of the two."""
        h, w = rgba.shape[:2]
        for ty in range(y0 // STORE, (y0 + h - 1) // STORE + 1):
            for tx in range(x0 // STORE, (x0 + w - 1) // STORE + 1):
                old = self.get(tx, ty)
                sq = old.copy() if old is not None else np.zeros((STORE, STORE, 4), np.uint8)
                ax0, ay0 = max(x0, tx * STORE), max(y0, ty * STORE)
                ax1, ay1 = min(x0 + w, tx * STORE + STORE), min(y0 + h, ty * STORE + STORE)
                dst = sq[ay0 - ty * STORE:ay1 - ty * STORE, ax0 - tx * STORE:ax1 - tx * STORE]
                src = rgba[ay0 - y0:ay1 - y0, ax0 - x0:ax1 - x0]
                dst[:] = np.where(src[..., 3:] > dst[..., 3:], src, dst)
                self.put(tx, ty, sq)

    def get(self, tx, ty):
        if (tx, ty) not in self.have:
            return None
        if (tx, ty) not in self.cache:
            if len(self.cache) > 48:
                self.cache.pop(next(iter(self.cache)))
            self.cache[(tx, ty)] = np.array(Image.open(self.dir / f"{tx}_{ty}.png").convert("RGBA"))
        return self.cache[(tx, ty)]

    def read(self, x0, y0, w, h):
        """(h, w, 4) uint8, zeros where nothing was painted; None if the rectangle is empty."""
        out = None
        for ty in range(y0 // STORE, (y0 + h - 1) // STORE + 1):
            for tx in range(x0 // STORE, (x0 + w - 1) // STORE + 1):
                t = self.get(tx, ty)
                if t is None:
                    continue
                if out is None:
                    out = np.zeros((h, w, 4), np.uint8)
                ax0, ay0 = max(x0, tx * STORE), max(y0, ty * STORE)
                ax1, ay1 = min(x0 + w, tx * STORE + STORE), min(y0 + h, ty * STORE + STORE)
                out[ay0 - y0:ay1 - y0, ax0 - x0:ax1 - x0] = t[ay0 - ty * STORE:ay1 - ty * STORE, ax0 - tx * STORE:ax1 - tx * STORE]
        return out


class Picture:
    """The finished picture at any level of detail d (picture pixels per map pixel)."""

    def __init__(self, comp, stores, device, patches=None, country=None, fixes=None):
        self.comp = comp
        self.base = comp.k
        self.stores = stores  # {8: Store, 16: Store}: the places, redrawn from the level below
        self.country = country or {}  # {8: Store}: the land between them, painted afresh up to the places' edges
        self.fixes = fixes or {}  # {8: Store}: patches painted again later, over all of that
        self.patches = patches or {}  # {8: Store}: the minor places, painted afresh (minor.py)
        self.dev = device

    def block(self, d, x0, y0, w, h):
        """RGBA uint8 (h, w, 4). For d above the base, x0, y0, w and h must be even."""
        if d == self.base:
            return self.comp.block(x0, y0, w, h)
        # Work on a larger rectangle, so the colour of a tile does not depend on where its edges fall.
        g = 48
        X0, Y0, Wd, Hd = x0 - g, y0 - g, w + 2 * g, h + 2 * g
        m = 4
        c = self.block(d // 2, X0 // 2 - m, Y0 // 2 - m, Wd // 2 + 2 * m, Hd // 2 + 2 * m)
        t = torch.from_numpy(c).to(self.dev).permute(2, 0, 1).float()
        crop = lambda v: v[..., 2 * m:2 * m + Hd, 2 * m:2 * m + Wd]
        # Where nothing finer was painted, the level below shows through enlarged with hard pixels,
        # exactly as the viewer would enlarge it; halving it again gives back what was there.
        rgb = crop(up(t[None, :3] / 255, 2, "nearest"))[0]
        a = t[3]
        cls = torch.stack([a == 255, a == 253, a == 254, a == 0]).float()[None]
        which = crop(up(cls, 2, "bilinear"))[0].argmax(0)   # but coastlines are smoothed, not stepped
        alpha = torch.tensor([255, 253, 254, 0], dtype=torch.uint8, device=self.dev)[which]
        sea = which >= 2
        # The country goes over the places: it was painted with them held still, so it is the one that
        # fades out where they meet (it stops a few cells inside each place's edge).
        for st, redrawn in ((self.stores.get(d), True), (self.country.get(d), True), (self.fixes.get(d), True), (self.patches.get(d), False)):
            fine = st.read(X0, Y0, Wd, Hd) if st else None
            if fine is None:
                continue
            f = torch.from_numpy(fine).to(self.dev).permute(2, 0, 1).float() / 255
            wgt = f[3] * (~sea).float()
            got = f[3] > 0.02
            if bool(got.any()):
                # A patch shows something the level below does not, so it keeps its own colours.
                img = sharpen(recolour(f[:3], rgb, got, *DETAIL_COLOUR) if redrawn else f[:3])
                rgb = rgb * (1 - wgt) + img * wgt
        out = torch.cat([(rgb * 255 + 0.5).byte(), alpha[None]])
        return out[:, g:g + h, g:g + w].permute(1, 2, 0).cpu().numpy()


def halve(a):
    """Half-size RGBA: the average colour of what is there, and the commonest kind."""
    h, w = a.shape[:2]
    if h % 2 or w % 2:
        a = np.pad(a, ((0, h % 2), (0, w % 2), (0, 0)), mode="edge")
        h, w = a.shape[:2]
    q = a.reshape(h // 2, 2, w // 2, 2, 4).transpose(0, 2, 1, 3, 4).reshape(h // 2, w // 2, 4, 4)
    al = q[..., 3]
    there = al > 0
    n = there.sum(-1)
    rgb = (q[..., :3].astype(np.uint16) * there[..., None]).sum(2) // np.maximum(n, 1)[..., None]
    water = ((al == 254) | (al == 253)).sum(-1)
    alpha = np.where(n < 2, 0, np.where(water * 2 >= n, 254, 255)).astype(np.uint8)
    return np.concatenate([rgb.astype(np.uint8), alpha[..., None]], -1)


def save_tile(a, path):
    if a[..., 3].min() == 255:
        Image.fromarray(a[..., :3]).save(path, "WEBP", quality=QUALITY, method=4, use_sharp_yuv=True)
    else:
        Image.fromarray(a).save(path, "WEBP", quality=QUALITY, method=4, alpha_quality=100, exact=False, use_sharp_yuv=True)
    return path.stat().st_size


def open_picture(device, base="work/base", render=None, country="work/c8"):
    render = render or Render(HERE / "work" / "cond", 3.0, 1.0, device)
    comp = Composer(render, HERE / base, device)
    stores = {d: Store(HERE / "work" / f"d{d}") for d in (8, 16)}
    patches = {8: Store(HERE / "work" / "m8")}
    lands = {8: Store(HERE / country)}
    fixes = {8: Store(HERE / "work" / "f8")}
    some = lambda m: {d: s for d, s in m.items() if s.have}
    return render, Picture(comp, some(stores), device, some(patches), some(lands), some(fixes))


def pack_sheets(world, man, lap):
    """The sprite sheets and the height tiles shrink as lossless WebP (the sheets to about half)."""
    saved = 0
    sheets = [man.get("sprites")] + list(man.get("animPages") or []) + list((man.get("units") or {}).get("pages") or [])
    for pg in sheets:
        src = world / pg["file"] if pg else None
        if not src or src.suffix != ".png" or not src.exists():
            continue
        dst = src.with_suffix(".webp")
        Image.open(src).save(dst, "WEBP", lossless=True, method=6, exact=True)
        saved += src.stat().st_size - dst.stat().st_size
        src.unlink()
        pg["file"] = dst.name
    occ = man.get("occ")
    if occ and occ.get("ext") == "png":
        for src in sorted((world / occ["dir"]).glob("*.png")):
            dst = src.with_suffix(".webp")
            Image.open(src).convert("L").save(dst, "WEBP", lossless=True, method=6, exact=True)
            saved += src.stat().st_size - dst.stat().st_size
            src.unlink()
        occ["ext"] = "webp"
    lap(f"sprite sheets and height tiles: {saved / 1e6:.1f} MB saved")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheets", action="store_true", help="only repack the sprite sheets and height tiles of a finished world")
    ap.add_argument("--src", default="work/base")
    ap.add_argument("--world", default="../world")
    ap.add_argument("--preview", help="write one PNG of a rectangle instead of tiles")
    ap.add_argument("--at", help="X,Y,W,H of the preview, in pixels of its level")
    ap.add_argument("--level", type=int, default=4)
    ap.add_argument("--device", default="cuda")
    ap.add_argument("--country", default="work/c8", help="the open country's level-8 painting, if there is one")
    args = ap.parse_args()
    t0 = time.time()
    lap = lambda s: print(f"{time.time() - t0:7.1f}s  {s}", flush=True)
    if args.sheets:
        world = (HERE / args.world).resolve()
        mf = world / "manifest.json"
        man = json.loads(mf.read_text())
        pack_sheets(world, man, lap)
        man["version"] = format(int(time.time() * 1000), "x")
        mf.write_text(json.dumps(man, separators=(",", ":")))
        return
    render, pic = open_picture(args.device, args.src, country=args.country)
    comp = pic.comp
    k = render.k
    W, H = render.w1 * k, render.h1 * k

    if args.preview:
        x, y, w, h = (int(v) // 2 * 2 for v in args.at.split(",")) if args.at else (comp.rx, comp.ry, comp.rw, comp.rh)
        a = pic.block(args.level, x, y, w, h)
        bg = np.array([21, 18, 46], np.uint8)
        Image.fromarray(np.where(a[..., 3:] > 0, a[..., :3], bg)).save(HERE / args.preview)
        lap(f"wrote {args.preview}")
        return

    world = (HERE / args.world).resolve()
    tiles = world / "tiles"
    shutil.rmtree(tiles, ignore_errors=True)
    total, count = 0, 0

    def put(a, level, tx, ty):
        nonlocal total, count
        d = tiles / str(level)
        d.mkdir(parents=True, exist_ok=True)
        total += save_tile(a, d / f"{tx}_{ty}.webp")
        count += 1

    # --- The finer levels, only where something was painted -------------------------------
    fine = sorted(set(pic.stores) | set(pic.country) | set(pic.fixes), reverse=True)   # e.g. [16, 8]
    nfine = len(fine)
    levels, held = [], {}                              # held: halved tiles waiting for the level above
    sets = {}
    for d in fine:
        s = set()
        for st in (pic.stores.get(d), pic.country.get(d), pic.fixes.get(d), pic.patches.get(d)):
            for (tx, ty) in (st.have if st else ()):
                t = st.get(tx, ty)
                for b in range(STORE // TILE):
                    for a in range(STORE // TILE):
                        if t[b * TILE:(b + 1) * TILE, a * TILE:(a + 1) * TILE, 3].max() > 0:
                            s.add((tx * (STORE // TILE) + a, ty * (STORE // TILE) + b))
        sets[d] = s
    for i, d in enumerate(fine):                       # a tile exists wherever a finer one does
        if i > 0:
            sets[d] |= {(x // 2, y // 2) for (x, y) in sets[fine[i - 1]]}
    for i, d in enumerate(fine):
        f = d // k
        lw, lh = W * f, H * f
        below, held = held, {}
        for n, (tx, ty) in enumerate(sorted(sets[d], key=lambda t: (t[1], t[0]))):
            x0, y0 = tx * TILE, ty * TILE
            w, h = min(TILE, lw - x0), min(TILE, lh - y0)
            if w <= 0 or h <= 0:
                continue
            a = pic.block(d, x0, y0, w, h)
            for cy in (0, 1):                           # where finer tiles exist, this one is made from them
                for cx in (0, 1):
                    q = below.pop((tx * 2 + cx, ty * 2 + cy), None)
                    if q is not None:
                        a[cy * 256:cy * 256 + q.shape[0], cx * 256:cx * 256 + q.shape[1]] = q
            put(a, i, tx, ty)
            held[(tx, ty)] = halve(a)
            if n % 200 == 199:
                lap(f"detail {d}: {n + 1}/{len(sets[d])} tiles")
        levels.append({"w": lw, "h": lh, "cols": -(-lw // TILE), "rows": -(-lh // TILE), "tiles": sorted(f"{x}_{y}" for x, y in sets[d])})
        lap(f"detail {d}: {len(sets[d])} tiles")

    # --- The base level in strips; the level above is assembled in memory as the strips go by -----
    def cut_tiles(a, level, row0):
        for ty in range(0, a.shape[0], TILE):
            for tx in range(0, a.shape[1], TILE):
                put(a[ty:ty + TILE, tx:tx + TILE], level, tx // TILE, row0 + ty // TILE)

    STRIP, BLOCK = 2048, 4096
    one = np.zeros((-(-H // 2), -(-W // 2), 4), np.uint8)
    for y in range(0, H, STRIP):
        h = min(STRIP, H - y)
        strip = np.concatenate([comp.block(x, y, min(BLOCK, W - x), h) for x in range(0, W, BLOCK)], 1)
        for (tx, ty), q in held.items():                # made from the finer level where there is one
            qx, qy = tx * 256, ty * 256 - y
            if qy + q.shape[0] <= 0 or qy >= h:
                continue
            sy0, sy1 = max(0, qy), min(h, qy + q.shape[0])
            strip[sy0:sy1, qx:qx + q.shape[1]] = q[sy0 - qy:sy1 - qy, :strip.shape[1] - qx]
        cut_tiles(strip, nfine, y // TILE)
        half = halve(strip)
        one[y // 2:y // 2 + half.shape[0], :half.shape[1]] = half[:, :one.shape[1]]
        lap(f"rows {y}..{y + h} of {H}")
    levels.append({"w": W, "h": H, "cols": -(-W // TILE), "rows": -(-H // TILE)})
    cur, lv = one, nfine + 1
    while True:
        cut_tiles(cur, lv, 0)
        levels.append({"w": cur.shape[1], "h": cur.shape[0], "cols": -(-cur.shape[1] // TILE), "rows": -(-cur.shape[0] // TILE)})
        if cur.shape[0] <= TILE and cur.shape[1] <= TILE:
            break
        cur, lv = halve(cur), lv + 1
    lap(f"{count} tiles, {total / 1e6:.0f} MB, {len(levels)} levels")

    mf = world / "manifest.json"
    man = json.loads(mf.read_text())
    man["version"] = format(int(time.time() * 1000), "x")
    man["paint"] = {"detail": k * 2 ** nfine, "base": k, "ext": "webp", "tile": TILE, "levels": levels}

    pack_sheets(world, man, lap)
    mf.write_text(json.dumps(man, separators=(",", ":")))
    lap("manifest updated")


if __name__ == "__main__":
    main()
