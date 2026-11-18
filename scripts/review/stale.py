import json
import os
import subprocess
from pathlib import Path


def render_context(video):
    """The selected film's render name, clock and known freshness."""
    root = Path.cwd()
    cli = Path(__file__).resolve().parents[2] / "packages/live-studio/src/stale.mjs"
    try:
        r = subprocess.run(["bun", str(cli), str(Path(video).absolute()), "--json"],
                           capture_output=True, check=True, timeout=30,
                           env={**os.environ, "LIVE_PROJECT": str(root)})
        return json.loads(r.stdout)
    except (OSError, ValueError, subprocess.SubprocessError) as e:
        return {"render": None, "stale": None, "cuts": None, "error": f"cannot check film render context: {e}"}
