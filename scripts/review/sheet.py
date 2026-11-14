"""Contact sheets for self-review, 6 pictures each (3 x 2, 640 wide), in time order.
  bun run sheet                                  every renders/still_*.jpg (make them: AT=1,4 bun run render stills),
                                                 to renders/sheet_<n>.jpg; a draft still carries its time and shot under it
  bun run sheet renders/draft_video.mp4 10,20,30  only those seconds of a video, to renders/sheet_<video>_<n>.jpg
  bun run sheet renders/chunks/c02.mp4 62,70     film seconds, as framecheck prints them: a chunk or a span starts at its
                                                 film second by itself (c02: 60 s, span_40-44: 40 s), START=60 for any other
  bun run sheet renders/draft_video.mp4 shots    the whole film at a glance: one frame from the middle of every shot
  bun run sheet renders/draft_video.mp4 cut 4    a transition up close: 6 frames from 0.25 s before cut 4 to 0.35 s after,
                                                 naming the shots either side (cut 4: shot 4 into 5, numbered from 0 as everywhere)
                                                 and the transition between them (shotsTimeline row 5 .transition)
                                                 (shots and cuts from renders/cuts.json, the render clip that made the video)
Seconds are heard seconds: 65, 1:05 or 01:05.250. Worth a look: a note's (bun run notes), a line's (bun run voice:cues),
a fault's (bun run framecheck), either side of a cut (renders/cuts.json).
Prints each sheet with the seconds on it; open them to look. Run inside the film."""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from seconds import heard_second, meant  # noqa: E402
from stale import say_if_stale  # noqa: E402

R = Path.cwd() / "renders"  # run from the film folder
args = sys.argv[1:]
if args[:1] == ["help"] or "-h" in args or "--help" in args:
    print(__doc__)
    raise SystemExit
flags = [a for a in args if re.match(r"^--?[a-zA-Z]", a)]


def usage(why, code=2):
    print(why, file=sys.stderr)
    raise SystemExit(code)


def cuts_of():
    f = R / "cuts.json"
    if not f.exists():
        usage("no renders/cuts.json to find the shots in: bun run render clip writes it with the video")
    return sorted(json.loads(f.read_text(encoding="utf8")))


USE = "bun run sheet, or bun run sheet <video> 10,20.5,30 | shots | cut <n> (--help for more)"
if flags:
    usage(f"unknown option {flags[0]}: {USE}")
mode = args[1] if len(args) >= 2 and args[1] in ("shots", "cut") else ""
if len(args) == 1 and not Path(args[0]).exists() and not re.fullmatch(r"[\d.,:]+", args[0]):
    usage(f"no {args[0]}: bun run sheet <video> 10,20.5,30, a video from renders/ (bun run render clip makes one)")
if len(args) not in (0, 2, 3) or (len(args) == 3) != (mode == "cut"):
    why = ("cut takes a number: bun run sheet <video> cut 4" if mode == "cut" else
           "the video needs its seconds too" if len(args) == 1 else f"one video at a time, got {len(args)} words")
    usage(f"{why}: {USE}")

