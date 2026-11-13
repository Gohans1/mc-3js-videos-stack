"""The film's soundtrack from src/timeline/audio.json in one ffmpeg graph: the narration (assets/public/agent/full_voice.wav,
already placed on the film clock by voice/assemble.ts and the studio's voice edits), beds (room hum, CCTV hiss) and
one-shot sound effects (sound/sfx, CC0, sound/get_sfx.py). A limiter catches peaks (audio.json drive pushes into it), then
one linear gain brings it to audio.json lufs, or only as far as its true peak stays under -1.5 dBTP (listen.py level), and
ffmpeg's ebur128 measures the result. -14 LUFS is what YouTube plays at.
  bun run mix                          -> sound/mix.wav (48 kHz stereo, film length)
  bun run mix renders/draft_video.mp4  also muxes it -> renders/draft.mp4, the draft with its sound (bun run render clip
                                       makes the silent video first)
  bun run mix renders/final_video.mp4  the same for bun run render final -> renders/final.mp4, the file to upload
Is it heard right (voice buried, a sound too loud, dead air)? bun run listen measures it."""
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
from functools import cache
from pathlib import Path
if str(Path(__file__).resolve().parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
from process import render as process_audio

# bun run mix [video]: every word checked before the mix starts (--raw and --measure are the studio's own calls)
if __name__ == "__main__" and sys.argv[1:2] in (["-h"], ["--help"], ["help"]):
    print(__doc__)
    raise SystemExit
if __name__ == "__main__" and sys.argv[1:2] not in (["--raw"], ["--measure"]) and sys.argv[1:]:
    if len(sys.argv) > 2 or sys.argv[1].startswith("-"):
        print(f"bun run mix, or bun run mix <video> to put the sound on it; got {' '.join(sys.argv[1:])} (--help for more)", file=sys.stderr)
        raise SystemExit(2)
    if not Path(sys.argv[1]).is_file():
        videos = sorted(p.as_posix() for p in Path("renders").glob("*.mp4")) if Path("renders").is_dir() else []
        print(f"no {sys.argv[1]} (the videos here: {', '.join(videos) or 'none yet'}); bun run render clip makes renders/draft_video.mp4", file=sys.stderr)
        raise SystemExit(2)
if not (Path.cwd() / "src/timeline/audio.json").exists():
    print("no src/timeline/audio.json here: run it inside a film (cd films/<name>)", file=sys.stderr)
    raise SystemExit(2)

ROOT = Path.cwd()  # the film's folder: bun run mix runs it there
E = json.loads((ROOT / "src/edit.json").read_text(encoding="utf8"))
A = json.loads((ROOT / "src/timeline/audio.json").read_text(encoding="utf8"))
# A track muted in the studio (audio.json "tracks", mute) is left out of every mix; a track's gain (dB) is a volume after each
# clip's own chain, so normalizing a clip (measure_clip) leaves it out
MUTED = {t["id"] for t in A.get("tracks", []) if t.get("mute")}
A["beds"], A["sfx"] = ([e for e in A[k] if e.get("track") not in MUTED] for k in ("beds", "sfx"))
TRACKS = {t["id"]: t for t in A.get("tracks", [])}


def track_chain(e):
    """The track's own EQ (tracks[].filters) and volume, on every clip of it: each is linear, so per clip equals the bus"""
    t = TRACKS.get(e.get("track"), {})
    db = float(t.get("gain", 0))
    return [*_safe_filters(t.get("filters")), *([f"volume={db:.4g}dB"] if db else [])]


PROJECTED_VOICE = LEGACY_TIMELINE = None
PKG = ROOT / "package.json"
CONFIG = (json.loads(PKG.read_text(encoding="utf8")) if PKG.exists() else {}).get("live-studio", {})
SFX = ROOT / CONFIG.get("sfx", "sound/sfx")
SOURCES = CONFIG.get("soundSources", {})
REAL_ROOT = ROOT.resolve()
SAFE_NAME = re.compile(r"^\w[\w.-]*$")
ALLOWED_AUDIO_FILTER = re.compile(
    r"^(?:lowpass|highpass|bandpass|bandreject|allpass|equalizer|lowshelf|highshelf|bass|treble|acompressor|alimiter|agate|asoftclip|aecho|aphaser|aflanger|achorus|vibrato|tremolo|stereowiden|extrastereo|volume|dynaudnorm|adeclick|adeclip|afftdn|deesser)(?:=[A-Za-z0-9_.:=|+\s%-]+)?$"
)


def _inside(base: Path, target: Path) -> bool:
    try:
        return target != base and target.is_relative_to(base)
    except ValueError:
        return False


def _assert_in_root(target: Path, label: str = "Path") -> Path:
    abs_root = ROOT.absolute()
    abs_target = target.absolute() if target.is_absolute() else (abs_root / target).absolute()
    base = abs_root if _inside(abs_root, abs_target) else (REAL_ROOT if _inside(REAL_ROOT, abs_target) else None)
    if base is None:
        raise ValueError(f"{label} escapes film directory: {str(target)!r}")
    cur = base
    for seg in abs_target.relative_to(base).parts:
        cur = cur / seg
        try:
            st = cur.lstat()
        except OSError:
            break
        if os.path.islink(cur) or (st.st_file_attributes & 0x400 if hasattr(st, "st_file_attributes") else False):
            raise ValueError(f"{label} cannot traverse symlink or junction: {str(target)!r}")
        if not _inside(REAL_ROOT, cur.resolve()):
            raise ValueError(f"{label} escapes film directory: {str(target)!r}")
    return abs_target


def _safe_filters(items):
    out = []
    for raw in items or ():
        if not isinstance(raw, str) or not ALLOWED_AUDIO_FILTER.match(raw):
            raise ValueError(f"Unsafe or invalid ffmpeg audio filter: {raw!r}")
        out.append(raw)
    return out


# What was picked in the studio: {sound name: {set: option name, gain: x}}. The studio writes it, never this script
CHOICES = ROOT / "choices.json"
CHOICES_MAP = json.loads(CHOICES.read_text(encoding="utf8")) if CHOICES.exists() else {}
STEMS = ROOT / "assets/public/agent/stems"  # served by the studio as /agent/stems


def _repo_vault_root():
    for d in (REAL_ROOT, *REAL_ROOT.parents):
        if (d / "vault.json").exists():
            return d.resolve()
    return None


def _find_vaults():
    cfg = CONFIG.get("soundVault")
    if cfg is False:
        return ()
    if isinstance(cfg, str):
        cand = ROOT / cfg
        if cand.is_symlink():
            raise ValueError(f"soundVault cannot be a symlink: {cfg!r}")
        p = cand.resolve()
        repo_root = _repo_vault_root()
        allowed = _inside(REAL_ROOT, p) or (repo_root is not None and _inside(repo_root, p))
        if not allowed:
            raise ValueError(f"soundVault escapes allowed root: {cfg!r}")
        return (p,) if p.exists() else ()
    for d in (ROOT, *ROOT.parents):
        vf = d / "vault.json"
        if vf.exists():
            try:
                vcfg = json.loads(vf.read_text(encoding="utf8"))
            except Exception:
                vcfg = {}
            vroot = (d / vcfg.get("root", "./vault")).resolve()
            mc_local = vroot / "mc-sound"
            mc_ext = (d / vcfg["externalRoot"] / "mc-sound").resolve() if vcfg.get("externalRoot") else None
            mc_dir = mc_local if mc_local.exists() else (mc_ext if mc_ext and mc_ext.exists() else None)
            snd_dir = vroot / "sound" if (vroot / "sound").exists() else None
            return tuple(x for x in (mc_dir, snd_dir) if x is not None)
    return ()


VAULTS = _find_vaults()
VAULT = VAULTS[-1] if VAULTS else None


@cache
def _sound_index():
    out = {}
    for base in (*VAULTS, SFX):
        if base and base.exists():
            is_local = base == SFX
            real_base = REAL_ROOT if is_local else base.resolve()
            if is_local and (base.is_symlink() or not _inside(REAL_ROOT, base.resolve())):
                continue
            for ext in ("*.ogg", "*.wav"):
                for f in sorted(base.rglob(ext)):
                    if f.name.startswith(".") or not SAFE_NAME.match(f.stem):
                        continue
                    if is_local and f.is_symlink():
                        continue
                    if _inside(real_base, f.resolve()):
                        out[f.stem] = f
    return out


def audio_file(name):
    if not isinstance(name, str) or not SAFE_NAME.match(name):
        raise ValueError(f"Invalid audio source name: {name!r}")
    if name in SOURCES:
        candidate = ROOT / SOURCES[name]
        if candidate.is_symlink() or not _inside(REAL_ROOT, candidate.resolve()):
            raise ValueError(f"Audio source escapes film directory: {name!r}")
        return candidate
    if not SFX.is_symlink() and _inside(REAL_ROOT, SFX.resolve()):
        for ext in (".wav", ".ogg"):
            direct = SFX / f"{name}{ext}"
            if direct.exists():
                if direct.is_symlink() or not _inside(REAL_ROOT, direct.resolve()):
                    raise ValueError(f"Audio file escapes film directory: {name!r}")
                return direct
    hit = _sound_index().get(name)
    if hit is not None:
        return hit
    if name == "narration":
        fallback = ROOT / "assets/public/agent/full_voice.wav"
        if fallback.exists():
            if fallback.is_symlink() or not _inside(REAL_ROOT, fallback.resolve()):
                raise ValueError("Narration audio escapes film directory")
            return fallback
    default_out = SFX / f"{name}.wav"
    if SFX.is_symlink() or not _inside(REAL_ROOT, default_out.resolve()):
        raise ValueError(f"Audio path escapes film directory: {name!r}")
    return default_out


@cache
def present(name):
    """The sound's file, or one line saying it is missing instead of a traceback from ffmpeg"""
    f = audio_file(name)
    if not f.exists():
        raise SystemExit(f'no sound "{name}" in {SFX.relative_to(ROOT).as_posix()}/ or the vault: bun run check lists every missing name with the nearest ones')
    return f


def loudness(name):
    """Mean level in dB, so an option comes in at the level of the sound it stands in for (the room hum is 28 dB up)."""
    r = subprocess.run(["ffmpeg", "-v", "info", "-i", str(present(name)), "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True, timeout=30)
    return float(re.search(r"mean_volume: (-?[\d.]+) dB", r.stderr).group(1))


@cache
def seconds(name):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(present(name))], capture_output=True, text=True, timeout=30)
    return float(r.stdout)


def options(e):
    return [e["name"], *e.get("try", [])]


def as_option(e, name, gain=1.0):
    """The same placement played with another sound. Its start offset belongs to the original file, so an option plays from its own start."""
    if name == e["name"] and gain == 1.0:
        return e
    out = {**e, "name": name, "gain": e["gain"] + loudness(e["name"]) - loudness(name) + 20 * math.log10(gain)}
    if e.get("gainKeys"):
        out["gainKeys"] = [{**k, "gain": k["gain"] + out["gain"] - e["gain"]} for k in e["gainKeys"]]
    if name != e["name"]:
        out.pop("start", None)
    return out


def unfit():
    """The first row missing a field every row of its list must have (the ones the mix reads), said as bun run check would
    place it; None when all rows have them. bun run mix and listen stop on it before any work, check names every fault."""
    need = {"beds": ("name", "from", "to", "gain", "fadeIn", "fadeOut"), "sfx": ("name", "at", "gain")}
    for kind, keys in need.items():
        rows = A.get(kind)
        if not isinstance(rows, list):
            return f"src/timeline/audio.json: no {kind} list: bun run check names every fault"
        for i, row in enumerate(rows):
            gone = next((k for k in keys if not isinstance(row, dict) or row.get(k) is None), None)
            if gone:
                return f"src/timeline/audio.json: {kind}[{i}] has no {gone}: bun run check names every fault and where"
    return None


def chosen(e):
    """None when the studio's Tắt was picked (set "off"): the sound is left out of the mix."""
    c = CHOICES_MAP.get(e["name"]) or {}
    if c.get("set") == "off":
        return None
    return as_option(e, c["set"] if c.get("set") in options(e) else e["name"], c.get("gain", 1.0))


# Ducking (a bed's "duck": N dB under the narration): the same shape as the studio's app/sound/duck.ts, change both together
ATTACK, RELEASE = 0.3, 0.8


def warped(x):
    """A source second as heard, through the voice edit's warp (live-studio src/edit.ts map)."""
    w = E["voice"].get("warp") or []
    if len(w) < 2:
        return x
    if x <= w[0][0]:
        return x - w[0][0] + w[0][1]
    if x >= w[-1][0]:
        return x - w[-1][0] + w[-1][1]
    i = max(k for k in range(len(w) - 1) if w[k][0] <= x)
    return w[i][1] + (x - w[i][0]) / (w[i + 1][0] - w[i][0]) * (w[i + 1][1] - w[i][1])


SOURCE_END = END = warped(E["end"])


def voice_intervals():
    intervals = [[warped(a), warped(b)] for a, b in E["voice"].get("lines", [])]
    if A.get("narration"):
        projected = []
        for clip in A["sfx"]:
            if clip["name"] != A["narration"]:
                continue
            rate, start = clip.get("rate", 1), clip.get("start", 0)
            length = clip["length"] if "length" in clip else (seconds(clip["name"]) - start) / rate
            end = start + length * rate
            for a, b in intervals:
                if b <= start or a >= end:
                    continue
                a, b = max(start, a), min(end, b)
                projected.append([clip["at"] + (end - b if clip.get("reverse") else a - start) / rate,
                                  clip["at"] + (end - a if clip.get("reverse") else b - start) / rate])
        intervals = projected
    return intervals


def prepare_timing():
    global A, END, PROJECTED_VOICE, LEGACY_TIMELINE
    END, PROJECTED_VOICE, LEGACY_TIMELINE = SOURCE_END, None, None
    path = CONFIG.get("timingTimeline")
    if not path:
        return
    timing = json.loads(_assert_in_root(ROOT / path, "Timing timeline").read_text(encoding="utf8"))
    if not timing.get("layers") and not any(timing.get(k) for k in ("speeds", "freezes", "cuts", "gaps", "main", "layerKinds")):
        return
    payload = {"timing": timing, "duration": SOURCE_END, "audio": A,
               "durations": {c["name"]: seconds(c["name"]) for c in A["sfx"] if "length" not in c},
               "voiceIntervals": voice_intervals()}
    cli = Path(__file__).resolve().parents[2] / "packages/live-studio/src/timing-audio-cli.mjs"
    runner = shutil.which("bun") or shutil.which("node") or "node"
    r = subprocess.run([runner, str(cli)], input=json.dumps(payload), capture_output=True, text=True, check=True, timeout=20)
    result = json.loads(r.stdout)
    A, END = result["audio"], result["end"]
    PROJECTED_VOICE, LEGACY_TIMELINE = result["voiceIntervals"], result["legacyTimeline"]


def duck_windows():
    intervals = voice_intervals() if PROJECTED_VOICE is None else PROJECTED_VOICE
    out = []
    for s0, e0 in sorted(intervals):
        if out and s0 - out[-1][1] < ATTACK + RELEASE:
            out[-1][1] = max(out[-1][1], e0)
        else:
            out.append([s0, e0])
    return out


def duck_expr(start_at, end_at, db):
    """volume filter expression on a bed's own clock (t 0 at start_at): one trapezoid per window, which never overlap."""
    g = 10 ** (-db / 20)
    parts = [f"clip(min((t+{start_at - a + ATTACK:.4f})/{ATTACK},({b + RELEASE - start_at:.4f}-t)/{RELEASE}),0,1)"
             for a, b in duck_windows() if b + RELEASE > start_at and a - ATTACK < end_at]
    return f"volume='1-{1 - g:.6f}*({'+'.join(parts)})':eval=frame" if parts else None


def pan_filter(p):
    """audio.json pan (-1 left .. 1 right) as Web Audio's StereoPannerNode moves a stereo signal (equal power), the way the
    studio's live mix plays it (live-studio app/sound/mixer.ts), so both agree."""
    if p <= 0:
        x = (p + 1) * math.pi / 2
        return f"pan=stereo|c0=c0+{math.cos(x):.6f}*c1|c1={math.sin(x):.6f}*c1"
    x = p * math.pi / 2
    return f"pan=stereo|c0={math.cos(x):.6f}*c0|c1=c1+{math.sin(x):.6f}*c0"


def gain_filter(keys, base):
    """Clip-local, linear dB automation; aeval evaluates each sample, matching Web Audio's exponential gain ramps."""
    if not keys:
        return None
    expression = f"({keys[0]['gain'] - base:.12g})"
    for a, b in zip(keys, keys[1:]):
        expression += f"+({b['gain'] - a['gain']:.12g})*clip((t-({a['t']:.12g}))/({b['t'] - a['t']:.12g}),0,1)"
    return f"aeval='val(ch)*pow(10,({expression})/20)':c=same"


def build(out, beds, sfx, voice=True, span=None, master=True, float_output=False, end=None):
    with tempfile.TemporaryDirectory(prefix="studio-mix-clips-") as folder:
        _build(out, beds, sfx, voice, span, master, float_output, end, Path(folder))


def _build(out, beds, sfx, voice, span, master, float_output, end, folder):
    inputs, chains = [], []
    end = END if end is None else end

    def add(path, at, gain, start=0.0, length=None, fade_in=0.0, fade_out=0.0, loop=False, extra=(), gain_keys=None, processing=None):
        i = len(chains)  # one chain per input file, so this is the input's index
        timing = (processing or {}).get("__timing")
        # a bed that runs past its file's end crossfades into the next pass (process.py loop_xfade), never a hard -stream_loop jump
        file = seconds(processing["name"]) if loop and processing else 0
        wraps = bool(loop and processing and length is not None) and start + length * processing.get("rate", 1) > file
        if processing and (timing or wraps or processing.get("dialogue") or processing.get("rate", 1) != 1 or processing.get("pitch", 0) or processing.get("reverse") or (processing.get("voiceFilter", "none") != "none" and processing.get("voiceStrength", 100) > 0)):
            length = length if length is not None else (seconds(processing["name"]) - start) / processing.get("rate", 1)
            processed = folder / f"{i}.wav"
            settings = {**processing, "start": start, "duration": timing["duration"] if timing else length, "loop": loop}
            if timing:
                settings["timeline"] = timing["timeline"]
            process_audio(path, processed, settings)
            path, start = processed, 0
        inputs.extend(["-i", str(path)])
        f = [f"atrim=start={start}" + (f":duration={length}" if length else ""), "asetpts=PTS-STARTPTS",
             "aformat=sample_rates=48000:channel_layouts=stereo", f"volume={gain}dB", *extra]
        automation = gain_filter(gain_keys, gain)
        if automation:
            f.append(automation)
        if fade_in:
            f.append(f"afade=t=in:d={fade_in}")
        if fade_out and length:
            f.append(f"afade=t=out:st={max(0, length - fade_out)}:d={fade_out}")
        samples = math.floor(at * 48000 + 0.5)
        f.append(f"adelay={samples}S|{samples}S")
        chains.append(f"[{i}:a]{','.join(f)}[a{i}]")

    # Dialogue compression (4:1 above -30 dBFS, fast attack) and a voice limiter bring the hushed narration's peaks to
    # about 11 dB over its loudness, so the loudness pass below can stay linear
    if voice and A.get("voice", True) and not A.get("narration"):
        add(ROOT / "assets/public/agent/full_voice.wav", 0, float(A.get("voiceGain", 0)), length=END,
            processing={"dialogue": True, **({"__timing": {"duration": SOURCE_END, "timeline": LEGACY_TIMELINE}} if LEGACY_TIMELINE else {})})
    for b in beds:
        if b["to"] <= b["from"]:
            continue
        duck = duck_expr(b["from"], b["to"], float(b["duck"])) if b.get("duck") and (A.get("narration") or A.get("voice", True)) else None
        add(present(b["name"]), float(b["from"]), float(b["gain"]), float(b.get("start", 0)), float(b["to"] - b["from"]), float(b["fadeIn"]), float(b["fadeOut"]), loop=True, gain_keys=b.get("gainKeys"), processing=b, extra=[*_safe_filters(b.get("filters")), *track_chain(b), *([duck] if duck else []), *([pan_filter(float(b["pan"]))] if b.get("pan") else [])])
    for s in sfx:
        if "length" in s and s["length"] <= 0:
            continue
        add(present(s["name"]), float(s["at"]), float(s["gain"]), float(s.get("start", 0)), float(s["length"]) if "length" in s and s["length"] is not None else None, float(s.get("fadeIn", 0)), float(s.get("fadeOut", 0)), gain_keys=s.get("gainKeys"), processing=s, extra=[*_safe_filters(s.get("filters")), *track_chain(s), *([pan_filter(float(s["pan"]))] if s.get("pan") else [])])
    if not chains:  # a film with no sound yet: silence as long as the film
        inputs.extend(["-f", "lavfi", "-t", str(end), "-i", "anullsrc=r=48000:cl=stereo"])
        chains.append("[0:a]anull[a0]")
    drive_db = float(A.get("drive", 0))
    graph = chains + [
        # audio.drive dB into the limiter first: hits (a slam, a drawer) stand ~20 dB over the average, too far apart for the
        # linear -14 LUFS pass below; the limiter trims them so the gap fits. Then the
        # safety limiter at about -7 dBFS. The loudness pass after it stays linear (listen.level): a dynamic one lifts
        # every quiet stretch (the CCTV hiss came up level with the voice), so drive is the only lever for more loudness
        f"{''.join(f'[a{i}]' for i in range(len(chains)))}amix=inputs={len(chains)}:normalize=0,apad=whole_dur={end},asetpts=N/SR/TB,atrim=duration={end}"
        + (f",volume={drive_db}dB,alimiter=limit=0.45:level=false" if master else "")
        + (f",atrim={span[0]}:{span[1]},asetpts=PTS-STARTPTS" if span else "") + "[out]",
    ]
    script = out.with_name(out.name + ".graph.txt")
    script.write_text(";\n".join(graph), encoding="utf8")
    codec = ["-c:a", "libopus", "-b:a", "96k"] if out.suffix == ".webm" else ["-c:a", "pcm_f32le" if float_output else "pcm_s16le"]
    subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex_script", str(script), "-map", "[out]", "-ar", "48000", *codec, str(out)], check=True, timeout=120 if float_output else 300)
    script.unlink()


def measure_clip(kind, index):
    c = chosen({**A[kind][index], "track": None})  # --measure reads the unsaved lanes, unfiltered, from stdin
    if c is None:
        raise ValueError("Choose an audible sound option before normalizing")
    start = c["from"] if kind == "beds" else c["at"]
    length = c["to"] - start if kind == "beds" else c.get("length", (seconds(c["name"]) - c.get("start", 0)) / c.get("rate", 1))
    if length < 0.4:
        raise ValueError("Loudness needs at least 0.4 seconds of audio")
    with tempfile.TemporaryDirectory(prefix="studio-loudness-") as folder:
        out = Path(folder) / "clip.wav"
        build(out, [c] if kind == "beds" else [], [c] if kind == "sfx" else [], voice=False, span=(start, start + length), master=False, float_output=True, end=start + length)
        r = subprocess.run(["ffmpeg", "-v", "info", "-i", str(out), "-af", "loudnorm=I=-14:TP=-1:LRA=11:print_format=json", "-f", "null", "-"], capture_output=True, text=True, check=True, timeout=120)
        stats, _ = json.JSONDecoder().raw_decode(r.stderr[r.stderr.rfind("{"):])
        finite = lambda key: float(stats[key]) if math.isfinite(float(stats[key])) else None
        return {"loudness": finite("input_i"), "peak": finite("input_tp")}


def studio(out):
    """The studio's mix without the sounds that have options, plus one stem per option covering just the stretch where that
    sound plays, and trials.json beside the mix saying where they are: switching an option is heard at once, with no remix."""
    tried = lambda e: "try" in e
    build(out, [b for b in A["beds"] if not tried(b)], [s for s in A["sfx"] if not tried(s)])
    vault_sources = {}
    for v in VAULTS:
        if (v / "SOURCES.json").exists():
            vault_sources.update(json.loads((v / "SOURCES.json").read_text(encoding="utf8")))
    film_sources_file = _assert_in_root(SFX / "SOURCES.json", "Film SOURCES.json")
    film_sources = json.loads(film_sources_file.read_text(encoding="utf8")) if film_sources_file.exists() else {}
    sources = {**vault_sources, **film_sources}
    safe_stems = _assert_in_root(STEMS, "Stems directory")
    shutil.rmtree(safe_stems, ignore_errors=True)
    trials = {}
    for kind, entries in (("bed", A["beds"]), ("sfx", A["sfx"])):
        for name in dict.fromkeys(e["name"] for e in entries if tried(e)):
            group = [e for e in entries if e["name"] == name]
            if kind == "bed":
                span = (min(b["from"] for b in group), max(b["to"] for b in group))
            else:  # a one-shot without a length rings as long as its longest option
                longest = max(seconds(o) for o in options(group[0]))
                span = (min(s["at"] for s in group), max(s["at"] + s.get("length", longest) for s in group))
            (safe_stems / name).mkdir(parents=True, exist_ok=True)
            opts = []
            for o in options(group[0]):
                one = [as_option(e, o) for e in group]
                build(safe_stems / name / f"{o}.webm", one if kind == "bed" else [], one if kind == "sfx" else [], voice=False, span=span)
                opts.append({"id": o, "title": sources.get(o, {}).get("title", o), "files": [f"/agent/stems/{name}/{o}.webm"], "source": sources.get(o, {}).get("url", "")})
            trials[name] = {"title": f"{name.replace('_', ' ')} ({kind})", "kind": "stem", "from": span[0], "to": span[1], "options": opts}
    out.with_name("trials.json").write_text(json.dumps(trials, ensure_ascii=False), encoding="utf8")


if __name__ == "__main__" and sys.argv[1:2] == ["--raw"] and "--live-lanes" in sys.argv:
    A = {**A, "beds": [], "sfx": []}

if __name__ != "__main__" or sys.argv[1:2] != ["--measure"]:
    prepare_timing()


if __name__ == "__main__":
    if sys.argv[1:2] == ["--measure"]:
        A = json.load(sys.stdin)
        prepare_timing()
        print(json.dumps(measure_clip(sys.argv[2], int(sys.argv[3]))))
        raise SystemExit
    if sys.argv[1:2] == ["--raw"]:
        if "--live-lanes" in sys.argv:
            build(Path(sys.argv[2]), [], [], master=False)
            shutil.rmtree(_assert_in_root(STEMS, "Stems directory"), ignore_errors=True)
            Path(sys.argv[2]).with_name("trials.json").write_text("{}", encoding="utf8")
        else:
            studio(Path(sys.argv[2]))
        raise SystemExit
    if why := unfit():
        print(why, file=sys.stderr)
        raise SystemExit(1)
    raw = _assert_in_root(ROOT / "sound/mix_raw.wav", "Mix raw output")
    build(raw, [c for b in A["beds"] if (c := chosen(b))], [c for s in A["sfx"] if (c := chosen(s))])
    out = _assert_in_root(ROOT / "sound/mix.wav", "Mix output")
    from listen import level, loudness_report
    held = level(raw, out, float(A["lufs"]))
    print("\n".join(loudness_report("sound/mix.wav", float(A["lufs"]), held, float(A.get("drive", 0)))))
    if len(sys.argv) > 1:
        # the final (bun run render final) goes out as the upload: AAC at YouTube's 384 kbps for stereo, moov up front, no edit list
        final = Path(sys.argv[1]).name == "final_video.mp4"
        name = "final.mp4" if final else "draft.mp4"
        muxed = _assert_in_root(ROOT / "renders" / name, "Muxed mp4 output")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", sys.argv[1], "-i", str(out), "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac",
                        "-b:a", "384k" if final else "192k", "-movflags", "+faststart", "-use_editlist", "0", "-shortest", str(muxed)],
                       check=True, timeout=300)
        print(f"muxed renders/{name}" + (" (the file to upload; bun run deliver checks it against YouTube's spec)" if final else ""))
    print("NOT checked here, and needed before calling it ready: whether every word is heard over the beds, the end fades, "
          "no hit is buried: bun run listen (about a second per film second the first time)"
          + ("" if len(sys.argv) > 1 else "; bun run mix renders/draft_video.mp4 puts it on the draft"))
