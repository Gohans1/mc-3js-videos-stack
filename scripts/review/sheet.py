"""Contact sheets for self-review: every renders/still_*.jpg (or frames pulled from a video) in time order,
6 per sheet (3 x 2, 640x360 each); each still carries the draft's own mm:ss.sss label.
  python ../../scripts/review/sheet.py                       stills in renders/
  python ../../scripts/review/sheet.py renders/draft.mp4 10,20,30   frames of a video at those seconds"""
import re
import subprocess
import sys
from pathlib import Path

R = Path.cwd() / "renders"  # run from the film folder
if len(sys.argv) > 2:
    video, secs = sys.argv[1], [float(s) for s in sys.argv[2].split(",")]
    for s in secs:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(s), "-i", video, "-frames:v", "1", "-q:v", "3", str(R / f"still_{s:g}s.jpg")], check=True)
files = sorted(R.glob("still_*.jpg"), key=lambda f: float(re.search(r"still_([\d.]+)s", f.name).group(1)))
for old in R.glob("sheet_*.jpg"):
    old.unlink()
for i in range(0, len(files), 6):
    grp = files[i:i + 6]
    inp, filt = [], ""
    for k, f in enumerate(grp):
        inp += ["-i", str(f)]
        filt += f"[{k}:v]scale=640:360[v{k}];"  # the draft's own mm:ss.sss label names each picture
    n = len(grp)
    while n % 3:
        inp += ["-f", "lavfi", "-i", "color=black:s=640x360"]
        filt += f"[{n}:v]null[v{n}];"
        n += 1
    filt += "".join(f"[v{k}]" for k in range(n)) + f"xstack=inputs={n}:layout=" + "|".join(f"{(k % 3) * 640}_{(k // 3) * 360}" for k in range(n))
    subprocess.run(["ffmpeg", "-v", "error", "-y", *inp, "-filter_complex", filt, "-frames:v", "1", str(R / f"sheet_{i // 6}.jpg")], check=True)
print(len(files), "stills ->", (len(files) + 5) // 6, "sheets")
