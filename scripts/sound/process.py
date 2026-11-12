import bisect
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


def filters(settings):
    rate = settings.get("rate", 1)
    duration, start = settings["duration"], settings.get("start", 0)
    chain = ["aformat=sample_fmts=flt:sample_rates=48000:channel_layouts=stereo"]
    if settings.get("dialogue"):
        # Process before trimming so a split retains the original compressor envelope and limiter delay.
        chain += ["acompressor=threshold=0.03:ratio=4:attack=1:release=150:makeup=3", "alimiter=limit=0.35:level=false"]
    chain += [f"atrim=start={start}:duration={duration * rate}", "asetpts=PTS-STARTPTS"]
    if settings.get("reverse"):
        chain.append("areverse")
    return chain


def loop_xfade(source, output, seconds):
    """The file looped to `seconds` the way app/sound/loop.ts plays it: passes a period apart, each crossfading into the
    next with equal power (cos out, sin in) over 1.5 s or a quarter of a short file. Returns False when the file
    alone covers it: a bed that ends inside its file never loops."""
    import numpy as np

    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels,sample_rate",
                            "-of", "json", str(source)], check=True, capture_output=True, text=True, timeout=60)
    stream = json.loads(probe.stdout)["streams"][0]
    ch, sr = int(stream["channels"]), int(stream["sample_rate"])
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(source), "-f", "f32le", "-acodec", "pcm_f32le", "-"],
                         check=True, capture_output=True, timeout=120).stdout
    x = np.frombuffer(raw, dtype=np.float32).reshape(-1, ch)
    d, need = len(x), math.ceil(seconds * sr)
    if need <= d:
        return False
    xf = min(round(1.5 * sr), d // 4)
    p = d - xf
    need += 1
    ramp = np.arange(xf) / xf
    out = np.zeros((need, ch), dtype=np.float64)
    for k in range(need // p + 1):
        w = np.ones(d)
        if k > 0:
            w[:xf] *= np.sin(np.pi / 2 * ramp)
        w[p:] *= np.cos(np.pi / 2 * ramp)
        at = k * p
        n = min(d, need - at)
        if n > 0:
            out[at:at + n] += x[:n] * w[:n, None]
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(sr), "-ac", str(ch), "-i", "-", "-c:a", "pcm_f32le",
                    str(output)], input=out.astype(np.float32).tobytes(), check=True, timeout=120)
    return True


def rubberband():
    executable = os.environ.get("RUBBERBAND") or shutil.which("rubberband")
    if not executable:
        executable = Path.home() / ".local/share/live-studio/tools/rubberband-4.0.0/rubberband.exe"
    if not Path(executable).is_file():
        raise RuntimeError("Install the Rubber Band command-line tool or set RUBBERBAND to its executable path")
    return str(executable)


def stretch_with(executable, *args):
    # rubberband prints its ratios even with -q, one line per clip into bun run mix; only a failure's words matter
    done = subprocess.run([executable, *args], capture_output=True, text=True, timeout=120)
    if done.returncode:
        raise RuntimeError(f"rubberband failed: {(done.stderr or done.stdout).strip()}")


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


