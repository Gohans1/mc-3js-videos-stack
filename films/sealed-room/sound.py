"""The studio's mix: python sound.py OUT.wav [--dry]. The same graph as the draft and final (sound/mix.py --raw), without
the loudness pass, so a remix takes a moment. Sounds with options (src/timeline/audio.json `try`) are left out of it and written as one
stem per option plus trials.json beside OUT, which the page plays itself."""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
out = Path(sys.argv[1])
subprocess.run([sys.executable, str(ROOT / "sound/mix.py"), "--raw", str(out)], check=True)
