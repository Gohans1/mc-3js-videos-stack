"""Assembles narration takes onto assets/public/agent/full_voice.wav, updates voice_map.json, and writes per-take
draggable Phrase Bricks onto src/timeline/audio.json via Bun (scripts/voice/assemble.ts).
  python ../../scripts/voice/assemble.py [--clips]"""
import shutil
import subprocess
import sys
from pathlib import Path

bun = shutil.which("bun") or "bun"
script = Path(__file__).with_suffix(".ts")
raise SystemExit(subprocess.call([bun, str(script), *sys.argv[1:]]))
