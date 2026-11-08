"""Contact sheets for self-review: every renders/still_*.jpg (or frames pulled from a video) in time order,
6 per sheet (3 x 2, 640 wide each); a draft still carries its time and shot in the strip under the picture.
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
# tiles 640 wide at the stills' own shape (a draft still is the picture with its time strip under it)
TH = 360
if files:
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
    subprocess.run(["ffmpeg", "-v", "error", "-y", *inp, "-filter_complex", filt, "-frames:v", "1", str(R / f"sheet_{i // 6}.jpg")], check=True)
print(len(files), "stills ->", (len(files) + 5) // 6, "sheets")
