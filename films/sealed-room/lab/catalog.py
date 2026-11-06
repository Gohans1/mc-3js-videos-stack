"""Search the clip catalogue (E:/mc_vault/motion/catalog/<lib>.jsonl, written by lab/catalog.sh) for a scene's move.

python lab/catalog.py kneel pray --to stand          words match the clip's name, its Mixamo search keywords and
                                                     the description written when someone checked it by eye
python lab/catalog.py --from stand --to sitFloor --still --dur 1-6
python lab/catalog.py scared --head                  a hand at his head for a while
python lab/catalog.py --jev "he searches the floor with his hands for something hidden"
                                                     Jev reads every clip's description and ranks them by how well
                                                     each acts the scene out (rerank, below); start here, unfiltered,
                                                     so a wrong filter word can't hide the right clip; add filters
                                                     (--has kneel ...) only to narrow a second pass

Postures (lab/catalog.ts POSTURE): stand crouch kneel sitSeat sitFloor allFours lie. Weapons and fights are left out unless
--fights. Each line: ref, seconds, posture runs, travel (m to his left, m ahead), turn, hands, look, a loop mark. Tags
checked by eye (lab/catalog_review.py) override the measured ones; "(unchecked)": nobody has looked yet. Then preview
the picks in the cell: LAB_CLIP=<ref> ENTRY=lab/clip.ts bun run render stills && python lab/sheet_clip.py
"""
import argparse, json, os, random, re, sys, threading, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path("E:/mc_vault/motion")
FIGHT = re.compile(r"gun|rifle|pistol|sword|shoot|shot|aim|reload|punch|kick|boxing|fight|attack|block|arrow|archer|"
                   r"blade|knife|axe|katana|grenade|magic|spell|zombie|mutant|sniper|stab|slash|combo|"
                   r"strike|uppercut|jab|hook|melee|weapon|dodge|parry|hit_reaction|martial|capoeira|kata", re.I)
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
    (lab/catalog.ts `tl`: when each posture, step, turn, gaze, hand position and tempo happens), ~5x the tokens of the
    note alone, so Jev's free daily quota runs out ~5x sooner; the note alone ranked well enough. A body sequence
    corrected by eye replaces the measured body channel."""
    if r.get("desc"):
        head = f"{r['desc']} [mood: {', '.join(r.get('mood', []))}; touches: {', '.join(r.get('prop', []))}" + (f"; acted: {', '.join(r['style'])}" if r.get("style") else "") + (f"; flaw: {r['flaw']}" if r.get("flaw") else "") + "]"
    else:
        head = f"{r['ref'].split('/', 1)[1].rsplit('_', 1)[0].replace('_', ' ')} (not checked by eye)"
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


def secret(env, file):
    f = Path.home() / ".secrets" / file
    return os.environ.get(env) or (f.read_text().split("=", 1)[1].strip() if f.exists() else None)


# Jev routes, tried in order: OpenCode Zen's free one (a daily quota: 429 FreeUsageLimitError, back in hours), then
# OpenRouter's paid one ($0.042 per million input tokens: a whole-catalogue search ~$0.002, ~$0.01 with --timeline).
# Keys live in ~/.secrets/<file> or the env var, never in the repo. Inputs may be kept by the provider: scene words only.
ROUTES = [("OpenCode Zen free", "https://opencode.ai/zen/v1/systemone", "jev-1.13-free", "OPENCODE_API_KEY", "opencode_zen.env"),
          ("OpenRouter (paid)", "https://openrouter.ai/api/v1/systemone", "typesafe/jev-1.14", "OPENROUTER_API_KEY", "openrouter.env")]
SPEND_CAP = 0.05  # USD per run on a paid route: a run past it stops, as a runaway loop would
HEAT, KEEP, SEED, FIT_N = 200, 20, 1, 5  # rerank heats; fits checks the first FIT_N shown


class Jev:
    """Calls Jev (TypeSafe System One, docs.typesafe.ai) on the first route in ROUTES that still has quota, adding up
    what the paid route costs. Thread-safe: the heats run in parallel."""

    def __init__(self):
        self.routes = [r for r in ROUTES if secret(*r[3:])]
        self.spent, self.lock = 0.0, threading.Lock()

    def ask(self, state, questions):
        while self.routes:
            route = self.routes[0]
            name, url, model, env, file = route
            # Cloudflare in front of Zen refuses Python's default User-Agent (error 1010)
            req = urllib.request.Request(url, data=json.dumps({"model": model, "state": state, "questions": questions}).encode(),
                headers={"Authorization": f"Bearer {secret(env, file)}", "Content-Type": "application/json", "User-Agent": "clip-catalog/1"})
            # 429 with a short Retry-After is a burst limit: wait it out; with hours (the free quota spent): next route
            for wait in [5, 10, 20, 40, 80, 160, 0]:
                try:
                    res = json.load(urllib.request.urlopen(req, timeout=120))
                    with self.lock:
                        self.spent += res.get("usage", {}).get("cost") or 0
                        if self.spent > SPEND_CAP:
                            sys.exit(f"Jev: stopped at ${self.spent:.4f}, past SPEND_CAP ${SPEND_CAP}")
                        self.used = name
                    return res["answers"]
                except urllib.error.HTTPError as e:
                    after = float(e.headers.get("Retry-After") or wait)
                    if e.code != 429 or not wait:
                        raise
                    if after > 300:
                        with self.lock:
                            if self.routes and self.routes[0] is route:
                                print(f"Jev: {name} quota spent, back in {after / 3600:.1f} h", file=sys.stderr)
                                self.routes.pop(0)
                        break
                    time.sleep(after)
        sys.exit("Jev: no route left (keys in ~/.secrets: opencode_zen.env, openrouter.env); search with filters, no --jev")


def rerank(jev, scene, hits, full=False):
    """Ranks clips by how well each acts out the scene: one Choice over their descriptions, a probability per clip. A
    Choice holds at most 255 options, so a longer list runs in heats of HEAT whose nonzero picks meet in a final.
    Cost is the tokens read, about one pass over the catalogue. Two traps from TypeSafe's docs and our tests:
    probabilities come rounded to 0.01 (a 200-clip heat has ~7 nonzero), so never fill a heat's picks up by list order;
    and similar clips sit together in name order and would knock each other out in one heat, so the list is shuffled
    first (fixed seed: the same scene ranks the same)."""
    def choice(group):
        opts = {f"c{i}": describe(r, full) for i, r in enumerate(group)}
        probs = jev.ask(f"A scene to act out: {scene}", {"clip": {"type": "choice", "instructions": "Which motion clip acts this scene out best?", "criteria": opts}})["clip"]["probabilities"]
        return [(probs.get(f"c{i}", 0), r) for i, r in enumerate(group)]

    if len(hits) > 255:
        order = hits[:]
        random.Random(SEED).shuffle(order)
        with ThreadPoolExecutor(4) as pool:
            heats = pool.map(choice, [order[k : k + HEAT] for k in range(0, len(order), HEAT)])
        hits = [r for heat in heats for p, r in sorted(heat, key=lambda x: -x[0])[:KEEP] if p > 0]
    return sorted(choice(hits), key=lambda x: -x[0])


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


def rows(libs):
    # measured tags, with the fixes recorded by eye (lab/catalog_review.py) over them; `seen`: someone has checked the clip
    rp = ROOT / "catalog" / "review.json"
    review = json.loads(rp.read_text(encoding="utf-8")) if rp.exists() else {}
    for lib in libs:
        p = ROOT / "catalog" / f"{lib}.jsonl"
        if p.exists():
            for line in p.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    r = json.loads(line)
                    rv = review.get(r["ref"], {})
                    yield {**r, **rv, "seen": r["ref"] in review, "fix": set(rv)}


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
    ap.add_argument("--mood", help="checked clips only: one of lab/catalog_review.py MOODS (scared, tired, curious...)")
    ap.add_argument("--prop", help="checked clips only: one of lab/catalog_review.py PROPS (floor, door, table...)")
    ap.add_argument("--style", help="checked clips only: one of lab/catalog_review.py STYLES (natural, cartoonish...)")
    ap.add_argument("--fights", action="store_true", help="keep weapons and fights")
    ap.add_argument("--jev", metavar="SCENE", help="rank what the filters leave by how well it acts out SCENE (rerank)")
    ap.add_argument("--timeline", action="store_true", help="Jev also reads the measured facts and timeline (~5x the quota)")
    ap.add_argument("-n", type=int, default=30)
    a = ap.parse_args()
    kw = keywords()
    span = lambda s: [float(x) for x in s.split("-")]
    words = [w.lower() for w in a.words]
    hits = []
    for r in rows(a.lib.split(",")):
        if "error" in r:
            continue
        lib, name = r["ref"].split("/", 1)
        tags = kw.get(name[-8:], set()) if lib == "mixamo" else set()
        text = " | ".join([name.lower().replace("_", " "), *sorted(tags), r.get("desc", "").lower(), *r.get("mood", []), *r.get("prop", []), *r.get("style", [])])
        if not a.fights and FIGHT.search(name):
            continue
        if any(w not in text for w in words):
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
            score = sum(2 if w in name.lower() or w in r.get("desc", "").lower() else 1 for w in words)
            hits.append((score, r, loop, tags))
    hits.sort(key=lambda h: (-h[0], h[1]["dur"]))
    pool = len(hits)
    fit = {}
    if a.jev and hits:
        jev = Jev()
        by = {id(h[1]): h for h in hits}
        hits = [(p, *by[id(r)][1:]) for p, r in rerank(jev, a.jev, [h[1] for h in hits], a.timeline)]
        shown = [h[1] for h in hits[: min(a.n, FIT_N)]]
        fit = dict(zip(map(id, shown), fits(jev, a.jev, shown, a.timeline)))
        print(f"Jev via {jev.used}" + (f", cost ${jev.spent:.4f}" if jev.spent else "") + "; rank = Choice probability, fits = "
              "its own yes/no", file=sys.stderr)
        # TypeSafe's starting thresholds for a Noul: yes above 0.7, no below 0.3
        if max(fit.values()) < 0.3:
            print(f"Jev: no shown clip fits (best {max(fit.values()):.2f}): the vault may have nothing for this scene", file=sys.stderr)
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
