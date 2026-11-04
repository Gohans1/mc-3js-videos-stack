"""The studio's mix: python sound.py OUT.wav [--dry]. The same graph as the draft and final (sound/mix.py --raw), without
the loudness pass, so a remix takes a moment. No sound trials yet, so the page has none to play itself."""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
out = Path(sys.argv[1])
subprocess.run([sys.executable, str(ROOT / "sound/mix.py"), "--raw", str(out)], check=True)
out.with_name("trials.json").write_text("{}")
