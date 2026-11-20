"""Paint every landmark's own window once and lay the results out in contact sheets (work/lm_N.png).

A quick way to check hints.json before a full run: python review_landmarks.py [id ...]
"""
import json
import sys
import torch
from PIL import Image, ImageDraw
from paint import HERE, Render, Painter, ANCHOR, WIN, CELL, STEPS, load_hints

dev = "cuda"
render = Render(HERE / "work" / "cond", 3.0, 1.0, dev)
hints = load_hints(render.meta)
cuts = [c for c in render.meta["cuts"] if c["id"] in hints and (not sys.argv[1:] or c["id"] in sys.argv[1:])]
P = WIN * CELL
painter = Painter(dev)
text = lambda c: ANCHOR + hints[c["id"]]
embeds = painter.encode_prompts(sorted({text(c) for c in cuts}))
painter.load_transformer()
sig = painter.sigmas()
COLS, ROWS, T = 4, 3, 512
for s in range(0, len(cuts), COLS * ROWS):
    sheet = Image.new("RGB", (COLS * T, ROWS * T))
    d = ImageDraw.Draw(sheet)
    for n, c in enumerate(cuts[s:s + COLS * ROWS]):
        x = min(max(0, c["x"] + c["w"] // 2 - P // 2), render.W - P) // 16 * 16
        y = min(max(0, c["y"] + c["h"] // 2 - P // 2), render.H - P) // 16 * 16
        ref = painter.encode(render.window(x, y, P, P))
        lat = torch.randn((128, WIN, WIN), generator=torch.Generator().manual_seed(7)).to(dev)
        emb, tid = embeds[text(c)]
        for i in range(STEPS):
            lat = lat + (float(sig[i + 1]) - float(sig[i])) * painter.predict(lat, ref, float(sig[i]), emb.to(dev), tid.to(dev))
        img = Image.fromarray((painter.decode(lat).permute(1, 2, 0) * 255 + 0.5).byte().cpu().numpy())
        # the middle of the window, where the landmark is
        m = max(c["w"], c["h"], 420) + 60
        m = min(m, P)
        img = img.crop(((P - m) // 2, (P - m) // 2, (P + m) // 2, (P + m) // 2)).resize((T, T), Image.LANCZOS)
        sheet.paste(img, ((n % COLS) * T, (n // COLS) * T))
        d.text(((n % COLS) * T + 6, (n // COLS) * T + 4), c["id"], fill=(255, 255, 255), stroke_width=2, stroke_fill=(0, 0, 0))
        print(c["id"], flush=True)
    sheet.save(HERE / "work" / f"lm_{s // (COLS * ROWS)}.png")
