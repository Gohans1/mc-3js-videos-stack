# renders/clip_*_<view> stills (lab/clip.ts) -> renders/clip_sheet_<view>.jpg, 8 per row, numbered by still index
import glob, sys
from PIL import Image, ImageDraw
for view in ["front", "left"]:
    files = sorted(f for f in glob.glob(f"renders/clip_*_{view}*") if "sheet" not in f)
    if not files: continue
    tiles = []
    for f in files:
        im = Image.open(f); w, h = im.size; im = im.crop((w // 4, 0, 3 * w // 4, h)); im.thumbnail((320, 360))
        ImageDraw.Draw(im).text((6, 4), f.split("_")[1], fill="yellow"); tiles.append(im)
    W, H = tiles[0].size; cols = 8; rows = (len(tiles) + cols - 1) // cols
    o = Image.new("RGB", (W * cols, H * rows))
    for i, t in enumerate(tiles): o.paste(t, ((i % cols) * W, (i // cols) * H))
    o.save(f"renders/clip_sheet_{view}.jpg", quality=88)
    print(view, len(tiles))
