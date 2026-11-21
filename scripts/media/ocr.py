"""Read text from local images or sampled video frames with CPU RapidOCR.

  bun run media ocr image.png
  bun run media ocr reference.mp4 --at 0:05,0:10
  bun run media ocr reference.mp4 --from 10 --to 30 --frames 12
  bun run media ocr image.png --language vi --config config.yaml

--at, --from and --to use input-file seconds, without film offsets or speed changes.
Default: 12 evenly spaced video frames; images have no timestamp. Source frames,
text boxes and model scores are retained in frames.jsonl and result.json.
Scores are model estimates, not verified correctness. No uploads or paid APIs.
First inference may download official model files; later runs use the kept cache.
--config preserves RapidOCR's native model/engine options; --language selects the
recognizer language route. Models/default routes follow RapidOCR 3.10.0.
--dry-run validates and prints the plan without loading OCR or writing files.
"""
import argparse
import hashlib
import importlib.metadata
import json
import math
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from seconds import heard_second  # noqa: E402


def second(value):
    number = heard_second(value)
    if number is None or not math.isfinite(number):
        raise argparse.ArgumentTypeError("takes a finite file second, e.g. 1:05.250")
    return number


def frame_times(start, end, count, pins, duration):
    end = duration if end is None else end
    if not 0 <= start < end <= duration:
        raise ValueError("range must be inside the input video and --to must be after --from")
    if pins:
        if any(not start <= t < end for t in pins):
            raise ValueError("--at times must be inside the source range, before its end")
        if len(set(pins)) > count:
            raise ValueError("more --at times than --frames; raise --frames")
        return sorted(set(pins))
    return [start + (end - start) * (i + 0.5) / count for i in range(count)]


def main():
    parser = argparse.ArgumentParser(prog="bun run media ocr", description=__doc__, allow_abbrev=False,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", type=Path)
    parser.add_argument("--at", default="")
    parser.add_argument("--from", dest="start", type=second, default=0.0)
    parser.add_argument("--to", dest="end", type=second)
    parser.add_argument("--frames", type=int, default=12)
    parser.add_argument("--score", type=float)
    parser.add_argument("--language")
    parser.add_argument("--config", type=Path)
    parser.add_argument("--out", type=Path, default=os.environ.get("MC_MEDIA_RUN_DIR"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    source = args.source.resolve()
    if not source.is_file():
        parser.error(f"not a local file: {source}")
    if args.frames < 1:
        parser.error("--frames must be at least 1")
    if args.score is not None and (not math.isfinite(args.score) or not 0 <= args.score <= 1):
        parser.error("--score must be between 0 and 1")
    if args.config and not args.config.is_file():
        parser.error("--config must be a local RapidOCR YAML file")
    image = source.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff")
    try:
        pins = [second(value) for value in args.at.split(",")] if args.at else []
        if image:
            if pins or args.start or args.end is not None:
                parser.error("images do not take video times")
            times = [None]
        else:
            probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                    "-of", "json", str(source)], capture_output=True, text=True, check=True, timeout=15)
            duration = float(json.loads(probe.stdout)["format"]["duration"])
            if not math.isfinite(duration):
                raise ValueError("video duration is not finite")
            times = frame_times(args.start, args.end, args.frames, pins, duration)
    except (argparse.ArgumentTypeError, OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        parser.error(str(error))
    plan = {"source": str(source), "clock": "input-file seconds; images have null time", "times": times,
            "language": args.language, "config": str(args.config.resolve()) if args.config else None,
            "scoreThreshold": args.score}
    if args.dry_run:
        print(json.dumps(plan, ensure_ascii=False))
        return 0
    if args.out is None:
        parser.error("--out is required outside bun run media")
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    frames = out / "frames"
    frames.mkdir(exist_ok=True)
    result = {"schemaVersion": 1, "status": "partial", "plan": plan, "frames": []}

    def save():
        pending = out / "result.json.tmp"
        pending.write_text(json.dumps(result, indent=2, ensure_ascii=False, default=str) + "\n", encoding="utf-8")
        pending.replace(out / "result.json")

    save()
    try:
        from rapidocr import RapidOCR
        from omegaconf import OmegaConf
        params = {} if args.config else {"EngineConfig.onnxruntime.intra_op_num_threads": 2,
                                        "EngineConfig.onnxruntime.inter_op_num_threads": 2}
        if args.score is not None:
            params["Global.text_score"] = args.score
        if not args.config and os.environ.get("MC_MEDIA_MODELS_DIR"):
            params["Global.model_root_dir"] = os.environ["MC_MEDIA_MODELS_DIR"]
        if args.language:
            params["Rec.lang_type"] = args.language
        engine = RapidOCR(config_path=str(args.config) if args.config else None, params=params)
        result["backend"] = {"name": "RapidOCR", "version": importlib.metadata.version("rapidocr"),
                             "onnxruntime": importlib.metadata.version("onnxruntime"), "params": params}
        with source.open("rb") as stream:
            result["sourceSha256"] = hashlib.file_digest(stream, "sha256").hexdigest()
        save()
        with (out / "frames.jsonl").open("a", encoding="utf-8") as evidence:
            for index, at in enumerate(times):
                file = frames / f"frame-{index:04d}{source.suffix.lower() if image else '.png'}"
                if image:
                    shutil.copyfile(source, file)
                else:
                    subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-ss", str(at), "-i", str(source),
                                    "-frames:v", "1", "-update", "1", file.name], cwd=frames, check=True, timeout=30)
                started = time.monotonic()
                read = engine(str(file))
                result["backend"]["config"] = OmegaConf.to_container(engine.cfg, resolve=True, enum_to_str=True)
                text = [{"text": txt, "score": float(score), "box": box.tolist()}
                        for txt, score, box in zip(read.txts or (), read.scores or (), read.boxes if read.boxes is not None else ())]
                row = {"sourceSecond": at, "frame": file.relative_to(out).as_posix(), "text": text,
                       "secondsElapsed": round(time.monotonic() - started, 4)}
                evidence.write(json.dumps(row, ensure_ascii=False) + "\n")
                evidence.flush()
                result["frames"].append(row)
                save()
                print(f"frame {index + 1}/{len(times)}: {len(text)} text regions", flush=True)
        result["status"] = "completed"
        model_root = Path(engine.cfg.Global.model_root_dir)
        result["backend"]["cachedModelSha256"] = {}
        for model in model_root.glob("*.onnx"):
            with model.open("rb") as stream:
                result["backend"]["cachedModelSha256"][model.name] = hashlib.file_digest(stream, "sha256").hexdigest()
    except (Exception, KeyboardInterrupt) as error:
        result.update(status="interrupted" if isinstance(error, KeyboardInterrupt) else "failed", error=str(error))
        print(str(error), file=sys.stderr)
    save()
    print(out / "result.json")
    return 0 if result["status"] == "completed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
