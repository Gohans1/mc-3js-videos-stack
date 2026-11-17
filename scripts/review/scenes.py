"""Optional CPU scene detection for reference footage; measurements do not edit the film.

bun run scenes <video> [--method adaptive|content|threshold] [--threshold N]
  [--from 0:10 --to 0:30] [--min-scene 0.6] [--minutes 5] [--out DIR] [--no-images]

Each run keeps result.json, native scenes.csv, metrics.csv and detector.log in a new
run-* folder under --out (default: renders/scenes). Also saves three images per scene
and scenes.html unless --no-images. Times are seconds in the input file, without film
speed/span offsets; JSON frames are zero-based, end exclusive (approximate for VFR).
Empty upstream scene rows are omitted in JSON; scene numbers still match native images.
adaptive handles cuts amid camera motion; content measures picture differences;
threshold detects fades through darkness. Try another method/threshold if needed.
Threshold must be finite and >= 0; content/threshold accept at most 255.

Free/local, no GPU, models, uploads or audio analysis. Setup at the repo root:
  uv venv --python 3.12 .venv
  uv pip install --python .venv/Scripts/python.exe -r scripts/review/requirements.txt
SCENEDETECT_PYTHON can select another Python with scenedetect installed. Otherwise
uses the root .venv, then the current Python. The detector stops at
--minutes (default 5, maximum 60); logs and any finished artifacts survive failure.
For advanced upstream features use that Python's -m scenedetect --help directly.
"""
import argparse
import csv
import json
import math
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from seconds import heard_second  # noqa: E402


def read_scenes(file):
    with open(file, newline="", encoding="utf-8-sig") as stream:
        rows = list(csv.DictReader(stream))
    scenes = []
    for row in rows:
        scene = {"scene": int(row["Scene Number"]),
                 "startFrame": int(row["Start Frame"]) - 1,
                 "endFrame": int(row["End Frame"]),
                 "startSeconds": float(row["Start Time (seconds)"]),
                 "endSeconds": float(row["End Time (seconds)"])}
        if scene["startFrame"] == scene["endFrame"] and scene["startSeconds"] == scene["endSeconds"]:
            continue
        if (not all(math.isfinite(v) for v in scene.values())
                or scene["startFrame"] < 0 or scene["endFrame"] <= scene["startFrame"]
                or scene["startSeconds"] < 0 or scene["endSeconds"] <= scene["startSeconds"]):
            raise ValueError("invalid scene bounds in scenes.csv")
        scenes.append(scene)
    if not scenes:
        raise ValueError("no scenes returned; check input/range and detector.log")
    return scenes


def run_detector(command, log, timeout):
    with open(log, "a", encoding="utf-8") as stream:
        subprocess.run(command, stdout=stream, stderr=subprocess.STDOUT, check=True,
                       timeout=timeout, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)


def finite(text):
    value = float(text)
    if not math.isfinite(value) or value <= 0:
        raise argparse.ArgumentTypeError("takes a positive finite number")
    return value


