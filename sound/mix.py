"""The film's soundtrack from src/edit.json `audio` in one ffmpeg graph: the narration (assets/public/agent/full_voice.wav,
already placed on the film clock by voice/assemble.py and the studio's voice edits), beds (room hum, CCTV hiss) and
one-shot sound effects (sound/sfx, CC0, sound/get_sfx.py). A limiter catches peaks, then ffmpeg-normalize (two-pass EBU
R128, linear) brings it to edit.json audio.lufs / -1 dBTP, and pyloudnorm measures the result independently. -14 LUFS
is what YouTube plays at; the 27 s cold open alone is mostly quiet room tone and stays linear only at -16.
  python sound/mix.py --raw OUT.wav      the mix without loudness normalising (the studio's sound.py)
  python sound/mix.py                    -> sound/mix.wav (48 kHz stereo, film length)
  python sound/mix.py renders/draft_video.mp4   also muxes it -> renders/draft.mp4"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
E = json.loads((ROOT / "src/edit.json").read_text(encoding="utf8"))
A = E["audio"]
END = E["end"]
VENV = Path("E:/threejs_lab/py/venv/Scripts")  # has ffmpeg-normalize and pyloudnorm


def build(out):
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
    add(ROOT / "assets/public/agent/full_voice.wav", 0, A["voiceGain"], extra=["acompressor=threshold=0.03:ratio=4:attack=1:release=150:makeup=3", "alimiter=limit=0.35:level=false"])
    for b in A["beds"]:
        add(ROOT / "sound/sfx" / f"{b['name']}.wav", b["from"], b["gain"], 0, b["to"] - b["from"], b["fadeIn"], b["fadeOut"], loop=True, extra=b.get("filters", []))
    for s in A["sfx"]:
        add(ROOT / "sound/sfx" / f"{s['name']}.wav", s["at"], s["gain"], s.get("start", 0), s.get("length"), 0, s.get("fadeOut", 0))
    graph = chains + [
        # safety limiter at about -7 dBFS. The loudness pass must stay linear: ffmpeg-normalize's dynamic fallback lifts
        # every quiet stretch (the CCTV hiss came up level with the voice). It falls back when target - true peak gap is
        # too small, so a quiet excerpt takes a lower target (edit.json audio.lufs)
        f"{''.join(f'[a{i}]' for i in range(len(chains)))}amix=inputs={len(chains)}:normalize=0,apad=whole_dur={END},atrim=duration={END},alimiter=limit=0.45:level=false[out]",
    ]
    script = ROOT / "sound/.mix_graph.txt"
    script.write_text(";\n".join(graph), encoding="utf8")
    subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex_script", str(script), "-map", "[out]", "-ar", "48000", "-c:a", "pcm_s16le", str(out)], check=True)


if __name__ == "__main__":
    if sys.argv[1:2] == ["--raw"]:
        build(Path(sys.argv[2]))
        raise SystemExit
    raw = ROOT / "sound/mix_raw.wav"
    build(raw)
    out = ROOT / "sound/mix.wav"
    subprocess.run([str(VENV / "ffmpeg-normalize"), str(raw), "-o", str(out), "-f", "-nt", "ebu", "-t", str(A["lufs"]), "-tp", "-1", "-lrt", "11", "--keep-lra-above-loudness-range-target", "-ar", "48000", "-c:a", "pcm_s16le"], check=True)
    check = "import soundfile as sf, pyloudnorm as pl, numpy as np, sys; d, r = sf.read(sys.argv[1]); print(f'pyloudnorm: {pl.Meter(r).integrated_loudness(d):.2f} LUFS, peak {20*np.log10(np.abs(d).max()):.2f} dBFS')"
    subprocess.run([str(VENV / "python.exe"), "-c", check, str(out)], check=True)
    if len(sys.argv) > 1:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", sys.argv[1], "-i", str(out), "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", str(ROOT / "renders/draft.mp4")], check=True)
        print("muxed renders/draft.mp4")
