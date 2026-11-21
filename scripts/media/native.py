"""Structured adapters for pinned local native media tools. Run via bun run media.
Each result retains its native stdout, input hash, parameters and artifacts.
--from/--to refer to input-file seconds; no film clock conversions or source edits.
Native binaries/models are installed by media setup, never downloaded by this worker.
Raw model scores/captions remain hypotheses; keep the original evidence for review.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ocr import second  # noqa: E402


def parse_ced(text):
    tags = []
    for line in text.splitlines():
        match = re.fullmatch(r"\s*(0(?:\.\d+)?|1(?:\.0+)?)\s+(.+?)\s*", line)
        if match:
            tags.append({"label": match[2], "score": float(match[1])})
    if not tags:
        raise ValueError("CED returned no recognizable scores; inspect native.stdout.txt")
    return tags


def digest(file):
    checksum = hashlib.sha256()
    with Path(file).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(block)
    return checksum.hexdigest()


def _help_for(kind):
    details = {
        "denoise": "Enhance noisy speech locally at 48 kHz; --from/--to use input-file seconds.",
        "ced": "Classify audio with tiny AudioSet CPU model; --from/--to use input-file seconds. Scores are independent, not onset times.",
        "midi": "Render editable MIDI into offline WAV audio with FluidSynth and a licensed SoundFont.",
        "fingerprint": "Generate local Chromaprint audio fingerprints without network lookup; --from/--to/--length use input-file seconds.",
        "tts": "Generate local English/other supported voice drafts with Kokoro CPU (no Vietnamese preset or forced alignment).",
        "caption": "Experimental local audio captioning (MiDashengLM CPU); --from/--to use input-file seconds. Treat text as unverified.",
        "vision": "Experimental local single-frame description (SmolVLM2 CPU); --at uses input-file seconds. Verify text against retained frames.",
        "metadata": "Read and export Broadcast WAV metadata XML with BWF MetaEdit without modifying the source.",
    }
    return (
        f"Structured adapters for pinned local native media tools: {kind}.\n"
        f"{details[kind]}\n"
        "Each result retains its native stdout, input hash, parameters and artifacts.\n"
        "Native binaries/models are installed by media setup, never downloaded by this worker.\n"
        "No film clock conversions or source edits."
    )


def main():
    kinds = ("denoise", "ced", "midi", "fingerprint", "tts", "caption", "vision", "metadata")
    if len(sys.argv) < 2 or sys.argv[1] not in kinds:
        raise SystemExit("native adapter requires a tool id; use bun run media list")
    kind = sys.argv[1]
    parser = argparse.ArgumentParser(
        prog=f"bun run media {kind}",
        description=_help_for(kind),
        allow_abbrev=False,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    if kind != "tts":
        parser.add_argument("source", type=Path)
    parser.add_argument("--out", type=Path, default=os.environ.get("MC_MEDIA_RUN_DIR"))
    parser.add_argument("--dry-run", action="store_true")
    if kind in ("ced", "tts", "caption", "vision"):
        parser.add_argument("--threads", type=int, default=4)
    if kind in ("denoise", "ced", "fingerprint", "caption"):
        parser.add_argument("--from", dest="start", type=second, default=0.0)
        parser.add_argument("--to", dest="end", type=second)
    if kind in ("ced", "tts", "caption", "vision"):
        parser.add_argument("--model", type=Path)
    if kind in ("caption", "vision"):
        parser.add_argument("--projector", type=Path)
        parser.add_argument("--prompt", default="Describe only the sounds you hear." if kind == "caption" else "Describe only what is visible in this image.")
        parser.add_argument("--tokens", type=int, default=96)
        parser.add_argument("--context", type=int, default=4096)
    if kind == "vision":
        parser.add_argument("--at", type=second, default=0.0)
    if kind == "ced":
        parser.add_argument("--top-k", type=int, default=5)
    if kind == "midi":
        parser.add_argument("--soundfont", type=Path)
    if kind == "fingerprint":
        parser.add_argument("--length", type=second, default=120.0)
    if kind == "tts":
        text = parser.add_mutually_exclusive_group(required=True)
        text.add_argument("--text")
        text.add_argument("--text-file", type=Path)
        parser.add_argument("--voice", default="af_heart")
        parser.add_argument("--language", default="en-us")
        parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args(sys.argv[2:])
    root = Path(__file__).resolve().parents[2]
    profiles = json.loads((root / "scripts/media/tools.json").read_text(encoding="utf-8"))
    if getattr(args, "threads", 1) < 1 or getattr(args, "tokens", 1) < 1 or getattr(args, "context", 1) < 1:
        parser.error("--threads, --tokens and --context must be positive")
    if kind == "fingerprint" and args.length <= 0:
        parser.error("--length must be positive")
    if not 1 <= getattr(args, "top_k", 1) <= 527:
        parser.error("--top-k must be between 1 and 527")
    start, end = getattr(args, "start", 0), getattr(args, "end", None)
    if end is not None and end <= start:
        parser.error("--to must be after --from")
    source = getattr(args, "source", None)
    if source:
        source = source.resolve()
        if not source.is_file():
            parser.error(f"not a local file: {source}")
    if kind == "midi" and source.suffix.lower() not in (".mid", ".midi"):
        parser.error("midi takes a .mid or .midi file")
    text_value = None
    if kind == "tts":
        if args.text_file and not args.text_file.is_file():
            parser.error("--text-file must exist")
        text_value = args.text_file.read_text(encoding="utf-8") if args.text_file else args.text
        if not text_value or not text_value.strip():
            parser.error("speech text must not be empty")
        if args.seed < 0:
            parser.error("--seed must be nonnegative")
    if kind not in profiles:
        parser.error(f"tool {kind} is not registered")
    profile = profiles[kind]
    home = Path(os.environ.get("MC_MEDIA_TOOL_HOME", root / "vault/tools/media" / kind)).resolve()
    binary = home / profile["binary"]
    model = getattr(args, "model", None) or (home / profile["defaultModel"] if profile.get("defaultModel") else None)
    projector = getattr(args, "projector", None) or (home / profile["defaultProjector"] if profile.get("defaultProjector") else None)
    soundfont = getattr(args, "soundfont", None) or (home / profile["defaultSoundfont"] if profile.get("defaultSoundfont") else None)
    model = model.resolve() if model else None
    projector = projector.resolve() if projector else None
    soundfont = soundfont.resolve() if soundfont else None
    required = [binary, *[p.resolve() for p in (model, projector, soundfont) if p],
                *[home / path for path in profile.get("requiredFiles", [])]]
    plan = {"tool": kind, "source": str(source) if source else None, "clock": "input-file seconds",
            "fromSeconds": start, "toSeconds": end, "requiredFiles": [str(p) for p in required],
            "parameters": {key: str(value) if isinstance(value, Path) else value for key, value in vars(args).items() if key not in ("out", "dry_run")}}
    if args.dry_run:
        print(json.dumps(plan, ensure_ascii=False))
        return 0
    for file in required:
        if not file.is_file():
            parser.error(f"missing {file}; bun run media setup {kind}")
    if args.out is None:
        parser.error("run via bun run media, or provide --out")
    out = args.out.resolve()
    if out.exists() and any(p.name not in ("job.json", "process.log") for p in out.iterdir()):
        parser.error("--out must be empty; existing source/artifacts are kept intact")
    out.mkdir(parents=True, exist_ok=True)
    result = {"schemaVersion": 1, "status": "partial", "plan": plan,
              "backend": {"name": profile["name"], "version": profile["version"],
                          "codeLicense": profile["codeLicense"], "modelLicense": profile.get("modelLicense")}}

    def save():
        pending = out / "result.json.tmp"
        pending.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        pending.replace(out / "result.json")

    def run(command, stdout=None, env=None):
        result["command"] = [str(value) for value in command]
        save()
        with (out / (stdout or "native.stdout.txt")).open("w", encoding="utf-8") as stream:
            subprocess.run(result["command"], cwd=out, stdout=stream, check=True, env=env, timeout=1800)

    save()
    try:
        if source:
            result["sourceSha256"] = digest(source)
        if model:
            result["backend"]["modelSha256"] = digest(model)
        if projector:
            result["backend"]["projectorSha256"] = digest(projector)
        audio = out / "input.wav"
        if kind in ("denoise", "ced", "fingerprint", "caption"):
            command = ["ffmpeg", "-v", "error", "-nostdin", "-ss", str(start), "-i", str(source), "-vn"]
            length = end - start if end is not None else args.length if kind == "fingerprint" else None
            if length is not None:
                command += ["-t", str(length)]
            command += ["-ar", "48000", "-c:a", "pcm_s16le", str(audio)]
            run(command, "decode.stdout.txt")
        if kind == "denoise":
            run([binary, "-D", "-o", out / "denoised", audio])
            result["audio"] = [p.relative_to(out).as_posix() for p in (out / "denoised").glob("*.wav")]
            if not result["audio"]:
                raise ValueError("denoiser returned no WAV")
        elif kind == "ced":
            run([binary, "classify", model, audio, "--top-k", str(args.top_k), "--threads", str(args.threads)])
            result["tags"] = parse_ced((out / "native.stdout.txt").read_text(encoding="utf-8"))
        elif kind == "fingerprint":
            run([binary, "-json", "-raw", "-length", str(args.length), audio])
            result["fingerprint"] = json.loads((out / "native.stdout.txt").read_text(encoding="utf-8"))
        elif kind == "midi":
            run([binary, "-ni", "-F", "music.wav", "-T", "wav", "-O", "s16", "-r", "48000", soundfont, source])
            result["audio"] = "music.wav"
            result["backend"]["soundfontSha256"] = digest(soundfont)
        elif kind == "tts":
            (out / "text.txt").write_text(text_value, encoding="utf-8")
            library = home / profile["espeakDirectory"]
            env = {**os.environ, "PATH": str(library) + os.pathsep + os.environ.get("PATH", ""),
                   "ESPEAK_DATA_PATH": str(library)}
            run([binary, "--task", "tts", "--family", "kokoro_tts", "--model", model, "--backend", "cpu",
                 "--threads", str(args.threads), "--language", args.language, "--voice-id", args.voice,
                 "--request-option", f"seed={args.seed}", "--text", text_value, "--out", "voice.wav"], env=env)
            result["audio"] = "voice.wav"
        elif kind in ("caption", "vision"):
            from llama import infer
            media = audio
            if kind == "vision":
                media = out / "frame.png"
                if source.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp", ".bmp"):
                    media = out / ("frame" + source.suffix.lower())
                    shutil.copyfile(source, media)
                else:
                    run(["ffmpeg", "-v", "error", "-nostdin", "-ss", str(args.at), "-i", source,
                         "-frames:v", "1", "-update", "1", "frame.png"], "decode.stdout.txt")
                result["frame"] = media.name
                result["sourceSecond"] = args.at if media.suffix == ".png" and source.suffix.lower() not in (".png",) else None
            response, command = infer(binary, model, projector, kind, media, args.prompt,
                                      args.tokens, args.context, args.threads, out)
            result["command"] = command
            result["verification"] = "unverified model hypothesis; compare with retained source media"
            result["text"] = response["choices"][0]["message"]["content"]
            if not isinstance(result["text"], str):
                raise ValueError("model response has no text content; inspect response.json")
        elif kind == "metadata":
            run([binary, "--out-xml=metadata.xml", source])
            result["metadata"] = "metadata.xml"
            if digest(source) != result["sourceSha256"]:
                raise ValueError("source changed during metadata inspection")
        result["status"] = "completed"
    except (Exception, KeyboardInterrupt) as error:
        result.update(status="interrupted" if isinstance(error, KeyboardInterrupt) else "failed", error=str(error))
        print(str(error), file=sys.stderr)
    save()
    print(out / "result.json")
    return 0 if result["status"] == "completed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
