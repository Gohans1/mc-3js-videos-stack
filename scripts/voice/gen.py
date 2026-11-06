"""Generates the narration takes listed in src/edit.json `takes` with ElevenLabs v4 through GenVoice, Seff Echo voice.
  python ../../scripts/voice/gen.py            all missing takes
  python ../../scripts/voice/gen.py 02 03      redo just these
  python ../../scripts/voice/gen.py 02 --try   a candidate take in voice/try/02_N.mp3, keeping the current one
Takes land in voice/takes/NN.mp3; existing ones are skipped unless named, so a stopped run picks up where it was."""
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path.home() / "Desktop/huggingfaceopenaiincident/scripts"))
from genvoice import tts  # noqa: E402

ROOT = Path.cwd() / "voice"  # run from the film folder: its voice/takes
NARRATOR = "ZaZosYpkIGmSqOwAlfnk"  # Seff Echo - Cinematic Storyteller (the stack's first-choice third-person narrator)
TAKES, TRY = ROOT / "takes", ROOT / "try"
TAKES.mkdir(exist_ok=True)
TRY.mkdir(exist_ok=True)
takes = {k["id"]: k["text"] for k in json.loads((ROOT.parent / "src/edit.json").read_text(encoding="utf8"))["takes"]}
trying = "--try" in sys.argv
names = [a for a in sys.argv[1:] if not a.startswith("--")]
want = names or [k for k in takes if not (TAKES / f"{k}.mp3").exists()]


def out(k):
    if not trying:
        return TAKES / f"{k}.mp3"
    n = 1
    while (TRY / f"{k}_{n}.mp3").exists():
        n += 1
    return TRY / f"{k}_{n}.mp3"


def one(k):
    return k, tts(NARRATOR, takes[k], str(out(k)), "eleven_v4", 1.0, 0.5)


with ThreadPoolExecutor(4) as pool:
    for k, r in pool.map(one, want):
        print(k, r, flush=True)
