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
    # Options the studio can switch to (edit.json `try` on a bed or sound effect)
    "hum_lowfreq": (72091, None, "room hum option: a plain low-frequency hum (Low Frequency Humming Noise)"),
    "hum_fluorescent": (784208, None, "room hum option: old fluorescent tubes in a quiet room (1950s Flourescent Bathroom Lights)"),
    "hum_backrooms": (626096, None, "room hum option: a buzzing fluorescent backrooms tone (Backrooms Ambience)"),
    "pop_flick": (448394, None, "cut pop option: a fuse switch flicked off (Fuze Switch Flick)"),
    "pop_flashlight": (758910, None, "cut pop option: a flashlight clicked off (Flashlight Off)"),
    # 0:27-0:58: up, to the door, back to the desk, the terminal
    "bed_creak": (444389, None, "the bed frame as he pushes himself up (Bed creak)"),
    "steps": (366111, None, "his bare feet on the stone floor (Indoor Footsteps)"),
    "steps_stone": (813622, None, "footsteps option: harder steps on stone (Footsteps - Stone, Rock, Concrete, Cement)"),
    "door_touch": (337853, None, "his hand along the steel door's seam (metal-touch)"),
    "button_click": (257357, None, "the stone button by the door, pressed again and again (Button click)"),
    "button_push": (635915, None, "button option: a heavier push (Button Push)"),
    "door_kick": (209772, None, "his kick on the steel door (Metal Boom)"),
    "door_kick_wood": (411694, None, "door kick option: a drier thud (DoorKick2)"),
    "chair_drag": (186437, None, "the chair dragged on the stone (chair dragged)"),
    "chair_drag_concrete": (871017, None, "chair drag option: on concrete in a bare room (dragging chair on concrete floor)"),
    "chair_creak": (175410, None, "the chair taking his weight (Moaning Chair)"),
    "typing": (644842, None, "his first try at the old keyboard (Old Keyboard Typing 8)"),
    "typing_fast": (677658, None, "the second try, hammered in (Fast Typing)"),
    "typing_fast_short": (813214, None, "fast typing option (Very_Fast_Typing_Short)"),
    "key_enter": (627647, None, "Enter (Enter Key Press Mechanical Keyboard)"),
    "denied": (419023, None, "the terminal's ACCESS DENIED (acess denied buzz)"),
    "denied_soft": (67454, None, "ACCESS DENIED option: a softer low beep (negativebeep)"),
    "slam": (529396, None, "both fists slammed on the keyboard (thump_thud_slam_fist_heavy)"),
    "slam_table": (787456, None, "slam option: a hand slapped on a table (hand_on_table)"),
    "keys_rattle": (368025, None, "the keyboard rattling as it is knocked askew (keyboard bang)"),
    "sigh": (215380, None, "his breath out as he slumps (male sigh)"),
    # 0:59-1:50: the cabinet, the silverfish, the pages
    "cabinet_rustle": (211246, None, "something stirring among the papers inside the cabinet (PageRustle)"),
    "cabinet_rustle_crumple": (272015, None, "cabinet rustle option: paper crumpled inside (Crumpling Paper)"),
    "drawer_creak": (752216, None, "the drawer eased open (Sliding Squeaking Drawer Soft Opening)"),
    "drawer_yank": (185838, None, "the metal drawer jerked open, things shifting inside (Metal drawer with objects inside)"),
    "drawer_shut": (50735, None, "the drawer kneed shut (Kitchen Drawer Close 3)"),
    "drawer_out": (643502, None, "the drawer pulled off its slides (Steel Drawer Open & Close)"),
    "set_down": (500283, None, "the emptied drawer set down on the stone (Box Falling Down)"),
    "squeak": (288941, None, "the silverfish's squeal as it leaps (rat-squeak)"),
    "squeak_rat": (536753, None, "silverfish option: a rat's chitter (Rat.ogg)"),
    "paper_burst": (389437, None, "pages blown out of the drawer (Papers Tossed into Air; falling 1)"),
    "gasp": (344407, None, "his gasp at the burst (Male Gasp 1)"),
    "fall": (346695, None, "he falls back onto the floor (Body fall_01)"),
    "panting": (543243, None, "his panting on the floor (vocals panting)"),
    "paper_grab": (767489, None, "a page picked up (Paper Grab)"),
    "paper_lay": (464302, None, "the pages laid on the desk (PaperSlide)"),
    "page_turn": (136778, None, "a page moved to the aside pile (Page Turn)"),
    "paper_sweep": (389441, None, "the pages swept off the desk (Paper Throw Into Air; 3)"),
    "dig_papers": (389440, None, "papers flung out while he digs (Papers Flapping; Intense)"),
    "zap": (582631, None, "the lamp dropping out (Long Crackle 04)"),
    "arrival": (541029, None, "a page out of nowhere: a very low thud (Very low frequency impact)"),
    "lamp_flicker": (484157, None, "the dying tube's flicker under section 1.2 (fluorescent light flickering 1)"),
    "heartbeat": (249716, None, "his heartbeat at the empty slot (SLOW HEARTBEAT)"),
    # background music (BGM), 115 s kept: options in the studio
    "bgm_thriller": (157133, 115.0, "BGM: slow dark thriller ambience (Thriller Ambient)"),
    "bgm_museum": (726368, 115.0, "BGM option: dark ambient (Street Museum (Dark Ambient BGM))"),
    "bgm_drone": (332246, None, "BGM option: a plain drone (Drone - 15.12.2015)"),
    "bgm_suspense": (387223, None, "BGM option: orchestral suspense (Orchestral Suspense Loop 1)"),
}
BEDS = {"room_hum", "cctv_hiss", "hum_lowfreq", "hum_fluorescent", "hum_backrooms", "lamp_flicker", "heartbeat", "dig_papers",
        "bgm_thriller", "bgm_museum", "bgm_drone", "bgm_suspense"}
MUSIC = {"bgm_thriller", "bgm_museum", "bgm_drone", "bgm_suspense"}  # kept stereo; every other sound is mono

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
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), *trim, "-ac", "2" if name in MUSIC else "1", "-ar", "48000",
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
