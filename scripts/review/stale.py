import subprocess
from pathlib import Path


def stale(video):
    """Why the video is older than the film data it was made from, or None (live-studio src/stale.mjs, as framecheck says it)."""
    r = subprocess.run(["bun", str(Path(__file__).resolve().parents[2] / "packages/live-studio/src/stale.mjs"), str(video)],
                       capture_output=True, text=True, timeout=60)
    return r.stdout.strip() or None


def say_if_stale(video):
    if why := stale(video):
        print(f"STALE: {why}")
