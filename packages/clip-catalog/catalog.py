"""Search the clip catalogue (vault/motion/catalog/<lib>.jsonl, written by clip-catalog/catalog.sh) for a scene's move.

python ../../packages/clip-catalog/catalog.py kneel pray --to stand          words match the clip's name, its Mixamo search keywords and
                                                     the description written when someone checked it by eye
python ../../packages/clip-catalog/catalog.py --from stand --to sitFloor --still --dur 1-6
python ../../packages/clip-catalog/catalog.py scared --head                  a hand at his head for a while
python ../../packages/clip-catalog/catalog.py --jev "he searches the floor with his hands for something hidden"
                                                     Jev reads every clip's description and ranks them by how well
                                                     each acts the scene out (rerank, below); start here, unfiltered,
                                                     so a wrong filter word can't hide the right clip; add filters
                                                     (--has kneel ...) only to narrow a second pass

Postures (clip-catalog/catalog.ts POSTURE): stand crouch kneel sitSeat sitFloor allFours lie. Weapons and fights are left out unless
--fights. Each line: ref, seconds, posture runs, travel (m to his left, m ahead), turn, hands, look, a loop mark. Tags
checked by eye (clip-catalog/catalog_review.py) override the measured ones; "(unchecked)": nobody has looked yet. Then preview
the picks in the cell: LAB_CLIP=<ref> ENTRY=lab/clip.ts bun run render stills && python ../../packages/clip-catalog/sheet_clip.py
"""
import argparse, json, random, re, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from jev import Jev
from batch import read_rows

ROOT = Path(__file__).resolve().parents[2] / "vault/motion"  # the repo's vault link (bun run link)
# Fight words and retarget-break limits, shared with bun run find (scripts/find.ts reads the same file)
SCREEN = json.loads((Path(__file__).parent / "screen.json").read_text(encoding="utf-8"))
# matched at a word's start in the name (after _ or a camel hump): inside a word, Wheelbarrow read as arrow, Relaxed as axe
FIGHT = re.compile(r"(?:(?<![a-z])|(?<=(?-i:[a-z]))(?=(?-i:[A-Z])))(?:" + "|".join(SCREEN["fights"]) + ")", re.I)
LOOP_DEG, LOOP_CM, STILL_M, HAND_S = 15, 5, 0.3, 0.3


def has(r, k):
    """a seconds tag that counts: HAND_S long, or half of a clip shorter than that (a one-frame pose holds it all through)"""
    return r.get(k, 0) > 0 and r[k] >= min(HAND_S, 0.5 * r["dur"])


def keywords():
    out = {}
    for f in ["acting.tsv", "common.tsv"]:
        p = ROOT / "mixamo/_tools" / f
        if p.exists():
            for line in p.read_text(encoding="utf-8").splitlines():
                cid, kw, name = (line.split("\t") + ["", ""])[:3]
                out.setdefault(cid[:8], set()).update([kw.lower(), name.lower()])
    return out


TL = {"body": "body", "moves": "travel", "turns": "body turns", "gaze": "gaze", "handR": "right hand", "handL": "left hand", "tempo": "tempo"}


def describe(r, full=False):
    """What Jev reads for a clip: the eye-checked note (what it is, mood, what it implies he touches, style, flaw), else
    the clip's name. `full` adds the measured facts (length, start and end, travel, turn, loop) and the timeline
    (clip-catalog/catalog.ts `tl`: when each posture, step, turn, gaze, hand position and tempo happens), ~5x the tokens of the
    note alone, so Jev's free daily quota runs out ~5x sooner; the note alone ranked well enough. A body sequence
    corrected by eye replaces the measured body channel."""
    if r.get("desc"):
        head = f"{r['desc']} [mood: {', '.join(r.get('mood', []))}; touches: {', '.join(r.get('prop', []))}" + (f"; acted: {', '.join(r['style'])}" if r.get("style") else "") + (f"; flaw: {r['flaw']}" if r.get("flaw") else "") + "]"
    else:
        name = re.sub(r"_[0-9a-f]{8}$", "", r["ref"].split("/", 1)[1]).replace("_", " ")
        head = f"{name} (not checked by eye)" + (f" [flaw: {r['flaw']}]" if r.get("flaw") else "")
    loop = r["loop"][0] < LOOP_DEG and r["loop"][1] < LOOP_CM
    facts = (f"{r['dur']} s; starts {r['start']}, ends {r['end']}; ends {r['reach']} m from the start, facing {abs(r['turn'])} deg "
             f"{'left' if r['turn'] > 0 else 'right'} of his first facing; {'loops seamlessly' if loop else 'does not loop'}")
    if not full:
        return head
    tl = []
    for k, name in TL.items():
        if k == "body" and r.get("seen") and "seq" in r.get("fix", {}):
            tl.append(f"body (checked by eye): {' > '.join(r['seq'])}")
        elif r.get("tl", {}).get(k):
            tl.append(f"{name}: " + "; ".join(f"{a}-{b} s {s}" for a, b, s in r["tl"][k]))
    return " | ".join([head, facts, *tl])


