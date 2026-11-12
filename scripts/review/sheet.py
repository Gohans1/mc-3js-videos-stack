"""Contact sheets for self-review, 6 pictures each (3 x 2, 640 wide), in time order.
  bun run sheet                                  every renders/still_*.jpg (make them: AT=1,4 bun run render stills),
                                                 to renders/sheet_<n>.jpg; a draft still carries its time and shot under it
  bun run sheet renders/draft_video.mp4 10,20,30  only those seconds of a video, to renders/sheet_<video>_<n>.jpg
  bun run sheet renders/chunks/c02.mp4 62,70     film seconds, as framecheck and jumps print them: a chunk starts at its
                                                 film second by itself (c02: 60 s), START=60 says it for any other video
  bun run sheet renders/draft_video.mp4 shots    the whole film at a glance: one frame from the middle of every shot
  bun run sheet renders/draft_video.mp4 cut 4    a transition up close: 6 frames from 0.25 s before cut 4 to 0.35 s after,
                                                 naming the shots either side as the notes number them (cut 4: shot 4 into 5)
                                                 and the transition between them (shotsTimeline row 5 .transition)
                                                 (shots and cuts from renders/cuts.json, the render clip that made the video)
Seconds worth a look: a note's (bun run notes), a line's (bun run voice:cues), a fault's (bun run framecheck, jumps),
either side of a cut (renders/cuts.json).
Prints each sheet with the seconds on it; open them to look. (python ../../scripts/review/sheet.py, in the film)"""
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

R = Path.cwd() / "renders"  # run from the film folder
args = sys.argv[1:]
if args[:1] in (["-h"], ["--help"], ["help"]):
    print(__doc__)
    raise SystemExit
flags = [a for a in args if re.match(r"^--?[a-zA-Z]", a)]


def cuts_of():
    f = R / "cuts.json"
    if not f.exists():
        print("no renders/cuts.json to find the shots in: bun run render clip writes it with the video", file=sys.stderr)
        raise SystemExit(1)
    import json
    return sorted(json.loads(f.read_text(encoding="utf8")))


# "shots" and "cut N" name their seconds from renders/cuts.json (heard seconds, as the video's own); each its own sheet names
# said once the video is known good, so a wrong file name is the only line printed
mode, header = "", None
if len(args) == 2 and args[1] == "cut" and not flags:
    print(f"cut takes a number: bun run sheet {args[0]} cut 4 (the cuts are 0-{len(cuts_of()) - 1})", file=sys.stderr)
    raise SystemExit(2)
if len(args) == 2 and args[1] == "shots" and not flags:
    ends = cuts_of()
    probe_d = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", args[0]], capture_output=True, text=True).stdout.strip()
    end = float(probe_d) if re.fullmatch(r"[\d.]+", probe_d) else ends[-1] + 1
    edges = [0.0, *[c for c in ends if 0 < c < end], end]
    args[1] = ",".join(f"{(a + b) / 2:.2f}" for a, b in zip(edges, edges[1:]) if b - a > 0.05)
    header = f"{len(edges) - 1} shots: a frame from the middle of each, in order (shot 0 first)"
    mode = "shots_"
elif len(args) == 3 and args[1] == "cut" and not flags:
    ends = cuts_of()
    if not re.fullmatch(r"\d+", args[2]) or int(args[2]) >= len(ends):
        print(f"cut takes a number 0-{len(ends) - 1} (renders/cuts.json has {len(ends)} cuts), got {args[2]}", file=sys.stderr)
        raise SystemExit(2)
    n = int(args[2])
    c = ends[n]
    args = [args[0], ",".join(f"{c + d:.3f}" for d in (-0.25, -0.15, -0.05, 0.05, 0.15, 0.35))]
    # cut n opens shots-timeline row n+1 when the rows are the video's shots (one more row than cuts)
    import json
    conf = json.loads(Path("package.json").read_text(encoding="utf8")).get("live-studio", {}) if Path("package.json").exists() else {}
    rows_file = conf.get("shotsTimeline")
    rows = json.loads(Path(rows_file).read_text(encoding="utf8")) if rows_file and Path(rows_file).exists() else None
    meet = ""
    if isinstance(rows, list) and len(rows) == len(ends) + 1:
        a, b = rows[n], rows[n + 1]
        tr = b.get("transition") or {}
        fx = f"{tr.get('fx')} {tr.get('len', 0):g} s ({rows_file} [{n + 1}].transition)" if tr.get("fx") else f"a hard cut (a transition goes in {rows_file} [{n + 1}].transition)"
        meet = f': from shot {n} "{a.get("name", "")}" into shot {n + 1} "{b.get("name", "")}" (as the notes number them), {fx}'
    header = f"cut {n} at {c:.2f} s{meet}; 3 frames before, 3 after\nnext: bun run at {round(c, 2):g} names every row that places it"
    mode = f"cut{n}_"
