"""Optional yt-dlp acquisition; no speech inference, browser discovery or provider fallback."""
import json
import re
import subprocess
from pathlib import Path


def caption_track(info, language=None):
    manual, automatic = info.get("subtitles") or {}, info.get("automatic_captions") or {}
    tracks = {k for collection in (manual, automatic) for k, values in collection.items()
              if values and re.fullmatch(r"[A-Za-z0-9_-]+", k) and k != "live_chat"}
    if language:
        candidates = [language] if language in tracks else [k for k in tracks if k == language + "-orig"]
    else:
        original = info.get("language")
        candidates = [k for k in (original, f"{original}-orig") if k in tracks] if original else []
        if not candidates:
            originals = sorted(k for k in tracks if k.endswith("-orig"))
            candidates = originals if len(originals) == 1 else []
        if not candidates and len(tracks) == 1:
            candidates = sorted(tracks)
    if not candidates:
        return None, {"status": "missing", "reason": "no unambiguous matching caption track; choose --language",
                      "availableLanguages": sorted(tracks)}
    code = candidates[0]
    provenance = "manual" if manual.get(code) else "automatic"
    return code, {"status": "pending", "language": code, "provenance": provenance,
                  "sourceLanguage": info.get("language"), "availableLanguages": sorted(tracks)}


def downloader(args):
    result = subprocess.run(["yt-dlp", "--ignore-config", "--no-playlist", "--playlist-items", "1",
                             "--socket-timeout", "20", "--retries", "1", "--fragment-retries", "1",
                             "--no-progress", *args], capture_output=True, text=True, encoding="utf8",
                            errors="replace", timeout=120)
    if result.returncode:
        raise RuntimeError(result.stderr[-4000:] or "yt-dlp failed")
    return result.stdout


def remote_source(url, out, *, language=None, transcript_only=False, transcript_provided=False,
                  cookies=None, browser=None, runtime=None):
    auth = (["--cookies", cookies] if cookies else ["--cookies-from-browser", browser] if browser else [])
    if runtime:
        auth += ["--js-runtimes", runtime]
    result = {"path": None, "transcript": None, "captions": {"status": "missing"}, "errors": []}
    def checkpoint():
        pending = out / "acquisition.json.tmp"
        pending.write_text(json.dumps(result, ensure_ascii=False, indent=2, default=str), encoding="utf8")
        pending.replace(out / "acquisition.json")
    checkpoint()
    try:
        info = json.loads(downloader([*auth, "--dump-single-json", "--skip-download", "--write-subs",
                                      "--write-auto-subs", "--sub-langs", "all", "--", url]))
        if info.get("entries") is not None or info.get("_type", "video") not in ("video", "url_transparent"):
            result["errors"].append("give one video URL, not a collection")
            checkpoint()
            return result
        metadata = {k: info.get(k) for k in ("id", "title", "extractor", "webpage_url", "language", "duration", "license")}
        (out / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf8")
        result["metadata"] = metadata
        checkpoint()
        if not transcript_provided:
            code, captions = caption_track(info, language)
            result["captions"] = captions
            if code:
                folder = out / "captions"
                folder.mkdir()
                flags = ["--write-subs", "--no-write-auto-subs"] if captions["provenance"] == "manual" else ["--no-write-subs", "--write-auto-subs"]
                try:
                    downloader([*auth, "--skip-download", "--no-simulate", *flags,
                                "--sub-langs", "^" + re.escape(code) + "$", "--sub-format", "vtt/srt",
                                "-o", str(folder / "captions.%(ext)s"), "--", url])
                    files = [p for p in folder.iterdir() if p.suffix in (".vtt", ".srt")]
                    if len(files) != 1:
                        raise ValueError("selected caption track did not produce one VTT/SRT file")
                    result["transcript"] = files[0]
                    captions["status"] = "available"
                except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as e:
                    captions.update(status="failed", reason=str(e))
                    result["errors"].append(f"captions: {e}")
            checkpoint()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as e:
        result["errors"].append(f"source metadata: {e}")
        checkpoint()
    if not transcript_only:
        try:
            text = downloader([*auth, "--no-simulate", "--print", "after_move:filepath",
                               "-f", "bv*[height<=720]+ba/b[height<=720]/b", "--merge-output-format", "mp4",
                               "-o", str(out / "source.%(ext)s"), "--", url])
            paths = [Path(line.strip()).resolve() for line in text.splitlines() if line.strip()]
            if len(paths) != 1 or paths[0].parent != out or not paths[0].is_file() or paths[0].suffix in (".part", ".ytdl"):
                raise ValueError("download did not report one completed media file inside this run")
            result["path"] = paths[0]
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as e:
            result["errors"].append(f"media: {e}")
        checkpoint()
    return result