HEAT, KEEP, SEED, FIT_N = 200, 20, 1, 5  # rerank heats; fits checks the first FIT_N shown
FIT_NO, FIT_YES = 0.3, 0.7



def rerank(jev, scene, hits, full=False):
    """Ranks clips by how well each acts out the scene: one Choice over their descriptions, a probability per clip. A
    Choice holds at most 255 options, so a longer list runs in heats of HEAT whose nonzero picks meet in a final (heats
    again while they are still too many).
    Cost is the tokens read, about one pass over the catalogue. Two traps from TypeSafe's docs and our tests:
    probabilities come rounded to 0.01 (a 200-clip heat has ~7 nonzero), so never fill a heat's picks up by list order;
    and similar clips sit together in name order and would knock each other out in one heat, so the list is shuffled
    first (fixed seed: the same scene ranks the same)."""
    def choice(group):
        opts = {f"c{i}": describe(r, full) for i, r in enumerate(group)}
        probs = jev.ask(f"A scene to act out: {scene}", {"clip": {"type": "choice", "instructions": "Which motion clip acts this scene out best?", "criteria": opts}})["clip"]["probabilities"]
        return [(probs.get(f"c{i}", 0), r) for i, r in enumerate(group)]

    while len(hits) > 255:
        order = hits[:]
        random.Random(SEED).shuffle(order)
        with ThreadPoolExecutor(4) as pool:
            heats = pool.map(choice, [order[k : k + HEAT] for k in range(0, len(order), HEAT)])
        hits = [r for heat in heats for p, r in sorted(heat, key=lambda x: -x[0])[:KEEP] if p > 0]
    if not hits:
        return []
    return [(p, r) for p, r in sorted(choice(hits), key=lambda x: -x[0]) if p > 0]


def fits(jev, scene, shown, full=False):
    """A Choice always picks something, even when no clip in the vault fits (TypeSafe: a "none of the above" option
    often fails; ask a companion Noul instead). So each clip shown gets its own yes/no: does it really act the scene
    out? All in one request, answered in parallel. Returns the probability of yes per clip."""
    state = {"scene": scene, **{f"clip_{k + 1}": describe(r, full) for k, r in enumerate(shown)}}
    qs = {f"fit_{k + 1}": {"type": "noul", "instructions": f"Does `clip_{k + 1}` show a person doing what `scene` describes?",
                           "criteria": {"true": "The clip's movement is the scene's action, as a viewer would read it",
                                        "false": "The clip shows a different action, or only part of it"}} for k in range(len(shown))}
    ans = jev.ask(state, qs)
    return [ans[f"fit_{k + 1}"]["noul"] for k in range(len(shown))]


# Retarget breaks that read on screen (clip-catalog/sweep.sh numbers; milder ones are the box body meeting itself and pass
# by eye; a hand catching a fall jumps ~15 cm in a frame and reads right): check name start -> (limit, what a viewer sees)
BROKEN = SCREEN["broken"]


def broken(lib):
    """ref -> 'retarget breaks on Steve: <what> at <s> s; ...' for clips whose sweep crosses a BROKEN limit"""
    p = ROOT / "catalog" / f"sweep_{lib}.jsonl"
    out = {}
    if p.exists():
        for r in read_rows(p).values():
            seen = {}
            for k, (v, t) in r.get("s", {}).items():
                for check, (limit, what) in BROKEN.items():
                    if k.startswith(check) and v > limit and what not in seen:
                        seen[what] = t
            if seen:
                out[f"{lib}/{r['clip']}"] = "retarget breaks on Steve: " + "; ".join(f"{w} at {t} s" for w, t in sorted(seen.items(), key=lambda x: x[1]))
    return out


