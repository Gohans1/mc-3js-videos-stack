"""The creator's notes, for the AI about to act on them. Two levels, so a hundred notes never cost a hundred notes' worth of reading:

bun run notes                 index of open notes in the order written (#1 first): one line each, enough to plan the round
bun run notes ID [ID ...]     everything about those notes: the tap, words, actions, version, pictures to open
bun run notes --shot 3        everything about one shot's notes
(the film's script for: python node_modules/live-studio/notes_report.py, run in the film)
Add --done to include fixed notes, --cam to include the camera line (for changing a shot's framing).
Fixed one: bun run note done ID "what you changed" (docs/film-contract.md, "Notes").

Notes come in the order the creator wrote them, not film order: a later note often builds on, narrows or takes back an earlier
one ("this", "still", "no, rather"), so read them in that order before fixing any. #N is a note's place in that order and never
changes. Read the index first, then open the notes you're about to fix. Open the pictures named there:
"seconds around" first, it's the cheapest way to see the moment; the words alone don't say what was being looked at.
Notes from before context was saved get their words and actions worked out from today's edit, marked "(today's edit)".
Strokes drawn on the picture are listed with the second each was drawn at; a path is one point per second, the creator's way of
saying "from here at A to there at B". Open "drawn at" pictures: each is the film at one of those seconds with every stroke on it.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path.cwd()
sys.stdout.reconfigure(encoding="utf8")


def load_notes():
    file = ROOT / "notes/notes.jsonl"
    notes = [json.loads(l) for l in file.read_text(encoding="utf8").splitlines() if l.strip()] if file.exists() else []
    whole = [n for n in notes if all(k in n for k in ("id", "t", "text", "shot", "time"))]
    if len(whole) != len(notes):
        print(f"{len(notes) - len(whole)} malformed notes skipped: see notes/notes.jsonl", file=sys.stderr)
    # #N counts every note, done ones too, so a note keeps its number as the round goes on
    for i, n in enumerate(sorted(whole, key=lambda n: n.get("at", ""))):
        n["n"] = i + 1
    return whole


def written(notes):
    return sorted(notes, key=lambda n: n["n"])


def worked_out(n):
    t = n.get("srcT", n["t"])
    out = {"beats": []}
    try:
        lines = json.loads((ROOT / "renders/live/voice_map.json").read_text(encoding="utf8"))["lines"]
        here = next((i for i, l in enumerate(lines) if l["s"] <= t <= l["e"] + 0.35), None)
        after = next((i for i, l in enumerate(lines) if l["s"] > t), len(lines))
        before, nxt = (here - 1, here + 1) if here is not None else (after - 1, after)
        out["line"] = lines[here]["text"] if here is not None else None
        out["silence"] = here is None
        out["before"] = lines[before]["text"] if before >= 0 else None
        out["next"] = lines[nxt]["text"] if nxt < len(lines) else None
        beats = json.loads((ROOT / "src/edit.json").read_text(encoding="utf8"))["beats"]
        out["beats"] = [{"id": k, "title": b.get("title"), "at": b["at"], "dur": b.get("dur"), "sounds": b.get("sounds")} for k, b in beats.items() if b["at"] - 1.5 <= t <= b["at"] + (b.get("dur") or 0) + 1.5]
    except (OSError, KeyError, ValueError):
        pass
    return out


def film_now():
    try:
        described = subprocess.run(["git", "describe", "--tags", "--always", "--dirty"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    except OSError:
        described = ""
    return described or "(not in git)"


def where(pt, hit):
    return f"({pt[0] * 100:.0f}%, {pt[1] * 100:.0f}%) on \"{(hit or {}).get('what', '?')}\"" + (f" world {hit['world']}" if hit and hit.get("world") else "")


def drawn(m):
    hits = m.get("hits") or []
    hit = lambda i: hits[i] if i < len(hits) else None
    if m["kind"] == "path":
        return "path " + " -> ".join(f"{t}s {where(pt, hit(i))}" for i, (t, pt) in enumerate(zip(m["ts"], m["pts"])))
    if m["kind"] == "box":
        (x0, y0), (x1, y1) = m["pts"][0], m["pts"][-1]
        return f"box at {m['t']}s: {min(x0, x1) * 100:.0f}-{max(x0, x1) * 100:.0f}% across, {min(y0, y1) * 100:.0f}-{max(y0, y1) * 100:.0f}% down, middle " + where(((x0 + x1) / 2, (y0 + y1) / 2), hit(0))
    ends = {"pen": ("from", "to"), "arrow": ("tail", "head")}[m["kind"]]
    return f"{m['kind']} at {m['t']}s: {ends[0]} {where(m['pts'][0], hit(0))}, {ends[1]} {where(m['pts'][-1], hit(1))}"


def one_line(n):
    pin = n.get("pin")
    tags = []
    if pin:
        tags.append(f"tap {pin.get('what')}")
    if n.get("marks"):
        tags.append(f"drew {len(n['marks'])}" + (f" over {n['range'][0]}-{n['range'][1]}s" if n.get("range") else ""))
    if (n.get("context") or {}).get("playing"):
        tags.append("while playing")
    if n.get("fixes"):
        tags.append(f"tried {len(n['fixes'])}x")
    if n.get("done"):
        tags.append("done")
    text = " ".join(n["text"].split())
    return f"#{n['n']} {n['id']} {n['time']} shot {n['shot']}{' [' +', '.join(tags) + ']' if tags else ''} {text}"


def index(notes):
    print(f"{len(notes)} notes, in the order written. Film now: {film_now()}. Detail: bun run notes ID ...\n")
    for n in written(notes):
        print(one_line(n))


def detail(n, cam):
    c = n.get("context")
    print(f"\n## #{n['n']} {n['id']} {n['time']} frame {n.get('frame')}, shot {n['shot']}: {n.get('shotName', '')}{' (DONE)' if n.get('done') else ''}")
    print(f"NOTE: {n['text']}")
    for e in n.get("edits", []):
        print(f"earlier wording: {e['was']}")
    pin = n.get("pin")
    if pin:
        print(f"tap: {pin['x'] * 100:.0f}% across, {pin['y'] * 100:.0f}% down, on \"{pin.get('what')}\"" + (f", world {pin['world']}" if pin.get("world") else ""))
    elif n.get("marks"):
        print("tap: none, it was drawn on")
    else:
        print("tap: none (note button), about the moment as a whole")
    if n.get("range"):
        print(f"about {n['range'][0]}-{n['range'][1]}s, not one moment")
    for m in n.get("marks", []):
        print(f"drawn: {drawn(m)}")
    if c:
        s = c["shot"]
        print(f"in shot: {s['into']}s of {s['from']}-{s['to']}s")
        if c.get("playing"):
            print(f"pressed while PLAYING at {c.get('rate', 1)}x: it may be about a moment earlier")
        v = c["voice"]
    else:
        v = worked_out(n)
    suffix = "" if c else " (today's edit)"
    if v.get("word"):
        print(f"word: \"{v['word']}\" at {v.get('wordAt')}s in \"...{v.get('around')}...\"")
    for name, key in (("before", "before"), ("saying", "line"), ("next", "next")):
        if v.get(key):
            print(f"{name}{suffix}: {v[key]}")
    if v.get("silence"):
        print(f"voice{suffix}: silent here")
    for b in (c or v).get("beats") or []:
        print(f"action{suffix}: {b['id']} \"{b.get('title')}\" {b['at']}s +{b.get('dur')}s" + (f", sounds {b['sounds']}" if b.get("sounds") else ""))
    if c:
        view = c["view"]
        if view.get("lite"):
            print("seen on a phone with small textures: softness may not be in the film")
    for k, words in (("freeCam", "seen through the free camera"), ("finalLook", "seen in final quality")):
        if n.get(k):
            print(words)
    if n.get("version"):
        print(f"said about version: {n['version']}")
    for fix in n.get("fixes", []):
        print(f"tried: {fix['what']} ({fix['checkpoint']})")
    if cam and n.get("cam"):
        print(f"camera: {n['cam'].get('line')}" + (f" ({n['cam']['warn']})" if n["cam"].get("warn") else ""))
    for label, key in (("seconds around (-2 -1 0 +1)", "strip"), ("frame", "img"), ("under the tap", "crop")):
        if n.get(key):
            print(f"{label}: {(ROOT / n[key]).as_posix()}")
    for f in n.get("frames", []):
        print(f"drawn at {f['t']}s: {(ROOT / f['img']).as_posix()}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("ids", nargs="*")
    p.add_argument("--shot", type=int)
    p.add_argument("--done", action="store_true")
    p.add_argument("--cam", action="store_true")
    a = p.parse_args()
    notes = load_notes()
    if a.ids:
        unknown = set(a.ids) - {n["id"] for n in notes}
        if unknown:
            sys.exit(f"no such note: {', '.join(unknown)}")
        pick = [n for n in notes if n["id"] in a.ids]
    else:
        pick = [n for n in notes if a.done or not n.get("done")]
        if a.shot is not None:
            pick = [n for n in pick if n["shot"] == a.shot]
    if a.ids or a.shot is not None:
        for n in written(pick):
            detail(n, a.cam)
    else:
        index(pick)


if __name__ == "__main__":
    main()
