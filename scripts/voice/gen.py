"""Generates narration takes listed in src/edit.json `takes` via Bun (scripts/voice/gen.ts), preserving CLI compatibility:
  python ../../scripts/voice/gen.py                        all missing takes (sequential prosody stitching)
  python ../../scripts/voice/gen.py 02 03                  redo just these
  python ../../scripts/voice/gen.py 02 --try [--takes 3]   candidate takes in voice/try/02_N.mp3
  python ../../scripts/voice/gen.py 02 --guide draft.wav   Voice Changer (Speech-to-Speech via ELEVENLABS_API_KEY)"""
import shutil
import subprocess
import sys
from pathlib import Path

bun = shutil.which("bun") or "bun"
script = Path(__file__).with_suffix(".ts")
raise SystemExit(subprocess.call([bun, str(script), *sys.argv[1:]]))
