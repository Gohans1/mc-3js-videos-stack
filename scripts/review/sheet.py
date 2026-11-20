"""Contact sheets for self-review, 6 pictures each (3 x 2, 640 wide), in time order.
  bun run sheet                                  every renders/still_*.jpg (make them: AT=1,4 bun run render stills),
                                                 to renders/sheet_<n>.jpg; a draft still carries its time and shot under it
  bun run sheet renders/view_a_4s.jpg renders/view_b_4s.jpg [--out renders/grid.jpg]
                                                 explicit images (.jpg, .jpeg, .png, .webp) into one captioned grid
                                                 (default renders/sheet_custom.jpg; --out must stay inside the film folder)
  bun run sheet renders/draft_video.mp4 10,20,30  only those seconds of a video, to renders/sheet_<video>_<n>.jpg
  bun run sheet renders/chunks/c02.mp4 62,70     film seconds, as framecheck prints them: a chunk or a span starts at its
                                                 film second by itself (c02: 60 s, span_40-44: 40 s), START=60 for any other
  bun run sheet renders/draft_video.mp4 shots    the whole film at a glance: one frame from the middle of every shot
  bun run sheet renders/draft_video.mp4 overview bounded compact overview, or overview 10-20/16 for a closer look
  bun run sheet renders/draft_video.mp4 frames 10,20-21/8  persistent native frames; no render, download or model
  bun run sheet renders/draft_video.mp4 frames 37-38/12 --vs references/ref.mp4
                                                 each frame beside the reference's at the same heard second (its file
                                                 second, its exact frame), reference | ours, to vs_*.jpg; overview takes it too
  bun run sheet references/ref.mp4 frames 7.2 --grid 50 [--crop 100,500,1000,1600]
                                                 each frame ruled every 50 px and labelled in the video's own pixels
                                                 (--crop x0,y0,x1,y1 keeps that region at full size): read where a
                                                 landmark sits for bun run reference solve's uv
  bun run sheet renders/draft_video.mp4 cut 4    a transition up close: 6 frames from 0.25 s before cut 4 to 0.35 s after,
                                                 naming the shots either side (cut 4: shot 4 into 5, numbered from 0 as everywhere)
                                                 and the transition between them (shotsTimeline row 5 .transition)
                                                 (shots and cuts from renders/cuts.json, the render clip that made the video)
Use film seconds for film renders, file seconds for other videos, or START for a manual offset. TIMES accepts 65, 1:05
or 01:05.250. The shots and cut modes require a current film render at its original offset. Worth a look: a note's (bun run notes), a line's (bun run voice:cues),
a fault's (bun run framecheck), either side of a cut (renders/cuts.json).
Prints each sheet with the seconds on it; open them to look. Run inside the film.

overview: 16-96 evenly spaced samples (16 per sheet, one sheet per 160 s rounded, at most 6).
  Optional A-B[/N] scans one heard-time range: 16 samples by default, N from 1 to 96.
frames TIMES: comma-separated heard seconds and A-B[/N] ranges (4 per range by default, N from 1 to 40).
  At most 96 samples per run; range endpoints must be inside the source (B may equal its end).
New modes keep their outputs in a fresh renders/review_<name>_<id>/ with index.json: source, requestedTime,
  decoded frame time/sourceTime, sheet/cell (1-16, left to right then down) or native JPEG, and timeline context.
Follow-up commands contain argv and optional env: apply both, including START, even in a new shell.
Open every sheet, then use commands.frames from the index for details; never read small text from a tile.
  Speech and shots come from the current timeline. Stale, external and manually re-aligned files omit those links.
Local only, no credits or model. Up to 96 seeks; extraction and timeline-context subprocesses time out after 30 s.
  Interrupted/failed new runs keep images and complete=false in their index; reruns create a new directory."""
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from seconds import heard_second, meant  # noqa: E402
from stale import render_context  # noqa: E402
from sheet_view import (  # noqa: E402
    compact_filter, displayed_time, extract_displayed_frame, image_dimensions, load_caption_font, presentation_times,
    review, sample_aspects, seconds, timeline_length, video_bounds,
)
from studio_tell import tell  # noqa: E402

sys.stdout.reconfigure(encoding="utf8")
sys.stderr.reconfigure(encoding="utf8")

R = Path.cwd() / "renders"  # run from the film folder
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
args = sys.argv[1:]
if args[:1] == ["help"] or "-h" in args or "--help" in args:
    print(__doc__)
    raise SystemExit


