"""Finds pops in a draft: frames that differ from the one before far more than the frames around them do (a mob
teleporting, an item snapping, a camera jerk). Planned cuts in edit.json are listed separately.
  python review/jumps.py renders/draft_video.mp4"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
video = sys.argv[1]
cuts = [k["t"] for k in json.loads((ROOT / "src/edit.json").read_text(encoding="utf8"))["cam"] if k.get("cut")]
# mean brightness of |frame - previous frame| on a small grey copy, one number per frame
log = subprocess.run(["ffmpeg", "-v", "info", "-i", video, "-vf", "scale=160:90,format=gray,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG",
                      "-f", "null", "-"], capture_output=True, text=True).stderr
d = [float(v) for v in re.findall(r"YAVG=([\d.]+)", log)]
out = []
for i in range(3, len(d) - 3):
    around = sorted(d[i - 3:i] + d[i + 1:i + 4])[3]
    if d[i] > 6 and d[i] > 3 * max(around, 1):
        t = (i + 1) / 30
        out.append((t, d[i], around, any(abs(t - c) < 0.1 for c in cuts)))
for t, v, a, cut in out:
    print(f"{int(t // 60):02d}:{t % 60:06.3f}  diff {v:5.1f} vs {a:4.1f}  {'(planned cut)' if cut else 'POP'}")
print(len([o for o in out if not o[3]]), "pops,", len([o for o in out if o[3]]), "cuts")
