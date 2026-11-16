"""Compatibility entry for old film scripts; pick.mjs is the single asset builder.
python ../../packages/mc-assets/pick.py (inside a film; Bun required)."""
from pathlib import Path
import subprocess
import sys


if __name__ == "__main__":
    try:
        sys.exit(subprocess.call(["bun", str(Path(__file__).with_suffix(".mjs")), *sys.argv[1:]]))
    except FileNotFoundError:
        sys.exit("Bun is missing: install Bun, then run this command again")
