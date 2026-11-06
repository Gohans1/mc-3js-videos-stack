"""Runs every scene of lab/catalog_eval.txt through lab/catalog.py --jev and writes the top picks per scene, so two
versions of what Jev reads can be compared side by side (diff the outputs, then judge the changed picks by eye).
python lab/catalog_eval.py OUT.txt [-n 5] [--timeline]"""
import argparse, subprocess, sys
from pathlib import Path

ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument("out")
ap.add_argument("-n", type=int, default=5)
ap.add_argument("--timeline", action="store_true", help="passed on to catalog.py")
a = ap.parse_args()
scenes = [l.strip() for l in Path("lab/catalog_eval.txt").read_text(encoding="utf-8").splitlines() if l.strip() and not l.startswith("#")]
with open(a.out, "w", encoding="utf-8") as out:
    for k, s in enumerate(scenes):
        r = subprocess.run([sys.executable, "lab/catalog.py", "--jev", s, "-n", str(a.n)] + (["--timeline"] if a.timeline else []), capture_output=True, text=True, encoding="utf-8")
        # a result line: "<rank prob>  [fits <yes prob>]  <lib/clip> ..." (fits on the first few only)
        picks = [l.split("  ")[:3] for l in r.stdout.splitlines() if l and not l.startswith(" ")]
        picks = [" ".join([p[0]] + [w.replace("fits ", "fit ") for w in p[1:] if w.startswith("fits") or "/" in w]) for p in picks]
        out.write(f"## {s}\n" + "".join(f"{p}\n" for p in picks) + (f"ERROR {r.stderr[-300:]}\n" if r.returncode else ""))
        print(f"{k + 1}/{len(scenes)}", file=sys.stderr)
