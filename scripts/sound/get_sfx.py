"""CC0 sound effects from Freesound without an API key (its public search page and preview CDN), adapted from the
Minecraft worktree's get_sfx.py. Each sound is a Freesound id picked from `find` (most downloaded CC0 first) and
pinned in SFX, or in the film's own sound/sfx_list.json when it has one ({name: {id, keep, for, bed, music}}, which then
replaces SFX); title, author and link are kept in sound/sfx/SOURCES.json.
  bun run sfx:get                        fetch every missing sound in SFX (or sound/sfx_list.json)
  bun run sfx:get find "cat meow" [max seconds]   search Freesound: id | title | seconds | downloads, to pin one
  bun run sfx:get sweeteners             fetch the cut sweeteners every film shares (SWEETENERS)
To pin one: add "name": {"id": <id from find>, "for": "what it is for"} to sound/sfx_list.json, then bun run sfx:get.
A sound is used only if its own page still says Creative Commons 0. Cached sounds with matching processing are skipped. Run inside the
film. The vault may have it already: bun run find <words>."""
import html
import json
import math
import os
import re
import shutil
import stat
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import wave
from pathlib import Path

ROOT = Path.cwd() / "sound"  # run from the film folder: its sound/sfx
OUT = ROOT / "sfx"
RAW = OUT / "raw"
SOURCES = OUT / "SOURCES.json"
UA = {"User-Agent": "Mozilla/5.0"}

NAME_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]*$")
WINDOWS_RESERVED = {
    "con", "prn", "aux", "nul",
    *(f"com{i}" for i in range(1, 10)),
    *(f"lpt{i}" for i in range(1, 10)),
}


class CliError(Exception):
    """User-facing CLI error with exit code (1 = film/work error, 2 = bad CLI args)."""

    def __init__(self, message, code=1):
        super().__init__(message)
        self.code = code

