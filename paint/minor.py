"""Paint the minor places close up, told what they are.

In the base painting a minor place is a thing a hundred pixels across in a
window ten times that, with nothing said about it, and the model guesses: a
boar comes back as a stone hut, a burial mound as a tree. Telling it does not
help at that size; it draws a second, larger one beside the first.

So each is painted again here on its own, at 8 picture pixels to the map pixel,
where it fills a third of the window. The model is shown the render (not the
painting), is told what the thing is (the site's `paint` line in src/minor.js),
and may only change the landmark's own outline; everything round it is held at
the picture as it stands, so the new landmark grows into the old surroundings.

  python minor.py                       every minor place, into work/m8
  python minor.py --only calydon,aulis  just these (others already in work/m8 are kept)
  python minor.py --sheet work/m.png    also write a contact sheet of the results
  python minor.py --only olympia --say "A straight running track ..."
                                        one of the great places, told what it is in so many words
  python minor.py --drop16              and blank the 16 level there (see below)

Run it after `detail.py --level 8` and before `detail.py --level 16`, so that
the finest level is drawn from the corrected picture. If level 16 was painted
first, --drop16 blanks it round the minor places, which then stop at level 8.
"""
import argparse
import json
import time

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image, ImageDraw

from paint import HERE, CELL, WIN, STEPS, ANCHOR, Painter, Render
from tiles import STORE, Store, open_picture, up

