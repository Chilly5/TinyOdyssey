"""Try prompts on single windows: python try_prompts.py OUT.png SPOT [SPOT ...]

A SPOT is X,Y (top-left corner in painted-image pixels) or a landmark id (the window is centred on it).
Each row of the sheet is one window: the render, then one painting per line of prompts.txt.
A line ending in {hint} gets that landmark's line from hints.json appended.
"""
import json
import sys
import torch
from PIL import Image
from paint import HERE, Render, Painter, WIN, CELL, STEPS, PROMPT, ANCHOR, load_hints

out = sys.argv[1]
dev = "cuda"
render = Render(HERE / "work" / "cond", 3.0, 1.0, dev)
hints = load_hints(render.meta)
cuts = {c["id"]: c for c in render.meta["cuts"]}
P = WIN * CELL
spots = []
for a in sys.argv[2:]:
    if a in cuts:
        c = cuts[a]
        spots.append((max(0, c["x"] + c["w"] // 2 - P // 2) // 16 * 16, max(0, c["y"] + c["h"] // 2 - P // 2) // 16 * 16, hints.get(a, "")))
    else:
        x, y = (int(v) // 16 * 16 for v in a.split(","))
        spots.append((x, y, ""))
lines = [l.strip() for l in (HERE / "prompts.txt").read_text().splitlines() if l.strip() and not l.startswith("#")]
# A line that is just PROMPT or ANCHOR stands for the prompt paint.py uses.
def text(line, hint):
    if line == "PROMPT":
        return PROMPT
    if line == "ANCHOR":
        return (ANCHOR + hint) if hint else PROMPT
    return line.replace("{hint}", (" In this view: " + hint) if hint else "").strip()
painter = Painter(dev)
embeds = painter.encode_prompts(sorted({text(l, h) for l in lines for _, _, h in spots}))
painter.load_transformer()
sig = painter.sigmas()
sheet = Image.new("RGB", (P * (len(lines) + 1), P * len(spots)))
to_img = lambda t: Image.fromarray((t.permute(1, 2, 0) * 255 + 0.5).byte().cpu().numpy())
for r, (x, y, hint) in enumerate(spots):
    cond = render.window(x, y, P, P)
    ref = painter.encode(cond)
    sheet.paste(to_img(cond), (0, r * P))
    for c, line in enumerate(lines):
        lat = torch.randn((128, WIN, WIN), generator=torch.Generator().manual_seed(7)).to(dev)
        emb, tid = embeds[text(line, hint)]
        for i in range(STEPS):
            lat = lat + (float(sig[i + 1]) - float(sig[i])) * painter.predict(lat, ref, float(sig[i]), emb.to(dev), tid.to(dev))
        sheet.paste(to_img(painter.decode(lat)), ((c + 1) * P, r * P))
        print(r, c, flush=True)
sheet.save(HERE / out)
for r in range(len(spots)):
    sheet.crop((0, r * P, sheet.width, (r + 1) * P)).resize((sheet.width // 2, P // 2), Image.LANCZOS).save(HERE / out.replace(".png", f"_{r}.png"))
