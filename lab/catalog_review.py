"""Review pages for checking every catalogue tag by eye: each clip's sheet (lab/catalog_review.sh) captioned with its tags,
8 clips a page, renders/catalog_review/page_NNN.jpg, plus pages.json (the refs on each page, in order).

The verdicts go in E:/mc_vault/motion/catalog/review.json, one entry per clip someone has looked at:
  desc  what he does on screen, plain English, in order, with the words a scene would be searched by ("stands, kneels on
        his right knee, sweeps both hands over the floor, stands back up"); lab/catalog.py searches it with the name
  mood  1-3 of MOODS below, how it reads (fixed words, so a filter or a decision model like Jev matches them exactly)
  prop  1-2 of PROPS below: what the move implies he touches or faces ("none" when nothing)
  style 1-2 of STYLES below: how it is acted, so a film can keep one tone (a feminine walk or a cartoon double take
        looks wrong in a grim drama, a naturalistic shrug reads too small in a comedy)
  flaw  what looks wrong on Steve, if anything ("right hand passes through his head at the end")
  any measured field that is wrong, with its right value ("seq": ["stand", "kneel"], "end": "kneel")
lab/catalog.py applies them over the measured tags and marks clips nobody has looked at yet. Pages skip clips already in
review.json.

python lab/catalog_review.py              make the pages
python lab/catalog_review.py --missing style    pages of reviewed clips without that field, captioned with their notes
                                          (a field added to the notes later), then --page N as usual
python lab/catalog_review.py --page 3 < notes.json    a page's verdicts: {"1": {"desc": ...}, ..., "8": {...}}, every slot
python lab/catalog_review.py --fix mixamo/X '{"seq": ["stand"], "start": "stand"}'    one clip, merged into its entry
"""
import argparse, json, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from catalog import has

CAT = Path("E:/mc_vault/motion/catalog")
REVIEW, SHEETS, OUT = CAT / "review.json", Path("renders/catalog_sheets"), Path("renders/catalog_review")
PER = 8
MOODS = {"neutral", "calm", "happy", "excited", "proud", "sad", "tired", "scared", "nervous", "angry", "surprised",
         "confused", "curious", "thinking", "pain", "sick", "drunk", "playful", "bored", "relieved"}
PROPS = {"none", "floor", "wall", "door", "table", "chair", "bed", "box", "object", "phone", "screen", "book", "paper",
         "person", "ledge", "ladder", "lever", "button"}
STYLES = {
    "natural",     # a real person's size and timing
    "theatrical",  # big, clear, mimed gestures that read from far away
    "cartoonish",  # comic exaggeration: double takes, flailing, silly walks
    "feminine",    # a feminine gait or carriage: hips, wrists, posture
    "athletic",    # sport, fitness, stunts, parkour
    "game",        # stiff game-style loop or transition, little weight shift
    "dance",
    "pose",        # a single held frame, no motion
}
CAP = 40  # caption band over each sheet: name, then tags


def load_review():
    return json.loads(REVIEW.read_text(encoding="utf-8")) if REVIEW.exists() else {}


def save_review(rv):
    REVIEW.write_text(json.dumps(rv, indent=1, sort_keys=True), encoding="utf-8")


def caption(r):
    flags = " ".join(f"{k} {r[k]}s" for k in ["head", "up", "ground", "bend", "air"] if has(r, k))
    return (f"{r['ref']}  {r['dur']}s", f"[{' > '.join(r['seq'])}]  {r['start']} -> {r['end']}  reach {r['reach']} m  "
            f"turn {r['turn']}  {flags}")


def pages(missing=None):
    """the pages: clips nobody has reviewed, captioned with their measured tags; or, with `missing`, reviewed clips whose
    notes lack that field, captioned with the notes so far"""
    rows = {json.loads(l)["ref"]: json.loads(l) for f in sorted(CAT.glob("*.jsonl")) for l in f.read_text(encoding="utf-8").splitlines() if l.strip()}
    seen = load_review()
    want = (lambda ref: ref in seen and missing not in seen[ref]) if missing else (lambda ref: ref not in seen)
    refs = [ref for ref in rows if want(ref) and (SHEETS / f"{ref.replace('/', '__')}.jpg").exists()]
    cap = CAP + 18 if missing else CAP
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("page_*.jpg"):
        old.unlink()
    font = ImageFont.truetype("arial.ttf", 15)
    book = {}
    for p in range(0, len(refs), PER):
        part = refs[p : p + PER]
        page = Image.new("RGB", (1280, 4 * (360 + cap)), "black")
        d = ImageDraw.Draw(page)
        for k, ref in enumerate(part):
            x, y = (k % 2) * 640, (k // 2) * (360 + cap)
            page.paste(Image.open(SHEETS / f"{ref.replace('/', '__')}.jpg").resize((640, 360)), (x, y + cap))
            name, tags = caption(rows[ref])
            lines = [f"{k + 1}. {name}"[:80]] + ([seen[ref]["desc"][i : i + 84] for i in (0, 84)] if missing else [tags[:84]])
            for j, line in enumerate(lines):
                d.text((x + 4, y + 2 + 18 * j), line, fill="white" if j == 0 else "yellow", font=font)
        page = page.crop((0, 0, 1280, ((len(part) + 1) // 2) * (360 + cap)))
        n = p // PER
        page.save(OUT / f"page_{n:03d}.jpg", quality=88)
        book[n] = part
    (OUT / "pages.json").write_text(json.dumps(book, indent=1), encoding="utf-8")
    print(f"{len(refs)} clips to review on {len(book)} pages in {OUT}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--page", type=int, help="page number: its verdicts from stdin, by slot")
    ap.add_argument("--fix", nargs=2, metavar=("REF", "JSON"), help="right values for a clip's wrong fields")
    ap.add_argument("--missing", metavar="FIELD", help="pages of reviewed clips whose notes lack FIELD")
    a = ap.parse_args()
    if a.fix:
        rv = load_review()
        rv[a.fix[0]] = {**rv.get(a.fix[0], {}), **json.loads(a.fix[1])}
        save_review(rv)
    elif a.page is not None:
        refs = json.loads((OUT / "pages.json").read_text(encoding="utf-8"))[str(a.page)]
        notes = json.loads(sys.stdin.read())
        rv = load_review()
        # every clip's notes once merged must hold desc, mood, prop and style, in the fixed words
        for k, ref in enumerate(refs):
            n = {**rv.get(ref, {}), **notes.get(str(k + 1), {})}
            bad = set(n.get("mood", [])) - MOODS | set(n.get("prop", [])) - PROPS | set(n.get("style", [])) - STYLES
            if bad or not all(n.get(f) for f in ["desc", "mood", "prop", "style"]):
                sys.exit(f"page {a.page} slot {k + 1}: needs desc, mood, prop and style (fixed words); unknown: {sorted(bad)}")
        for k, ref in enumerate(refs):
            rv[ref] = {**rv.get(ref, {}), **notes.get(str(k + 1), {})}
        save_review(rv)
        print(f"page {a.page}: {len(refs)} clips noted; {len(rv)} reviewed")
    else:
        pages(a.missing)


if __name__ == "__main__":
    sys.exit(main())