def usage(why, code=2):
    print(why, file=sys.stderr)
    raise SystemExit(code)


def caption_labels(paths):
    stems = [p.stem for p in paths]
    counts = Counter(stems)
    if all(c == 1 for c in counts.values()):
        return stems
    labels = [
        p.stem if counts[p.stem] == 1 else (f"{p.parent.name}/{p.stem}" if p.parent.name else p.name)
        for p in paths
    ]
    dup2 = Counter(labels)
    if any(c > 1 for c in dup2.values()):
        labels = [
            (f"{p.parent.name}/{p.name}" if p.parent.name else p.name)
            if counts[p.stem] > 1 and dup2[lbl] > 1
            else lbl
            for p, lbl in zip(paths, labels)
        ]
    dup3 = Counter(labels)
    if any(c > 1 for c in dup3.values()):
        seen = Counter()
        disambiguated = []
        for lbl in labels:
            if dup3[lbl] > 1:
                seen[lbl] += 1
                disambiguated.append(f"{lbl} ({seen[lbl]})")
            else:
                disambiguated.append(lbl)
        return disambiguated
    return labels


def build_image_sheet(paths, out_arg):
    cwd_root = Path.cwd().resolve()
    raw_out = out_arg if out_arg is not None else "renders/sheet_custom.jpg"
    if not raw_out.strip():
        usage("--out path cannot be empty")
    out_path = Path(raw_out)
    if not out_path.is_absolute():
        out_path = cwd_root / out_path
    try:
        resolved_out = out_path.resolve()
    except OSError as e:
        usage(f"invalid --out path {raw_out!r}: {e}")
    try:
        rel_out = resolved_out.relative_to(cwd_root)
    except ValueError:
        usage(f"--out must stay inside the current folder ({cwd_root}), got {raw_out!r}")
    if resolved_out == cwd_root or resolved_out.is_dir():
        usage(f"--out must name a file inside the current folder, got {raw_out!r}")
    out_ext = resolved_out.suffix.lower()
    if out_ext not in IMAGE_EXTS:
        usage(f"--out must end in .jpg, .jpeg, .png, or .webp, got {raw_out!r}")

    img_paths = []
    for raw in paths:
        p = Path(raw)
        if p.suffix.lower() not in IMAGE_EXTS:
            usage(f"unsupported image {raw}: expected .jpg, .jpeg, .png, or .webp")
        if p.is_dir():
            usage(f"{raw} is a folder, not an image")
        if not p.is_file():
            usage(f"no image file {raw}")
        img_paths.append(p)

    try:
        from PIL import Image, ImageDraw, ImageFont, ImageOps
    except ImportError as e:
        usage(f"Pillow (PIL) is required for image contact sheets: {e}", 1)

    n = len(img_paths)
    if n <= 3:
        cols = n
    elif n == 4:
        cols = 2
    elif n <= 9:
        cols = 3
    elif n <= 16:
        cols = 4
    else:
        cols = min(6, math.ceil(math.sqrt(n)))
    rows = math.ceil(n / cols)

    tile_w = 640
    caption_h = 34
    gap = 4
    labels = caption_labels(img_paths)
    font = load_caption_font(ImageFont, 18)

    canvas = None
    draw = None
    tile_h = 0
    cell_h = 0
    for idx, (p, raw_label) in enumerate(zip(img_paths, labels)):
        try:
            with Image.open(p) as opened:
                im = ImageOps.exif_transpose(opened)
                if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
                    rgba = im.convert("RGBA")
                    bg = Image.new("RGBA", rgba.size, (20, 20, 24, 255))
                    im = Image.alpha_composite(bg, rgba).convert("RGB")
                else:
                    im = im.convert("RGB")
                iw, ih = im.size
                if canvas is None:
                    tile_h = max(120, min(960, round(tile_w * ih / max(1, iw) / 2) * 2))
                    cell_h = tile_h + caption_h
                    sheet_w = cols * tile_w + (cols + 1) * gap
                    sheet_h = rows * cell_h + (rows + 1) * gap
                    canvas = Image.new("RGB", (sheet_w, sheet_h), (10, 10, 12))
                    draw = ImageDraw.Draw(canvas)
                scale = min(tile_w / max(1, iw), tile_h / max(1, ih))
                nw = max(1, round(iw * scale))
                nh = max(1, round(ih * scale))
                resized = im.resize((nw, nh), Image.Resampling.LANCZOS)
        except (OSError, ValueError) as e:
            usage(f"could not read image {p}: {e}")

        col, row = idx % cols, idx // cols
        x0 = gap + col * (tile_w + gap)
        y0 = gap + row * (cell_h + gap)
        draw.rectangle([x0, y0, x0 + tile_w - 1, y0 + tile_h - 1], fill=(18, 18, 22))
        px = x0 + (tile_w - nw) // 2
        py = y0 + (tile_h - nh) // 2
        canvas.paste(resized, (px, py))

        cap_y0 = y0 + tile_h
        draw.rectangle([x0, cap_y0, x0 + tile_w - 1, cap_y0 + caption_h - 1], fill=(18, 18, 22))
        label = raw_label
        max_text_w = tile_w - 16
        if draw.textlength(label, font=font) > max_text_w:
            while len(label) > 1 and draw.textlength(label + "...", font=font) > max_text_w:
                label = label[:-1]
            label = label + "..."
        bbox = draw.textbbox((0, 0), label, font=font)
        text_h = bbox[3] - bbox[1]
        ty = cap_y0 + (caption_h - text_h) // 2 - bbox[1]
        draw.text((x0 + 8, ty), label, fill=(240, 240, 240), font=font)

    rel_display = rel_out.as_posix()
    try:
        resolved_out.parent.mkdir(parents=True, exist_ok=True)
        if out_ext in (".jpg", ".jpeg"):
            canvas.save(resolved_out, format="JPEG", quality=92, optimize=True)
        elif out_ext == ".png":
            canvas.save(resolved_out, format="PNG")
        else:
            canvas.save(resolved_out, format="WEBP", quality=92)
    except OSError as e:
        usage(f"could not write {rel_display}: {e}", 1)
    tell(Path.cwd(), f"Laid out {n} image{'s' if n != 1 else ''} to {rel_display}")
    print(f"{rel_display}  {', '.join(labels)}")
    print(f"{n} {'picture' if n == 1 else 'pictures'} -> {rel_display}")
    print("next: open it to look")


