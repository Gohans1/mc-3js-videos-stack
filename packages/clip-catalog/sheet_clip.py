"""Assemble renders/clip_<index>_<front|left>.jpg from lab/clip.ts into contact sheets.
python ../../packages/clip-catalog/sheet_clip.py (inside a film, after rendering the clip)."""
import argparse
from pathlib import Path
import re
import sys


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.parse_args(["--help"] if sys.argv[1:2] == ["help"] else None)
    from PIL import Image, ImageDraw

    count = 0
    for view in ["front", "left"]:
        files = sorted((p for p in Path("renders").glob(f"clip_*_{view}.jpg")
                        if re.fullmatch(rf"clip_\d+_{view}\.jpg", p.name)),
                       key=lambda p: int(p.stem.split("_")[1]))
        if not files:
            continue
        tiles = []
        for f in files:
            with Image.open(f) as src:
                w, h = src.size
                im = src.convert("RGB").crop((w // 4, 0, 3 * w // 4, h))
            im.thumbnail((320, 360))
            ImageDraw.Draw(im).text((6, 4), f.stem.split("_")[1], fill="yellow")
            tiles.append(im)
        w, h = tiles[0].size
        out = Image.new("RGB", (w * 8, h * ((len(tiles) + 7) // 8)))
        for i, tile in enumerate(tiles):
            out.paste(tile, ((i % 8) * w, (i // 8) * h))
        path = Path(f"renders/clip_sheet_{view}.jpg")
        out.save(path, quality=88)
        print(f"{path}: {len(tiles)} frames")
        count += len(tiles)
    if not count:
        ap.error("no clip frames: inside a film run ENTRY=lab/clip.ts LAB_CLIP=<lib/name> bun run render stills first")
    print("next: open renders/clip_sheet_front.jpg and renders/clip_sheet_left.jpg; judge motion in the rendered clip too")


if __name__ == "__main__":
    main()
