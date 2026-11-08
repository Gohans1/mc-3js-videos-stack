"""Checks the catalogue's tags against what the clips' own names say (a clip named Kneeling must kneel somewhere, one named
Sitting must sit...): run after `bash ../../packages/clip-catalog/catalog.sh`, above all after a change to clip-catalog/catalog.ts. Prints every clip that
disagrees, for a look with lab/clip.ts: a name can be wrong too (Kneeling_To_Holding_Down... ends lying), so judge by eye.
python ../../packages/clip-catalog/catalog_check.py
"""
import glob, json, re
from pathlib import Path

from catalog import ROOT

FIGHT = re.compile(r"gun|rifle|pistol|sword|shoot|aim|reload|punch|kick|boxing|fight|attack|block|arrow|bow|zombie|mutant|sniper|grenade|flip", re.I)
# name word -> postures of which one must show up in the clip (None: a check of its own below)
RULES = [
    ({"kneel", "kneeling"}, {"kneel"}),
    ({"sitting", "seated", "sit"}, {"sitSeat", "sitFloor"}),
    ({"lying", "laying", "sleeping", "prone"}, {"lie"}),
    ({"crawl", "crawling"}, {"allFours", "lie", "sitFloor"}),
    ({"crouch", "crouching", "crouched"}, {"crouch"}),
    ({"jump", "jumping"}, None),
    ({"walk", "walking", "run", "running", "jog", "sprint"}, None),
]


def main():
    rows = [json.loads(l) for f in sorted(glob.glob(str(ROOT / "catalog/*.jsonl"))) if not Path(f).name.startswith("sweep_") for l in open(f, encoding="utf-8") if l.strip()]
    errors = [r for r in rows if "error" in r]
    rows = [r for r in rows if "error" not in r and not FIGHT.search(r["ref"])]
    total = bad_total = 0
    for words, want in RULES:
        hit = [r for r in rows if words & set(re.split(r"[_\W]+", r["ref"].split("/", 1)[1].lower()))]
        if want is None and "jump" in words:
            bad, what = [r for r in hit if r["air"] < 0.1], "never off the floor"
        elif want is None:
            # the glTF libraries' loops play in place: only Mixamo's walks travel
            bad, what = [r for r in hit if r["ref"].startswith("mixamo/") and r["reach"] < 0.3], "goes under 0.3 m"
        else:
            bad, what = [r for r in hit if not want & {*r["seq"], r["start"], r["end"]}], f"no {'/'.join(sorted(want))}"
        total, bad_total = total + len(hit), bad_total + len(bad)
        print(f"{'/'.join(sorted(words))}: {len(hit)} clips, {len(bad)} {what}")
        for r in bad:
            print(f"    {r['ref']}  {r['dur']}s  {'>'.join(r['seq'])}  reach {r['reach']} air {r['air']} hips {r['hips']}")
    print(f"{bad_total} of {total} named clips disagree; {len(errors)} clips failed to load" + "".join(f"\n    {e['ref']}: {e['error']}" for e in errors))


if __name__ == "__main__":
    main()
