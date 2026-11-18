"""Lossless cue import for reference evidence; original files remain alongside normalized segments."""
import html
import json
import math
import re
from pathlib import Path


def stamp(value):
    parts = value.replace(",", ".").split(":")
    if len(parts) not in (2, 3) or not all(re.fullmatch(r"\d+(?:\.\d+)?", p) for p in parts):
        raise ValueError(f"invalid subtitle timestamp: {value}")
    numbers = [float(p) for p in parts]
    if any(n >= 60 for n in numbers[1:]):
        raise ValueError(f"invalid subtitle timestamp: {value}")
    return sum(n * 60 ** i for i, n in enumerate(reversed(numbers)))


def read_transcript(file):
    file = Path(file)
    raw = file.read_bytes()
    text = raw.decode("utf-16" if raw.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8-sig")
    if file.suffix.lower() == ".json":
        data = json.loads(text)
        segments = data.get("segments") if isinstance(data, dict) else data
        if not isinstance(segments, list):
            raise ValueError("transcript JSON needs a segments array with start, end and text")
    elif file.suffix.lower() in (".vtt", ".srt"):
        segments = []
        for block in re.split(r"\n\s*\n", text.replace("\r\n", "\n").strip()):
            lines = block.splitlines()
            if not lines or re.match(r"^(NOTE(?:\s|$)|STYLE$|REGION$)", lines[0]):
                continue
            for i, line in enumerate(lines):
                if "-->" not in line:
                    continue
                timing = re.fullmatch(r"\s*(\S+)\s+-->\s+(\S+)(?:\s+.*)?", line)
                if not timing:
                    raise ValueError(f"invalid subtitle cue: {line}")
                body = " ".join(lines[i + 1:])
                body = re.sub(r"<v(?:\.[^ >]+)?\s+([^>]+)>", lambda m: f"[{m[1]}] ", body)
                body = html.unescape(re.sub(r"<[^>]*>", "", body)).strip()
                if body:
                    segments.append({"start": stamp(timing[1]), "end": stamp(timing[2]), "text": body})
                break
        if not segments and "-->" in text:
            raise ValueError("no readable subtitle cues")
        if not segments and text.strip() and not text.lstrip().startswith("WEBVTT"):
            raise ValueError("no subtitle cues; provide VTT, SRT or segment JSON")
    else:
        raise ValueError("transcript must be VTT, SRT or segment JSON")
    for s in segments:
        if not isinstance(s, dict) or not isinstance(s.get("text"), str) or not s["text"].strip():
            raise ValueError("each transcript segment needs text")
        if not all(type(s.get(k)) in (int, float) and math.isfinite(s[k]) for k in ("start", "end")):
            raise ValueError("each transcript segment needs finite numeric start/end seconds")
        if not 0 <= s["start"] < s["end"]:
            raise ValueError("transcript segment times must satisfy 0 <= start < end")
    return sorted(segments, key=lambda s: s["start"])
