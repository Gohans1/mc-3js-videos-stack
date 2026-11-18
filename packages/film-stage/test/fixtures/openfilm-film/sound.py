import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parent
script = Path(__file__).resolve().parents[5] / "scripts" / "sound" / "mix.py"
raise SystemExit(subprocess.run([sys.executable, str(script), "--raw", sys.argv[1], *[arg for arg in sys.argv[2:] if arg == "--live-lanes"]], cwd=root).returncode)