def cuts_of(context):
    cuts = context["cuts"] or {}
    if "times" not in cuts:
        usage(cuts.get("reason", "cut metadata unavailable"), 1 if cuts.get("status") == "invalid" else 2)
    return sorted(set(cuts["times"]))


USE = "bun run sheet, bun run sheet <img1> [<img2> ...] [--out <path>], or bun run sheet <video> 10,20.5,30 | shots | cut <n> | overview [A-B[/N]] | frames TIMES (--help for more)"
pos = []
out_arg = None
vs_arg = None
grid_arg = None
crop_arg = None
i = 0
while i < len(args):
    a = args[i]
    if a == "--vs" or a.startswith("--vs="):
        if vs_arg is not None:
            usage("--vs may only be passed once")
        vs_arg = a.split("=", 1)[1] if "=" in a else args[i + 1] if i + 1 < len(args) and not args[i + 1].startswith("-") else ""
        if not vs_arg:
            usage("--vs needs the reference video: bun run sheet renders/draft_video.mp4 frames 37-38/12 --vs references/ref.mp4")
        i += 1 if "=" in a else 2
        continue
    if a in ("--grid", "--crop"):
        if i + 1 >= len(args):
            usage(f"{a} needs a value: bun run sheet references/ref.mp4 frames 7.2 --grid 50 --crop 100,500,1000,1600")
        if (grid_arg if a == "--grid" else crop_arg) is not None:
            usage(f"{a} may only be passed once")
        if a == "--grid":
            grid_arg = args[i + 1]
        else:
            crop_arg = args[i + 1]
        i += 2
        continue
    if a == "--out":
        if out_arg is not None:
            usage("--out may only be passed once")
        if i + 1 >= len(args) or re.match(r"^--?[a-zA-Z]", args[i + 1]):
            usage("--out needs a path: bun run sheet img1.jpg img2.jpg --out renders/grid.jpg")
        out_arg = args[i + 1]
        i += 2
        continue
    if a.startswith("--out="):
        if out_arg is not None:
            usage("--out may only be passed once")
        out_arg = a.split("=", 1)[1]
        if not out_arg:
            usage("--out needs a path: bun run sheet img1.jpg img2.jpg --out renders/grid.jpg")
        i += 1
        continue
    if re.match(r"^--?[a-zA-Z]", a):
        usage(f"unknown option {a}: {USE}")
    pos.append(a)
    i += 1