tmp, header = None, None
if args:
    video = args[0]
    # a render's chunk (renders/chunks or final_chunks/cNN.mp4) starts at NN*30 s, a SPAN run's renders/span_<from>-<to>.mp4 at
    # <from> (live-studio src/video.mjs reads the same names: change both); the seconds asked are the film's
    chunk = re.search(r"[\\/]?chunks[\\/]c(\d+)\.mp4$", video)
    span = re.search(r"span_(\d+(?:\.\d+)?)-[\d.]+\.mp4$", video)
    if "START" in os.environ:
        try:
            start = float(os.environ["START"])
            if not 0 <= start < 1e6:
                raise ValueError
        except ValueError:
            usage(f"START takes the film second the video starts at, 0 or more, got {os.environ['START']!r}")
    else:
        start = int(chunk.group(1)) * 30 if chunk else float(span.group(1)) if span else 0.0
        if start >= 1e6:
            usage(f"{video} starts at film second {start:.15g} by its name, past any film: START=<s> says where it starts")
    if Path(video).is_dir():
        usage(f"{video} is a folder, not a video: give it a render's mp4, as renders/draft_video.mp4")
    videos = ", ".join(sorted(p.relative_to(Path.cwd()).as_posix() for p in R.rglob("*.mp4"))[:8]) or "none yet"
    if not Path(video).is_file():
        usage(f"no {video} (the videos here: {videos}); a new one: bun run render clip")
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate:format=duration",
                            "-of", "json", video], capture_output=True, text=True)
    try:
        probed = json.loads(probe.stdout)
        dur = float(probed["format"]["duration"])
        num, den = probed["streams"][0]["r_frame_rate"].split("/")
        frame = float(den) / float(num)
    except (ValueError, KeyError, IndexError, ZeroDivisionError):
        usage(f"{video} is no video ffprobe can read (the videos here: {videos})")
    # the last frame's second: a seek past it reads nothing
    end = start + dur - frame

    if mode == "shots":
        ends = cuts_of()
        before = sum(c <= start for c in ends)
        edges = [start, *[c for c in ends if start < c < start + dur], start + dur]
        # a shot under 0.05 s has no frame of its own to show; a video that short shows its one frame
        shots = [(a, b) for a, b in zip(edges, edges[1:]) if b - a > 0.05] or [(edges[0], edges[-1])]
        args[1] = ",".join(f"{min((a + b) / 2, end):.2f}" for a, b in shots)
        short = len(edges) - 1 - len(shots)
        header = (f"{len(shots)} shots: a frame from the middle of each, in order (shot {before} first"
                  f"{f'; {short} under 0.05 s left out' if short > 0 else ''})")
    elif mode == "cut":
        ends = cuts_of()
        if not ends:
            usage(f"renders/cuts.json has no cuts: the film is one shot (bun run sheet {video} shots shows it)")
        if not re.fullmatch(r"\d+", args[2]) or int(args[2]) >= len(ends):
            usage(f"cut takes a number 0-{len(ends) - 1} (renders/cuts.json has {len(ends)} cuts), got {args[2]}")
        n = int(args[2])
        c = ends[n]
        if not start <= c <= start + dur:
            usage(f"cut {n} is at {c:.2f} s, outside {video} (film seconds {start:g}-{start + dur:.2f})")
        args[1] = ",".join(f"{min(max(c + d, start), end):.3f}" for d in (-0.25, -0.15, -0.05, 0.05, 0.15, 0.35))
        # cut n opens shots-timeline row n+1 when the rows are the video's shots (one more row than cuts)
        conf = json.loads(Path("package.json").read_text(encoding="utf8")).get("live-studio", {}) if Path("package.json").exists() else {}
        rows_file = conf.get("shotsTimeline")
        rows = json.loads(Path(rows_file).read_text(encoding="utf8")) if rows_file and Path(rows_file).exists() else None
        meet = ""
        if isinstance(rows, list) and len(rows) == len(ends) + 1:
            a, b = rows[n], rows[n + 1]
            tr = b.get("transition") or {}
            fx = f"{tr.get('fx')} {tr.get('len', 0):g} s ({rows_file} [{n + 1}].transition)" if tr.get("fx") else f"a hard cut (a transition goes in {rows_file} [{n + 1}].transition)"
            meet = f': from shot {n} "{a.get("name", "")}" into shot {n + 1} "{b.get("name", "")}", {fx}'
        header = f"cut {n} at {c:.2f} s{meet}; frames from 0.25 s before to 0.35 s after\nnext: bun run at {round(c, 2):g} names every row that places it"

    secs = [heard_second(s) for s in args[1].split(",")]
    if None in secs:
        usage(f"takes heard seconds (65, 1:05 or 01:05.250), with commas; got {args[1]}{next((meant(s) for s in args[1].split(',') if meant(s)), '')}")
    secs = sorted(set(secs))
    out = [s for s in secs if not start <= s < start + dur]
    if out:
        usage(f"{video} holds film seconds {start:g}-{start + dur:.2f}; outside it: {', '.join(f'{s:g}' for s in out)}")
    secs = sorted({min(s, end) for s in secs})
    if start:
        print(f"film seconds from {start:g} s on ({'START' if 'START' in os.environ else 'the chunk' + chr(39) + 's start' if chunk else 'the span' + chr(39) + 's start'})")
    if header:
        print(header)
    say_if_stale(video)
    # the video's frames go to a folder of their own, never over the film's rendered stills
    tmp = Path(tempfile.mkdtemp(prefix="sheet-"))
    for s in secs:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(s - start), "-i", video, "-frames:v", "1", "-q:v", "3", str(tmp / f"still_{s:g}s.jpg")], check=True)
    src, name = tmp, f"sheet_{Path(video).stem}_{'shots_' if mode == 'shots' else f'cut{args[2]}_' if mode else ''}"
else:
    src, name = R, "sheet_"
# a still a render names by its second (still_12.5s.jpg); any other still_*.jpg is no frame of the film
at_second = {f: re.fullmatch(r"still_(-?\d+(?:\.\d+)?)s\.jpg", f.name) for f in src.glob("still_*.jpg")}
files = sorted((f for f, m in at_second.items() if m), key=lambda f: float(at_second[f].group(1)))
if not files:
    usage("no renders/still_*.jpg to lay out: AT=1,4,8 bun run render stills first, or bun run sheet <video> 10,20,30", 1)
R.mkdir(exist_ok=True)
for old in R.glob(f"{name}*.jpg"):
    if re.fullmatch(re.escape(name) + r"\d+\.jpg", old.name):
        old.unlink()
# tiles 640 wide at the stills' own shape (a draft still is the picture with its time strip under it)
w, h = map(int, subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", str(files[0])], capture_output=True, text=True, check=True).stdout.split(","))
TH = round(640 * h / w / 2) * 2
for i in range(0, len(files), 6):
    grp = files[i:i + 6]
    inp, filt = [], ""
    for k, f in enumerate(grp):
        inp += ["-i", str(f)]
        filt += f"[{k}:v]scale=640:{TH}[v{k}];"  # the draft's own time strip names each picture
    n = len(grp)
    while n % 3:
        inp += ["-f", "lavfi", "-i", f"color=black:s=640x{TH}"]
        filt += f"[{n}:v]null[v{n}];"
        n += 1
    filt += "".join(f"[v{k}]" for k in range(n)) + f"xstack=inputs={n}:layout=" + "|".join(f"{(k % 3) * 640}_{(k // 3) * TH}" for k in range(n))
    subprocess.run(["ffmpeg", "-v", "error", "-y", *inp, "-filter_complex", filt, "-frames:v", "1", str(R / f"{name}{i // 6}.jpg")], check=True)
    print(f"renders/{name}{i // 6}.jpg  {', '.join(f.stem.removeprefix('still_') for f in grp)}")
if tmp:
    shutil.rmtree(tmp, ignore_errors=True)
sheets = (len(files) + 5) // 6
print(len(files), "pictures ->", sheets, "sheet: open it to look" if sheets == 1 else "sheets: open them to look")
