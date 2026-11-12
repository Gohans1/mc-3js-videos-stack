#!/usr/bin/env python3
"""Contact sheets with frame and time labels at the real fps, from an MP4 or image stills.

Usage:
  python3 scripts/sheet.py out/film.mp4 --out out/qa/sheet.png                      # whole film, <= 48 tiles
  python3 scripts/sheet.py out/film.mp4 --chunks 4 --rate 12 --out out/qa/r1/watch.png  # 12 fps, one sheet per 4 s
  python3 scripts/sheet.py out/film.mp4 --every 30 --width 480 --out out/qa/legibility.png  # phone legibility
  python3 scripts/sheet.py out/film.mp4 --frames 358-364,1796 --diff --width 480 --out out/qa/pops.png
  python3 scripts/sheet.py --images out/stills/*.png --width 480 --out out/qa/stills.png  # tile stills

Tiles are labelled "f<frame> <seconds>s" (frame = t * fps, 0-based) and, with --cues out/cues.json,
the act and any cue within half a step. --diff pairs each frame with its change from the previous
frame (x4), which is how single-frame pops and ghosts show up. With --chunks, one sheet per chunk is
written as <out stem>_<k>_f<a>-<b>.png. --json writes a manifest of the sheets.
Exit: 0 ok, 1 nothing decoded, 2 usage error.
Needs ffmpeg/ffprobe, numpy and opencv-python or Pillow (either draws the tiles).
"""
import argparse
import json
import math
import os
import re
import sys

import numpy as np

sys.dont_write_bytecode = True  # no __pycache__ in the project's scripts/
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
# opencv or Pillow: forensics' sheet helpers use whichever is installed and name the install when neither is
from forensics import decode, imread, imwrite, inferno, label, need_images, probe, resize_area, rgb2bgr, tile  # noqa: E402


def die(msg, code=2):
    print(f'sheet: {msg}', file=sys.stderr)
    sys.exit(code)


def parse_frames(text):
    out = []
    for part in filter(None, (x.strip() for x in text.split(','))):
        m = re.fullmatch(r'(\d+)(?:-(\d+))?', part)
        if not m:
            die(f'bad --frames entry: {part}')
        a, b = int(m.group(1)), int(m.group(2) or m.group(1))
        out.extend(range(a, b + 1))
    return sorted(set(out))


def load_cues(path):
    if not path:
        return {}, {}
    try:
        c = json.load(open(path))
    except (OSError, json.JSONDecodeError) as e:
        die(f'cannot read --cues {path}: {e}')
    acts = {k: (int(v['from']), int(v['from']) + int(v.get('dur', 0)))
            for k, v in (c.get('acts') or {}).items() if isinstance(v, dict) and 'from' in v}
    cue = {k: int(v) for k, v in (c.get('cue') or {}).items() if isinstance(v, (int, float))}
    return acts, cue


def sublabel(f, acts, cue, half):
    act = next((k for k, (a, b) in acts.items() if a <= f < b), None)
    near = [k for k, v in cue.items() if abs(v - f) <= half]
    parts = ([act] if act else []) + near[:2]
    return ' / '.join(parts) if parts else None


def grab_video(path, info, frames, width, with_prev):
    """Decode only what is needed, in contiguous spans; returns {frame: rgb tile}, plus previous frames."""
    th = int(round(width * info['h'] / info['w'] / 2)) * 2
    need = sorted(set(frames) | ({f - 1 for f in frames if f > 0} if with_prev else set()))
    spans, cur = [], [need[0], need[0]]
    for f in need[1:]:
        if f - cur[1] <= 120:
            cur[1] = f
        else:
            spans.append(cur)
            cur = [f, f]
    spans.append(cur)
    got = {}
    want = set(need)
    for a, b in spans:
        for f, im in decode(path, info, a, b - a + 1, size=(width, th)):
            if f in want:
                got[f] = im.copy()
    return got


def diff_tile(cur, prev):
    d = np.abs(cur.astype(np.int16) - prev.astype(np.int16)).max(axis=2)
    d = np.clip(d * 4, 0, 255).astype(np.uint8)
    return inferno(d)


def build(frames, imgs, fps, args, acts, cue, half, bgr):
    tiles = []
    for f in frames:
        if f not in imgs:
            continue
        im = imgs[f]
        im = im if bgr else rgb2bgr(im)
        if im.shape[1] != args.width:
            h = int(round(args.width * im.shape[0] / im.shape[1] / 2)) * 2
            im = resize_area(im, (args.width, h))
        g = f + args.offset  # label in film frames when a per-act composition starts later in the film
        tiles.append(label(im.copy(), f'f{g} {g / fps:.2f}s', sublabel(g, acts, cue, half)))
        if args.diff:
            pv = imgs.get(f - 1)
            if pv is None:
                dt = np.zeros_like(im)
            else:
                pv = pv if bgr else rgb2bgr(pv)
                pv = resize_area(pv, (im.shape[1], im.shape[0]))
                dt = diff_tile(im, pv)
            tiles.append(label(dt, f'f{f - 1 + args.offset}->f{f + args.offset} x4'))
    return tiles