def second(text):
    value = heard_second(text)
    if value is None or not math.isfinite(value):
        raise argparse.ArgumentTypeError("takes a file second (65, 1:05 or 01:05.250)")
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
                                     allow_abbrev=False)
    parser.add_argument("video")
    parser.add_argument("--method", choices=["adaptive", "content", "threshold"], default="adaptive")
    parser.add_argument("--threshold", type=float)
    parser.add_argument("--from", dest="start", type=second, default=0.0)
    parser.add_argument("--to", dest="end", type=second)
    parser.add_argument("--min-scene", type=finite, default=0.6)
    parser.add_argument("--minutes", type=finite, default=5.0)
    parser.add_argument("--out", type=Path, default=Path("renders/scenes"))
    parser.add_argument("--no-images", action="store_true")
    argv = sys.argv[1:]
    if "-h" in argv or "--help" in argv or argv[:1] == ["help"]:
        parser.print_help()
        return 0
    args = parser.parse_args(argv)
    source = Path(args.video).resolve()
    if not source.is_file():
        parser.error(f"not a local file: {source}")
    if args.end is not None and args.end <= args.start:
        parser.error("--to must be after --from")
    if args.minutes > 60:
        parser.error("--minutes must be at most 60")
    if args.threshold is not None:
        if not math.isfinite(args.threshold) or args.threshold < 0:
            parser.error("--threshold takes a nonnegative finite number")
        if args.method in ("content", "threshold") and args.threshold > 255:
            parser.error(f"--threshold must be at most 255 for {args.method}")

    root = Path(__file__).resolve().parents[2]
    executable = Path("Scripts/python.exe" if os.name == "nt" else "bin/python")
    local_python = root / ".venv" / executable
    python = os.environ.get("SCENEDETECT_PYTHON") or str(local_python if local_python.is_file() else Path(sys.executable))
    args.out.mkdir(parents=True, exist_ok=True)
    run = Path(tempfile.mkdtemp(prefix="run-", dir=args.out)).resolve()
    report = run / "result.json"
    (run / "scenedetect.cfg").write_text("[global]\n", encoding="utf-8")
    threshold = args.threshold if args.threshold is not None else {"adaptive": 3, "content": 27, "threshold": 12}[args.method]
    command = [python, "-m", "scenedetect", "-c", str(run / "scenedetect.cfg"),
               "-i", str(source), "-o", str(run), "-b", "opencv", "-m", f"{args.min_scene}s",
               "-s", str(run / "metrics.csv"), "time", "--start", f"{args.start}s"]
    if args.end is not None:
        command += ["--end", f"{args.end}s"]
    command += [f"detect-{args.method}", "--threshold", str(threshold),
                "list-scenes", "--skip-cuts", "--filename", "scenes.csv"]
    if not args.no_images:
        command += ["save-images", "--num-images", "3", "--width", "320", "--jpeg",
                    "--filename", "scene-$SCENE_NUMBER-$IMAGE_NUMBER", "save-html", "--filename", "scenes.html"]
    stat = source.stat()
    result = {"schemaVersion": 1, "status": "running", "startedAt": datetime.now(timezone.utc).isoformat(),
              "source": {"path": str(source), "bytes": stat.st_size, "mtimeNs": stat.st_mtime_ns},
              "clock": "input-file seconds; zero-based half-open frames (approximate for VFR)",
              "detector": {"name": "PySceneDetect", "method": args.method, "threshold": threshold,
                           "minSceneSeconds": args.min_scene, "python": python},
              "range": {"fromSeconds": args.start, "toSeconds": args.end},
              "deadlineMinutes": args.minutes, "command": command}

    def save():
        temporary = report.with_suffix(".tmp")
        temporary.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        temporary.replace(report)

    save()
    print(f"Scene detection: up to {args.minutes:g} minutes; evidence: {run}", flush=True)
    exit_code = 0
    try:
        version = subprocess.run([python, "-c", "import importlib.metadata; print(importlib.metadata.version('scenedetect'))"],
                                 capture_output=True, text=True, check=True, timeout=10)
        result["detector"]["version"] = version.stdout.strip()
        save()
        run_detector(command, run / "detector.log", args.minutes * 60)
        scenes = read_scenes(run / "scenes.csv")
        result.update(status="completed", scenes=scenes,
                      cutsSeconds=[scene["startSeconds"] for scene in scenes[1:]])
    except (OSError, ValueError, KeyError, subprocess.SubprocessError, KeyboardInterrupt) as error:
        status = "interrupted" if isinstance(error, KeyboardInterrupt) else "timed_out" if isinstance(error, subprocess.TimeoutExpired) else "failed"
        result.update(status=status, error=str(error) or status)
        if isinstance(error, subprocess.CalledProcessError) and error.stderr:
            result["error"] += "\n" + error.stderr.strip()
        print(f"{status}: {result['error']}; setup: bun run scenes --help; evidence: {run}", file=sys.stderr)
        exit_code = 130 if status == "interrupted" else 1
    result["finishedAt"] = datetime.now(timezone.utc).isoformat()
    result["artifacts"] = sorted(p.name for p in run.iterdir() if p.is_file() and p != report)
    save()
    if not exit_code:
        print(f"{len(result['scenes'])} scenes, {len(result['cutsSeconds'])} suggested cuts; {report}")
        if not args.no_images:
            print(f"Look: {run / 'scenes.html'}")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
