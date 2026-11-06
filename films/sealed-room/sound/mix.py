"""The film's soundtrack from src/timeline/audio.json in one ffmpeg graph: the narration (assets/public/agent/full_voice.wav,
already placed on the film clock by voice/assemble.py and the studio's voice edits), beds (room hum, CCTV hiss) and
one-shot sound effects (sound/sfx, CC0, sound/get_sfx.py). A limiter catches peaks, then ffmpeg-normalize (two-pass EBU
R128, linear) brings it to audio.json lufs / -1 dBTP, and pyloudnorm measures the result independently. -14 LUFS
is what YouTube plays at; the 27 s cold open alone is mostly quiet room tone and stays linear only at -16.
  python sound/mix.py --raw OUT.wav      the studio's mix (sound.py): no loudness pass, and without the sounds that have
                                         options to try; those go out as one stem per option, which the page plays itself
  python sound/mix.py                    -> sound/mix.wav (48 kHz stereo, film length)
  python sound/mix.py renders/draft_video.mp4   also muxes it -> renders/draft.mp4"""
import json
import math
import re
import shutil
import subprocess
import sys
from functools import cache
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
E = json.loads((ROOT / "src/edit.json").read_text(encoding="utf8"))
A = json.loads((ROOT / "src/timeline/audio.json").read_text(encoding="utf8"))
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
    if name != e["name"]:
        out.pop("start", None)
    return out


def chosen(e):
    c = (json.loads(CHOICES.read_text(encoding="utf8")) if CHOICES.exists() else {}).get(e["name"]) or {}
    return as_option(e, c["set"] if c.get("set") in options(e) else e["name"], c.get("gain", 1.0))


def build(out, beds, sfx, voice=True, span=None):
    inputs, chains = [], []

    def add(path, at, gain, start=0.0, length=None, fade_in=0.0, fade_out=0.0, loop=False, extra=()):
        i = len(chains)  # one chain per input file, so this is the input's index
        inputs.extend(["-stream_loop", "-1", "-i", str(path)] if loop else ["-i", str(path)])
        f = [f"atrim=start={start}" + (f":duration={length}" if length else ""), "asetpts=PTS-STARTPTS",
             "aformat=sample_rates=48000:channel_layouts=stereo", f"volume={gain}dB", *extra]
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
        add(SFX / f"{b['name']}.wav", b["from"], b["gain"], 0, b["to"] - b["from"], b["fadeIn"], b["fadeOut"], loop=True, extra=b.get("filters", []))
    for s in sfx:
        add(SFX / f"{s['name']}.wav", s["at"], s["gain"], s.get("start", 0), s.get("length"), 0, s.get("fadeOut", 0))
    graph = chains + [
        # audio.drive dB into the limiter first: hits (a slam, a drawer) stand ~20 dB over the average, too far apart for the
        # linear -14 LUFS pass below; the limiter trims them so the gap fits. Then the
        # safety limiter at about -7 dBFS. The loudness pass must stay linear: ffmpeg-normalize's dynamic fallback lifts
        # every quiet stretch (the CCTV hiss came up level with the voice). It falls back when target - true peak gap is
        # too small, so a quiet excerpt takes a lower target (src/timeline/audio.json lufs)
        f"{''.join(f'[a{i}]' for i in range(len(chains)))}amix=inputs={len(chains)}:normalize=0,apad=whole_dur={END},atrim=duration={END},volume={A.get('drive', 0)}dB,alimiter=limit=0.45:level=false"
        + (f",atrim={span[0]}:{span[1]},asetpts=PTS-STARTPTS" if span else "") + "[out]",
    ]
    script = out.with_name(out.name + ".graph.txt")
    script.write_text(";\n".join(graph), encoding="utf8")
    codec = ["-c:a", "libopus", "-b:a", "96k"] if out.suffix == ".webm" else ["-c:a", "pcm_s16le"]
    subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex_script", str(script), "-map", "[out]", "-ar", "48000", *codec, str(out)], check=True)
    script.unlink()


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
    if sys.argv[1:2] == ["--raw"]:
        studio(Path(sys.argv[2]))
        raise SystemExit
    raw = ROOT / "sound/mix_raw.wav"
    build(raw, [chosen(b) for b in A["beds"]], [chosen(s) for s in A["sfx"]])
    out = ROOT / "sound/mix.wav"
    subprocess.run([str(VENV / "ffmpeg-normalize"), str(raw), "-o", str(out), "-f", "-nt", "ebu", "-t", str(A["lufs"]), "-tp", "-1", "-lrt", "11", "--keep-lra-above-loudness-range-target", "-ar", "48000", "-c:a", "pcm_s16le"], check=True)
    check = "import soundfile as sf, pyloudnorm as pl, numpy as np, sys; d, r = sf.read(sys.argv[1]); print(f'pyloudnorm: {pl.Meter(r).integrated_loudness(d):.2f} LUFS, peak {20*np.log10(np.abs(d).max()):.2f} dBFS')"
    subprocess.run([str(VENV / "python.exe"), "-c", check, str(out)], check=True)
    if len(sys.argv) > 1:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", sys.argv[1], "-i", str(out), "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", str(ROOT / "renders/draft.mp4")], check=True)
        print("muxed renders/draft.mp4")