def sheet_of_images(args):
    """Tile existing images (stills, frames grabbed earlier) at one tile width, each labelled with its file name."""
    tiles = []
    for path in args.images:
        im = imread(path)
        if im is None:
            die(f'cannot read {path}')
        w = args.width or 480
        tiles.append(label(resize_area(im, (w, max(1, round(im.shape[0] * w / im.shape[1])))).copy(),
                           os.path.splitext(os.path.basename(path))[0]))
    h = max(t.shape[0] for t in tiles)  # pad mixed aspect ratios to one row height
    tiles = [np.pad(t, ((0, h - t.shape[0]), (0, 0), (0, 0)), constant_values=90) for t in tiles]
    cols = args.cols or max(1, min(len(tiles), 8, max(2, round(1920 / tiles[0].shape[1]))))
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    imwrite(args.out, tile(tiles, cols))
    print(f'{args.out}  ({len(tiles)} images)')
    sys.exit(0)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    ap.add_argument('video', nargs='?', help='MP4 to sample (or use --images)')
    ap.add_argument('--images', nargs='+', help='tile these image files instead, labelled by file name')
    ap.add_argument('--fps', type=float, help='override label fps (default: read from video)')
    ap.add_argument('--from', dest='from_frame', type=int, default=0)
    ap.add_argument('--to', dest='to_frame', type=int, help='last frame, inclusive (default: the end)')
    ap.add_argument('--every', type=int, help='take every Nth frame')
    ap.add_argument('--rate', type=float, help='sample at this many frames per second instead of --every')
    ap.add_argument('--chunks', type=float, help='one sheet per chunk of this many seconds (default rate 12)')
    ap.add_argument('--frames', help='explicit frames/ranges for a video, e.g. 358-364,1796')
    ap.add_argument('--width', type=int, help='tile width in px (480 = phone legibility)')
    ap.add_argument('--cols', type=int)
    ap.add_argument('--offset', type=int, default=0,
                    help='add to frame labels, e.g. the shot start when rendering a segment')
    ap.add_argument('--diff', action='store_true', help='pair each frame with its change from the previous one')
    ap.add_argument('--cues', help='out/cues.json, to label acts and cues')
    ap.add_argument('--out', required=True, help='PNG path (chunked sheets get _k_fa-b suffixes)')
    ap.add_argument('--json', help='write a manifest of the sheets here')
    args = ap.parse_args()
    need_images('a contact sheet')
    if args.images:
        sheet_of_images(args)
        return
    if not args.video:
        die('give either a video path or --images <files>')
    info = probe(args.video)
    fps, last = args.fps or info['fps'], info['frames'] - 1
    if args.to_frame is not None:
        last = min(last, args.to_frame)
    first = max(0, args.from_frame)
    if last < first:
        die(f'empty range {first}-{last}')

    if args.every:
        every = args.every
    elif args.rate:
        every = max(1, int(round(fps / args.rate)))
    elif args.chunks:
        every = max(1, int(round(fps / 12)))
    else:
        every = max(1, math.ceil((last - first + 1) / 48))

    if args.frames:
        groups = [('', parse_frames(args.frames))]
    elif args.chunks:
        span = max(1, int(round(args.chunks * fps)))
        groups = []
        for k, a in enumerate(range(first, last + 1, span)):
            b = min(last, a + span - 1)
            groups.append((f'_{k + 1:02d}_f{a}-{b}', list(range(a, b + 1, every))))
    else:
        groups = [('', list(range(first, last + 1, every)))]

    n_max = max(len(g) for _, g in groups) * (2 if args.diff else 1)
    if not args.width:
        args.width = 480 if n_max <= 8 else 320 if n_max <= 24 else 240
    cols = args.cols or max(1, min(n_max, 8, max(2, round(1920 / args.width))))
    if args.diff and cols % 2:
        cols += 1

    all_frames = sorted({f for _, g in groups for f in g})
    imgs = grab_video(args.video, info, all_frames, args.width, args.diff)
    bgr = False
    if not imgs:
        die('no frames decoded', 1)

    acts, cue = load_cues(args.cues)
    stem, ext = os.path.splitext(args.out)
    ext = ext or '.png'
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    manifest = []
    for suffix, frames in groups:
        tiles = build(frames, imgs, fps, args, acts, cue, max(1, every // 2), bgr)
        if not tiles:
            continue
        path = stem + suffix + ext
        imwrite(path, tile(tiles, cols))
        manifest.append(dict(path=path, frames=[f for f in frames if f in imgs], every=every, fps=fps))
        step = '' if args.frames else f', every {every}'
        print(f'{path}  ({len([f for f in frames if f in imgs])} frames, f{frames[0] + args.offset}-'
              f'f{frames[-1] + args.offset}{step})')
    if args.json:
        os.makedirs(os.path.dirname(os.path.abspath(args.json)), exist_ok=True)
        json.dump(dict(source=args.video, sheets=manifest), open(args.json, 'w'), indent=1)
    sys.exit(0 if manifest else 1)


if __name__ == '__main__':
    main()