def retime_timeline(source, output, timeline, folder):
    rate = 48000
    plays = [s for s in timeline if s["kind"] == "play" and not s.get("blank")]
    total = round(timeline[-1]["to"] * rate)
    if not plays:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-af", f"atrim=end_sample={total}", "-c:a", "pcm_f32le", str(output)], check=True, timeout=120)
        return
    cut, stretched, mapping = (Path(folder) / n for n in ("sequence-cut.wav", "sequence-timed.wav", "sequence-map.txt"))
    ranges = []
    for s in plays:
        a, b = round(s["sourceFrom"] * rate), round(s["sourceTo"] * rate)
        if ranges and ranges[-1][1] == a:
            ranges[-1][1] = b
        else:
            ranges.append([a, b])
    graph = [f"[0:a]apad=whole_len={max(b for _, b in ranges)},asplit={len(ranges)}" + "".join(f"[in{i}]" for i in range(len(ranges)))]
    for i, (a, b) in enumerate(ranges):
        graph.append(f"[in{i}]atrim=start_sample={a}:end_sample={b},asetpts=PTS-STARTPTS[part{i}]")
    points, input_at, output_at = {0: 0}, 0, 0
    for s in plays:
        a, b = round(s["sourceFrom"] * rate), round(s["sourceTo"] * rate)
        length = round(s["to"] * rate) - round(s["from"] * rate)
        span = s["sourceTo"] - s["sourceFrom"]
        slope = (s["rate1"] - s["rate0"]) / span
        def elapsed(x):
            return x / s["rate0"] if abs(slope) < 1e-10 else math.log1p(slope * x / s["rate0"]) / slope
        steps = 1 if s["rate0"] == s["rate1"] else max(1, math.ceil(span * 30))
        for j in range(steps + 1):
            u = j / steps
            points[input_at + round((b - a) * u)] = output_at + round(length * elapsed(span * u) / elapsed(span))
        input_at += b - a
        output_at += length
    graph.append("".join(f"[part{i}]" for i in range(len(ranges))) + f"concat=n={len(ranges)}:v=0:a=1[cut]")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(source), "-filter_complex", ";".join(graph), "-map", "[cut]", "-c:a", "pcm_f32le", str(cut)], check=True, timeout=120)
    if any(a != b for a, b in points.items()):
        # R3 4.0.0 divides by zero for a 0 -> 0 entry (upstream issue #124); endpoints are defined by -D.
        # Its updateRatioFromMap advances one pending key per process block; sub-block keys accumulate audible timing drift.
        frames = sorted(points)
        sampled = []
        for a in range(rate // 30, input_at, rate // 30):
            i = bisect.bisect_right(frames, a) - 1
            left, right = frames[i:i + 2]
            b = round(points[left] + (points[right] - points[left]) * (a - left) / (right - left))
            sampled.append(f"{a} {b}\n")
        mapping.write_text("".join(sampled), encoding="ascii")
        stretch_with(rubberband(), "-q", "-3", "--centre-focus", "-D", str(output_at / rate), "-M", str(mapping), str(cut), str(stretched))
    else:
        stretched = cut
    runs = []
    for s in timeline:
        length = round(s["to"] * rate) - round(s["from"] * rate)
        kind = "freeze" if s.get("blank") else s["kind"]
        if runs and runs[-1][0] == kind:
            runs[-1][1] += length
        else:
            runs.append([kind, length])
    play_count = sum(kind == "play" for kind, _ in runs)
    graph = [f"[0:a]apad=whole_len={output_at},asplit={play_count}" + "".join(f"[in{i}]" for i in range(play_count))]
    cursor, play_i = 0, 0
    for i, (kind, length) in enumerate(runs):
        if kind == "freeze":
            graph.append(f"anullsrc=r=48000:cl=stereo,atrim=end_sample={length},asetpts=PTS-STARTPTS[out{i}]")
        else:
            graph.append(f"[in{play_i}]atrim=start_sample={cursor}:end_sample={cursor + length},asetpts=PTS-STARTPTS[out{i}]")
            cursor += length
            play_i += 1
    graph.append("".join(f"[out{i}]" for i in range(len(runs))) + f"concat=n={len(runs)}:v=0:a=1,atrim=end_sample={total}[out]")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(stretched), "-filter_complex", ";".join(graph), "-map", "[out]", "-c:a", "pcm_f32le", str(output)], check=True, timeout=120)


def render(source, output, settings):
    # FFmpeg's rubberband filter uses realtime R2 without offline alignment; use the upstream R3 CLI for exact clip duration.
    rate, pitch = settings.get("rate", 1), settings.get("pitch", 0)
    shift = 2 ** (pitch / 12) * (rate if settings.get("changePitch") else 1)
    stretch = rate != 1 or shift != 1
    executable = rubberband() if stretch else None
    voice = voice_filters(settings.get("voiceFilter", "none"))
    strength = settings.get("voiceStrength", 100) / 100
    effect = bool(voice and strength > 0)
    with tempfile.TemporaryDirectory(prefix="studio-audio-process-") as folder:
        if settings.get("loop"):
            looped = Path(folder) / "looped.wav"
            if loop_xfade(source, looped, settings.get("start", 0) + settings["duration"] * rate):
                source = looped
        destination = output
        if settings.get("timeline"):
            output = Path(folder) / "source-processed.wav"
        trimmed = Path(folder) / "trimmed.wav"
        timed = Path(folder) / "timed.wav" if effect else output
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(source), "-af", ",".join(filters(settings)), "-c:a", "pcm_f32le", str(trimmed if stretch else timed)], check=True, timeout=120)
        if stretch:
            stretch_with(executable, "-q", "-3", "--centre-focus", "-T", str(rate), "-f", str(shift), str(trimmed), str(timed))
        if effect:
            graph = f"[0:a]asplit[dry][wet];[wet]{voice}[fx];[dry][fx]amix=inputs=2:weights='{1-strength} {strength}':normalize=0[out]"
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(timed), "-filter_complex", graph, "-map", "[out]", "-c:a", "pcm_f32le", str(output)], check=True, timeout=120)
        if settings.get("timeline"):
            retime_timeline(output, destination, settings["timeline"], folder)


if __name__ == "__main__":
    render(sys.argv[1], sys.argv[2], json.load(sys.stdin))
