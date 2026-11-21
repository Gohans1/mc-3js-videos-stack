"""CPU reference tracking: tapir follows --point x,y (repeatable); track detects COCO boxes.
--query-frame indexes the sampled frames, not the source frame number; points use original pixels.
Frames/JSONL retain actual input-file timestamps, images and unverified model predictions.
CLI --out is the parent of a new run-*; --minutes bounds the job (default 5).
Defaults sample 16 frames at up to 5 fps; raise --frames for a longer span.
Models are installed by media setup; this worker never edits the source or timeline.
"""
import argparse
import importlib.metadata
import json
import math
import os
import re
import subprocess
import sys
from pathlib import Path

from native import digest
from ocr import second


def extract_frames(source, out, start, end, fps, count):
    out.mkdir(parents=True, exist_ok=True)
    select = f"gte(t,{start})*({'lte(t,' + str(end) + ')' if end is not None else '1'})*(isnan(prev_selected_t)+gte(t-prev_selected_t,{1 / fps - 1e-7}))"
    command = ["ffmpeg", "-hide_banner", "-nostdin", "-i", str(source), "-an", "-vf",
               f"select='{select}',showinfo", "-frames:v", str(count), "-fps_mode", "vfr", str(out / "frame-%06d.png")]
    with (out / "decode.log").open("w", encoding="utf-8") as log:
        subprocess.run(command, stdout=log, stderr=log, check=True, timeout=120)
    times = re.findall(r"\bn:\s*\d+\s+pts:\s*-?\d+\s+pts_time:([-+\deE.]+)", (out / "decode.log").read_text(encoding="utf-8"))
    files = sorted(out.glob("frame-*.png"))
    if not files or len(times) < len(files):
        raise ValueError("no timestamped frames decoded; inspect decode.log")
    rows = [{"frame": i, "sourceSecond": float(times[i]), "file": p.name} for i, p in enumerate(files)]
    (out / "frames.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    return rows


def point(text):
    try:
        values = [float(v) for v in text.split(",")]
        if len(values) != 2 or not all(math.isfinite(v) and v >= 0 for v in values):
            raise ValueError()
        return values
    except ValueError:
        raise argparse.ArgumentTypeError("--point requires two finite nonnegative pixels: x,y")


def predict(args, model_path, frames, out):
    import cv2
    import numpy as np
    import torch
    torch.set_num_threads(args.threads)
    torch.manual_seed(0)
    if args.tool == "tapir":
        from tapnet.torch import tapir_model
        images = [cv2.cvtColor(cv2.imread(str(out / row["file"])), cv2.COLOR_BGR2RGB) for row in frames]
        height, width = images[0].shape[:2]
        if args.query_frame >= len(frames) or any(x >= width or y >= height for x, y in args.point):
            raise ValueError("query frame/point falls outside the decoded frames")
        model = tapir_model.TAPIR(pyramid_level=1)
        model.load_state_dict(torch.load(model_path, map_location="cpu", weights_only=True))
        model.eval()
        values = torch.from_numpy(np.stack([cv2.resize(f, (256, 256)) for f in images])).float()[None] / 255 * 2 - 1
        queries = torch.tensor([[[args.query_frame, y / height * 256, x / width * 256] for x, y in args.point]])
        with torch.inference_mode():
            output = model(values, queries)
        tracks = output["tracks"][0].numpy()
        tracks[:, :, 0] *= width / 256
        tracks[:, :, 1] *= height / 256
        visibility = ((1 - torch.sigmoid(output["occlusion"])) * (1 - torch.sigmoid(output["expected_dist"])))[0].numpy()
        for i, frame in enumerate(frames):
            yield {**frame, "points": [{"point": p, "x": float(x), "y": float(y), "visibilityScore": float(visibility[p, i]),
                                       "visible": bool(visibility[p, i] > 0.5)} for p, (x, y) in enumerate(tracks[:, i])]}
    else:
        from rfdetr import RFDETRNano
        from trackers import ByteTrackTracker
        detector = RFDETRNano(device="cpu", pretrain_weights=str(model_path))
        model = detector.inference(compile=False)
        del detector
        tracker = ByteTrackTracker(frame_rate=args.fps)
        for frame in frames:
            image = cv2.cvtColor(cv2.imread(str(out / frame["file"])), cv2.COLOR_BGR2RGB)
            detections = model.predict(image, threshold=args.threshold)
            if args.classes:
                detections = detections[np.isin(detections.class_id, args.classes)]
            tracked = tracker.update(detections, timestamp=frame["sourceSecond"])
            yield {**frame, "boxes": [{"xyxy": box.tolist(), "classId": int(cls), "score": float(score),
                                      "trackId": int(identity) if identity >= 0 else None}
                                     for box, cls, score, identity in zip(tracked.xyxy, tracked.class_id, tracked.confidence, tracked.tracker_id)]}


TOOL_HELP = {
    "tapir": (
        "Track one or more reference points across frames on CPU (--point x,y, repeatable).\n"
        "--query-frame indexes the sampled frames, not the source frame number; points use original pixels."
    ),
    "track": (
        "Detect and track COCO object boxes across frames on CPU with RF-DETR Nano + ByteTrack.\n"
        "Filter with --threshold and repeatable --class <coco-id>."
    ),
}


def _help_for(kind):
    if kind not in TOOL_HELP:
        return __doc__
    return (
        f"{TOOL_HELP[kind]}\n"
        "Frames/JSONL retain actual input-file timestamps, images and unverified model predictions.\n"
        "Defaults sample 16 frames at up to 5 fps; raise --frames for a longer span. Models come from media setup."
    )


def main():
    valid_tools = ("tapir", "track")
    kind = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] in valid_tools else None
    parser = argparse.ArgumentParser(
        prog=f"bun run media {kind}" if kind else None,
        description=_help_for(kind),
        allow_abbrev=False,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    if not kind:
        parser.add_argument("tool", choices=valid_tools)
    parser.add_argument("source", type=Path)
    parser.add_argument("--from", dest="start", type=second, default=0.0)
    parser.add_argument("--to", dest="end", type=second)
    parser.add_argument("--fps", type=float, default=5)
    parser.add_argument("--frames", type=int, default=16)
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--model", type=Path)
    if kind == "tapir":
        parser.add_argument("--point", type=point, action="append", required=True)
        parser.add_argument("--query-frame", type=int, default=0)
    else:
        parser.add_argument("--threshold", type=float, default=0.3)
        parser.add_argument("--class", dest="classes", type=int, action="append", default=[])
    parser.add_argument("--out", type=Path, default=os.environ.get("MC_MEDIA_RUN_DIR"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(sys.argv[2:] if kind else None)
    if kind:
        args.tool = kind
    source = args.source.resolve()
    if not source.is_file():
        parser.error("source must be a local video file")
    if not math.isfinite(args.fps) or args.fps <= 0 or args.frames < 1 or args.threads < 1:
        parser.error("--fps, --frames and --threads must be positive and finite")
    if args.end is not None and args.end <= args.start:
        parser.error("--to must be after --from")
    if args.tool == "tapir" and not 0 <= args.query_frame < args.frames:
        parser.error("--query-frame must index the requested sampled frames")
    if args.tool == "track" and (not math.isfinite(args.threshold) or not 0 <= args.threshold <= 1 or any(c < 0 for c in args.classes)):
        parser.error("--threshold must be 0..1; --class must be nonnegative")
    root = Path(__file__).resolve().parents[2]
    profile = json.loads((root / "scripts/media/tools.json").read_text(encoding="utf-8"))[args.tool]
    home = Path(os.environ.get("MC_MEDIA_TOOL_HOME", root / "vault/tools/media" / args.tool))
    model = args.model.resolve() if args.model else home / profile["defaultModel"]
    plan = {"tool": args.tool, "source": str(source), "model": str(model), "requiredFiles": [str(model)],
            "parameters": {k: str(v) if isinstance(v, Path) else v for k, v in vars(args).items() if k not in ("out", "dry_run")}}
    if args.dry_run:
        print(json.dumps(plan))
        return 0
    if args.out is None:
        parser.error("run via bun run media or provide an empty --out")
    out = args.out.resolve()
    if out.exists() and any(p.name not in ("job.json", "process.log") for p in out.iterdir()):
        parser.error("--out must be empty; previous source/artifacts remain intact")
    out.mkdir(parents=True, exist_ok=True)
    result = {"status": "partial", "plan": plan, "verification": "unverified model predictions; inspect retained frames",
              "backend": {"source": profile["source"], "codeLicense": profile["codeLicense"], "modelLicense": profile["modelLicense"]}}

    def save():
        pending = out / "result.json.tmp"
        pending.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        pending.replace(out / "result.json")

    save()
    try:
        result.update(sourceSha256=digest(source), modelSha256=digest(model))
        result["backend"]["versions"] = {re.match(r"[\w.-]+", package)[0]: importlib.metadata.version(re.match(r"[\w.-]+", package)[0])
                                          for package in profile["packages"] + profile.get("cpuPackages", [])}
        frames = extract_frames(source, out, args.start, args.end, args.fps, args.frames)
        result["frameCount"] = len(frames)
        with (out / "tracks.jsonl").open("w", encoding="utf-8") as stream:
            for row in predict(args, model, frames, out):
                stream.write(json.dumps(row, allow_nan=False) + "\n")
                stream.flush()
        result.update(status="completed", tracks="tracks.jsonl", frames="frames.jsonl")
    except (Exception, KeyboardInterrupt) as error:
        result.update(status="failed", error=str(error))
        print(str(error), file=sys.stderr)
    save()
    print(out / "result.json")
    return 0 if result["status"] == "completed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
