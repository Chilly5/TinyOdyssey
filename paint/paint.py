"""Paint the map.

An image model (FLUX.2 klein 4B) redraws the splat render as detailed voxel
art, K times larger than the render. The method follows the isometric city
maps this project learned from:

  * The whole map is one shared latent canvas. At every denoising step the
    model runs on overlapping 1024-pixel windows, each shown its own crop of
    the render, and the windows' predictions are averaged where they overlap
    (MultiDiffusion). Every other step uses a grid shifted by half a stride,
    so no seam falls in the same place twice.
  * Open sea is not painted. It is held at the render at each step's noise
    level (as in RePaint), so painted coast grows into it without an edge.

  python paint.py                      the whole map, into work/out
  python paint.py --region X,Y,W,H     one rectangle, in painted-image pixels (multiples of 16)
  python paint.py --resume             carry on after an interruption

Needs gen/build.mjs --cond to have been run first.
"""
import argparse
import json
import math
import os
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
os.environ.setdefault("HF_HOME", str(HERE / ".models"))
os.environ.setdefault("HF_HUB_OFFLINE", "1")

import torch
import torch.nn.functional as F
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

MODEL = "black-forest-labs/FLUX.2-klein-4B"
CELL = 16      # image pixels per latent cell
WIN = 64       # window size in cells (1024 px)
STRIDE = 48    # 768 px
SHIFT = 24     # the second grid's offset, 384 px
STEPS = 4      # klein is distilled to four
NIGHT = (21, 18, 46)

# The prompt says how to draw, never what to draw: naming things ("temples", "fields") makes the
# model add them to empty sea. What stands at each landmark is said separately, in hints.json,
# and only to the windows that actually contain it.
STYLE = (
    "Redraw this render as detailed voxel art in crisp pixels: a 3D model built from tiny cubes, like MagicaVoxel, "
    "seen from above through an orthographic camera. Fidelity comes first: draw exactly what the render shows, in "
    "the same positions, shapes, sizes and colours. "
)
# Nothing is said about particular colours. Told that dry ground is tan, the model turns meadows to sand;
# told the sea is blue, it floods valleys. Colour is put right afterwards instead (see tiles.py).
FOCUS = (
    "Keep the render's own colours. Everything is in sharp focus from top to bottom: no depth of field, no blur, "
    "no haze, no gradients, no text."
)
PROMPT = STYLE + (
    "Add nothing that is not in the render; empty water stays empty water. Build everything from small cubes with flat "
    "faces, tops light and fronts darker, with hard square edges: trees are clumps of leaf cubes on a trunk, houses are "
    "blocks with stepped tiled roofs, a door and windows, rocks and mountains are stacked blocks, walls are stone "
    "blocks, roads are flat pale paths. "
) + FOCUS
# Added only for windows that really contain snow; said everywhere, it makes the model whiten beaches.
SNOW = " The white ground on the mountain tops is snow."
# For a landmark's own window. It leaves out the line about houses: with it, caves, crags and
# giants all come back as stone cottages.
ANCHOR = STYLE + (
    "Add nothing that is not in the render. Build what is there from small cubes with flat faces and hard square "
    "edges, and give it fine detail: masonry gets stone blocks, roofs get tiles, marble gets joints, trees get leaf "
    "cubes, rocks get ledges and cracks, figures get faces and clothing. Rocks and caves stay bare rock; no extra "
    "buildings. "
) + FOCUS + " In this view: "


def load_hints(meta):
    """What stands at each landmark: hints.json for the great sites, the site's own `paint` line for the minor ones."""
    hints = json.loads((HERE / "hints.json").read_text(encoding="utf-8")) if (HERE / "hints.json").exists() else {}
    # The minor places are left out on purpose. Told what a small thing in a large window is, the model
    # draws a second, bigger one beside it; shown only the render, it redraws the one that is there.
    minor = {s["id"] for s in meta["sites"] if s.get("paint")}
    return {k: v for k, v in hints.items() if k not in minor}


