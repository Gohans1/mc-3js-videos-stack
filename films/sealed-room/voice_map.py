"""What the studio's timeline shows of the voice: python voice_map.py OUT.json. Word times are whisperX's, per take
(voice/takes/NN.mp3.words.json), moved to where bun run voice:assemble laid each take in full_voice.wav."""
import array
import json
import sys
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STEP = 0.04
E = json.loads((ROOT / "src/edit.json").read_text(encoding="utf8"))

VOICE = ROOT / "assets/public/agent/full_voice.wav"
if not VOICE.exists():  # no narration yet (bun run voice:assemble writes it)
    Path(sys.argv[1]).write_text(json.dumps({"step": STEP, "peaks": [], "lines": []}))
    print("words 0", flush=True)
    sys.exit(0)
with wave.open(str(VOICE)) as w:
    samples = array.array("h", w.readframes(w.getnframes()))
    size = int(w.getframerate() * STEP)
peaks = [round(max((abs(v) for v in samples[i : i + size]), default=0) / 32768, 3) for i in range(0, len(samples), size)]
lines = []
for k in E["takes"]:
    words = json.loads((ROOT / f"voice/takes/{k['id']}.mp3.words.json").read_text(encoding="utf8"))["words"]
    shift = k["t"] - words[0]["s"]
    ws = [{"w": x["w"], "s": round(x["s"] + shift, 3), "e": round(x["e"] + shift, 3)} for x in words]
    lines.append({"s": ws[0]["s"], "e": ws[-1]["e"], "text": " ".join(x["w"] for x in ws), "words": ws})
Path(sys.argv[1]).write_text(json.dumps({"step": STEP, "peaks": peaks, "lines": lines}))
print("words", sum(len(l["words"]) for l in lines), flush=True)
