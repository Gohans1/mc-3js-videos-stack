"""CC0 sound effects from Freesound without an API key (its public search page and preview CDN), adapted from the
Minecraft worktree's get_sfx.py. Each sound is a Freesound id picked from `find` (most downloaded CC0 first) and
pinned in SFX; title, author and link are kept in sound/sfx/SOURCES.json.
  python sound/get_sfx.py                 fetch every missing sound in SFX
  python sound/get_sfx.py find "cat meow" [max seconds]
A sound is used only if its own page still says Creative Commons 0. Already fetched sounds are skipped."""
import html
import json
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "sfx"
RAW = OUT / "raw"
SOURCES = OUT / "SOURCES.json"
UA = {"User-Agent": "Mozilla/5.0"}

# name: (Freesound id, keep s or None for the whole sound, what it is for). Ids were picked with `find` and are pinned here.
SFX = {
    "room_hum": (671455, 30.0, "the cold lamp's electric hum under the whole cell (Bedroom Room Tone Electric Lamp Hum)"),
    "cctv_hiss": (443339, 5.0, "the CCTV feed's faint recording hiss, cut dead at the cut to the clean lens (TAPE HISS)"),
    "cut_pop": (674713, None, "the hiss cutting out at 00:03.5 (Turning Off Microphone)"),
    "rustle_hand": (320144, None, "his right hand twitching on the mattress at 00:02.8 (Blanket Movement 6)"),
    "rustle_head": (556711, 1.6, "his collar on the mattress as his head turns at 00:06.6 (Rustling fabric)"),
    "breath": (707832, None, "the short breath in as his eyes open at 00:03.7 (IN-BREATHS; the mix keeps the first breath)"),
}
BEDS = {"room_hum", "cctv_hiss"}

def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read()


def find(query, lo=0.0, hi=60.0):
    q = urllib.parse.urlencode({"q": query, "f": 'license:"Creative Commons 0"', "s": "Downloads (most first)"})
    page = get(f"https://freesound.org/search/?{q}").decode("utf8")
    out = []
    for m in re.finditer(r'class="bw-player"(.*?)tabindex', page, re.S):
        a = dict(re.findall(r'data-([a-z-]+)="([^"]*)"', m.group(1)))
        if lo <= float(a["duration"]) <= hi:
            out.append((int(a["sound-id"]), html.unescape(a["title"]), float(a["duration"]), int(a.get("num-downloads", 0))))
    return out


def fetch(name, sid, keep):
    RAW.mkdir(parents=True, exist_ok=True)
    page = get(f"https://freesound.org/s/{sid}/").decode("utf8")
    if "Creative Commons 0" not in page and "publicdomain/zero" not in page:
        raise ValueError(f"{name}: sound {sid} is not CC0")
    mp3 = re.search(r'data-mp3="(https://cdn\.freesound\.org/previews/[^"]+)-lq\.mp3"', page).group(1) + "-hq.mp3"
    title = html.unescape(re.search(r'data-title="([^"]*)"', page).group(1))
    user = re.search(r'data-username="([^"]*)"', page).group(1)
    raw = RAW / f"{sid}.mp3"
    if not raw.exists():
        raw.write_bytes(get(mp3))
    trim = ["-t", str(keep)] if keep else []
    # One-shots lose their leading silence; beds (room tone, hiss) are quiet all through and would be cut away whole.
    # Both ends fade so cuts never click.
    lead = "" if name in BEDS else "silenceremove=start_periods=1:start_threshold=-45dB,"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), *trim, "-ac", "1", "-ar", "48000",
                    "-af", lead + "afade=t=in:d=0.004,areverse,afade=t=in:d=0.03,areverse",
                    str(OUT / f"{name}.wav")], check=True)
    return {"id": sid, "title": title, "by": user, "url": f"https://freesound.org/s/{sid}/", "license": "CC0 1.0"}


if __name__ == "__main__":
    if sys.argv[1:2] == ["find"]:
        for r in find(sys.argv[2], 0, float(sys.argv[3]) if len(sys.argv) > 3 else 60):
            print(*r, sep=" | ")
        raise SystemExit
    OUT.mkdir(parents=True, exist_ok=True)
    known = json.loads(SOURCES.read_text(encoding="utf8")) if SOURCES.exists() else {}
    for name, (sid, keep, why) in SFX.items():
        if name in known and known[name]["id"] == sid and (OUT / f"{name}.wav").exists():
            continue
        known[name] = {**fetch(name, sid, keep), "for": why}
        SOURCES.write_text(json.dumps(known, indent=1, ensure_ascii=False), encoding="utf8")
        print("got", name, known[name]["title"])
