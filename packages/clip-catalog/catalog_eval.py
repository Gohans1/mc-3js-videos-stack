"""Compare Jev's mocap picks for plain-English scenes, then judge the changed picks by eye.
python ../../packages/clip-catalog/catalog_eval.py OUT.txt [-n 5] [--timeline] [--limit N] [--resume]
Runs from any directory. Sends scene words and catalogue descriptions to Jev's configured providers;
may use paid fallback, once per scene (~$0.002/search, ~5x with --timeline; provider rates can change).
Default scenes: catalog_eval.txt. OUT.txt.jsonl checkpoints every scene; --resume retries failed/missing scenes.
Use a new output path when code/data changes, so comparisons cannot mix versions. Each scene has a timeout.
"""
import argparse
import json
import math
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("out", type=Path)
    ap.add_argument("-n", type=int, default=5, help="picks per scene")
    ap.add_argument("--timeline", action="store_true", help="include measured timeline in Jev input (~5x quota)")
    ap.add_argument("--scenes", type=Path, default=HERE / "catalog_eval.txt", help="one scene per line, # comments")
    ap.add_argument("--limit", type=int, help="at most N pending scenes this run")
    ap.add_argument("--timeout", type=float, default=180, help="seconds per scene, default 180")
    ap.add_argument("--resume", action="store_true", help="continue the same output/checkpoint")
    a = ap.parse_args(["--help"] if sys.argv[1:2] == ["help"] else None)
    if a.n <= 0 or a.timeout <= 0 or not math.isfinite(a.timeout) or (a.limit is not None and a.limit <= 0):
        ap.error("-n, --limit and --timeout must be positive finite numbers")
    checkpoint = Path(str(a.out) + ".jsonl")
    try:
        scenes = list(dict.fromkeys(l.strip() for l in a.scenes.read_text(encoding="utf-8-sig").splitlines()
                                   if l.strip() and not l.lstrip().startswith("#")))
        if not scenes:
            ap.error(f"no scenes in {a.scenes}: add one plain-English scene per line")
        if not a.resume and (a.out.exists() or checkpoint.exists()):
            ap.error(f"{a.out} or its checkpoint exists: use a fresh output path, or --resume for this same run")
        if a.resume and not checkpoint.exists():
            ap.error(f"no {checkpoint}: start with a new output path without --resume")
        records = [json.loads(l) for l in checkpoint.read_text(encoding="utf8").splitlines() if l.strip()] if a.resume else []
        settings = {"scenes": scenes, "n": a.n, "timeline": a.timeline}
        if records and records[0] != settings:
            ap.error("checkpoint settings differ: use the original scenes/options or a new output path")
        latest = {r["scene"]: r for r in records[1:]}
        pending = [s for s in scenes if s not in latest or latest[s].get("error")][:a.limit]
        a.out.parent.mkdir(parents=True, exist_ok=True)
        with checkpoint.open("a", encoding="utf8") as progress:
            if not records:
                progress.write(json.dumps(settings) + "\n")
                progress.flush()
            failed = False
            for k, scene in enumerate(pending):
                command = [sys.executable, str(HERE / "catalog.py"), "--jev", scene, "-n", str(a.n)]
                if a.timeline:
                    command.append("--timeline")
                try:
                    result = subprocess.run(command, capture_output=True, text=True, encoding="utf8", timeout=a.timeout)
                    record = {"scene": scene, "output": result.stdout, "error": result.stderr[-2000:] or f"exit {result.returncode}" if result.returncode else ""}
                except subprocess.TimeoutExpired:
                    record = {"scene": scene, "output": "", "error": f"timed out after {a.timeout}s"}
                latest[scene] = record
                failed |= bool(record["error"])
                progress.write(json.dumps(record, ensure_ascii=False) + "\n")
                progress.flush()
                save_output(a.out, scenes, latest)
                print(f"{k + 1}/{len(pending)} saved: {scene}" + (" (failed)" if record["error"] else ""), file=sys.stderr, flush=True)
        save_output(a.out, scenes, latest)
    except (OSError, ValueError, KeyError) as e:
        ap.error(f"{e}; inspect the named file before retrying")
    except KeyboardInterrupt:
        print(f"interrupted; completed scenes kept in {checkpoint}; rerun with --resume", file=sys.stderr)
        return 1
    print(f"{len(latest)}/{len(scenes)} scenes in {a.out}\nnext: compare this output with another run; --resume continues pending/failed scenes")
    return int(any(r.get("error") for r in latest.values()))


def save_output(path, scenes, latest):
    text = "".join(f"## {scene}\n{latest[scene]['output']}" + (f"ERROR {latest[scene]['error']}\n" if latest[scene]["error"] else "")
                   for scene in scenes if scene in latest)
    tmp = Path(str(path) + ".new")
    tmp.write_text(text, encoding="utf8")
    tmp.replace(path)


if __name__ == "__main__":
    sys.exit(main())