def gauss(x, sigma):
    """Separable Gaussian blur of a (1, C, H, W) tensor."""
    if sigma <= 0:
        return x
    r = max(1, math.ceil(sigma * 3))
    k = torch.exp(-torch.arange(-r, r + 1, device=x.device, dtype=x.dtype) ** 2 / (2 * sigma * sigma))
    k = (k / k.sum())
    c = x.shape[1]
    x = F.conv2d(F.pad(x, (r, r, 0, 0), mode="replicate"), k.view(1, 1, 1, -1).repeat(c, 1, 1, 1), groups=c)
    return F.conv2d(F.pad(x, (0, 0, r, r), mode="replicate"), k.view(1, 1, -1, 1).repeat(c, 1, 1, 1), groups=c)


class Render:
    """The render the model is shown: scenery enlarged and softened, landmarks laid over it at full detail."""

    def __init__(self, cond_dir, blur, cut_blur, device):
        meta = json.loads((cond_dir / "meta.json").read_text())
        self.meta = meta
        self.k = k = meta["k"]
        self.w1, self.h1 = meta["w"], meta["h"]
        self.W = self.w1 * k
        self.H = math.ceil(self.h1 * k / CELL) * CELL
        self.blur = blur
        self.dev = device
        rgba = np.array(Image.open(cond_dir / "base.png").convert("RGBA"))
        self.kind = rgba[..., 3].copy()  # 0 nothing, 254 sea, 253 river, 255 land
        v = rgba[..., 0].astype(np.uint32) << 16 | rgba[..., 1].astype(np.uint32) << 8 | rgba[..., 2]
        self.snow = np.isin(v, [0xCCDAF0, 0xEDF4FC, 0xFFFFFF]) & (self.kind == 255)
        rgb = rgba[..., :3].copy()
        rgb[self.kind == 0] = NIGHT
        self.pad = 8
        self.rgb = np.pad(rgb, ((self.pad, self.pad + 2), (self.pad, self.pad), (0, 0)), mode="edge")
        self.cuts = []
        for c in meta["cuts"]:
            a = np.array(Image.open(cond_dir / "lm" / f"{c['id']}.png").convert("RGBA"))
            t = torch.from_numpy(a).to(device).permute(2, 0, 1)[None].float() / 255
            t = torch.cat([t[:, :3] * t[:, 3:], t[:, 3:]], 1)  # premultiplied
            # Close the pinholes left by sampling, then soften a little so the model redraws rather than copies.
            near = gauss(t, 1.2)
            hole = (t[:, 3:] < 0.5) & (near[:, 3:] > 0.62)
            t = torch.where(hole, near / near[:, 3:].clamp(min=1e-3), t)
            t = gauss(t, cut_blur)
            self.cuts.append({**c, "t": t[0].half()})

    def window(self, x0, y0, w, h):
        """(3, h, w) float tensor in 0..1 for a rectangle of the painted image."""
        k, p = self.k, self.pad
        sx0, sy0 = x0 // k - 6, y0 // k - 6
        sx1, sy1 = -(-(x0 + w) // k) + 6, -(-(y0 + h) // k) + 6
        crop = self.rgb[sy0 + p:sy1 + p, sx0 + p:sx1 + p]
        t = torch.from_numpy(crop).to(self.dev).permute(2, 0, 1)[None].float() / 255
        up = F.interpolate(t, scale_factor=k, mode="bicubic", align_corners=False).clamp_(0, 1)
        up = gauss(up, self.blur)
        ox, oy = x0 - sx0 * k, y0 - sy0 * k
        out = up[0, :, oy:oy + h, ox:ox + w].clone()
        for c in self.cuts:
            ix0, ix1 = max(x0, c["x"]), min(x0 + w, c["x"] + c["w"])
            iy0, iy1 = max(y0, c["y"]), min(y0 + h, c["y"] + c["h"])
            if ix0 >= ix1 or iy0 >= iy1:
                continue
            src = c["t"][:, iy0 - c["y"]:iy1 - c["y"], ix0 - c["x"]:ix1 - c["x"]].float()
            dst = out[:, iy0 - y0:iy1 - y0, ix0 - x0:ix1 - x0]
            dst.mul_(1 - src[3:4]).add_(src[:3])
        return out.clamp_(0, 1)

    def snowy(self, x0, y0, w, h):
        k = self.k
        return int(self.snow[y0 // k:(y0 + h) // k, x0 // k:(x0 + w) // k].sum()) > 200

    def land_cells(self, reach_px):
        """Which latent cells hold land (or a landmark), grown outwards by reach_px."""
        k = self.k
        land = (self.kind == 255) | (self.kind == 253)
        for c in self.cuts:
            land[c["y"] // k:(c["y"] + c["h"]) // k + 1, c["x"] // k:(c["x"] + c["w"]) // k + 1] = True
        n = CELL // k
        ch, cw = self.H // CELL, self.W // CELL
        full = np.zeros((ch * n, cw * n), bool)
        full[:land.shape[0], :land.shape[1]] = land
        cells = torch.from_numpy(full.reshape(ch, n, cw, n).any(axis=(1, 3)))
        r = max(0, round(reach_px / CELL))
        if r:
            cells = F.max_pool2d(cells[None, None].float(), 2 * r + 1, 1, r)[0, 0] > 0
        return cells


def axis(n, first):
    """Window origins along an axis of n cells."""
    if n <= WIN:
        return [0]
    xs = list(range(first, n - WIN, STRIDE))
    return sorted(set([0] + xs + [n - WIN]))


def tent(n, ramp):
    """1 across the middle, falling to nearly 0 over `ramp` samples at each end."""
    i = torch.arange(n, dtype=torch.float32) + 0.5
    return torch.minimum(i / ramp, (n - i) / ramp).clamp(0.02, 1)


class Painter:
    def __init__(self, device="cuda"):
        from diffusers import Flux2KleinPipeline
        self.dev = device
        self.pipe = Flux2KleinPipeline.from_pretrained(MODEL, torch_dtype=torch.bfloat16)
        self.vae = self.pipe.vae.to(device)
        self.tf = None
        v = self.vae
        self.bn_mean = v.bn.running_mean.view(1, -1, 1, 1).to(device, torch.float32)
        self.bn_std = torch.sqrt(v.bn.running_var.view(1, -1, 1, 1) + v.config.batch_norm_eps).to(device, torch.float32)
        ids = torch.cartesian_prod(torch.arange(1), torch.arange(WIN), torch.arange(WIN), torch.arange(1))
        ref = ids.clone()
        ref[:, 0] = 10  # the reference image sits at another "time"
        self.ids = torch.cat([ids, ref])[None].to(device)

    @torch.no_grad()
    def encode_prompts(self, prompts):
        te = self.pipe.text_encoder.to(self.dev)
        out = {}
        for p in prompts:
            emb, tid = self.pipe.encode_prompt(prompt=p, device=self.dev)
            out[p] = (emb.cpu(), tid.cpu())
        te.to("cpu")
        self.pipe.text_encoder = None
        del te
        torch.cuda.empty_cache()
        return out

    def load_transformer(self):
        self.tf = self.pipe.transformer.to(self.dev)

    def sigmas(self):
        from diffusers.pipelines.flux2.pipeline_flux2_klein import compute_empirical_mu, retrieve_timesteps
        mu = compute_empirical_mu(image_seq_len=WIN * WIN, num_steps=STEPS)
        retrieve_timesteps(self.pipe.scheduler, STEPS, "cpu", sigmas=np.linspace(1.0, 1 / STEPS, STEPS), mu=mu)
        return self.pipe.scheduler.sigmas.float().cpu()

    @torch.no_grad()
    def encode(self, img):
        """(3, H, W) in 0..1 -> (128, H/16, W/16) normalised latent."""
        x = (img[None] * 2 - 1).to(self.vae.dtype)
        lat = self.vae.encode(x).latent_dist.mode()
        b, c, h, w = lat.shape
        lat = lat.view(b, c, h // 2, 2, w // 2, 2).permute(0, 1, 3, 5, 2, 4).reshape(b, c * 4, h // 2, w // 2)
        return ((lat.float() - self.bn_mean) / self.bn_std)[0]

    @torch.no_grad()
    def decode(self, lat):
        """(128, h, w) normalised latent -> (3, 16h, 16w) in 0..1."""
        x = lat[None].float() * self.bn_std + self.bn_mean
        b, c, h, w = x.shape
        x = x.reshape(b, c // 4, 2, 2, h, w).permute(0, 1, 4, 2, 5, 3).reshape(b, c // 4, h * 2, w * 2)
        img = self.vae.decode(x.to(self.vae.dtype), return_dict=False)[0]
        return (img[0].float() / 2 + 0.5).clamp_(0, 1)

    @torch.no_grad()
    def predict(self, x, ref, sigma, emb, tid):
        """Velocity for one window: x and ref are (128, 64, 64)."""
        tok = torch.cat([x.flatten(1).T, ref.flatten(1).T])[None].to(torch.bfloat16)
        t = torch.full((1,), float(sigma), device=self.dev, dtype=torch.bfloat16)
        with self.tf.cache_context("cond"):
            out = self.tf(hidden_states=tok, timestep=t, guidance=None, encoder_hidden_states=emb, txt_ids=tid,
                          img_ids=self.ids, joint_attention_kwargs=None, return_dict=False)[0]
        return out[0, :WIN * WIN].float().T.reshape(128, WIN, WIN)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--region", help="X,Y,W,H in painted-image pixels")
    ap.add_argument("--out", default="work/out")
    ap.add_argument("--blur", type=float, default=3.0, help="softening of the enlarged scenery, pixels")
    ap.add_argument("--cut-blur", type=float, default=1.0, help="softening of the landmark cut-outs")
    ap.add_argument("--reach", type=int, default=96, help="how far out to sea the model paints, pixels")
    ap.add_argument("--boost", type=float, default=30.0, help="how strongly a landmark's own window overrides its neighbours")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--plan", action="store_true", help="only count the windows and stop")
    ap.add_argument("--preview", action="store_true", help="also write the result as one PNG (small regions only)")
    args = ap.parse_args()

    out = (HERE / args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    dev = "cuda"
    t0 = time.time()
    lap = lambda s: print(f"{time.time() - t0:7.1f}s  {s}", flush=True)

    render = Render(HERE / "work" / "cond", args.blur, args.cut_blur, dev)
    if args.region:
        rx, ry, rw, rh = (int(v) // CELL * CELL for v in args.region.split(","))
    else:
        rx, ry, rw, rh = 0, 0, render.W, render.H
    cx0, cy0, cw, ch = rx // CELL, ry // CELL, rw // CELL, rh // CELL
    lap(f"render {render.W} x {render.H}, painting {rw} x {rh} at {rx},{ry}")

    # --- Plan: which windows run, and which cells they are allowed to change --------------
    near = render.land_cells(args.reach)[cy0:cy0 + ch, cx0:cx0 + cw]
    grids, covers = [], []
    for first in (0, SHIFT):
        wins = [(wy, wx) for wy in axis(ch, first) for wx in axis(cw, first) if near[wy:wy + WIN, wx:wx + WIN].any()]
        cover = torch.zeros((ch, cw), dtype=torch.bool)
        for wy, wx in wins:
            cover[wy:wy + WIN, wx:wx + WIN] = True
        grids.append(wins)
        covers.append(cover)
    # Only cells near land may change. The rest of each window is open sea, held at the render:
    # a model handed a window of empty water will otherwise find something to put in it.
    paint = near & covers[0] & covers[1]
    lap(f"windows: {len(grids[0])} + {len(grids[1])}, painting {paint.float().mean() * 100:.0f}% of the canvas")

    # --- Landmarks ----------------------------------------------------------------------
    # What stands at a landmark is told to one window only, centred on it, and that window's
    # say is made to count many times over inside the landmark's outline. Telling every window
    # that overlaps it ends with each one drawing its own copy of the temple.
    hints = load_hints(render.meta)
    wgt = tent(WIN, 16)
    wgt = (wgt[:, None] * wgt[None, :])
    anchors = []
    for c in render.meta["cuts"]:
        hint = hints.get(c["id"])
        if not hint or c["w"] > 944 or c["h"] > 944:
            continue
        ax0, ay0 = (c["x"] - rx) / CELL, (c["y"] - ry) / CELL  # the outline, in cells of this canvas
        ax1, ay1 = ax0 + c["w"] / CELL, ay0 + c["h"] / CELL
        if ax0 < 0 or ay0 < 0 or ax1 > cw or ay1 > ch:
            continue
        wx = int(min(max(round((ax0 + ax1) / 2) - WIN // 2, 0), max(0, cw - WIN)))
        wy = int(min(max(round((ay0 + ay1) / 2) - WIN // 2, 0), max(0, ch - WIN)))
        i = torch.arange(WIN, dtype=torch.float32) + 0.5
        edge = lambda lo, hi: (((i - lo + 5) / 4).clamp(0, 1) * ((hi + 5 - i) / 4).clamp(0, 1))
        inside = edge(ay0 - wy, ay1 - wy)[:, None] * edge(ax0 - wx, ax1 - wx)[None, :]
        anchors.append(((wy, wx), ANCHOR + hint, wgt * (1 + args.boost * inside)))
    lap(f"{len(anchors)} landmark window(s)")
    plain = {w: PROMPT + (SNOW if render.snowy(rx + w[1] * CELL, ry + w[0] * CELL, WIN * CELL, WIN * CELL) else "")
             for g in grids for w in g}

    if args.plan:
        n = (len(grids[0]) + len(grids[1])) * STEPS // 2 + len(anchors) * STEPS
        print(f"{n} model calls, about {n * 1.35 / 3600:.1f} hours on an RTX 5080")
        return

    painter = Painter(dev)
    embeds = painter.encode_prompts(sorted(set(plain.values()) | {a[1] for a in anchors}))
    lap(f"{len(embeds)} prompt(s) encoded")
    painter.load_transformer()
    sig = painter.sigmas()
    lap("model ready, sigmas " + " ".join(f"{s:.3f}" for s in sig))

    state = out / "state.pt"
    gen = torch.Generator().manual_seed(args.seed)
    lat = torch.randn((128, ch, cw), generator=gen)
    start = 0
    if args.resume and state.exists():
        s = torch.load(state)
        lat, start = s["lat"].float(), s["step"]
        lap(f"resuming at step {start}")

    def ref_latent(wy, wx):
        return painter.encode(render.window(rx + wx * CELL, ry + wy * CELL, WIN * CELL, WIN * CELL))

    # --- Denoise ------------------------------------------------------------------------
    for i in range(start, STEPS):
        s0, s1 = float(sig[i]), float(sig[i + 1])
        vel = torch.zeros_like(lat)
        wsum = torch.zeros((ch, cw))
        wins = [(w, plain[w], wgt) for w in grids[i % 2]] + anchors
        tick = time.time()
        for n, ((wy, wx), prompt, wg) in enumerate(wins):
            ref = ref_latent(wy, wx)
            x = lat[:, wy:wy + WIN, wx:wx + WIN].to(dev)
            pm = paint[wy:wy + WIN, wx:wx + WIN].to(dev)
            if not bool(pm.all()):  # hold everything outside the painted area at the render
                x = torch.where(pm, x, (1 - s0) * ref + s0 * torch.randn_like(ref))
            emb, tid = embeds[prompt]
            v = painter.predict(x, ref, s0, emb.to(dev), tid.to(dev))
            vel[:, wy:wy + WIN, wx:wx + WIN] += (v.cpu() * wg)
            wsum[wy:wy + WIN, wx:wx + WIN] += wg
            if n % 50 == 49:
                lap(f"  step {i + 1}/{STEPS}: {n + 1}/{len(wins)} windows, {(time.time() - tick) / (n + 1):.2f}s each")
        upd = paint & (wsum > 0)
        lat[:, upd] += (s1 - s0) * vel[:, upd] / wsum[upd]
        del vel
        torch.save({"lat": lat.half(), "step": i + 1}, state)
        lap(f"step {i + 1}/{STEPS} done")

    # --- Decode, blending overlapping windows in pixel space ---------------------------------
    rgb = np.lib.format.open_memmap(out / "paint.npy", mode="w+", dtype=np.uint8, shape=(rh, rw, 3))
    P = WIN * CELL
    ramp = (WIN - STRIDE) * CELL
    w1 = tent(P, ramp)
    pw = (w1[:, None] * w1[None, :]).to(dev)
    rows = sorted(set(wy for wy, _ in grids[0]))
    acc = torch.zeros((3, P, rw))
    wacc = torch.zeros((P, rw))
    top = None  # image row of acc's first row

    def flush(upto):
        nonlocal acc, wacc, top
        n = min(P, upto - top)
        if n > 0:
            px = (acc[:, :n] / wacc[:n].clamp(min=1e-4)).clamp_(0, 1)
            px[:, wacc[:n] <= 0] = 0
            rgb[top:top + n] = (px.permute(1, 2, 0) * 255 + 0.5).byte().numpy()
        keep = max(0, P - max(0, n))
        acc = torch.cat([acc[:, P - keep:], torch.zeros((3, P - keep, rw))], 1) if keep else torch.zeros((3, P, rw))
        wacc = torch.cat([wacc[P - keep:], torch.zeros((P - keep, rw))], 0) if keep else torch.zeros((P, rw))
        top = upto

    for wy in rows:
        y = wy * CELL
        if top is None:
            top = y
        elif y > top:
            flush(y)
        for _, wx in [w for w in grids[0] if w[0] == wy]:
            x = lat[:, wy:wy + WIN, wx:wx + WIN].to(dev)
            pm = paint[wy:wy + WIN, wx:wx + WIN].to(dev)
            if not bool(pm.all()):
                x = torch.where(pm, x, ref_latent(wy, wx))
            img = painter.decode(x)
            acc[:, :, wx * CELL:wx * CELL + P] += (img * pw).cpu()
            wacc[:, wx * CELL:wx * CELL + P] += pw.cpu()
    if top is not None:
        flush(top + P)
    rgb.flush()
    torch.save({"paint": paint, "region": [rx, ry, rw, rh]}, out / "plan.pt")
    lap("decoded")

    if args.preview:
        cond = torch.cat([torch.cat([render.window(rx + x, ry + y, min(2048, rw - x), min(2048, rh - y)).cpu() for x in range(0, rw, 2048)], 2) for y in range(0, rh, 2048)], 1)
        cond = (cond.permute(1, 2, 0) * 255 + 0.5).byte().numpy()
        Image.fromarray(cond).save(out / "cond.png")
        mask = np.kron(paint.numpy(), np.ones((CELL, CELL), bool))[..., None]
        Image.fromarray(np.where(mask, np.asarray(rgb), cond)).save(out / "paint.png")
        lap(f"wrote {out / 'paint.png'}")


if __name__ == "__main__":
    main()
