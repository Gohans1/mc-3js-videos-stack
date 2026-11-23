"""Checks the catalogue's tags against what the clips' own names say (a clip named Kneeling must kneel somewhere, one named
Sitting must sit...): run after `bash ../../packages/clip-catalog/catalog.sh`, above all after a change to clip-catalog/catalog.ts. Prints every clip that
disagrees, for a look with lab/clip.ts: a name can be wrong too (Kneeling_To_Holding_Down... ends lying), so judge by eye.
python ../../packages/clip-catalog/catalog_check.py
"""
import argparse, re, sys

from catalog import ROOT, FIGHT
from batch import read_rows

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
    ap = argparse.ArgumentParser(description=__doc__ + "\nName disagreements are hints, not creative restrictions. Exit 1: disagreements/load failures; exit 2: missing or invalid data.")
    ap.add_argument("--fights", action="store_true", help="include weapons and fights; the default matches the finder")
    a = ap.parse_args(["--help"] if sys.argv[1:2] == ["help"] else None)
    files = [p for p in sorted((ROOT / "catalog").glob("*.jsonl")) if not p.name.startswith("sweep_")]
    if not files:
        ap.error("no catalogue: inside a film run python ../../packages/clip-catalog/batch.py catalog first")
    try:
        rows = [r for p in files for r in read_rows(p).values()]
    except (OSError, ValueError) as e:
        ap.error(str(e))
    if not rows:
        ap.error("catalogue is empty: run batch.py catalog first")
    errors = [r for r in rows if "error" in r]
    rows = [r for r in rows if "error" not in r and (a.fights or not FIGHT.search(r["ref"].split("/", 1)[1]))]
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
    print("next: inspect flagged clips with bun run render stills --lab clip=<lib/name> --entry lab/clip.ts; correct tags with catalog_review.py --fix")
    return int(bool(bad_total or errors))


if __name__ == "__main__":
    sys.exit(main())
