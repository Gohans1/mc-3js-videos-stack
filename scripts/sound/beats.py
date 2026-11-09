import json
from pathlib import Path
import sys
import tempfile

import librosa
import numpy as np

from process import render


def analyze(source, settings):
    with tempfile.TemporaryDirectory(prefix="studio-beats-") as folder:
        clip = Path(folder) / "clip.wav"
        render(source, clip, settings)
        samples, sr = librosa.load(clip, sr=22050, mono=True)
        tempo, beats = librosa.beat.beat_track(y=samples, sr=sr, hop_length=256, units="time")
        return {"bpm": round(float(np.asarray(tempo).reshape(-1)[0]), 2), "beats": [round(float(t), 4) for t in beats if 0 <= t < settings["duration"]]}


if __name__ == "__main__":
    print(json.dumps(analyze(sys.argv[1], json.load(sys.stdin))))
