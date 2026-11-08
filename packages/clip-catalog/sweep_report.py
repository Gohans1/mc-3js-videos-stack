"""Ranks clip-catalog/sweep.sh's retarget numbers: for each check, how many clips pass its limit and the worst ones (clip, value,
second), so a retarget bug shows as a cluster to open in the lab (ENTRY=../../packages/clip-catalog/mocap.ts LAB_LIB=mixamo
LAB_CLIP=<clip> LAB_FROM=<s-0.5> LAB_TO=<s+0.5>). Spins and jumps also rise on falls and flips where the source's shorter
limbs don't reach the floor yet: judge those by eye.
python ../../packages/clip-catalog/sweep_report.py [lib] [--top N] [--only clip1,clip2]
python ../../packages/clip-catalog/sweep_report.py --diff OLD.jsonl    regression check after a change to mc-actor/mocap.ts: move the
    old sweep aside, sweep again, then list every clip whose numbers changed at all (the lab is deterministic, so an
    untouched clip matches exactly), each check's worst value old > new
"""
import argparse, json, re

from catalog import FIGHT, ROOT

# check (start of its name) -> limit past which a clip is listed
LIMITS = {
    "not a number": 0, "spin": 20, "jump": 4, "inside hand": 6, "inside elbow": 6, "inside knee": 6, "inside foot": 6,
    "inside head in legs": 4, "sink": 4, "arm below the floor": 4, "head below the floor": 4, "float": 6,
    "direction error upper arm": 35, "direction error forearm": 35, "direction error thigh": 35, "direction error shin": 35,
    "direction error head facing": 25, "direction error chest": 25, "neck turn": 80,
}


def diff(rows, old_path):
    old = {r["clip"]: r for r in (json.loads(l) for l in open(old_path, encoding="utf-8") if l.strip())}
    worst = lambda r, check: max([v for k, (v, t) in r.get("s", {}).items() if k.startswith(check)], default=0)
    same = changed = 0
    for r in rows:
        o = old.get(r["clip"])
        if not o:
            continue
        if o.get("s") == r.get("s"):
            same += 1
            continue
        changed += 1
        moves = [f"{c} {worst(o, c):.0f}>{worst(r, c):.0f}" for c in LIMITS if abs(worst(o, c) - worst(r, c)) >= 1]
        print(f"{r['clip']}: {', '.join(moves) or 'changes under 1 unit'}")
    print(f"\n{same} clips identical, {changed} changed, {len(rows) - same - changed} not in the old sweep")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("lib", nargs="?", default="mixamo")
    ap.add_argument("--top", type=int, default=12)
    ap.add_argument("--only")
    ap.add_argument("--fights", action="store_true", help="keep weapon and fight clips (left out by default, as the finder does)")
    ap.add_argument("--diff", metavar="OLD")
    a = ap.parse_args()
    rows = [json.loads(l) for l in open(ROOT / f"catalog/sweep_{a.lib}.jsonl", encoding="utf-8") if l.strip()]
    if a.diff:
        return diff(rows, a.diff)
    if a.only:
        keep = set(a.only.split(","))
        rows = [r for r in rows if r["clip"] in keep]
    errors = [r for r in rows if "error" in r]
    rows = [r for r in rows if "error" not in r and (a.fights or not FIGHT.search(r["clip"]))]
    print(f"{len(rows)} clips, {len(errors)} failed" + "".join(f"\n    {e['clip']}: {e['error']}" for e in errors))
    bad = {}
    for check, limit in LIMITS.items():
        hits = sorted(((r["s"][k][0], r["s"][k][1], r["clip"], k) for r in rows for k in r["s"] if k.startswith(check) and r["s"][k][0] > limit), reverse=True)
        for _, _, c, _ in hits:
            bad.setdefault(c, set()).add(check)
        print(f"\n{check} > {limit}: {len({h[2] for h in hits})} clips")
        for v, t, c, k in hits[: a.top]:
            print(f"    {v:7.1f} at {t:5.2f}s  {c}  ({k})")
    print(f"\n{len(bad)} of {len(rows)} clips past some limit")


if __name__ == "__main__":
    main()
