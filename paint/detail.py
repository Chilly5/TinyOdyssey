"""Paint the places worth a closer look at a finer level of detail.

The base painting covers the whole map at 4 picture pixels per map pixel. Towns,
landmarks and the minor places are painted again here at 8, and their cores at 16,
so that zooming in on them keeps showing something new.

  python detail.py --level 8              round every place in work/spots.json, into work/d8
  python detail.py --level 16             their cores, from the level-8 picture, into work/d16
  python detail.py --level 8 --all        the open country between the places, into work/c8
  python detail.py --level 8 --all --over --box X,Y,W,H    one rectangle of land again, into work/f8
  python detail.py --level 8 --only athens,marathon --plan

Each level is drawn from the finished picture one level below it (see tiles.py):
the model is shown that picture enlarged twice and softened, and told to redraw
it sharp without moving anything. Otherwise the method is paint.py's: one shared
canvas, overlapping 1024-pixel windows on two staggered grids, their answers
averaged, and everything outside the chosen places held still. Here the canvas
is far too large to keep whole, so it is kept in small blocks, only where needed.

The open country (--all) is done differently. Redrawn from an enlargement it only
comes back smoother: the model copies the softness it is shown, or, given more
freedom, invents things. So it is painted afresh from the render, exactly as the
base was but at twice the scale, where a tree is twice as many pixels across and
gets twice the cubes. The places already painted are held as they stand, so the
new country grows up to them without a join. Run it after the places' level 8.

--over is for putting right a patch of the map after the render under it has changed
(a place moved, a road rerouted): everything on land inside --box is painted afresh
from the render as it now is, places and all, grown into the finished picture round
it, and kept in work/f8, which is laid over the rest.

Needs: gen/build.mjs --cond and --spots, paint.py, and for level 16 a finished level 8.
"""
import argparse
import json
import math
import time

import numpy as np
import torch
import torch.nn.functional as F

from paint import HERE, CELL, WIN, STRIDE, SHIFT, STEPS, Painter, Render, gauss, tent
from paint import PROMPT as PAINT, SNOW
from tiles import STORE, Store, open_picture, up

PROMPT = (
    "Redraw this picture as detailed voxel art in crisp pixels: a 3D model built from tiny cubes, like MagicaVoxel, "
    "seen from above through an orthographic camera. The picture is an enlargement and is soft. Redraw it sharp, "
    "keeping every object exactly where it is, with the same shape, size and colour, and adding nothing new. Give each "
    "thing finer cubes and more detail: roof tiles, doors, windows, stone blocks, steps, paving stones, leaves and "
    "trunks, ledges and cracks in rock, faces and clothes on people. Hard square edges and flat faces. Everything is "
    "in sharp focus from top to bottom: no depth of field, no blur, no haze, no gradients, no text."
)
BLOCK = 32   # the canvas is kept in squares of this many cells


