"""Optional CPU scene detection for reference footage; measurements do not edit the film.

bun run scenes <video> [--method adaptive|content|threshold] [--threshold N]
  [--from 0:10 --to 0:30] [--min-scene 0.6] [--minutes 5] [--out DIR] [--no-images]

Each run keeps result.json, native scenes.csv, metrics.csv and detector.log in a new
run-* folder under --out (default: renders/scenes). --from and --to select evidence;
the detector scans the full source to keep cuts consistent across ranges. JSON uses
input-file seconds without film speed/span offsets. Frame indices are zero-based with
an exclusive end. startPtsMatched and endPtsMatched identify verified picture bounds.
The HTML gallery saves up to three distinct displayed frames per verified scene in
the requested range, unless --no-images. Each image has its requested time and PTS.
adaptive handles cuts amid camera motion; content measures picture differences;
threshold detects fades through darkness. Try another method/threshold if needed.
Threshold must be finite and >= 0; content/threshold accept at most 255.

Free/local, no GPU, models, uploads or audio analysis. Setup at the repo root:
  uv venv --python 3.12 .venv
  uv pip install --python .venv/Scripts/python.exe -r scripts/review/requirements.txt
SCENEDETECT_PYTHON can select another Python with scenedetect installed. Otherwise
uses the root .venv, then the current Python. Strict picture decode, detection and
gallery generation share --minutes (default 5, maximum 60) after probing.
Finished artifacts and source validation errors survive failure.
For advanced upstream features use that Python's -m scenedetect --help directly.
"""
import argparse
import bisect
import csv
import html
import json
import math
import os
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from seconds import heard_second  # noqa: E402
from review.sheet_view import (  # noqa: E402
    displayed_time, extract_displayed_frame, presentation_times, sample_aspects, seconds, video_bounds,
)


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


def scene_timestamp(estimate, stamps):
    # PySceneDetect's CSV rounds seconds to milliseconds.
    left = bisect.bisect_left(stamps, estimate - 0.000501)
    right = bisect.bisect_right(stamps, estimate + 0.000501)
    if right - left == 1:
        return stamps[left], left
    return estimate, None


def write_gallery(source, run, scenes, times, origin, start, end, deadline):
    title = html.escape(source.name)
    sections = []
    aspects = sample_aspects(source, origin, min(end if end is not None else times[-1], times[-1]),
                            deadline=deadline) if scenes and times else {}
    for scene in scenes:
        number = scene["scene"]
        images = scene["images"] = []
        sections.append(f"<section><h2>Scene {number}</h2>")
        if not (scene["startPtsMatched"] and scene["endPtsMatched"]):
            scene["imageStatus"] = "unverified-bounds"
            sections.append("<p>Images unavailable. The scene bounds are detector estimates.</p></section>")
            continue
        first, stop = scene["startSeconds"], scene["endSeconds"]
        left = max(first, start)
        right = min(stop, end) if end is not None else stop
        seen = set()
        for fraction in (0.15, 0.5, 0.85):
            target = left + (right - left) * fraction
            pts = displayed_time(times, target)
            if pts in seen or pts < times[scene["startFrame"]] or pts >= stop:
                continue
            seen.add(pts)
            name = f"scene-{number:03d}-{len(images) + 1:02d}.jpg"
            aspect = aspects.get(round(pts, 9))
            actual = extract_displayed_frame(source, run / name, pts, origin=origin, compact=True,
                                             aspect=aspect, deadline=deadline)
            images.append({"file": name, "requestedTime": round(target, 9), "sourceTime": round(actual, 9),
                           "sampleAspectRatio": str(aspect) if aspect is not None else None})
            at = seconds(actual)
            sections.append(f'<figure><img src="{name}" alt="Scene {number} at {at} s">'
                            f'<figcaption>PTS {at} s</figcaption></figure>')
        scene["imageStatus"] = "ready" if images else "unavailable"
        if not images:
            sections.append("<p>No verified picture in the selected range.</p>")
        sections.append("</section>")
    header = ('<!doctype html><html lang="en"><meta charset="utf-8">'
              f'<title>Scenes · {title}</title><h1>Scenes · {title}</h1>'
              '<style>figure{display:inline-block;margin:0 1em 1em 0}img{max-width:320px}</style>')
    (run / "scenes.html").write_text("\n".join([header, *sections, "</html>"]) + "\n", encoding="utf-8")


