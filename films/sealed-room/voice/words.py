"""Word timings for voice takes with whisperX (GPU), plus the pitch range of each take as a rough check that the acting is
not flat. Run with the lab venv that has whisperX: E:/threejs_lab/py/venv/Scripts/python.exe voice/words.py FILE...
Writes FILE.words.json beside each take. Unprimed on purpose: no script is given, so a mumbled word shows up as wrong text."""
import os
import json
import sys
from pathlib import Path

import numpy as np
os.environ.setdefault("HF_HOME", "E:/threejs_lab/.hf")  # models on E:, next to the lab's other caches
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS", "1")
import whisperx

device = "cuda"
model = whisperx.load_model("large-v3", device, compute_type="float16", language="en")
align, meta = whisperx.load_align_model(language_code="en", device=device)
for f in sys.argv[1:]:
    audio = whisperx.load_audio(f)
    seg = model.transcribe(audio, batch_size=8)["segments"]
    out = whisperx.align(seg, align, meta, audio, device)
    words = [{"w": w["word"], "s": round(w.get("start", -1), 3), "e": round(w.get("end", -1), 3)} for s in out["segments"] for w in s["words"]]
    # Pitch spread in semitones from a plain autocorrelation over voiced 40 ms frames
    sr, hop = 16000, 640
    f0 = []
    for i in range(0, len(audio) - hop, hop):
        x = audio[i:i + hop] - audio[i:i + hop].mean()
        if np.sqrt((x * x).mean()) < 0.02:
            continue
        ac = np.correlate(x, x, "full")[hop - 1:]
        lo, hi = sr // 300, sr // 70
        lag = lo + int(np.argmax(ac[lo:hi]))
        if ac[lag] > 0.3 * ac[0]:
            f0.append(sr / lag)
    st = 12 * np.log2(np.array(f0) / np.median(f0)) if f0 else np.array([0.0])
    info = {"text": " ".join(w["w"] for w in words), "dur": round(len(audio) / sr, 2), "pitch_p10_p90_st": [round(float(np.percentile(st, 10)), 1), round(float(np.percentile(st, 90)), 1)], "words": words}
    Path(f + ".words.json").write_text(json.dumps(info, indent=1), encoding="utf8")
    print(Path(f).name, info["dur"], info["pitch_p10_p90_st"], "|", info["text"])
