import json
from pathlib import Path
import sys
import tempfile

import librosa
import numpy as np

from process import render


def analyze(source, settings):
    if "duration" not in settings or settings["duration"] is None:
        raise ValueError("Missing required duration in beat analysis settings")
    duration = float(settings["duration"])
    if not np.isfinite(duration) or duration < 0:
        raise ValueError(f"Invalid duration: {duration!r}")
    if duration == 0:
        return {"bpm": 0.0, "beats": []}
    with tempfile.TemporaryDirectory(prefix="studio-beats-") as folder:
        clip = Path(folder) / "clip.wav"
        render(source, clip, settings)
        samples, sr = librosa.load(clip, sr=22050, mono=True)
        if len(samples) == 0:
            return {"bpm": 0.0, "beats": []}
        tempo, beats = librosa.beat.beat_track(y=samples, sr=sr, hop_length=256, units="time")
        return {"bpm": round(float(np.asarray(tempo).reshape(-1)[0]), 2), "beats": [round(float(t), 4) for t in beats if 0 <= t < duration]}


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: python beats.py <source> < settings.json", file=sys.stderr)
        raise SystemExit(2)
    try:
        settings = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(f"beats.py: invalid JSON on stdin (line {e.lineno}, col {e.colno})", file=sys.stderr)
        raise SystemExit(2)
    if not isinstance(settings, dict):
        print("beats.py: settings JSON must be an object", file=sys.stderr)
        raise SystemExit(2)
    if not Path(sys.argv[1]).is_file():
        print(f"beats.py: missing source file {sys.argv[1]}", file=sys.stderr)
        raise SystemExit(1)
    try:
        print(json.dumps(analyze(sys.argv[1], settings)))
    except Exception as e:
        print(f"beats.py: {e}", file=sys.stderr)
        raise SystemExit(1)