D = 8          # picture pixels per map pixel at this level
PAD = 24       # pixels round the landmark's outline that may change with it


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated place ids")
    ap.add_argument("--skip", default="", help="comma-separated place ids to leave alone")
    ap.add_argument("--seed", type=int, default=5)
    ap.add_argument("--sheet", help="write a contact sheet of the results to this file")
    ap.add_argument("--drop16", action="store_true", help="blank level 16 round the minor places")
    ap.add_argument("--say", help="with --only: what stands there, for a place that has no `paint` line of its own")
    args = ap.parse_args()
    dev = "cuda"
    t0 = time.time()
    lap = lambda s: print(f"{time.time() - t0:7.1f}s  {s}", flush=True)

    render = Render(HERE / "work" / "cond", 3.0, 1.0, dev)
    _, pic = open_picture(dev, render=render)
    k = render.k
    cuts = {c["id"]: c for c in render.meta["cuts"]}
    only = set(args.only.split(",")) if args.only else None
    skip = set(args.skip.split(","))
    if args.say:
        if not only:
            raise SystemExit("--say needs --only")
        for s in render.meta["sites"]:
            if s["id"] in only:
                s["paint"] = args.say
    todo = [s for s in render.meta["sites"] if s.get("paint") and s["id"] in cuts and s["id"] not in skip and (not only or s["id"] in only)]
    lap(f"{len(todo)} minor places")

    painter = Painter(dev)
    embeds = painter.encode_prompts(sorted({ANCHOR + s["paint"] for s in todo}))
    painter.load_transformer()
    sig = painter.sigmas()
    out = Store(HERE / "work" / "m8")
    P = WIN * CELL
    f = D // k
    shots = []
    for n, s in enumerate(todo):
        c = cuts[s["id"]]
        # The window, centred on the landmark, on the cell grid of this level.
        X0 = (round((c["x"] + c["w"] / 2) * f / CELL) - WIN // 2) * CELL
        Y0 = (round((c["y"] + c["h"] / 2) * f / CELL) - WIN // 2) * CELL
        X0 = min(max(X0, 0), render.W * f - P)
        Y0 = min(max(Y0, 0), (render.h1 * D) // CELL * CELL - P)
        shown = up(render.window(X0 // f, Y0 // f, P // f, P // f)[None], f).clamp(0, 1)[0]      # the render, enlarged
        now = torch.from_numpy(pic.block(D, X0, Y0, P, P)[..., :3]).to(dev).permute(2, 0, 1).float() / 255   # the picture as it stands
        ref, hold = painter.encode(shown), painter.encode(now)
        # Only the landmark's own outline, and a little round it, may change.
        i = torch.arange(WIN, device=dev) * CELL
        inx = (i + CELL > c["x"] * f - X0 - PAD) & (i < (c["x"] + c["w"]) * f - X0 + PAD)
        iny = (i + CELL > c["y"] * f - Y0 - PAD) & (i < (c["y"] + c["h"]) * f - Y0 + PAD)
        free = iny[:, None] & inx[None, :]
        emb, tid = embeds[ANCHOR + s["paint"]]
        emb, tid = emb.to(dev), tid.to(dev)
        g = torch.Generator(device=dev).manual_seed(args.seed * 7919 + n)
        x = torch.randn(ref.shape, generator=g, device=dev)
        for step in range(STEPS):
            s0, s1 = float(sig[step]), float(sig[step + 1])
            x = torch.where(free, x, (1 - s0) * hold + s0 * torch.randn(ref.shape, generator=g, device=dev))
            x = x + (s1 - s0) * painter.predict(x, ref, s0, emb, tid)
        img = painter.decode(torch.where(free, x, hold))
        a = F.avg_pool2d(free[None, None].float(), 3, 1, 1)                      # fade out over the last cell
        a = F.interpolate(a, scale_factor=CELL, mode="bilinear", align_corners=False)[0]
        rgba = (torch.cat([img, a]).clamp(0, 1).permute(1, 2, 0) * 255 + 0.5).byte().cpu().numpy()
        out.blend(X0, Y0, rgba)
        if args.sheet:
            m = int(max(c["w"], c["h"]) * f / 2) + 70
            cx, cy = int((c["x"] + c["w"] / 2) * f - X0), int((c["y"] + c["h"] / 2) * f - Y0)
            box = (max(0, cx - m), max(0, cy - m), min(P, cx + m), min(P, cy + m))
            shots.append((s["id"], Image.fromarray(rgba[..., :3]).crop(box).resize((320, 320), Image.LANCZOS)))
        if n % 10 == 9:
            lap(f"  {n + 1}/{len(todo)}")
    lap(f"painted {len(todo)} places into {out.dir}")

    if args.sheet and shots:
        cols = 8
        sheet = Image.new("RGB", (cols * 320, -(-len(shots) // cols) * 320))
        d = ImageDraw.Draw(sheet)
        for n, (name, im) in enumerate(shots):
            sheet.paste(im, ((n % cols) * 320, (n // cols) * 320))
            d.text(((n % cols) * 320 + 5, (n // cols) * 320 + 3), name, fill=(255, 255, 255), stroke_width=2, stroke_fill=(0, 0, 0))
        sheet.save(HERE / args.sheet)
        lap(f"wrote {args.sheet}")

    if args.drop16:
        # Level 16 was drawn from the picture before these were put right, so it shows the old guesses.
        d16 = Store(HERE / "work" / "d16")
        spots = {s["id"]: s for s in json.loads((HERE / "work" / "spots.json").read_text())["spots"]}
        n = 0
        for s in todo:
            p = spots.get(s["id"])
            if not p:
                continue
            rr = max(p["r"] * 0.75, p["wide"]) + 14    # what detail.py paints of it at this level, and a little over
            x0, x1 = int((p["x"] - rr) * 16), int((p["x"] + rr) * 16)
            y0, y1 = int((p["y"] - max(p["top"], rr)) * 16), int((p["y"] + max(p["bot"], rr)) * 16)
            for ty in range(y0 // STORE, y1 // STORE + 1):
                for tx in range(x0 // STORE, x1 // STORE + 1):
                    sq = d16.get(tx, ty)
                    if sq is None:
                        continue
                    sq = sq.copy()
                    sq[max(0, y0 - ty * STORE):max(0, y1 - ty * STORE), max(0, x0 - tx * STORE):max(0, x1 - tx * STORE), 3] = 0
                    d16.put(tx, ty, sq)
                    n += 1
        lap(f"blanked level 16 round the minor places ({n} squares touched)")


if __name__ == "__main__":
    main()
