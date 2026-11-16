"""The studio's mix: python sound.py OUT.wav [--dry]. The same graph as the draft and final (scripts/sound/mix.py --raw), without
the loudness pass, so a remix takes a moment. Sounds with options (src/timeline/audio.json `try`) are left out of it and written as one
stem per option plus trials.json beside OUT, which the page plays itself. With --live-lanes (package.json "live-studio" liveLanes)
the page plays every bed and one-shot itself, and OUT holds only what is not on the lanes."""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
out = Path(sys.argv[1])
# mix.py says what went wrong itself: a traceback here would only bury it
sys.exit(subprocess.run([sys.executable, str(ROOT.parents[1] / "scripts/sound/mix.py"), "--raw", str(out), *[a for a in sys.argv[2:] if a == "--live-lanes"]], cwd=ROOT).returncode)
