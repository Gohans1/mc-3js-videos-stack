"""Lays the narration takes on the film's clock: each take's first word lands on its `t` in src/edit.json, and
voice.lines becomes the spoken span of each take. Writes assets/public/agent/full_voice.wav (what the studio plays and
sound.py mixes). Run after voice/words.py:  python voice/assemble.py"""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EDIT = ROOT / "src/edit.json"
E = json.loads(EDIT.read_text(encoding="utf8"))
OUT = ROOT / "assets/public/agent/full_voice.wav"
OUT.parent.mkdir(parents=True, exist_ok=True)

inputs, chains, lines = [], [], []
for i, k in enumerate(E["takes"]):
    take = ROOT / f"voice/takes/{k['id']}.mp3"
    words = json.loads(Path(f"{take}.words.json").read_text(encoding="utf8"))["words"]
    start = k["t"] - words[0]["s"]
    inputs += ["-i", str(take)]
    chains.append(f"[{i}:a]aresample=48000,adelay={round(start * 1000)}:all=1[v{i}]")
    lines.append([k["t"], round(start + words[-1]["e"], 3)])
mix = ";".join(chains) + ";" + "".join(f"[v{i}]" for i in range(len(chains))) + f"amix=inputs={len(chains)}:normalize=0,apad=whole_dur={E['end']}[out]"
subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", mix, "-map", "[out]", "-t", str(E["end"]), "-ac", "1", "-c:a", "pcm_s16le", str(OUT)], check=True)
E["voice"]["lines"] = lines
EDIT.write_text(json.dumps(E, indent=1) + "\n", encoding="utf8", newline="\n")
print(OUT.name, lines)
