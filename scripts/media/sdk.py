"""Local SDK media tools; run with bun run media <tool> --help.
Audio --from/--to and output timestamps use seconds in the source file.
The evidence WAV keeps track offsets on the container clock. Audio is decoded
and resampled from the beginning, then cut on the output sample grid.
Read audioCoverage for the analyzed extent when the requested range outlasts audio.
Audio format changes may also produce a PCM intermediate and decodePreparationCommand.
effects requires --config with at least one plugin. It keeps float PCM until the plugins run.
Replace the last replay argv element with a fresh output path.
The effects decodeCommand keeps PCM and speaker labels.
CLI --out DIR is the parent of a fresh run-* folder; --minutes N bounds the worker
(default 5). The bun wrapper handles these flags; standalone --out must be empty.
Models stay in the tool cache; inference never uploads media or changes timelines.
--config is native backend JSON (Pedalboard: an array of {name, parameters}).
Output paths, model cache, device and input paths remain owned by the adapter.
locate scores/spans are uncalibrated hypotheses, not verified event labels.
timeline accepts .otio to inspect, or JSON {fps, tracks:[{kind, clips:[
{url, start, duration, metadata} or {gap:true, duration}]}]}; ranges use frames.
"""
import argparse
import importlib.metadata
import json
import math
import os
import re
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from audio_sdk import audio_coverage, audio_replay_command, decode_audio, event_spans, pack_effect_input, process_audio
from native import digest
from ocr import second
from timeline import process_timeline, validate_timeline


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("tool", choices=("beat", "effects", "vad", "melody", "separate", "locate", "timeline"))
    parser.add_argument("source", type=Path)
    kind = sys.argv[1] if len(sys.argv) > 1 else None
    parser.set_defaults(start=0.0, end=None, config=None, model=None, query=[], threshold=0.0, tail=2.0, threads=2)
    if kind != "timeline":
        parser.add_argument("--from", dest="start", type=second, default=0.0)
        parser.add_argument("--to", dest="end", type=second)
    if kind in ("beat", "effects", "vad", "melody", "separate"):
        parser.add_argument("--config", type=Path)
    if kind in ("beat", "vad", "melody", "separate", "locate"):
        parser.add_argument("--model", type=Path)
    if kind == "locate":
        parser.add_argument("--query", action="append", default=[])
        parser.add_argument("--threshold", type=float, default=0.0)
    if kind == "effects":
        parser.add_argument("--tail", type=second, default=2.0)
    if kind in ("beat", "vad", "locate"):
        parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--out", type=Path, default=os.environ.get("MC_MEDIA_RUN_DIR"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    source = args.source.resolve()
    root = Path(__file__).resolve().parents[2]
    profile = json.loads((root / "scripts/media/tools.json").read_text(encoding="utf-8")).get(args.tool, {})
    home = Path(os.environ.get("MC_MEDIA_TOOL_HOME", root / "vault/tools/media" / args.tool)).resolve()
    config = [] if args.tool == "effects" else {}
    try:
        if not source.is_file():
            raise ValueError(f"not a local file: {source}")
        if args.threads < 1 or not math.isfinite(args.threshold):
            raise ValueError("--threads must be positive; --threshold must be finite")
        if args.end is not None and args.end <= args.start:
            raise ValueError("--to must be after --from")
        if args.config:
            config = json.loads(args.config.read_text(encoding="utf-8-sig"))
        if args.tool == "effects":
            if not args.config or not isinstance(config, list) or not config:
                raise ValueError("effects requires --config with a nonempty plugin array")
            for plugin in config:
                if not isinstance(plugin, dict) or not isinstance(plugin.get("name"), str) or not isinstance(plugin.get("parameters", {}), dict):
                    raise ValueError("each effect needs name and parameters")
        elif not isinstance(config, dict):
            raise ValueError("--config must be a JSON object")
        if args.tool == "locate" and (not args.query or not all(q.strip() for q in args.query)):
            raise ValueError("locate requires at least one nonempty --query")
        reserved = {"audio_path", "audio_file_path", "debug_file", "output_dir", "model_file_dir", "model_or_model_path", "checkpoint_path", "model", "device", "float16", "sample_rate", "log_formatter"}
        if isinstance(config, dict) and reserved.intersection(config):
            raise ValueError(f"--config cannot override owned paths/device: {sorted(reserved.intersection(config))}")
        if kind == "separate":
            output_format = config.get("output_format", "WAV")
            if not isinstance(output_format, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", output_format):
                raise ValueError("output_format must be a format name, without path separators or a drive")
        if args.tool == "timeline" and source.suffix.lower() != ".otio":
            validate_timeline(json.loads(source.read_text(encoding="utf-8")))
    except (OSError, ValueError, TypeError, KeyError) as error:
        parser.error(str(error))
    model = args.model.resolve() if args.model else home / profile["defaultModel"] if profile.get("defaultModel") else None
    plan = {"tool": args.tool, "source": str(source), "fromSeconds": args.start, "toSeconds": args.end,
            "clock": "source-file seconds; timeline ranges are frames", "configuration": config,
            "model": str(model) if model else None, "queries": args.query, "threshold": args.threshold,
            "tailSeconds": args.tail,
            "requiredFiles": [str(model)] if model else []}
    if kind in ("beat", "vad", "locate"):
        plan["threads"] = args.threads
    elif kind == "separate":
        plan["threadControl"] = {"torch": args.threads, "onnx": "upstream defaults; no supported SDK thread setting"}
    if args.dry_run:
        print(json.dumps(plan, ensure_ascii=False))
        return 0
    if args.out is None:
        parser.error("run via bun run media, or provide --out")
    out = args.out.resolve()
    if out.exists() and any(p.name not in ("job.json", "process.log") for p in out.iterdir()):
        parser.error("--out must be empty; existing source/artifacts are kept intact")
    out.mkdir(parents=True, exist_ok=True)
    result = {"schemaVersion": 1, "status": "partial", "plan": plan,
              "backend": {"name": profile.get("name", args.tool), "codeLicense": profile.get("codeLicense"),
                          "modelLicense": profile.get("modelLicense")}}

    def save():
        pending = out / "result.json.tmp"
        pending.write_text(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")
        pending.replace(out / "result.json")

    save()
    try:
        result["sourceSha256"] = digest(source)
        result["backend"]["versions"] = {p.split("==")[0].split("[")[0]: importlib.metadata.version(p.split("==")[0].split("[")[0])
                                          for p in profile.get("packages", []) + profile.get("cpuPackages", [])}
        if args.config:
            shutil.copyfile(args.config, out / "configuration.json")
        if model and model.is_file():
            result["modelSha256"] = digest(model)
        elif model and model.is_dir():
            result["modelFiles"] = [{"file": p.name, "sha256": digest(p)} for p in sorted(model.iterdir())
                                    if p.is_file() and p.suffix in (".json", ".safetensors", ".bin", ".onnx")]
        if args.tool == "timeline":
            result.update(process_timeline(source, out))
        else:
            wav = out / "input.wav"
            rate = 16000 if args.tool == "vad" else 44100 if args.tool == "separate" else 48000
            effects = args.tool == "effects"

            def record_command(key, command):
                result[key] = audio_replay_command(command, wavex=effects and key == "decodeCommand")
                save()

            pcm_codec = "pcm_f32le" if effects else "pcm_s16le"
            decode_audio(source, wav, args.start, args.end, rate,
                         args.tool in ("vad", "locate", "beat"), record_command, pcm_codec=pcm_codec)
            if effects:
                pack_effect_input(wav)
            result["audioCoverage"] = audio_coverage(wav, args.start, args.end)
            save()
            details = process_audio(args, config, model, wav, out)
            json.dumps(details, allow_nan=False)
            result.update(details)
        result["status"] = "completed"
    except (Exception, KeyboardInterrupt) as error:
        result.update(status="interrupted" if isinstance(error, KeyboardInterrupt) else "failed", error=str(error))
        print(str(error), file=sys.stderr)
    save()
    print(out / "result.json")
    return 0 if result["status"] == "completed" else 1


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8", errors="backslashreplace")
    raise SystemExit(main())