if len(args) == 1 and not flags and not Path(args[0]).exists() and not re.fullmatch(r"[\d.,]+", args[0]):
    print(f"no {args[0]}: bun run sheet <video> 10,20.5,30, a video from renders/ (bun run render clip makes one)", file=sys.stderr)
    raise SystemExit(2)
if flags or len(args) not in (0, 2):
    why = f"unknown option {flags[0]}" if flags else "the video needs its seconds too" if len(args) == 1 else f"one video at a time, got {len(args)} words"
    print(f"{why}: bun run sheet, or bun run sheet <video> 10,20.5,30 (--help for more)", file=sys.stderr)
    raise SystemExit(2)


def say_if_stale(video):
    """The video older than a change to the film's picture data (live-studio src/stale.mjs, as framecheck says it)."""
    r = subprocess.run(["bun", str(Path(__file__).resolve().parents[2] / "packages/live-studio/src/stale.mjs"), str(video)],
                       capture_output=True, text=True, timeout=60)
    if r.stdout.strip():
        print(f"STALE: {r.stdout.strip()}")


def usage(why, code=2):
    print(why, file=sys.stderr)
    raise SystemExit(code)


tmp = None
if args:
    video = args[0]
    try:
        secs = [float(s) for s in args[1].split(",")]
    except ValueError:
        usage(f"seconds are numbers with commas, e.g. 10,20.5,30; got {args[1]}")
    # a render's chunk renders/chunks/cNN.mp4 starts at NN*30 s of the film; the seconds asked are the film's
    chunk = re.search(r"[\\/]?chunks[\\/]c(\d+)\.mp4$", video)
    try:
        start = float(os.environ["START"]) if "START" in os.environ else int(chunk.group(1)) * 30 if chunk else 0.0
        if not 0 <= start < 1e6:
            raise ValueError
    except ValueError:
        usage(f"START takes the film second the video starts at, 0 or more, got {os.environ['START']!r}")
    if Path(video).is_dir():
        usage(f"{video} is a folder, not a video: give it a render's mp4, as renders/draft_video.mp4")
    videos = ", ".join(sorted(p.relative_to(Path.cwd()).as_posix() for p in R.rglob("*.mp4"))[:8]) or "none yet"
    if not Path(video).is_file():
        usage(f"no {video} (the videos here: {videos}); a new one: bun run render clip")
    probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video], capture_output=True, text=True)
    try:
        dur = float(probe.stdout.strip())
    except ValueError:
        usage(f"{video} is no video ffprobe can read (the videos here: {videos})", 1)
    out = [s for s in secs if not start <= s < start + dur]
    if out:
        usage(f"{video} holds film seconds {start:g}-{start + dur:.2f}; outside it: {', '.join(f'{s:g}' for s in out)}")
    if start:
        print(f"film seconds from {start:g} s on ({'START' if 'START' in os.environ else 'the chunk' + chr(39) + 's start'})")
    if header:
        print(header)
    say_if_stale(video)
    # the video's frames go to a folder of their own, never over the film's rendered stills
    tmp = Path(tempfile.mkdtemp(prefix="sheet-"))
    for s in secs:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(s - start), "-i", video, "-frames:v", "1", "-q:v", "3", str(tmp / f"still_{s:g}s.jpg")], check=True)
    src, name = tmp, f"sheet_{Path(video).stem}_{mode}"
else:
    src, name = R, "sheet_"
files = sorted(src.glob("still_*.jpg"), key=lambda f: float(re.search(r"still_(-?[\d.]+)s", f.name).group(1)))
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