def run_detector(command, log, timeout):
    with open(log, "a", encoding="utf-8") as stream:
        subprocess.run(command, stdout=stream, stderr=subprocess.STDOUT, check=True,
                       timeout=timeout, env={**os.environ, "PYTHONIOENCODING": "utf-8"},
                       creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)


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
    sys.stdout.reconfigure(encoding="utf8")
    sys.stderr.reconfigure(encoding="utf8")
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
    picture_from, picture_end, origin, times, probe_error = None, None, 0, [], None
    try:
        picture_from, picture_end, origin, _ = video_bounds(source)
        times = presentation_times(source, origin)
    except (OSError, ValueError, KeyError, IndexError, subprocess.SubprocessError) as error:
        probe_error = error
    offset = picture_from or 0
    if args.end is not None and args.end <= offset:
        parser.error("--to must be after the first picture")
    if picture_end is not None and args.start >= picture_end:
        parser.error("--from must be before the picture ends")
    args.out.mkdir(parents=True, exist_ok=True)
    run = Path(tempfile.mkdtemp(prefix="run-", dir=args.out)).resolve()
    report = run / "result.json"
    (run / "scenedetect.cfg").write_text("[global]\n", encoding="utf-8")
    threshold = args.threshold if args.threshold is not None else {"adaptive": 3, "content": 27, "threshold": 12}[args.method]
    command = [python, "-m", "scenedetect", "-c", str(run / "scenedetect.cfg"),
               "-i", str(source), "-o", str(run), "-b", "opencv", "-m", f"{args.min_scene}s",
               "-s", str(run / "metrics.csv"), f"detect-{args.method}", "--threshold", str(threshold),
               "list-scenes", "--skip-cuts", "--filename", "scenes.csv"]
    stat = source.stat()
    result = {"schemaVersion": 1, "status": "running", "startedAt": datetime.now(timezone.utc).isoformat(),
              "source": {"path": str(source), "bytes": stat.st_size, "mtimeNs": stat.st_mtime_ns},
              "clock": ("input-file seconds; approximate detector times adjusted to picture start" if picture_from is not None
                        else "detector seconds; source picture start unavailable"),
              "pictureFrom": picture_from,
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
    if args.start or args.end is not None:
        print("Scanning the full source for detector context, then selecting evidence in the requested range.", file=sys.stderr)
    exit_code = 0
    deadline = time.monotonic() + args.minutes * 60
    try:
        if probe_error is not None:
            result["stage"] = "source-probe"
            raise probe_error
        result["stage"] = "source-decode"
        save()
        subprocess.run(["ffmpeg", "-nostdin", "-xerror", "-v", "error", "-i", str(source),
                        "-map", "0:V:0", "-fps_mode", "passthrough", "-f", "null", "-"],
                       check=True, capture_output=True, timeout=deadline - time.monotonic())
        del result["stage"]
        version = subprocess.run([python, "-c", "import importlib.metadata; print(importlib.metadata.version('scenedetect'))"],
                                 capture_output=True, text=True, check=True, timeout=min(10, deadline - time.monotonic()))
        result["detector"]["version"] = version.stdout.strip()
        save()
        run_detector(command, run / "detector.log", deadline - time.monotonic())
        scenes = read_scenes(run / "scenes.csv")
        edges = times[:]
        if edges and picture_end - edges[-1] > 0.001:
            edges.append(picture_end)
        cuts = []
        for i, scene in enumerate(scenes):
            start, start_index = scene_timestamp(scene["startSeconds"] + offset, times)
            end, end_index = scene_timestamp(scene["endSeconds"] + offset, edges)
            if i + 1 == len(scenes) and times and end >= times[-1] - 0.000501:
                end, end_index = picture_end, len(times)
            if start >= end:
                start, end = scene["startSeconds"] + offset, scene["endSeconds"] + offset
                start_index, end_index = None, None
            if start_index is not None:
                scene["startFrame"] = start_index
            if end_index is not None:
                scene["endFrame"] = end_index
            scene.update(startSeconds=round(start, 9), endSeconds=round(end, 9),
                         startPtsMatched=start_index is not None, endPtsMatched=end_index is not None)
        for scene in scenes[1:]:
            cut = scene["startSeconds"]
            if cut >= args.start and (args.end is None or cut < args.end):
                cuts.append(cut)
        scenes = [s for s in scenes if s["endSeconds"] > args.start and (args.end is None or s["startSeconds"] < args.end)]
        if times:
            result["clock"] = "input-file seconds; each PtsMatched flag identifies a bound confirmed against picture timestamps"
        result.update(scenes=scenes, cutsSeconds=cuts)
        if not args.no_images:
            write_gallery(source, run, scenes, times, origin, args.start, args.end, deadline)
        result["status"] = "completed"
    except (OSError, ValueError, KeyError, IndexError, subprocess.SubprocessError, KeyboardInterrupt) as error:
        status = "interrupted" if isinstance(error, KeyboardInterrupt) else "timed_out" if isinstance(error, subprocess.TimeoutExpired) else "failed"
        prefix = "source picture validation: " if result.get("stage") in {"source-probe", "source-decode"} else ""
        result.update(status=status, error=prefix + (str(error) or status))
        stderr = getattr(error, "stderr", None)
        if isinstance(stderr, bytes):
            stderr = stderr.decode("utf8", errors="replace")
        if stderr:
            result["error"] += "\n" + stderr.strip()
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