is_image_list = any(Path(a).suffix.lower() in IMAGE_EXTS for a in pos)
if is_image_list:
    build_image_sheet(pos, out_arg)
    raise SystemExit
if out_arg is not None:
    usage("--out is only for image lists: bun run sheet img1.jpg img2.jpg --out renders/grid.jpg")
args = pos
mode = args[1] if len(args) >= 2 and args[1] in ("shots", "cut", "overview", "frames") else ""
if len(args) == 1 and not Path(args[0]).exists() and not re.fullmatch(r"[\d.,:]+", args[0]):
    usage(f"no {args[0]}: bun run sheet <video> 10,20.5,30, a video from renders/ (bun run render clip makes one)")
if mode == "overview":
    valid_count = len(args) in (2, 3)
elif mode == "frames":
    valid_count = len(args) == 3
else:
    valid_count = len(args) in (0, 2, 3) and (len(args) == 3) == (mode == "cut")
if vs_arg is not None and mode not in ("overview", "frames"):
    usage("--vs goes with frames or overview: bun run sheet renders/draft_video.mp4 frames 37-38/12 --vs references/ref.mp4")
if vs_arg is not None and not Path(vs_arg).is_file():
    usage(f"no {vs_arg}: --vs takes the reference video in the film, as references/ref.mp4")
if vs_arg is not None or grid_arg is not None:
    try:
        import PIL  # noqa: F401
    except ImportError as e:
        usage(f"Pillow (PIL) is required to label {'--vs pairs' if vs_arg is not None else 'a --grid'}: {e}", 1)
grid = None
if crop_arg is not None and grid_arg is None:
    usage("--crop goes with --grid: bun run sheet references/ref.mp4 frames 7.2 --grid 50 --crop 100,500,1000,1600")
if grid_arg is not None:
    if mode != "frames" or vs_arg is not None:
        usage("--grid goes with frames, one video at a time (no --vs): bun run sheet references/ref.mp4 frames 7.2 --grid 50")
    if not re.fullmatch(r"[1-9]\d*", grid_arg):
        usage(f"--grid takes a pixel step, as --grid 50; got {grid_arg}")
    crop = None
    if crop_arg is not None:
        if not re.fullmatch(r"\d+,\d+,\d+,\d+", crop_arg):
            usage(f"--crop takes x0,y0,x1,y1 in the video's pixels, as 100,500,1000,1600; got {crop_arg}")
        crop = [int(n) for n in crop_arg.split(",")]
    grid = {"step": int(grid_arg), "crop": crop}
if not valid_count:
    why = ("cut takes a number: bun run sheet <video> cut 4" if mode == "cut" else
           "the video needs its seconds too" if len(args) == 1 else f"one video at a time, got {len(args)} words")
    usage(f"{why}: bun run sheet <video> {mode} {'TIMES' if mode == 'frames' else '[A-B[/N]]'}" if mode in ("overview", "frames") else f"{why}: {USE}")

