"""Review pages for checking every catalogue tag by eye: each clip's sheet (clip-catalog/catalog_review.sh) captioned with its tags,
8 clips a page, vault/motion/catalog/review_pages/page_NNN.jpg, plus pages.json (the refs on each page, in order).

The verdicts go in vault/motion/catalog/review.json, one entry per clip someone has looked at:
  desc  what he does on screen, plain English, in order, with the words a scene would be searched by ("stands, kneels on
        his right knee, sweeps both hands over the floor, stands back up"); clip-catalog/catalog.py searches it with the name
  mood  1-3 of MOODS below, how it reads (fixed words, so a filter or a decision model like Jev matches them exactly)
  prop  1-2 of PROPS below: what the move implies he touches or faces ("none" when nothing)
  style 1-2 of STYLES below: how it is acted, so a film can keep one tone (a feminine walk or a cartoon double take
        looks wrong in a grim drama, a naturalistic shrug reads too small in a comedy)
  flaw  what looks wrong on Steve, if anything ("right hand passes through his head at the end")
  any measured field that is wrong, with its right value ("seq": ["stand", "kneel"], "end": "kneel")
clip-catalog/catalog.py applies them over the measured tags and marks clips nobody has looked at yet. Pages skip clips already in
review.json.

python ../../packages/clip-catalog/catalog_review.py              make the pages
python ../../packages/clip-catalog/catalog_review.py --missing style    pages of reviewed clips without that field, captioned with their notes
                                          (a field added to the notes later), then --page N as usual
python ../../packages/clip-catalog/catalog_review.py --page 3 < notes.json    a page's verdicts: {"1": {"desc": ...}, ..., "8": {...}}, every slot
python ../../packages/clip-catalog/catalog_review.py --fix mixamo/X '{"seq": ["stand"], "start": "stand"}'    one clip, merged into its entry
"""
import argparse, json, sys
from pathlib import Path
from catalog import ROOT, has
from batch import read_rows

CAT = ROOT / "catalog"
REVIEW, SHEETS, OUT = CAT / "review.json", CAT / "sheets", CAT / "review_pages"
PER = 8
MOODS = {"neutral", "calm", "happy", "excited", "proud", "sad", "tired", "scared", "nervous", "angry", "surprised",
         "confused", "curious", "thinking", "pain", "sick", "drunk", "playful", "bored", "relieved"}
PROPS = {"none", "floor", "wall", "door", "table", "chair", "bed", "box", "object", "phone", "screen", "book", "paper",
         "person", "ledge", "ladder", "lever", "button"}
STYLES = {
    "natural",
    "theatrical",
    "cartoonish",
    "feminine",
    "athletic",
    "game",
    "dance",
    "pose",
}
CAP = 40


def load_review():
    return json.loads(REVIEW.read_text(encoding="utf-8")) if REVIEW.exists() else {}


def save_review(rv):
    REVIEW.parent.mkdir(parents=True, exist_ok=True)
    tmp = REVIEW.with_suffix(".json.new")
    tmp.write_text(json.dumps(rv, indent=1, sort_keys=True, allow_nan=False), encoding="utf-8")
    tmp.replace(REVIEW)


def caption(r):
    flags = " ".join(f"{k} {r[k]}s" for k in ["head", "up", "ground", "bend", "air"] if has(r, k))
    return (f"{r['ref']}  {r['dur']}s", f"[{' > '.join(r['seq'])}]  {r['start']} -> {r['end']}  reach {r['reach']} m  "
            f"turn {r['turn']}  {flags}")