def rows(libs):
    # measured tags, with the fixes recorded by eye (clip-catalog/catalog_review.py) over them; `seen`: someone has checked
    # the clip. A sweep break joins the clip's flaw, so the finder shows it and Jev weighs it
    rp = ROOT / "catalog" / "review.json"
    review = json.loads(rp.read_text(encoding="utf-8-sig")) if rp.exists() else {}
    for lib in libs:
        p = ROOT / "catalog" / f"{lib}.jsonl"
        brk = broken(lib)
        if p.exists():
            for r in read_rows(p).values():
                if r:
                    if "error" in r:
                        continue
                    rv = review.get(r["ref"], {})
                    row = {**r, **rv, "seen": r["ref"] in review, "fix": set(rv)}
                    # seq drops runs under 0.2 s, but --from/--to read the first and last 0.2 s: the shown order holds both
                    if not rv.get("seq"):
                        body = [x for x in [row.get("start"), *row.get("seq", []), row.get("end")] if x]
                        row["seq"] = [x for i, x in enumerate(body) if not i or x != body[i - 1]]
                    if r["ref"] in brk:
                        row["flaw"] = "; ".join(x for x in [rv.get("flaw"), brk[r["ref"]]] if x)
                    yield row


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("words", nargs="*")
    ap.add_argument("--lib", default="mixamo,ual1,ual2")
    ap.add_argument("--from", dest="start", help="posture at its start")
    ap.add_argument("--to", dest="end", help="posture at its end")
    ap.add_argument("--has", help="a posture somewhere in it")
    ap.add_argument("--still", action="store_true", help=f"stays within {STILL_M} m")
    ap.add_argument("--moves", action="store_true", help=f"goes further than {STILL_M} m")
    ap.add_argument("--loop", action="store_true", help="last frame meets the first (plays on repeat)")
    ap.add_argument("--dur", help="seconds, MIN-MAX")
    ap.add_argument("--energy", help="mean joint speed deg/s, MIN-MAX (calm idle ~10, walk ~30, jump 200)")
    ap.add_argument("--head", action="store_true", help="a hand at his head")
    ap.add_argument("--up", action="store_true", help="a hand above his head")
    ap.add_argument("--ground", action="store_true", help="a hand on the floor")
    ap.add_argument("--bend", action="store_true", help="bends over on his feet (picking up, putting down)")
    ap.add_argument("--air", choices=["no", "yes"], help="off the floor (a jump, or lying or sitting on furniture): never / a while")
    ap.add_argument("--look", type=float, help="head turns on the neck at least this many degrees")
    ap.add_argument("--mood", help="checked clips only: one of clip-catalog/catalog_review.py MOODS (scared, tired, curious...)")
    ap.add_argument("--prop", help="checked clips only: one of clip-catalog/catalog_review.py PROPS (floor, door, table...)")
    ap.add_argument("--style", help="checked clips only: one of clip-catalog/catalog_review.py STYLES (natural, cartoonish...)")
    ap.add_argument("--fights", action="store_true", help="keep weapons and fights")
    ap.add_argument("--jev", metavar="SCENE", help="rank what the filters leave by how well it acts out SCENE (rerank)")
    ap.add_argument("--timeline", action="store_true", help="Jev also reads the measured facts and timeline (~5x the quota)")
    ap.add_argument("-n", type=int, default=30)
    a = ap.parse_args()
    kw = keywords()
    span = lambda s: [float(x) for x in s.split("-")]
    words = [w.lower() for w in a.words]
    def _stem(w):
        s = re.sub(r"ies$", "y", re.sub(r"^(.)(?:ies|ying)$", r"\1ie", w))
        if len(s) > 4:
            s = re.sub(r"(?:ing|ed|es)$", "", s)
        if len(s) > 3:
            s = re.sub(r"([^aeioulsz])\1$", r"\1", s)
        if len(s) > 3 and not s.endswith("ss"):
            s = re.sub(r"s$", "", s)
        if len(s) > 3:
            s = re.sub(r"(?:ie|[ye])$", "", s)
        return s
    # match either from a word start ("sit" finds sitting, never disposition) or by shared light stem ("sitting" finds Sit)
    queries = [(re.compile(r"\b" + re.escape(w)), _stem(w)) for w in words]
    tok_stems = lambda t: {_stem(tok) for tok in re.split(r"[^a-z\d]+", t) if tok}
    plain_name = lambda n: re.sub(r"([a-z])([A-Z])", r"\1 \2", n).replace("_", " ").lower()
    hits = []
    for r in rows(a.lib.split(",")):
        lib, name = r["ref"].split("/", 1)
        tags = kw.get(name[-8:], set()) if lib == "mixamo" else set()
        text = " | ".join([plain_name(name), *sorted(tags), r.get("desc", "").lower(), *r.get("mood", []), *(p for p in r.get("prop", []) if p != "none"), *r.get("style", [])])
        if not a.fights and FIGHT.search(name):
            continue
        text_stems = tok_stems(text)
        if not all(p.search(text) or s in text_stems for p, s in queries):
            continue
        loop = r["loop"][0] < LOOP_DEG and r["loop"][1] < LOOP_CM
        checks = [
            (a.start, lambda: r["start"] == a.start), (a.end, lambda: r["end"] == a.end), (a.has, lambda: a.has in r["seq"]),
            (a.still, lambda: r["reach"] < STILL_M), (a.moves, lambda: r["reach"] >= STILL_M), (a.loop, lambda: loop),
            (a.dur, lambda: span(a.dur)[0] <= r["dur"] <= span(a.dur)[1]),
            (a.energy, lambda: span(a.energy)[0] <= r["energy"] <= span(a.energy)[1]),
            (a.head, lambda: has(r, "head")), (a.up, lambda: has(r, "up")), (a.ground, lambda: has(r, "ground")),
            (a.bend, lambda: has(r, "bend")), (a.mood, lambda: a.mood in r.get("mood", [])),
            (a.prop, lambda: a.prop in r.get("prop", [])),
            (a.style, lambda: a.style in r.get("style", [])),
            (a.look, lambda: r["look"] >= a.look), (a.air, lambda: has(r, "air") == (a.air == "yes")),
        ]
        if all(f() for on, f in checks if on):
            # words in the name or the eye-checked description outrank Mixamo's search keywords
            said = plain_name(name) + " | " + r.get("desc", "").lower()
            said_stems = tok_stems(said)
            score = sum(2 if p.search(said) or s in said_stems else 1 for p, s in queries)
            hits.append((score, r, loop, tags))
    # a one-frame clip is a still pose, never the move its name says: after every clip that moves; a clip with a
    # FLAW after the equal ones without, so a list with no words opens on a usable clip, not the bind pose
    hits.sort(key=lambda h: (h[1]["dur"] < 0.1, -h[0], bool(h[1].get("flaw")), h[1]["dur"]))
    pool = len(hits)
    fit = {}
    if a.jev and hits:
        jev = Jev()
        by = {id(h[1]): h for h in hits}
        hits = [(p, *by[id(r)][1:]) for p, r in rerank(jev, a.jev, [h[1] for h in hits], a.timeline)]
        shown = [h[1] for h in hits[: min(a.n, FIT_N)]]
        if shown:
            fit = dict(zip(map(id, shown), fits(jev, a.jev, shown, a.timeline)))
            print(f"Jev via {jev.used}" + (f", cost ${jev.spent:.4f}" if jev.spent else "") + "; rank = Choice probability, fits = "
                  "its own yes/no", file=sys.stderr)
            # TypeSafe's starting thresholds for a Noul: yes above 0.7, no below 0.3
            # The yes threshold is inclusive, as in jev.ts.
            best = max(fit.values())
            if fit[id(shown[0])] < FIT_YES <= best:
                best_index = max(range(len(shown)), key=lambda i: fit[id(shown[i])])
                hits.insert(0, hits.pop(best_index))
            if best < FIT_NO:
                print(f"Jev: no shown clip fits (best {best:.2f}): the vault may have nothing for this scene", file=sys.stderr)
            elif best < FIT_YES:
                print(f"Jev: unsure any shown clip fits (best {best:.2f}): see the top few before using one; if none acts it out, "
                      "key the pose by hand (steve.json moves[] pose) or retarget a new clip into vault/motion", file=sys.stderr)
    for score, r, loop, tags in hits[: a.n]:
        hands = " ".join(f"{k} {r[k]}s" for k in ["head", "up", "ground", "bend", "air"] if has(r, k))
        print(f"{f'{score:.2f}  ' if a.jev else ''}{f'fits {fit[id(r)]:.2f}  ' if id(r) in fit else ''}{r['ref']}  {r['dur']}s  {'>'.join(r['seq'])}  travel {r['travel'][0]},{r['travel'][1]} turn {r['turn']}"
              f"  energy {r['energy']} look {r['look']}{'  ' + hands if hands else ''}{'  LOOP' if loop else ''}"
              f"{'' if r['seen'] else '  (unchecked)'}")
        if r.get("desc"):
            print(f"      {r['desc']}  [mood: {', '.join(r.get('mood', []))}; prop: {', '.join(r.get('prop', []))}" + (f"; style: {', '.join(r['style'])}" if r.get("style") else "") + "]")
        if r.get("flaw"):
            print("      FLAW: " + r["flaw"])
    print(f"{pool} match{'' if pool == 1 else 'es'}" + (f", Jev's final ranked {len(hits)}" if a.jev else "")
          + (f", first {a.n} shown" if len(hits) > a.n else ""), file=sys.stderr)


if __name__ == "__main__":
    main()