tmp, header, after = None, None, ""
if args:
    video = args[0]
    if Path(video).is_dir():
        usage(f"{video} is a folder, not a video: give it a render's mp4, as renders/draft_video.mp4")
    videos = ", ".join(sorted(p.relative_to(Path.cwd()).as_posix() for p in R.rglob("*.mp4"))[:8]) or "none yet"
    if not Path(video).is_file():
        usage(f"no {video} (the videos here: {videos}); a new one: bun run render clip")
    context = render_context(video)
    render = context["render"]
    if "START" in os.environ:
        start = heard_second(os.environ["START"])
        if start is None or not 0 <= start < 1e6:
            usage(f"START takes the film second the video starts at (65, 1:05 or 01:05.250), got {os.environ['START']!r}")
    else:
        start = render["start"] if render else 0.0
        if start >= 1e6:
            usage(f"{video} starts at film second {start:.15g} by its name, past any film: START=<s> says where it starts")
    native_start = render["start"] if render else 0
    manual = abs(start - native_start) > 0.000001
    if not manual:
        start = native_start
    linked = bool(render and not context["stale"] and not manual)
    clock = "manual" if manual else "film" if render else "file"
    if mode in ("shots", "cut") and not linked:
        reason = context.get("error") or (context["stale"] or {}).get("message") or "no current cut context for this source and offset"
        usage(f"{reason}; use bun run sheet \"{video}\" overview or frames TIMES")
    try:
        first, stop, origin, stream = video_bounds(video)
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, IndexError):
        usage(f"{video} is no video ffprobe can read (the videos here: {videos})")
    picture_from = round(start + first, 9)
    picture_to = max(start + stop, round(start + stop, 9))
    end = math.nextafter(picture_to, -math.inf)

    if mode in ("overview", "frames"):
        review(video, mode, args[2] if len(args) == 3 else None, start, first, stop, origin, stream, context, clock, vs=vs_arg, grid=grid)
        raise SystemExit

    if mode == "shots":
        ends = cuts_of(context)
        before = sum(c <= picture_from for c in ends)
        edges = [picture_from, *[c for c in ends if picture_from < c < picture_to], picture_to]
        # a shot under 0.05 s has no frame of its own to show; a video that short shows its one frame
        shots = [(a, b) for a, b in zip(edges, edges[1:]) if b - a > 0.05] or [(edges[0], edges[-1])]
        secs = [min((a + b) / 2, end) for a, b in shots]
        short = len(edges) - 1 - len(shots)
        header = (f"{len(shots)} shots: a frame from the middle of each, in order (shot {before} first"
                  f"{f'; {short} under 0.05 s left out' if short > 0 else ''})")
    elif mode == "cut":
        ends = cuts_of(context)
        if not ends:
            usage(f"the render has no cuts: the film is one shot (bun run sheet {video} shots shows it)")
        if not re.fullmatch(r"\d+", args[2]) or int(args[2]) >= len(ends):
            usage(f"cut takes a number 0-{len(ends) - 1} ({len(ends)} in the render), got {args[2]}")
        n = int(args[2])
        c = ends[n]
        if not picture_from <= c < picture_to:
            usage(f"cut {n} is at {c:.2f} s, outside {video} (film seconds {start:g}-{seconds(picture_to)})")
        secs = [min(max(c + d, picture_from), end) for d in (-0.25, -0.15, -0.05, 0.05, 0.15, 0.35)]
        # cut n opens shots-timeline row n+1 when the rows are the video's shots (one more row than cuts)
        try:
            conf = json.loads(Path("package.json").read_text(encoding="utf8")).get("live-studio", {}) if Path("package.json").exists() else {}
            rows_file = conf.get("shotsTimeline") if isinstance(conf, dict) else None
            rows = json.loads(Path(rows_file).read_text(encoding="utf8")) if isinstance(rows_file, str) and Path(rows_file).exists() else None
        except (ValueError, OSError):
            rows_file, rows = None, None
        meet = ""
        if isinstance(rows, list) and len(rows) == len(ends) + 1 and isinstance(rows[n], dict) and isinstance(rows[n + 1], dict):
            a, b = rows[n], rows[n + 1]
            tr = b.get("transition") if isinstance(b.get("transition"), dict) else {}
            tlen = tr.get("len", 0)
            fx = f"{tr.get('fx')} {tlen if isinstance(tlen, (int, float)) else 0:g} s ({rows_file} [{n + 1}].transition)" if tr.get("fx") else f"a hard cut (a transition goes in {rows_file} [{n + 1}].transition)"
            meet = f': from shot {n} "{a.get("name", "")}" into shot {n + 1} "{b.get("name", "")}", {fx}'
        header = f"cut {n} at {c:.2f} s{meet}; frames from 0.25 s before to 0.35 s after"
        after = (f"; bun run at {seconds(c)} names every row that places it" if c < timeline_length(Path.cwd())
                 else f"; AT={seconds(c)} LIST=1 bun run render stills shows the live scene there")

    else:
        secs = [heard_second(s) for s in args[1].split(",")]
        if None in secs:
            usage(f"takes heard seconds (65, 1:05 or 01:05.250), with commas; got {args[1]}{next((meant(s) for s in args[1].split(',') if meant(s)), '')}")
        out = sorted({s for s in secs if not picture_from <= s < picture_to})
        if out:
            usage(f"{video} holds {clock} seconds {seconds(picture_from)}-{seconds(picture_to)}; outside it: {', '.join(f'{s:g}' for s in out)}")
    secs = sorted({round(min(s, end), 9) for s in secs})
    if start:
        label = "START" if "START" in os.environ else f"the {render['kind']}'s start"
        print(f"{clock} seconds from {start:g} s on ({label})")
    elif clock != "film":
        print(f"{clock} seconds from 0")
    if header:
        print(header)
    if context["stale"]:
        print(f"STALE: {context['stale']['message']}")
    elif "error" in context:
        print(context["error"], file=sys.stderr)
    what = "every shot" if mode == "shots" else f"cut {args[2]}" if mode else ", ".join(f"{s:g}" for s in secs[:8]) + " s"
    # a cut's frames are one stretch, lit on the studio's ruler; seconds far apart are named in the line only
    lit = {"at": secs[0], "to": secs[-1]} if mode == "cut" else {"at": secs[0]} if len(secs) == 1 else {}
    tell(Path.cwd(), f"Looking at frames of {Path(video).as_posix()}: {what}", **(lit if linked else {}))
    # the video's frames go to a folder of their own, never over the film's rendered stills
    tmp = Path(tempfile.mkdtemp(prefix="sheet-"))
    try:
        timestamps = presentation_times(video, origin)
        seeks = [displayed_time(timestamps, s - start) for s in secs]
        aspects = sample_aspects(video, origin, seeks[-1])
        for s, seek in zip(secs, seeks):
            named = seconds(s)
            extract_displayed_frame(video, tmp / f"still_{named}s.jpg", seek, origin=origin,
                                    aspect=aspects.get(round(seek, 9)))
    except (subprocess.SubprocessError, OSError, ValueError) as e:
        shutil.rmtree(tmp, ignore_errors=True)
        usage(f"ffmpeg could not read frames from {video}: {e}", 1)
    src, name = tmp, f"sheet_{Path(video).stem}_{'shots_' if mode == 'shots' else f'cut{args[2]}_' if mode else ''}"