def pages(missing=None):
    """the pages: clips nobody has reviewed, captioned with their measured tags; or, with `missing`, reviewed clips whose
    notes lack that field, captioned with the notes so far"""
    from PIL import Image, ImageDraw, ImageFont
    rows = catalogue()
    if not rows:
        raise ValueError("no measured clips: run batch.py catalog first")
    seen = load_review()
    want = (lambda ref: ref in seen and missing not in seen[ref]) if missing else (lambda ref: ref not in seen)
    refs = [ref for ref in rows if want(ref) and (SHEETS / f"{ref.replace('/', '__')}.jpg").exists()]
    cap = CAP + 18 if missing else CAP
    absent = [ref for ref in rows if want(ref) and not (SHEETS / f"{ref.replace('/', '__')}.jpg").exists()]
    if absent and not refs:
        raise ValueError(f"{len(absent)} clips need sheets: run batch.py sheets first (first: {absent[0]})")
    if absent:
        print(f"{len(absent)} clips still lack sheets; reviewing the available ones now. Later: run batch.py sheets")
    OUT.mkdir(parents=True, exist_ok=True)
    try:
        font = ImageFont.truetype("arial.ttf", 15)
    except OSError:
        font = ImageFont.load_default(size=15)
    book = {}
    for p in range(0, len(refs), PER):
        part = refs[p : p + PER]
        page = Image.new("RGB", (1280, 4 * (360 + cap)), "black")
        d = ImageDraw.Draw(page)
        for k, ref in enumerate(part):
            x, y = (k % 2) * 640, (k // 2) * (360 + cap)
            page.paste(Image.open(SHEETS / f"{ref.replace('/', '__')}.jpg").resize((640, 360)), (x, y + cap))
            name, tags = caption(rows[ref])
            desc = seen.get(ref, {}).get("desc", "")
            lines = [f"{k + 1}. {name}"[:80]] + ([desc[i : i + 84] for i in (0, 84)] if missing else [tags[:84]])
            for j, line in enumerate(lines):
                d.text((x + 4, y + 2 + 18 * j), line, fill="white" if j == 0 else "yellow", font=font)
        page = page.crop((0, 0, 1280, ((len(part) + 1) // 2) * (360 + cap)))
        n = p // PER
        page.save(OUT / f"page_{n:03d}.jpg", quality=88)
        book[n] = part
    (OUT / "pages.json").write_text(json.dumps(book, indent=1), encoding="utf-8")
    print(f"{len(refs)} clips to review on {len(book)} pages in {OUT}")
    print("next: open the pages listed in pages.json; submit a page with --page N --notes notes.json (do not regenerate pages mid-review)")


def catalogue():
    return {ref: row for f in sorted(CAT.glob("*.jsonl")) if not f.name.startswith("sweep_")
            for ref, row in read_rows(f).items() if "error" not in row}


def validate(note, row, complete=False):
    if not isinstance(note, dict):
        raise ValueError("notes must be JSON objects")
    allowed = (set(row) - {"ref", "error"}) | {"desc", "mood", "prop", "style", "flaw"}
    if set(note) - allowed:
        raise ValueError(f"unknown or protected fields: {sorted(set(note) - allowed)}")
    for key in ["desc", "flaw"]:
        if key in note and not isinstance(note[key], str):
            raise ValueError(f"{key} must be text")
    for key, vocabulary in [("mood", MOODS), ("prop", PROPS), ("style", STYLES)]:
        if key in note:
            value = note[key]
            if not isinstance(value, list) or any(not isinstance(x, str) or x not in vocabulary for x in value):
                raise ValueError(f"{key} must be an array from {sorted(vocabulary)}")
    for key in set(note) & set(row):
        old, new = row[key], note[key]
        if isinstance(new, bool) != isinstance(old, bool) or not (isinstance(new, (int, float)) and isinstance(old, (int, float)) or type(new) is type(old)):
            raise ValueError(f"{key} must have the same JSON type as the measurement")
    postures = {"stand", "crouch", "kneel", "sitSeat", "sitFloor", "allFours", "lie"}
    for key in ["start", "end", "seq"]:
        if key in note:
            values = note[key] if key == "seq" else [note[key]]
            if any(not isinstance(v, str) or v not in postures for v in values):
                raise ValueError(f"{key} needs postures from {sorted(postures)}")
    if complete and not all(note.get(key) for key in ["desc", "mood", "prop", "style"]):
        raise ValueError("needs desc, mood, prop and style")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
                                 epilog=f"Mood: {', '.join(sorted(MOODS))}\nProp: {', '.join(sorted(PROPS))}\nStyle: {', '.join(sorted(STYLES))}\nDescriptions stay free-form; tags aid search, never limit a film's acting.")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--page", type=int, help="zero-based page number; submit every numbered slot")
    mode.add_argument("--fix", nargs=2, metavar=("REF", "JSON"), help="merge corrections for one known clip")
    mode.add_argument("--missing", choices=["desc", "mood", "prop", "style", "flaw"], help="pages of reviewed clips missing this field")
    ap.add_argument("--notes", type=Path, help="page notes JSON file (PowerShell); without it read stdin")
    a = ap.parse_args(["--help"] if sys.argv[1:2] == ["help"] else None)
    if a.notes and a.page is None:
        ap.error("--notes requires --page N")
    try:
        return apply(a)
    except (OSError, ValueError, KeyError, TypeError) as e:
        ap.error(f"{e}; --help shows the workflow; no review changes saved")


def apply(a):
    rows = catalogue()
    if a.fix:
        ref, text = a.fix
        if ref not in rows:
            raise ValueError(f"unknown clip {ref}; use a ref from the catalogue")
        changes = json.loads(text)
        validate(changes, rows[ref])
        rv = load_review()
        rv[ref] = {**rv.get(ref, {}), **changes}
        save_review(rv)
        print(f"{ref}: corrections saved\nnext: preview the corrected clip with bun run render stills --entry lab/clip.ts --lab clip={ref}")
    elif a.page is not None:
        refs = json.loads((OUT / "pages.json").read_text(encoding="utf-8"))[str(a.page)]
        notes = json.loads(a.notes.read_text(encoding="utf-8-sig") if a.notes else sys.stdin.read())
        if not isinstance(notes, dict) or set(notes) != {str(k + 1) for k in range(len(refs))}:
            raise ValueError(f"page {a.page}: notes must contain exactly slots 1..{len(refs)}")
        rv = load_review()
        for k, ref in enumerate(refs):
            change = notes[str(k + 1)]
            validate(change, rows[ref])
            n = {**rv.get(ref, {}), **change}
            validate(n, rows[ref], complete=True)
        for k, ref in enumerate(refs):
            rv[ref] = {**rv.get(ref, {}), **notes.get(str(k + 1), {})}
        save_review(rv)
        print(f"page {a.page}: {len(refs)} clips noted; {len(rv)} reviewed")
        print("next: review the next page listed in pages.json; regenerate only after finishing this book")
    else:
        pages(a.missing)


if __name__ == "__main__":
    sys.exit(main())
