"""The film's soundtrack from src/timeline/audio.json in one ffmpeg graph: the narration (assets/public/agent/full_voice.wav,
already placed on the film clock by voice/assemble.py and the studio's voice edits), beds (room hum, CCTV hiss) and
one-shot sound effects (sound/sfx, CC0, sound/get_sfx.py). A limiter catches peaks, then ffmpeg-normalize (two-pass EBU
R128, linear) brings it to audio.json lufs / -1 dBTP, and pyloudnorm measures the result independently. -14 LUFS
is what YouTube plays at; the 27 s cold open alone is mostly quiet room tone and stays linear only at -16.
  python ../../scripts/sound/mix.py --raw OUT.wav      the studio's mix (sound.py): no loudness pass, and without the sounds that have
                                         options to try; those go out as one stem per option, which the page plays itself
  python ../../scripts/sound/mix.py --raw OUT.wav --live-lanes   the narration only, without the drive and limiter: the studio
                                         plays audio.json's beds and one-shots itself and puts the limiter over the sum
  python ../../scripts/sound/mix.py                    -> sound/mix.wav (48 kHz stereo, film length)
  python ../../scripts/sound/mix.py renders/draft_video.mp4   also muxes it -> renders/draft.mp4"""
import json
import math
import re
import shutil
import subprocess
import sys
import tempfile
from functools import cache
from pathlib import Path
from process import render as process_audio

ROOT = Path.cwd()  # the film's folder: run from films/<name>/ (python ../../scripts/...)
E = json.loads((ROOT / "src/edit.json").read_text(encoding="utf8"))
A = json.loads((ROOT / "src/timeline/audio.json").read_text(encoding="utf8"))
# A track muted in the studio (audio.json "tracks", mute) is left out of every mix
MUTED = {t["id"] for t in A.get("tracks", []) if t.get("mute")}
A["beds"], A["sfx"] = ([e for e in A[k] if e.get("track") not in MUTED] for k in ("beds", "sfx"))
END = E["end"]
VENV = Path("E:/threejs_lab/py/venv/Scripts")  # has ffmpeg-normalize and pyloudnorm
SFX = ROOT / "sound/sfx"
# What was picked in the studio: {sound name: {set: option name, gain: x}}. The studio writes it, never this script
CHOICES = ROOT / "choices.json"
STEMS = ROOT / "assets/public/agent/stems"  # served by the studio as /agent/stems


@cache
def loudness(name):
    """Mean level in dB, so an option comes in at the level of the sound it stands in for (the room hum is 28 dB up)."""
    r = subprocess.run(["ffmpeg", "-v", "info", "-i", str(SFX / f"{name}.wav"), "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True)
    return float(re.search(r"mean_volume: (-?[\d.]+) dB", r.stderr).group(1))


@cache
def seconds(name):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(SFX / f"{name}.wav")], capture_output=True, text=True)
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


def chosen(e):
    """None when the studio's Tắt was picked (set "off"): the sound is left out of the mix."""
    c = (json.loads(CHOICES.read_text(encoding="utf8")) if CHOICES.exists() else {}).get(e["name"]) or {}
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


def duck_windows():
    out = []
    for s0, e0 in sorted([warped(a), warped(b)] for a, b in E["voice"].get("lines", [])):
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
        if processing and (processing.get("rate", 1) != 1 or processing.get("pitch", 0) or processing.get("reverse") or (processing.get("voiceFilter", "none") != "none" and processing.get("voiceStrength", 100) > 0)):
            length = length if length is not None else (seconds(processing["name"]) - start) / processing.get("rate", 1)
            processed = folder / f"{i}.wav"
            process_audio(path, processed, {**processing, "start": start, "duration": length, "loop": loop})
            path, start, loop = processed, 0, False
        inputs.extend(["-stream_loop", "-1", "-i", str(path)] if loop else ["-i", str(path)])
        f = [f"atrim=start={start}" + (f":duration={length}" if length else ""), "asetpts=PTS-STARTPTS",
             "aformat=sample_rates=48000:channel_layouts=stereo", f"volume={gain}dB", *extra]
        automation = gain_filter(gain_keys, gain)
        if automation:
            f.append(automation)
        if fade_in:
            f.append(f"afade=t=in:d={fade_in}")
        if fade_out and length:
            f.append(f"afade=t=out:st={max(0, length - fade_out)}:d={fade_out}")
        ms = int(round(at * 1000))
        f.append(f"adelay={ms}|{ms}")
        chains.append(f"[{i}:a]{','.join(f)}[a{i}]")

    # Dialogue compression (4:1 above -30 dBFS, fast attack) and a voice limiter bring the hushed narration's peaks to
    # about 11 dB over its loudness, so the loudness pass below can stay linear
    if voice and A.get("voice", True):  # audio.voice false: no narration in the mix (the dev records it later)
        add(ROOT / "assets/public/agent/full_voice.wav", 0, A["voiceGain"], extra=["acompressor=threshold=0.03:ratio=4:attack=1:release=150:makeup=3", "alimiter=limit=0.35:level=false"])
    for b in beds:
        duck = duck_expr(b["from"], b["to"], b["duck"]) if b.get("duck") and A.get("voice", True) else None
        add(SFX / f"{b['name']}.wav", b["from"], b["gain"], b.get("start", 0), b["to"] - b["from"], b["fadeIn"], b["fadeOut"], loop=True, gain_keys=b.get("gainKeys"), processing=b, extra=[*b.get("filters", []), *([duck] if duck else []), *([pan_filter(b["pan"])] if b.get("pan") else [])])
    for s in sfx:
        add(SFX / f"{s['name']}.wav", s["at"], s["gain"], s.get("start", 0), s.get("length"), s.get("fadeIn", 0), s.get("fadeOut", 0), gain_keys=s.get("gainKeys"), processing=s, extra=[*s.get("filters", []), *([pan_filter(s["pan"])] if s.get("pan") else [])])
    if not chains:  # a film with no sound yet: silence as long as the film
        inputs.extend(["-f", "lavfi", "-t", str(end), "-i", "anullsrc=r=48000:cl=stereo"])
        chains.append("[0:a]anull[a0]")
    graph = chains + [
        # audio.drive dB into the limiter first: hits (a slam, a drawer) stand ~20 dB over the average, too far apart for the
        # linear -14 LUFS pass below; the limiter trims them so the gap fits. Then the
        # safety limiter at about -7 dBFS. The loudness pass must stay linear: ffmpeg-normalize's dynamic fallback lifts
        # every quiet stretch (the CCTV hiss came up level with the voice). It falls back when target - true peak gap is
        # too small, so a quiet excerpt takes a lower target (src/timeline/audio.json lufs)
        f"{''.join(f'[a{i}]' for i in range(len(chains)))}amix=inputs={len(chains)}:normalize=0,apad=whole_dur={end},asetpts=N/SR/TB,atrim=duration={end}"
        + (f",volume={A.get('drive', 0)}dB,alimiter=limit=0.45:level=false" if master else "")
        + (f",atrim={span[0]}:{span[1]},asetpts=PTS-STARTPTS" if span else "") + "[out]",
    ]
    script = out.with_name(out.name + ".graph.txt")
    script.write_text(";\n".join(graph), encoding="utf8")
    codec = ["-c:a", "libopus", "-b:a", "96k"] if out.suffix == ".webm" else ["-c:a", "pcm_f32le" if float_output else "pcm_s16le"]
    subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex_script", str(script), "-map", "[out]", "-ar", "48000", *codec, str(out)], check=True, timeout=120 if float_output else None)
    script.unlink()


