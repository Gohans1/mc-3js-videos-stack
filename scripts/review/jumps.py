"""Finds pops in a draft: frames that differ from the one before far more than the frames around them do (a mob
teleporting, an item snapping, a camera jerk). The cuts in renders/cuts.json (the last bun run render clip writes it,
framecheck reads the same) are listed separately.
  bun run jumps                            renders/draft_video.mp4, inside the film
  bun run jumps renders/chunks/c02.mp4     a chunk: its times are film seconds by itself (c02 starts at 60 s);
                                           START=60 says it for any other video
Make the video first: bun run render clip. bun run framecheck is the fuller check on the same file."""
import json
import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from stale import say_if_stale

ROOT = Path.cwd()  # the film's folder: bun run jumps runs it there
args = sys.argv[1:]
if args[:1] in (["-h"], ["--help"], ["help"]):
    print(__doc__)
    raise SystemExit
if len(args) > 1 or (args and args[0].startswith("-")):
    why = f"unknown option {args[0]}" if args[0].startswith("-") else f"one video at a time, got {len(args)}"
    print(f"{why}: bun run jumps [renders/draft_video.mp4] (--help for more)", file=sys.stderr)
    raise SystemExit(2)
video = args[0] if args else "renders/draft_video.mp4"


def one_edit(a, b):
    """a and b differ by one letter changed, added, dropped or two swapped"""
    if a == b or abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        off = [i for i in range(len(a)) if a[i] != b[i]]
        return len(off) == 1 or (len(off) == 2 and off[1] == off[0] + 1 and a[off[0]] == b[off[1]] and a[off[1]] == b[off[0]])
    short, long = sorted((a, b), key=len)
    return any(long[:i] + long[i + 1:] == short for i in range(len(long)))


# START is its only option: a near miss (STRT=60) would be read as no START at all
for key in os.environ:
    if one_edit(key, "START"):
        print(f"{key}={os.environ[key]} is no option here: did you mean START? (--help for more)", file=sys.stderr)
        raise SystemExit(2)
# a render's chunk renders/chunks/cNN.mp4 starts at NN*30 s of the film; START=<s> says it for any other video
chunk = re.search(r"[\\/]?chunks[\\/]c(\d+)\.mp4$", video)
try:
    start = float(os.environ["START"]) if "START" in os.environ else int(chunk.group(1)) * 30 if chunk else 0.0
    if not 0 <= start < 1e6:
        raise ValueError
except ValueError:
    print(f"START takes the film second the video starts at, 0 or more, got {os.environ['START']!r}", file=sys.stderr)
    raise SystemExit(2)
# nothing done on a path that is no video: exit 2, as every wrong word
if Path(video).is_dir():
    print(f"{video} is a folder, not a video: give it a render's mp4, as renders/draft_video.mp4", file=sys.stderr)
    raise SystemExit(2)
if not Path(video).is_file():
    videos = ", ".join(sorted(p.relative_to(ROOT).as_posix() for p in (ROOT / "renders").rglob("*.mp4"))[:8]) or "none yet"
    print(f"no {video} (the videos here: {videos}); a new one: bun run render clip", file=sys.stderr)
    raise SystemExit(2)
# ffprobe reads a picture as a one-frame video stream (image2, png_pipe, ...)
fmt = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_type:format=format_name", "-of", "csv=p=0", video], capture_output=True, text=True).stdout.split()
if "video" not in fmt or any(f.startswith("image2") or f.endswith("_pipe") for f in fmt):
    raise SystemExit(f"{video} is no video: give it a render's mp4, as renders/draft_video.mp4 (bun run render clip)")
# the cuts of the render that made the video, in heard seconds as the video is (the timeline files are in the voice's
# own seconds, before the warp), as framecheck reads them
cuts_file = ROOT / "renders/cuts.json"
cuts = sorted(json.loads(cuts_file.read_text(encoding="utf8"))) if cuts_file.exists() else []
if cuts:
    print(f"cuts from renders/cuts.json, the last bun run render clip's ({datetime.fromtimestamp(cuts_file.stat().st_mtime):%Y-%m-%d %H:%M}): a video from an older render may show a moved cut as a POP")
else:
    print("no renders/cuts.json: every cut will show as a POP (bun run render clip writes it)")
say_if_stale(video)
# mean brightness of |frame - previous frame| on a small grey copy, one number per frame
log = subprocess.run(["ffmpeg", "-v", "info", "-i", video, "-vf", "scale=160:90,format=gray,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG",
                      "-f", "null", "-"], capture_output=True, text=True).stderr
d = [float(v) for v in re.findall(r"YAVG=([\d.]+)", log)]
out = []
for i in range(3, len(d) - 3):
    around = sorted(d[i - 3:i] + d[i + 1:i + 4])[3]
    if d[i] > 6 and d[i] > 3 * max(around, 1):
        t = (i + 1) / 30 + start  # film seconds, as the cuts are
        out.append((t, d[i], around, any(abs(t - c) < 0.1 for c in cuts)))
if start:
    print(f"film seconds from {start:g} s on ({'START' if 'START' in os.environ else 'the chunk' + chr(39) + 's start'})")
for t, v, a, cut in out:
    print(f"{int(t // 60):02d}:{t % 60:06.3f}  diff {v:5.1f} vs {a:4.1f}  {'(planned cut)' if cut else 'POP'}")
pops = [t for t, _, _, cut in out if not cut]
print(len(pops), "pops,", len(out) - len(pops), "cuts")
if not pops:
    seconds = ",".join(f"{start + k * len(d) / 30:.1f}" for k in (0.2, 0.5, 0.8))
    print(f"next: black, flashes, shimmer, freezes: bun run framecheck {video}; look at it yourself: bun run sheet {video} {seconds}")
if pops:
    print(f"next: look at a pop (bun run sheet {video} {pops[0]:.2f}), fix the scene, re-render that stretch: CHUNKS={','.join(sorted({str(int(t // 30)) for t in pops}, key=int))} bun run render clip")