else:
    src, name = R, "sheet_"
    tell(Path.cwd(), "Looking at the rendered stills")
try:
    # a still a render names by its second (still_12.5s.jpg); any other still_*.jpg is no frame of the film
    at_second = {f: re.fullmatch(r"still_(-?\d+(?:\.\d+)?)s\.jpg", f.name) for f in src.glob("still_*.jpg")}
    files = sorted((f for f, m in at_second.items() if m), key=lambda f: float(at_second[f].group(1)))
    if not files:
        usage("no renders/still_*.jpg to lay out: AT=1,4,8 bun run render stills first, or bun run sheet <video> 10,20,30")
    R.mkdir(exist_ok=True)
    for old in R.glob(f"{name}*.jpg"):
        if re.fullmatch(re.escape(name) + r"\d+\.jpg", old.name):
            old.unlink()
    # tiles 640 wide at the stills' own shape (a draft still is the picture with its time strip under it)
    w, h = image_dimensions(files[0])
    TH = max(2, round(640 * h / w / 2) * 2)
    fit = compact_filter(640, TH, pad=True)
    for i in range(0, len(files), 6):
        grp = files[i:i + 6]
        inp, filt = [], ""
        for k, f in enumerate(grp):
            inp += ["-i", str(f)]
            filt += f"[{k}:v]{fit}[v{k}];"  # the draft's own time strip names each picture
        n = len(grp)
        while n % 3:
            inp += ["-f", "lavfi", "-i", f"color=black:s=640x{TH}"]
            filt += f"[{n}:v]null[v{n}];"
            n += 1
        filt += "".join(f"[v{k}]" for k in range(n)) + f"xstack=inputs={n}:layout=" + "|".join(f"{(k % 3) * 640}_{(k // 3) * TH}" for k in range(n))
        subprocess.run(["ffmpeg", "-v", "error", "-y", *inp, "-filter_complex", filt, "-frames:v", "1", str(R / f"{name}{i // 6}.jpg")], check=True)
        print(f"renders/{name}{i // 6}.jpg  {', '.join(f.stem.removeprefix('still_') for f in grp)}")
except (subprocess.CalledProcessError, FileNotFoundError, ValueError) as e:
    usage(f"could not lay out frames from {src}: {e}", 1)
finally:
    if tmp:
        shutil.rmtree(tmp, ignore_errors=True)
sheets = (len(files) + 5) // 6
print(len(files), "pictures ->", sheets, "sheet" if sheets == 1 else "sheets")
print(f"next: open {'it' if sheets == 1 else 'them'} to look{after}")