# name: (Freesound id, keep s or None for the whole sound, what it is for). Ids were picked with `find` and are pinned here.
SFX = {
    "room_hum": (671455, 30.0, "the cold lamp's electric hum under the whole cell (Bedroom Room Tone Electric Lamp Hum)"),
    "cctv_hiss": (443339, 5.0, "the CCTV feed's faint recording hiss, cut dead at the cut to the clean lens (TAPE HISS)"),
    "cut_pop": (674713, None, "the hiss cutting out at 00:03.5 (Turning Off Microphone)"),
    "rustle_hand": (320144, None, "his right hand twitching on the mattress at 00:02.8 (Blanket Movement 6)"),
    "rustle_head": (556711, 1.6, "his collar on the mattress as his head turns at 00:06.6 (Rustling fabric)"),
    "breath": (707832, None, "the short breath in as his eyes open at 00:03.7 (IN-BREATHS; the mix keeps the first breath)"),
    # Options the studio can switch to (src/timeline/audio.json `try` on a bed or sound effect)
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
# Cut sweeteners, the same set in every film: the studio's Sound at the cut (live-studio app/sound/sweeten.ts) finds them by
# role and lines each one's hit up with the cut: a riser ends on it, a whoosh is loudest on it, an impact starts on it, a
# downlifter falls away from it. name: (Freesound id, keep s or None, role, what it is)
SWEETENERS = {
    "sweet_riser": (685256, None, "riser", "a short riser that stops dead on the cut (Riser sound effect short)"),
    "sweet_swell": (110218, None, "riser", "a reversed crash swelling into the cut (reverse crash)"),
    "sweet_whoosh": (243400, None, "whoosh", "a whoosh across the cut, loudest on it (woosh)"),
    "sweet_whoosh_short": (60013, None, "whoosh", "a quick whoosh for a fast cut (Whoosh)"),
    "sweet_impact": (430977, None, "impact", "a big hit on the new shot's first frame, ringing out over 4 s (Big impact)"),
    "sweet_impact_low": (430978, None, "impact", "a lower, softer hit (Low impact)"),
    "sweet_downlifter": (482146, None, "downlifter", "a sweep falling away after the cut (downlifter 2)"),
}
def _utf8_stdio():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")


def _is_reparse(path):
    try:
        st = path.lstat()
    except OSError:
        return False
    if stat.S_ISLNK(st.st_mode):
        return True
    return bool(getattr(st, "st_file_attributes", 0) & 0x400)


def _assert_in_root(path, root, label):
    """Reject symlinks, Windows junctions/reparse points, root-equal paths, and escapes outside root."""
    root_real = root.resolve()
    try:
        rel = path.relative_to(root) if path.is_absolute() else path
    except ValueError as exc:
        raise CliError(f"{label} escapes film root: {path}") from exc
    if ".." in rel.parts:
        raise CliError(f"{label} escapes film root: {path}")
    cur = root
    for part in rel.parts:
        cur = cur / part
        if _is_reparse(cur):
            raise CliError(f"{label} uses a symlink or junction: {cur}")
    resolved = path.resolve()
    try:
        resolved.relative_to(root_real)
    except ValueError as exc:
        raise CliError(f"{label} escapes film root: {path}") from exc
    if resolved == root_real:
        raise CliError(f"{label} must be inside the film folder, not the film root itself: {path}")
    return resolved


def _check_dir_slot(path, label):
    if path.exists() and not path.is_dir():
        raise CliError(f"{label} must be a directory, got a file: {path}")


def _ensure_dir(path, label):
    _check_dir_slot(path, label)
    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise CliError(f"cannot create directory {label} ({path}): {exc}") from exc


def _ensure_file_slot(path, label):
    if path.exists() and path.is_dir():
        raise CliError(f"{label} must be a file, got a directory: {path}")


def _read_json_dict(path, label):
    """Read a UTF-8/BOM JSON file as an object, formatting parse errors clearly."""
    try:
        raw = path.read_text(encoding="utf-8-sig")
    except OSError as exc:
        raise CliError(f"cannot read {label}: {exc}") from exc
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise CliError(f"{label} is not valid JSON (at line {exc.lineno} column {exc.colno}): {exc.msg}") from exc
    if not isinstance(data, dict):
        raise CliError(f"{label} must be a JSON object")
    return data


def _validate_sound_name(name):
    """Ensure sound name matches sound.mjs NAME rules and cannot traverse or hit Windows device names."""
    if not isinstance(name, str) or ".." in name or not NAME_RE.match(name):
        raise CliError(f"invalid sound name {name!r}: use letters, numbers, _, -, or . (no paths or leading dot)")
    if name.split(".", 1)[0].lower() in WINDOWS_RESERVED:
        raise CliError(f"invalid sound name {name!r}: reserved device name on Windows")


def _resolve_sfx_dir(film_dir):
    """Resolve and confine sfx output paths inside film_dir (respecting package.json live-studio.sfx)."""
    rel_sfx = "sound/sfx"
    pkg_path = film_dir / "package.json"
    if pkg_path.exists() or pkg_path.is_symlink():
        _assert_in_root(pkg_path, film_dir, "package.json")
        pkg = _read_json_dict(pkg_path, "package.json")
        ls = pkg.get("live-studio")
        if ls is not None:
            if not isinstance(ls, dict):
                raise CliError('package.json "live-studio" must be a JSON object')
            custom = ls.get("sfx")
            if custom is not None:
                if not isinstance(custom, str) or not custom.strip():
                    raise CliError('package.json "live-studio".sfx must be a non-empty string')
                rel_sfx = custom.strip()
    sfx_rel = Path(rel_sfx)
    if sfx_rel.is_absolute() or sfx_rel.drive or sfx_rel.root or rel_sfx.startswith(("/", "\\")):
        raise CliError(f"live-studio.sfx must be relative to the film folder, got {rel_sfx}")
    out_dir = _assert_in_root(film_dir / sfx_rel, film_dir, rel_sfx)
    raw_dir = _assert_in_root(out_dir / "raw", film_dir, f"{rel_sfx}/raw")
    sources_path = _assert_in_root(out_dir / "SOURCES.json", film_dir, f"{rel_sfx}/SOURCES.json")
    return out_dir, raw_dir, sources_path


def _load_sfx_list(film_dir):
    """Load and validate sound/sfx_list.json, or return built-in SFX defaults when absent."""
    list_path = _assert_in_root(film_dir / "sound" / "sfx_list.json", film_dir, "sound/sfx_list.json")
    if not list_path.exists():
        return dict(SFX), set(BEDS), set(MUSIC)
    own = _read_json_dict(list_path, "sound/sfx_list.json")
    sfx_map, beds_set, music_set = {}, set(), set()
    for name, entry in own.items():
        _validate_sound_name(name)
        if not isinstance(entry, dict):
            raise CliError(f"sound/sfx_list.json[{name!r}] must be a JSON object")
        sid = entry.get("id")
        if type(sid) is not int or sid <= 0:
            raise CliError(f"sound/sfx_list.json[{name!r}].id must be a positive integer")
        why = entry.get("for")
        if not isinstance(why, str) or not why.strip():
            raise CliError(f'sound/sfx_list.json[{name!r}] is missing a non-empty "for" description')
        keep = entry.get("keep")
        if keep is not None:
            if isinstance(keep, bool) or not isinstance(keep, (int, float)) or not math.isfinite(keep) or keep <= 0:
                raise CliError(f"sound/sfx_list.json[{name!r}].keep must be a positive number of seconds")
            keep = float(keep)
        for flag in ("bed", "music"):
            val = entry.get(flag)
            if val is not None and not isinstance(val, bool):
                raise CliError(f"sound/sfx_list.json[{name!r}].{flag} must be true or false")
        sfx_map[name] = (sid, keep, why.strip())
        if entry.get("bed") or entry.get("music"):
            beds_set.add(name)
        if entry.get("music"):
            music_set.add(name)
    return sfx_map, beds_set, music_set


def _freesound_base():
    raw = os.environ.get("FREESOUND_BASE", "").strip()
    if not raw:
        return "https://freesound.org", False
    parsed = urllib.parse.urlparse(raw)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise CliError(f"FREESOUND_BASE must be an http(s) URL, got {raw!r}", code=2)
    return raw.rstrip("/"), True


def _assert_allowed_mp3(url, base, allow_base_origin):
    if url.startswith("https://cdn.freesound.org/previews/"):
        return url
    if allow_base_origin:
        bp = urllib.parse.urlparse(base)
        up = urllib.parse.urlparse(url)
        if up.scheme == bp.scheme and up.netloc == bp.netloc and up.path.startswith("/previews/"):
            return url
    raise CliError(f"unexpected preview audio URL: {url}")


def _verify_cc0_page(page, name, sid):
    """Reject pages with non-CC0 license links even if body text mentions Creative Commons 0."""
    links = [m.group(2) for m in re.finditer(r'href=(["\'])(https?://creativecommons\.org/[^"\']+)\1', page, re.I)]
    if any("publicdomain/zero" in u.lower() for u in links):
        return
    if any("/licenses/" in u.lower() for u in links) or (
        "Creative Commons 0" not in page and "publicdomain/zero" not in page
    ):
        raise CliError(f"{name}: sound {sid} is not CC0")


def _extract_meta(page, prop):
    for pattern in (
        rf'property=(["\']){re.escape(prop)}\1[^>]*content=(["\'])(.*?)\2',
        rf'content=(["\'])(.*?)\1[^>]*property=(["\']){re.escape(prop)}\3',
    ):
        m = re.search(pattern, page, re.I | re.S)
        if m:
            return m.group(3) if pattern.startswith("property") else m.group(2)
    return None


def _atomic_write_bytes(dest, data):
    tmp = dest.with_name(f".{dest.name}.{os.getpid()}.tmp")
    try:
        tmp.write_bytes(data)
        os.replace(tmp, dest)
    except OSError as exc:
        raise CliError(f"cannot write {dest}: {exc}") from exc
    finally:
        tmp.unlink(missing_ok=True)


def _atomic_write_text(dest, text):
    tmp = dest.with_name(f".{dest.name}.{os.getpid()}.tmp")
    try:
        with tmp.open("w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
        os.replace(tmp, dest)
    except OSError as exc:
        raise CliError(f"cannot write {dest}: {exc}") from exc
    finally:
        tmp.unlink(missing_ok=True)


def _wav_frames(path):
    try:
        with wave.open(str(path), "rb") as wf:
            return wf.getnframes() if wf.getframerate() > 0 else 0
    except (wave.Error, OSError, EOFError):
        return 0


def get(url):
    """Download bytes from Freesound with clear network/HTTP error reporting."""
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read()
    except urllib.error.HTTPError as exc:
        raise CliError(f"Freesound HTTP {exc.code} for {url}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        reason = getattr(exc, "reason", exc)
        raise CliError(f"cannot reach Freesound ({url}): {reason}") from exc


def find(query, lo=0.0, hi=60.0):
    """Search Freesound for CC0 sounds matching query within [lo, hi] seconds."""
    base, _ = _freesound_base()
    q = urllib.parse.urlencode({"q": query, "f": 'license:"Creative Commons 0"', "s": "Downloads (most first)"})
    page = get(f"{base}/search/?{q}").decode("utf8", errors="replace")
    out = []
    for m in re.finditer(r'<[a-zA-Z0-9]+\b([^>]*\bclass=(["\'])[^"\']*\bbw-player\b[^"\']*\2[^>]*)>', page, re.S):
        attrs = dict((k, v) for k, _, v in re.findall(r'data-([a-z-]+)=(["\'])(.*?)\2', m.group(1), re.S))
        sid_raw, title_raw, dur_raw = attrs.get("sound-id"), attrs.get("title"), attrs.get("duration")
        if not sid_raw or title_raw is None or not dur_raw:
            continue
        try:
            sid, dur, dls = int(sid_raw), float(dur_raw), int(attrs.get("num-downloads", 0))
        except ValueError:
            continue
        if lo <= dur <= hi:
            out.append((sid, html.unescape(title_raw), dur, dls))
    return out


def fetch(name, sid, keep, *, out_dir=OUT, raw_dir=RAW, raw_path=None, is_bed=None, is_music=None):
    """Verify CC0, cache raw mp3, transcode atomically to 48 kHz WAV, and return credit metadata."""
    base, allow_base_origin = _freesound_base()
    sound_url = f"{base}/s/{sid}/"
    page = get(sound_url).decode("utf8", errors="replace")
    _verify_cc0_page(page, name, sid)

    mp3_m = re.search(r'data-mp3=(["\'])(https?://[^"\']+)\1', page)
    if not mp3_m:
        raise CliError(f"{name}: missing preview audio URL on sound {sid}")
    raw_mp3 = mp3_m.group(2)
    mp3 = (raw_mp3[:-7] + "-hq.mp3") if raw_mp3.endswith("-lq.mp3") else raw_mp3
    _assert_allowed_mp3(mp3, base, allow_base_origin)

    title_m = re.search(r'data-title=(["\'])(.*?)\1', page, re.S)
    if not title_m:
        raise CliError(f"{name}: missing sound title on sound {sid}")
    title = html.unescape(title_m.group(2))
    user_raw = _extract_meta(page, "og:audio:artist")  # data-username is the viewer, not the author
    if not user_raw or not user_raw.strip():
        raise CliError(f"{name}: missing author on sound {sid}")
    user = html.unescape(user_raw)

    _ensure_dir(raw_dir, "raw cache dir")
    _ensure_dir(out_dir, "sfx output dir")
    raw = raw_path or (raw_dir / f"{sid}.mp3")
    _ensure_file_slot(raw, f"raw/{sid}.mp3")
    if not raw.exists() or raw.stat().st_size == 0:
        audio_bytes = get(mp3)
        if not audio_bytes:
            raise CliError(f"{name}: empty preview download from {mp3}")
        _atomic_write_bytes(raw, audio_bytes)

    bed = (name in BEDS) if is_bed is None else is_bed
    music = (name in MUSIC) if is_music is None else is_music
    # Trim after leading-silence removal and before fades so kept cuts fade out cleanly instead of clicking.
    trim = f"atrim=duration={keep:g},asetpts=PTS-STARTPTS," if keep is not None else ""
    fade = "afade=t=in:d=0.004,areverse,afade=t=in:d=0.03,areverse"
    leads = [""] if bed else ["silenceremove=start_periods=1:start_threshold=-45dB,", ""]
    dest_wav = out_dir / f"{name}.wav"
    _ensure_file_slot(dest_wav, f"{name}.wav")
    tmp_wav = out_dir / f".{name}.{os.getpid()}.tmp.wav"
    channels = "2" if music else "1"
    try:
        frames = 0
        for idx, lead in enumerate(leads):
            af = f"{lead}{trim}{fade}"
            proc = subprocess.run(
                ["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-ac", channels, "-ar", "48000", "-af", af, str(tmp_wav)],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            if proc.returncode != 0:
                detail = (proc.stderr or "").strip().splitlines()
                raise CliError(f"{name}: ffmpeg failed ({detail[-1] if detail else f'exit {proc.returncode}'})")
            frames = _wav_frames(tmp_wav)
            if frames > 0:
                if idx == 1:
                    print(f"note: {name} stayed below -45dB; kept without silenceremove", file=sys.stderr)
                break
        if frames <= 0:
            raise CliError(f"{name}: decoded 0 audio frames for sound {sid}")
        try:
            os.replace(tmp_wav, dest_wav)
        except OSError as exc:
            raise CliError(f"{name}: cannot write {dest_wav}: {exc}") from exc
    finally:
        tmp_wav.unlink(missing_ok=True)
    return {"id": sid, "title": title, "by": user, "url": sound_url, "license": "CC0 1.0",
            "processing": {"keep": keep, "bed": bed, "music": music}}


def main(argv=None):
    """Run sfx:get CLI entry point and return exit code 0, 1, or 2."""
    _utf8_stdio()
    args = sys.argv[1:] if argv is None else list(argv)
    if args[:1] == ["help"] or "-h" in args or "--help" in args:
        print(__doc__)
        return 0
    flags = [a for a in args if re.match(r"^--?[a-zA-Z]", a)]
    if flags:
        print(f'unknown option {flags[0]}: bun run sfx:get [find "words" [max seconds] | sweeteners] (--help for more)', file=sys.stderr)
        return 2
    if args[:1] == ["find"] and (len(args) < 2 or not args[1].strip()):
        print('find what? words in quotes: bun run sfx:get find "cat meow" (the vault first: bun run find cat meow)', file=sys.stderr)
        return 2
    if not (args in ([], ["sweeteners"]) or (args[:1] == ["find"] and len(args) in (2, 3))):
        hint = ' (put multi-word searches in quotes: find "cat meow" 10)' if args[:1] == ["find"] and len(args) > 3 else ""
        print(f'usage: bun run sfx:get [find "words" [max seconds] | sweeteners] (--help for more); got {" ".join(args)}{hint}', file=sys.stderr)
        return 2

    if args[:1] == ["find"]:
        try:
            hi = float(args[2]) if len(args) > 2 else 60.0
        except ValueError:
            hi = math.nan
        if not (math.isfinite(hi) and 0 < hi < 1e6):
            hint = ' (put multi-word searches in quotes: find "cat meow" 10)' if len(args) > 2 else ""
            print(f'max seconds is a number above 0, got {args[2]}: bun run sfx:get find "words" 10{hint}', file=sys.stderr)
            return 2
        hits = find(args[1], 0, hi)
        if not hits:
            print(f'no CC0 sound on Freesound for "{args[1]}" up to {hi:g} s: fewer or other words, or a longer max', file=sys.stderr)
            return 1
        for r in hits:
            print(*r, sep=" | ")
        print(f'next: add "{hits[0][0]}" to sound/sfx_list.json ("name": {{"id": {hits[0][0]}, "for": "what it is for"}}), then bun run sfx:get')
        return 0

    film_dir = Path.cwd()
    if not (film_dir / "src" / "scene.ts").exists():
        print(f"{film_dir} is not a film (no src/scene.ts): cd films/<name> first, it fetches into the film's sound/sfx", file=sys.stderr)
        return 2
    if not shutil.which("ffmpeg"):
        raise CliError("ffmpeg not found on PATH: install ffmpeg so sfx:get can decode preview mp3s into 48 kHz wav")

    out_dir, raw_dir, sources_path = _resolve_sfx_dir(film_dir)
    is_sweet = args == ["sweeteners"]
    if is_sweet:
        wanted = {k: (sid, keep, why, role) for k, (sid, keep, role, why) in SWEETENERS.items()}
        beds_set, music_set = set(), set()
    else:
        sfx_map, beds_set, music_set = _load_sfx_list(film_dir)
        wanted = {k: (*v, None) for k, v in sfx_map.items()}

    rel_out = out_dir.relative_to(film_dir.resolve()).as_posix()
    _check_dir_slot(out_dir, rel_out)
    _check_dir_slot(raw_dir, f"{rel_out}/raw")
    _ensure_file_slot(sources_path, f"{rel_out}/SOURCES.json")
    if not wanted:
        print(f"0 sounds in {rel_out}/ (sound/sfx_list.json is empty)")
        print('next: bun run sfx:get find "words"')
        return 0

    known = _read_json_dict(sources_path, f"{rel_out}/SOURCES.json") if sources_path.exists() else {}
    _ensure_dir(out_dir, rel_out)
    _ensure_dir(raw_dir, f"{rel_out}/raw")
    sources_dirty = False

    for name, (sid, keep, why, role) in wanted.items():
        _validate_sound_name(name)
        wav_path = _assert_in_root(out_dir / f"{name}.wav", film_dir, f"{rel_out}/{name}.wav")
        raw_path = _assert_in_root(raw_dir / f"{sid}.mp3", film_dir, f"{rel_out}/raw/{sid}.mp3")
        _ensure_file_slot(wav_path, f"{rel_out}/{name}.wav")
        _ensure_file_slot(raw_path, f"{rel_out}/raw/{sid}.mp3")
        existing = known.get(name)
        processing = {"keep": keep, "bed": name in beds_set, "music": name in music_set}
        if (isinstance(existing, dict) and type(existing.get("id")) is int and existing.get("id") == sid
                and existing.get("processing") == processing
                and _wav_frames(wav_path) > 0):
            if role and (existing.get("role") != role or existing.get("kind") != "sfx"):
                existing["role"] = role
                existing["kind"] = "sfx"
                sources_dirty = True
            elif name in music_set and existing.get("kind") != "bgm":
                existing["kind"] = "bgm"
                sources_dirty = True
            continue
        meta = fetch(name, sid, keep, out_dir=out_dir, raw_dir=raw_dir, raw_path=raw_path, is_bed=(name in beds_set), is_music=(name in music_set))
        extra = {"role": role, "kind": "sfx"} if role else ({"kind": "bgm"} if name in music_set else {})
        known[name] = {**meta, "for": why, **extra}
        _atomic_write_text(sources_path, json.dumps(known, indent=1, ensure_ascii=False) + "\n")
        sources_dirty = False
        print("got", name, known[name]["title"])

    if sources_dirty:
        _atomic_write_text(sources_path, json.dumps(known, indent=1, ensure_ascii=False) + "\n")

    print(f"{len(wanted)} sounds in {rel_out}/: use them by name in src/timeline/audio.json")
    print("next: bun run studio" if is_sweet else "next: bun run check")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except CliError as exc:
        print(exc, file=sys.stderr)
        raise SystemExit(exc.code)
