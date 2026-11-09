import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


def filters(settings):
    rate = settings.get("rate", 1)
    duration, start = settings["duration"], settings.get("start", 0)
    chain = [f"atrim=start={start}:duration={duration * rate}", "asetpts=PTS-STARTPTS", "aformat=sample_fmts=flt:sample_rates=48000:channel_layouts=stereo"]
    if settings.get("reverse"):
        chain.append("areverse")
    return chain


def rubberband():
    executable = os.environ.get("RUBBERBAND") or shutil.which("rubberband")
    if not executable:
        executable = Path.home() / ".local/share/live-studio/tools/rubberband-4.0.0/rubberband.exe"
    if not Path(executable).is_file():
        raise RuntimeError("Install the Rubber Band command-line tool or set RUBBERBAND to its executable path")
    return str(executable)


def voice_filters(preset):
    if preset == "telephone":
        return "highpass=f=300,lowpass=f=3400"
    if preset == "walkieTalkie":
        return "highpass=f=400,lowpass=f=3000,volume=32,asoftclip=type=tanh:output=0.08:oversample=4,lowpass=f=3500"
    if preset == "megaphone":
        return "highpass=f=300,equalizer=f=1500:t=q:w=1:g=6,volume=24,asoftclip=type=tanh:output=0.1:oversample=4,lowpass=f=4500"
    if preset != "none":
        raise ValueError(f"Unknown voice filter: {preset}")
    return None


def render(source, output, settings):
    # FFmpeg's rubberband filter uses realtime R2 without offline alignment; use the upstream R3 CLI for exact clip duration.
    rate, pitch = settings.get("rate", 1), settings.get("pitch", 0)
    shift = 2 ** (pitch / 12) * (rate if settings.get("changePitch") else 1)
    stretch = rate != 1 or shift != 1
    executable = rubberband() if stretch else None
    voice = voice_filters(settings.get("voiceFilter", "none"))
    strength = settings.get("voiceStrength", 100) / 100
    effect = bool(voice and strength > 0)
    loop = ["-stream_loop", "-1"] if settings.get("loop") else []
    with tempfile.TemporaryDirectory(prefix="studio-audio-process-") as folder:
        trimmed = Path(folder) / "trimmed.wav"
        timed = Path(folder) / "timed.wav" if effect else output
        subprocess.run(["ffmpeg", "-v", "error", "-y", *loop, "-i", str(source), "-af", ",".join(filters(settings)), "-c:a", "pcm_f32le", str(trimmed if stretch else timed)], check=True, timeout=120)
        if stretch:
            subprocess.run([executable, "-q", "-3", "--centre-focus", "-T", str(rate), "-f", str(shift), str(trimmed), str(timed)], check=True, timeout=120)
        if effect:
            graph = f"[0:a]asplit[dry][wet];[wet]{voice}[fx];[dry][fx]amix=inputs=2:weights='{1-strength} {strength}':normalize=0[out]"
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(timed), "-filter_complex", graph, "-map", "[out]", "-c:a", "pcm_f32le", str(output)], check=True, timeout=120)


if __name__ == "__main__":
    render(sys.argv[1], sys.argv[2], json.load(sys.stdin))