def measure_clip(kind, index):
    c = chosen(A[kind][index])
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
    sources = json.loads((SFX / "SOURCES.json").read_text(encoding="utf8"))
    shutil.rmtree(STEMS, ignore_errors=True)
    trials = {}
    for kind, entries in (("bed", A["beds"]), ("sfx", A["sfx"])):
        for name in dict.fromkeys(e["name"] for e in entries if tried(e)):
            group = [e for e in entries if e["name"] == name]
            if kind == "bed":
                span = (min(b["from"] for b in group), max(b["to"] for b in group))
            else:  # a one-shot without a length rings as long as its longest option
                longest = max(seconds(o) for o in options(group[0]))
                span = (min(s["at"] for s in group), max(s["at"] + s.get("length", longest) for s in group))
            (STEMS / name).mkdir(parents=True, exist_ok=True)
            opts = []
            for o in options(group[0]):
                one = [as_option(e, o) for e in group]
                build(STEMS / name / f"{o}.webm", one if kind == "bed" else [], one if kind == "sfx" else [], voice=False, span=span)
                opts.append({"id": o, "title": sources.get(o, {}).get("title", o), "files": [f"/agent/stems/{name}/{o}.webm"], "source": sources.get(o, {}).get("url", "")})
            trials[name] = {"title": f"{name.replace('_', ' ')} ({kind})", "kind": "stem", "from": span[0], "to": span[1], "options": opts}
    out.with_name("trials.json").write_text(json.dumps(trials, ensure_ascii=False), encoding="utf8")


if __name__ == "__main__":
    if sys.argv[1:2] == ["--measure"]:
        A = json.load(sys.stdin)
        print(json.dumps(measure_clip(sys.argv[2], int(sys.argv[3]))))
        raise SystemExit
    if sys.argv[1:2] == ["--raw"]:
        if "--live-lanes" in sys.argv:
            build(Path(sys.argv[2]), [], [], master=False)
            shutil.rmtree(STEMS, ignore_errors=True)
            Path(sys.argv[2]).with_name("trials.json").write_text("{}", encoding="utf8")
        else:
            studio(Path(sys.argv[2]))
        raise SystemExit
    raw = ROOT / "sound/mix_raw.wav"
    build(raw, [c for b in A["beds"] if (c := chosen(b))], [c for s in A["sfx"] if (c := chosen(s))])
    out = ROOT / "sound/mix.wav"
    subprocess.run([str(VENV / "ffmpeg-normalize"), str(raw), "-o", str(out), "-f", "-nt", "ebu", "-t", str(A["lufs"]), "-tp", "-1", "-lrt", "11", "--keep-lra-above-loudness-range-target", "-ar", "48000", "-c:a", "pcm_s16le"], check=True)
    check = "import soundfile as sf, pyloudnorm as pl, numpy as np, sys; d, r = sf.read(sys.argv[1]); print(f'pyloudnorm: {pl.Meter(r).integrated_loudness(d):.2f} LUFS, peak {20*np.log10(np.abs(d).max()):.2f} dBFS')"
    subprocess.run([str(VENV / "python.exe"), "-c", check, str(out)], check=True)
    if len(sys.argv) > 1:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", sys.argv[1], "-i", str(out), "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", str(ROOT / "renders/draft.mp4")], check=True)
        print("muxed renders/draft.mp4")