class Sparse:
    """A (C, H, W) array far too large to hold, kept as squares only where something was written."""

    def __init__(self, c, dtype=torch.float32):
        self.c, self.dtype, self.b = c, dtype, {}

    def _parts(self, y, x, h, w):
        for by in range(y // BLOCK, (y + h - 1) // BLOCK + 1):
            for bx in range(x // BLOCK, (x + w - 1) // BLOCK + 1):
                y0, x0 = max(y, by * BLOCK), max(x, bx * BLOCK)
                y1, x1 = min(y + h, by * BLOCK + BLOCK), min(x + w, bx * BLOCK + BLOCK)
                yield (by, bx), slice(y0 - by * BLOCK, y1 - by * BLOCK), slice(x0 - bx * BLOCK, x1 - bx * BLOCK), slice(y0 - y, y1 - y), slice(x0 - x, x1 - x)

    def read(self, y, x, h, w):
        out = torch.zeros((self.c, h, w), dtype=torch.float32)
        for key, sy, sx, dy, dx in self._parts(y, x, h, w):
            if key in self.b:
                out[:, dy, dx] = self.b[key][:, sy, sx].float()
        return out

    def _block(self, key):
        if key not in self.b:
            self.b[key] = torch.zeros((self.c, BLOCK, BLOCK), dtype=self.dtype)
        return self.b[key]

    def write(self, y, x, t):
        for key, sy, sx, dy, dx in self._parts(y, x, t.shape[1], t.shape[2]):
            self._block(key)[:, sy, sx] = t[:, dy, dx].to(self.dtype)

    def add(self, y, x, t):
        for key, sy, sx, dy, dx in self._parts(y, x, t.shape[1], t.shape[2]):
            self._block(key)[:, sy, sx] += t[:, dy, dx].to(self.dtype)


def lattice(n, first):
    """Window origins along an axis of n cells: every STRIDE cells, from `first`."""
    return list(range(first - STRIDE if first else 0, max(1, n - WIN + STRIDE), STRIDE))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--level", type=int, required=True, help="8 or 16")
    ap.add_argument("--only", help="comma-separated place ids")
    ap.add_argument("--all", action="store_true", help="level 8 only: the open country, all the land outside the places, into work/c8")
    ap.add_argument("--box", help="X,Y,W,H in map pixels: paint only inside this rectangle")
    ap.add_argument("--over", action="store_true", help="with --all and --box: paint that rectangle again over the finished picture, into work/f8")
    ap.add_argument("--start", type=int, help="first denoising step to run (0 is from pure noise; 2, the default for the places, keeps closest to the level below)")
    ap.add_argument("--soft", type=float, default=1.2, help="blur of the enlarged picture the model is shown, pixels")
    ap.add_argument("--out", help="where to write (default work/d<level>)")
    ap.add_argument("--seed", type=int, default=11)
    ap.add_argument("--plan", action="store_true", help="only count the windows and stop")
    ap.add_argument("--decode-only", action="store_true", help="skip the painting and decode the canvas kept from the last run")
    ap.add_argument("--resume", action="store_true", help="carry on from the last finished step of an interrupted run")
    args = ap.parse_args()
    if args.start is None:
        args.start = 0 if args.all else 2
    fresh = args.all   # painted from the render, not redrawn from the level below
    d = args.level
    dev = "cuda"
    t0 = time.time()
    lap = lambda s: print(f"{time.time() - t0:7.1f}s  {s}", flush=True)

    render = Render(HERE / "work" / "cond", 3.0, 1.0, dev)
    W, H = render.w1 * d, render.h1 * d
    cw, ch = W // CELL, -(-H // CELL)
    per = CELL / d   # map pixels per cell

    # --- Where to paint: round the places, on land -----------------------------------------
    spots = json.loads((HERE / "work" / "spots.json").read_text())["spots"]
    only = set(args.only.split(",")) if args.only else None
    my, mx = (np.arange(ch) + 0.5) * per, (np.arange(cw) + 0.5) * per   # cell centres, in map pixels
    mask = np.zeros((ch, cw), bool)
    n = 0
    for s in spots:
        if (only and s["id"] not in only) or not (s["r"] or s["wide"]):
            continue
        n += 1
        if d == 8:
            rr, pad = max(s["rt"], s["wide"]) + 20, 22
        else:
            rr, pad = (max(s["rt"] * 0.85, s["wide"]) if s["town"] else max(s["r"] * 0.75, s["wide"])) + 6, 8
        box = (slice(max(0, int((s["y"] - max(s["top"], rr) - pad) / per)), int((s["y"] + max(s["bot"], rr) + pad) / per) + 1),
               slice(max(0, int((s["x"] - rr - pad) / per)), int((s["x"] + rr + pad) / per) + 1))
        dy, dx = (my[box[0]] - s["y"])[:, None], (mx[box[1]] - s["x"])[None, :]
        town = (dx / rr) ** 2 + (dy / (rr * 0.62 + 6)) ** 2 <= 1                      # its levelled ground, as the camera sees it
        model = (np.abs(dx) <= s["wide"] + pad) & (dy >= -s["top"] - pad) & (dy <= s["bot"] + pad)   # and the landmark standing on it
        mask[box] |= town | model
    land = (render.kind == 255) | (render.kind == 253)
    for c in render.cuts:   # landmarks that stand in the sea
        land[c["y"] // render.k:(c["y"] + c["h"]) // render.k + 1, c["x"] // render.k:(c["x"] + c["w"]) // render.k + 1] = True
    land = F.max_pool2d(torch.from_numpy(land)[None, None].float(), 7, 1, 3)[0, 0] > 0   # and a little way out, for the shore
    iy = np.minimum(my.astype(int), land.shape[0] - 1)
    ix = np.minimum(mx.astype(int), land.shape[1] - 1)
    mask &= land.numpy()[np.ix_(iy, ix)]
    name = "d"
    if args.all:
        # The open country: all the land, less the middles of the places already painted. The two
        # paintings overlap by a few cells, over which the places' own fades in (see tiles.py).
        if d != 8 or only:
            raise SystemExit("--all is for level 8, without --only")
        name = "c"
        inner = -F.max_pool2d(-torch.from_numpy(mask)[None, None].float(), 11, 1, 5)[0, 0] > 0
        mask = land.numpy()[np.ix_(iy, ix)] & ~inner.numpy()
        if args.over:   # a correction: all the land in the box, whatever stands there
            if not args.box:
                raise SystemExit("--over needs --box")
            name = "f"
            mask = land.numpy()[np.ix_(iy, ix)].copy()
    if args.box:
        bx, by, bw, bh = (float(v) for v in args.box.split(","))
        inside = ((my >= by) & (my < by + bh))[:, None] & ((mx >= bx) & (mx < bx + bw))[None, :]
        mask &= inside

    ii =np.pad(mask.astype(np.int32).cumsum(0).cumsum(1), ((1, 0), (1, 0)))
    count = lambda y, x: int(ii[min(ch, y + WIN), min(cw, x + WIN)] - ii[max(0, y), min(cw, x + WIN)] - ii[min(ch, y + WIN), max(0, x)] + ii[max(0, y), max(0, x)])
    grids, covers = [], []
    for first in (0, SHIFT):
        wins = [(wy, wx) for wy in lattice(ch, first) for wx in lattice(cw, first) if count(wy, wx)]
        cover = np.zeros((ch, cw), bool)
        for wy, wx in wins:
            cover[max(0, wy):wy + WIN, max(0, wx):wx + WIN] = True
        grids.append(wins)
        covers.append(cover)
    paint = mask & covers[0] & covers[1]
    steps = STEPS - args.start
    calls = sum(len(grids[(args.start + i) % 2]) for i in range(steps))
    S_ = STORE // CELL
    nsq = sum(bool(paint[ty * S_:(ty + 1) * S_, tx * S_:(tx + 1) * S_].any()) for ty in range(ch // S_ + 1) for tx in range(cw // S_ + 1))
    lap(f"level {d}: {'open country' if args.all else f'{n} places'}, {int(paint.sum()) * per * per / 1e6:.2f} M map pixels, "
        f"windows {len(grids[0])} + {len(grids[1])}, {steps} steps, {calls} model calls, {nsq} squares to decode, "
        f"about {(calls * 1.32 + nsq * 0.6) / 3600:.1f} hours")
    if args.plan:
        return
    _, pic = open_picture(dev, render=render, country="work/c8" if args.over or not fresh else "work/none")
    if d // 2 != render.k and d // 2 not in pic.stores:
        raise SystemExit(f"level {d} is drawn from level {d // 2}, which has not been painted yet")
    # How much of the painting to use at each cell: all of it inside, fading out over the last cell or two.
    pt = torch.from_numpy(paint)[None, None].float()
    wcell = F.avg_pool2d(-F.max_pool2d(-pt, 3, 1, 1), 3, 1, 1)[0, 0]

    painter = Painter(dev)
    kept = HERE / (f"{args.out}_canvas.pt" if args.out else f"work/{name}{d}_canvas.pt")
    if not args.decode_only:
        texts = [PAINT, PAINT + SNOW] if fresh else [PROMPT]
        enc = painter.encode_prompts(texts)
        embs = [(enc[p][0].to(dev), enc[p][1].to(dev)) for p in texts]
        emb, tid = embs[0]
        painter.load_transformer()
        sig = painter.sigmas()
        lap("model ready, sigmas " + " ".join(f"{s:.3f}" for s in sig))

    def shown(y, x, h, w):
        """The picture one level down for a rectangle of cells, enlarged and softened: (3, 16h, 16w)."""
        a = pic.block(d // 2, x * CELL // 2 - 8, y * CELL // 2 - 8, w * CELL // 2 + 16, h * CELL // 2 + 16)
        t = torch.from_numpy(a[..., :3]).to(dev).permute(2, 0, 1)[None].float() / 255
        return gauss(up(t, 2).clamp(0, 1), args.soft)[0, :, 16:-16, 16:-16]

    fk = d // render.k

    def rendered(y, x, h, w):
        """The render for a rectangle of cells, enlarged to this level: what a fresh painting is made from."""
        X0, Y0 = x * CELL // fk, y * CELL // fk
        return up(pic.comp.shown(X0, Y0, X0 + w * CELL // fk, Y0 + h * CELL // fk)[None], fk).clamp(0, 1)[0]

    def standing(y, x, h, w):
        """The picture as it stands at this level, for the same rectangle."""
        a = pic.block(d, x * CELL, y * CELL, w * CELL, h * CELL)
        return torch.from_numpy(a[..., :3]).to(dev).permute(2, 0, 1).float() / 255

    def snowy(y, x, h, w):
        X0, Y0 = max(0, x * CELL // fk), max(0, y * CELL // fk)
        return render.snowy(X0, Y0, w * CELL // fk, h * CELL // fk)

    def cells(arr, y, x, h, w):
        """A rectangle of a whole-canvas array, with zeros beyond its edges."""
        out = torch.zeros((h, w), dtype=arr.dtype)
        y0, x0, y1, x1 = max(0, y), max(0, x), min(ch, y + h), min(cw, x + w)
        if y0 < y1 and x0 < x1:
            out[y0 - y:y1 - y, x0 - x:x1 - x] = arr[y0:y1, x0:x1]
        return out

    paint_t = torch.from_numpy(paint)
    lat, have = Sparse(128, torch.float16), Sparse(1, torch.bool)
    OFF = 4096   # windows may start a little before the canvas; blocks are indexed from here
    first = args.start
    if args.decode_only or args.resume:
        ck = torch.load(kept)
        if "lat" in ck:   # kept after every step: {"step": steps finished, "lat": ..., "have": ...}
            lat.b, have.b, first = ck["lat"], ck["have"], ck["step"]
        else:
            lat.b, first = ck, STEPS
        lap(f"canvas loaded, {first} of {STEPS} steps done")
    if not args.decode_only:
        wgt = tent(WIN, 16)
        wgt = wgt[:, None] * wgt[None, :]
        s_first = float(sig[args.start])
        for i in range(first, STEPS):
            s0, s1 = float(sig[i]), float(sig[i + 1])
            vel, wsum = Sparse(128, torch.float16), Sparse(1)
            wins = grids[i % 2]
            tick = time.time()
            for nwin, (wy, wx) in enumerate(wins):
                pm = cells(paint_t, wy, wx, WIN, WIN).to(dev)
                if fresh:   # shown the render; everything not being painted is held at the picture as it stands
                    ref = painter.encode(rendered(wy, wx, WIN, WIN))
                    still = ref if bool(pm.all()) else painter.encode(standing(wy, wx, WIN, WIN))
                    emb, tid = embs[1 if snowy(wy, wx, WIN, WIN) else 0]
                else:
                    ref = still = painter.encode(shown(wy, wx, WIN, WIN))
                x = lat.read(wy + OFF, wx + OFF, WIN, WIN).to(dev)
                got = have.read(wy + OFF, wx + OFF, WIN, WIN)[0].to(dev) > 0
                if not bool(got.all()):   # first visit: start from the picture itself, mostly noise
                    g = torch.Generator(device=dev).manual_seed(args.seed * 1000003 + wy * 7919 + wx)
                    new = (1 - s_first) * still + s_first * torch.randn(ref.shape, generator=g, device=dev)
                    x = torch.where(got, x, new)
                    lat.write(wy + OFF, wx + OFF, x.cpu())
                    have.write(wy + OFF, wx + OFF, torch.ones((1, WIN, WIN), dtype=torch.bool))
                x = torch.where(pm, x, (1 - s0) * still + s0 * torch.randn_like(ref))   # everything else is held still
                v = painter.predict(x, ref, s0, emb, tid)
                vel.add(wy + OFF, wx + OFF, v.cpu() * wgt)
                wsum.add(wy + OFF, wx + OFF, wgt[None])
                if nwin % 50 == 49:
                    lap(f"  step {i + 1}/{STEPS}: {nwin + 1}/{len(wins)} windows, {(time.time() - tick) / (nwin + 1):.2f}s each")
            for (by, bx), vb in vel.b.items():
                pm = cells(paint_t, by * BLOCK - OFF, bx * BLOCK - OFF, BLOCK, BLOCK) & (wsum.b[(by, bx)][0] > 0)
                if bool(pm.any()):
                    lb = lat.b[(by, bx)].float()
                    lb[:, pm] += (s1 - s0) * vb.float()[:, pm] / wsum.b[(by, bx)][0][pm]
                    lat.b[(by, bx)] = lb.half()
            del vel, wsum
            torch.save({"step": i + 1, "lat": lat.b, "have": have.b}, kept)   # to resume from, or decode again
            lap(f"step {i + 1}/{STEPS} done")
        painter.tf.to("cpu")
        torch.cuda.empty_cache()

    # --- Decode ----------------------------------------------------------------------------
    # One stored square at a time, each with a margin round it. The decoder does not give quite
    # the same colours twice, so neighbouring squares are cross-faded over their margins.
    out = Store(HERE / (args.out or f"work/{name}{d}"))
    S, M = STORE // CELL, 8
    n_ = S + 2 * M
    P = n_ * CELL
    w1 = tent(P, 2 * M * CELL)
    pw = w1[:, None] * w1[None, :]
    sq = {(ty, tx) for ty in range(ch // S + 1) for tx in range(cw // S + 1) if bool(paint[ty * S:(ty + 1) * S, tx * S:(tx + 1) * S].any())}
    acc = {}
    done = 0

    def finish(upto):
        """Write every square in rows above `upto`: nothing more will be added to them."""
        nonlocal done
        for key in sorted(k for k in acc if k[0] < upto):
            sm, wt = acc.pop(key)
            img = (sm.float() / wt.float().clamp(min=1e-4)).clamp(0, 1)
            a = cells(wcell, key[0] * S - 1, key[1] * S - 1, S + 2, S + 2)
            a = F.interpolate(a[None, None], scale_factor=CELL, mode="bilinear", align_corners=False)[0, :, CELL:-CELL, CELL:-CELL]
            rgba = (torch.cat([img, a]).clamp(0, 1).permute(1, 2, 0) * 255 + 0.5).byte().numpy()
            if args.over:   # other corrections may already be kept in the same square
                out.blend(key[1] * STORE, key[0] * STORE, rgba)
            else:
                out.put(key[1], key[0], rgba)
            done += 1

    for ty in sorted({k[0] for k in sq}):
        finish(ty - 1)
        for tx in sorted(k[1] for k in sq if k[0] == ty):
            y, x = ty * S - M, tx * S - M
            big = cells(paint_t, y, x, n_, n_).to(dev)
            z = lat.read(y + OFF, x + OFF, n_, n_).to(dev)
            if not bool(big.all()):
                z = torch.where(big, z, painter.encode(standing(y, x, n_, n_) if fresh else shown(y, x, n_, n_)))
            img = painter.decode(z).cpu()
            py, px = y * CELL, x * CELL
            for sy in (ty - 1, ty, ty + 1):
                for sx in (tx - 1, tx, tx + 1):
                    if (sy, sx) not in sq:
                        continue
                    y0, y1 = max(py, sy * STORE), min(py + P, sy * STORE + STORE)
                    x0, x1 = max(px, sx * STORE), min(px + P, sx * STORE + STORE)
                    if y0 >= y1 or x0 >= x1:
                        continue
                    if (sy, sx) not in acc:
                        # Half precision: with the whole country to do, three rows of these are held at once.
                        acc[(sy, sx)] = [torch.zeros((3, STORE, STORE), dtype=torch.float16), torch.zeros((STORE, STORE), dtype=torch.float16)]
                    sm, wt = acc[(sy, sx)]
                    wv = pw[y0 - py:y1 - py, x0 - px:x1 - px]
                    sm[:, y0 - sy * STORE:y1 - sy * STORE, x0 - sx * STORE:x1 - sx * STORE] += (img[:, y0 - py:y1 - py, x0 - px:x1 - px] * wv).half()
                    wt[y0 - sy * STORE:y1 - sy * STORE, x0 - sx * STORE:x1 - sx * STORE] += wv.half()
    finish(1 << 30)
    lap(f"decoded {done} squares into {out.dir}")


if __name__ == "__main__":
    main()
