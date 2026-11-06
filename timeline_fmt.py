"""The one way to write src/timeline/*.json (Steve's keys, camera keys, props, audio), so they stay short to read and their
diffs show only what changed: every object or list that fits in 140 columns sits on one line, longer ones open up one level.
python timeline_fmt.py            rewrites every src/timeline/*.json in this format (content unchanged)
from timeline_fmt import save     save("steve", data) from another script"""
import json
from pathlib import Path

DIR = Path(__file__).resolve().parent / "src/timeline"
WIDTH = 140


def dump(v, ind=0):
    one = json.dumps(v, ensure_ascii=False)
    if len(one) + ind <= WIDTH or not isinstance(v, (dict, list)) or not v:
        return one
    pad = " " * (ind + 1)
    if isinstance(v, dict):
        rows = [pad + json.dumps(k, ensure_ascii=False) + ": " + dump(x, ind + 1) for k, x in v.items()]
        return "{\n" + ",\n".join(rows) + "\n" + " " * ind + "}"
    return "[\n" + ",\n".join(pad + dump(x, ind + 1) for x in v) + "\n" + " " * ind + "]"


def load(name):
    return json.loads((DIR / f"{name}.json").read_text(encoding="utf8"))


def save(name, data):
    (DIR / f"{name}.json").write_text(dump(data) + "\n", encoding="utf8", newline="\n")


if __name__ == "__main__":
    for f in sorted(DIR.glob("*.json")):
        save(f.stem, load(f.stem))
        print(f.name, f.read_text(encoding="utf8").count("\n"), "lines")
