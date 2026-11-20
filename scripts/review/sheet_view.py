"""Bounded overview and native evidence frames, dispatched by sheet.py after its shared video probe."""
import bisect
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from fractions import Fraction
from functools import lru_cache

from seconds import heard_second
from studio_tell import job

DECODE_BEFORE_TRIM = {"mpeg", "mpegts"}
USE_PRESENTATION_BOUNDS = {"avi", "mpeg", "matroska,webm"}


def compact_filter(width=320, height=320, *, pad=False):
    fit = (f"scale=w='max(2,round(min({width},{height}*dar)/2)*2)':"
           f"h='max(2,round(min({height},{width}/dar)/2)*2)':reset_sar=1")
    return fit + (f",pad={width}:{height}:(ow-iw)/2:(oh-ih)/2" if pad else "")


def samples(spec, mode, start, duration, clock):
    stop = start + duration
    stop = max(stop, round(stop, 9))
    start = round(start, 9)
    if spec is None:
        n = 16 * min(6, max(1, math.floor(duration / 160 + 0.5)))
        return [start + duration * (i + 0.5) / n for i in range(n)]
    times = []
    for item in spec.split(","):
        if "-" in item:
            match = re.fullmatch(r"(.+?)-([^/]+)(?:/([0-9]+))?", item)
            if not match:
                raise ValueError(f"bad range {item!r}: use A-B/N, e.g. 10-20/8")
            a, b = (heard_second(v) for v in match.group(1, 2))
            n = int(match[3]) if match[3] else 16 if mode == "overview" else 4
            limit = 96 if mode == "overview" else 40
            if not 1 <= n <= limit:
                raise ValueError(f"range count must be 1-{limit}, got {n}")
            if a is None or b is None or not start <= a < b <= stop:
                raise ValueError(f"range {item!r} must increase inside {clock} seconds {seconds(start)}-{seconds(stop)}")
            times.extend(a + (b - a) * (i + 0.5) / n for i in range(n))
        else:
            t = heard_second(item)
            if mode == "overview" or t is None or not start <= t < stop:
                raise ValueError(f"{item!r}: {'overview needs A-B[/N]' if mode == 'overview' else f'give {clock} seconds inside {seconds(start)}-{seconds(stop)}'}")
            times.append(t)
        if len(times) > 96:
            raise ValueError("at most 96 samples per run: narrow the range or split the request")
    if mode == "overview" and "," in spec:
        raise ValueError("overview takes one range A-B[/N]")
    return sorted(set(times))


def command(argv, *, cwd=None, timeout=30):
    return subprocess.run(argv, cwd=cwd, check=True, capture_output=True, timeout=timeout)


def image_dimensions(image):
    result = command(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                      "stream=width,height", "-of", "csv=p=0", str(image)])
    return tuple(map(int, result.stdout.split(b",")))


def video_bounds(video, *, include_audio=False):
    probe = command(["ffprobe", "-v", "error", "-select_streams", "V:0", "-show_entries",
                     "stream=r_frame_rate,width,height,duration,start_time:stream_side_data=rotation:format=start_time,format_name",
                     "-of", "json", str(video)])
    data = json.loads(probe.stdout)
    if not data.get("streams"):
        raise ValueError("source has no timed picture track; cover images are excluded")
    stream, container = data["streams"][0], data["format"]
    if re.search(r"^image2|_pipe$", container.get("format_name", "")):
        raise ValueError("expected a video")
    first, stop, origin = picture_bounds(video, stream, container)
    width, height = display_size(stream)
    format_name = container.get("format_name")
    source_duration = max(stop, audio_end(video, origin, format_name)) if include_audio else stop
    return first, stop, origin, {**stream, "width": width, "height": height, "format": format_name,
                                 "sourceDuration": max(source_duration, round(source_duration, 9))}


def audio_end(video, origin, format_name):
    probe = command(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries",
                     "stream=index,start_time,duration,time_base:stream_tags=DURATION", "-of", "json", str(video)])
    tracks = json.loads(probe.stdout).get("streams", [])
    return max((audio_bounds(video, origin, track, format_name)[1] for track in tracks), default=0)


def audio_bounds(video, origin, track, format_name):
    start, duration = track.get("start_time"), track.get("duration")
    if (format_name in DECODE_BEFORE_TRIM or format_name == "matroska,webm"
            or start in (None, "N/A") or duration in (None, "N/A")):
        times, stop = presentation_bounds(video, origin, str(track["index"]))
        if format_name == "matroska,webm":
            hours, _, minutes = track.get("tags", {}).get("DURATION", "").partition(":")
            tagged_end = heard_second(minutes)
            if hours.isdecimal() and tagged_end is not None and track.get("time_base"):
                tagged_end += int(hours) * 3600 - origin
                if abs(tagged_end - stop) <= float(Fraction(track["time_base"])) + 1e-9:
                    stop = tagged_end
        if format_name in DECODE_BEFORE_TRIM or start in (None, "N/A"):
            return times[0], stop
        return float(start) - origin, stop
    start = float(start) - origin
    return start, start + float(duration)


def quarter_turn(stream):
    rotation = next((x["rotation"] for x in stream.get("side_data_list", []) if "rotation" in x), 0)
    return abs(float(rotation)) % 180 == 90


def display_size(stream):
    width, height = stream["width"], stream["height"]
    return (height, width) if quarter_turn(stream) else (width, height)


def pixel_aspect(value, stream):
    aspect = Fraction(value.replace(":", "/")) if value and value not in ("N/A", "0:1", "0:0") else Fraction(1)
    return 1 / aspect if quarter_turn(stream) else aspect


def sample_aspects(video, origin, through, *, deadline=None):
    timeout = 600 if deadline is None else deadline - time.monotonic()
    if timeout <= 0:
        raise subprocess.TimeoutExpired("FFprobe frame metadata", timeout)
    probe = command(["ffprobe", "-v", "error", "-select_streams", "V:0", "-read_intervals",
                     f"%{origin + through + 1:.9f}", "-show_entries",
                     "frame=best_effort_timestamp,sample_aspect_ratio:stream=time_base:stream_side_data=rotation",
                     "-of", "json", str(video)], timeout=timeout)
    info = json.loads(probe.stdout)
    stream = info["streams"][0]
    tick = Fraction(stream["time_base"])
    return {round(float(int(f["best_effort_timestamp"]) * tick) - origin, 9):
            pixel_aspect(f.get("sample_aspect_ratio"), stream)
            for f in info.get("frames", []) if "best_effort_timestamp" in f}


def picture_bounds(video, stream, container, *, selector="V:0"):
    origin = float(container.get("start_time", 0))
    times, observed_end = presentation_bounds(video, origin, selector)
    first = max(0, times[0])
    start, duration = stream.get("start_time"), stream.get("duration")
    if container.get("format_name") in USE_PRESENTATION_BOUNDS or duration in (None, "N/A"):
        stop = observed_end
    else:
        declared_start = first if start in (None, "N/A") else max(0, float(start) - origin)
        stop = declared_start + float(duration)
        # Stream-copy VFR can declare an end before its last presentable picture.
        if round(stop, 9) <= round(times[-1], 9):
            stop = observed_end
    if not math.isfinite(stop) or stop <= first:
        raise ValueError("invalid picture bounds")
    return round(first, 9), max(stop, round(stop, 9)), origin


def timeline_context(render_context, clock):
    root = Path.cwd()
    context = {"status": "unavailable", "reason": "no registered film timeline",
               "basis": "current timeline at requestedTime, not verified encoded audio", "shots": "unavailable"}
    if not (root / "src/scene.ts").is_file() or not (root / "package.json").is_file():
        return context, [], []
    if "error" in render_context:
        context["reason"] = render_context["error"]
        return context, [], []
    if not render_context["render"]:
        context.update(status="foreign", reason="video is not a recognized film render; timeline associations omitted")
        return context, [], []
    if render_context["stale"]:
        context.update(status="stale", reason=render_context["stale"]["message"])
        return context, [], []
    if clock == "manual":
        context.update(status="manual-offset", reason="START changes this render's offset; timeline associations omitted")
        return context, [], []
    context["timeline"] = "fresh"
    scripts = Path(__file__).resolve().parents[1]
    env = {**os.environ, "LIVE_PROJECT": str(root)}
    cut_info = render_context["cuts"] or {}
    cuts = sorted(set(cut_info.get("times", [])))
    if "times" in cut_info:
        context.update(shots=cut_info["file"], cutStatus=cut_info["status"])
    else:
        context["shotReason"] = cut_info.get("reason", "no current cut metadata")
    try:
        result = subprocess.run(["bun", str(scripts / "voice/cues.ts"), "--json"], capture_output=True,
                                check=True, timeout=30, env=env)
        cues = json.loads(result.stdout.decode("utf8"))
        if cues.get("voiceOff"):
            context.update(status="off", reason="narration is disabled in the current timeline")
        elif cues.get("voiceMuted"):
            context.update(status="muted", reason=f"narration track {cues['voiceMuted']} is muted")
        elif cues.get("unlaid") or cues.get("unplaced"):
            context.update(status="planning", reason="takes are not assembled; bun run voice:assemble then voice:cues")
        elif cues.get("audioFault"):
            context.update(status="unavailable", reason=cues["audioFault"])
        elif not cues.get("lines"):
            context.update(status="unavailable", reason="no narration timing available; bun run voice:cues explains it")
        else:
            context.update(status="ready", reason="narration positions from bun run voice:cues --json")
            return context, cues["lines"], cuts
    except (OSError, ValueError, subprocess.SubprocessError) as e:
        context.update(status="unavailable", reason=f"narration context unavailable: {e}; bun run voice:cues --json")
    return context, [], cuts


def timeline_length(root):
    if not (root / "src/scene.ts").is_file():
        return 0
    at = Path(__file__).resolve().parents[1] / "at.ts"
    script = f"import {{ whatsAt }} from {json.dumps(at.as_posix())}; console.log(whatsAt(process.cwd(), 0).length)"
    try:
        return float(command(["bun", "-e", script], cwd=root).stdout)
    except (OSError, ValueError, subprocess.SubprocessError):
        return 0


def seconds(t):
    return f"{t:.9f}".rstrip("0").rstrip(".")


def decoded_picture_stamps(video, stream):
    result = subprocess.run(["ffmpeg", "-nostdin", "-xerror", "-hide_banner", "-nostats", "-v", "info",
                             "-copyts", "-i", video, "-map", f"0:{stream}", "-vf", "showinfo=checksum=0",
                             "-fps_mode", "passthrough", "-f", "null", "-"],
                            capture_output=True, timeout=600)
    shown = result.stderr.decode("utf8", errors="replace")
    if result.returncode:
        raise ValueError(f"FFmpeg could not decode picture timestamps: {shown.strip()[-500:]}")
    base = re.search(r"config in time_base: (\d+/\d+)", shown)
    if not base:
        raise ValueError("FFmpeg did not report the picture time base")
    stamps = []
    for frame in re.finditer(r"\bn:\s*\d+\s+pts:\s*(-?\d+)\b[^\r\n]*", shown):
        duration = re.search(r"\bduration:\s*(\d+)", frame[0])
        stamps.append((int(frame[1]), int(duration[1]) if duration else 0))
    return Fraction(base[1]), stamps


@lru_cache(maxsize=4)
def presentation_bounds(video, origin, stream="V:0"):
    # Reordered pictures can fall outside a seek's decode window; read the whole PTS index.
    video = str(Path(video).resolve())
    args = ["ffprobe", "-v", "error", "-select_streams", stream, "-show_packets",
            "-show_entries", "packet=pts,duration,flags:stream=time_base,codec_type", "-of", "json", video]
    result = subprocess.run(args, check=True, capture_output=True, timeout=120)
    if result.stderr.strip():
        raise ValueError(result.stderr.decode("utf8", errors="replace").strip()[-500:])
    data = json.loads(result.stdout)
    entries = [packet for packet in data.get("packets", []) if "D" not in packet.get("flags", "")]
    field = "pts"
    stream_info = data["streams"][0]
    time_base = Fraction(stream_info["time_base"])
    missing = any(packet.get(field) in (None, "N/A") for packet in entries)
    if missing and stream_info["codec_type"] == "video":
        time_base, stamps = decoded_picture_stamps(video, stream)
    else:
        if missing:
            field = "best_effort_timestamp"
            result = subprocess.run(["ffprobe", "-v", "error", "-select_streams", stream, "-show_frames",
                                     "-show_entries", f"frame={field},duration", "-of", "json", video],
                                    check=True, capture_output=True, timeout=600)
            if result.stderr.strip():
                raise ValueError(result.stderr.decode("utf8", errors="replace").strip()[-500:])
            entries = json.loads(result.stdout).get("frames", [])
        stamps = [(int(x[field]), int(x["duration"]) if x.get("duration") not in (None, "N/A") else 0)
                  for x in entries if x.get(field) not in (None, "N/A")]
    if not stamps:
        raise ValueError(f"no presentation timestamps found for stream {stream}")
    times = sorted(float(pts * time_base) - origin for pts, _ in stamps)
    end = max(float((pts + duration) * time_base) - origin for pts, duration in stamps)
    return times, max(end, math.nextafter(times[-1], math.inf))


def presentation_times(video, origin):
    return presentation_bounds(video, origin, "V:0")[0]


def extract_frame(video, dest, seek, *, origin, compact=False, canvas=None, aspect=None, sequential=False, deadline=None):
    filters = compact_filter(*(canvas or (320, 320)), pad=canvas is not None) + "," if compact else ""
    if aspect is not None:
        filters = f"setsar={aspect}:max=1000000," + filters
    seek_args = ["-ss", f"{max(0, seek - 0.000002):.9f}"]
    if sequential:
        # Some demuxers seek to the following GOP. Decode to the proven PTS from the beginning if needed.
        seek_args = []
        absolute = seek + origin
        filters = f"select=between(t\\,{absolute - 0.000005:.9f}\\,{absolute + 0.000005:.9f})," + filters
    timeout = 30 if deadline is None else min(30, deadline - time.monotonic())
    if timeout <= 0:
        raise subprocess.TimeoutExpired("FFmpeg frame extraction", timeout)
    result = command(["ffmpeg", "-nostdin", "-xerror", "-v", "info", "-y", *seek_args,
                      "-copyts", "-i", str(Path(video).resolve()), "-map", "0:V:0",
                      "-frames:v", "1", "-q:v", "2", "-vf", filters + "showinfo=checksum=0",
                      "-noautoscale", "-fps_mode", "passthrough", "-update", "1", str(dest)], timeout=timeout)
    if not Path(dest).is_file():
        raise ValueError(f"no picture at {seek:g} source seconds")
    info = result.stderr.decode("utf8", errors="replace")
    tb = re.search(r"config in time_base: (\d+/\d+)", info)
    pts = re.search(r"\bn:\s*0\s+pts:\s*(-?\d+)", info)
    if not tb or not pts:
        raise ValueError("FFmpeg did not report the decoded frame timestamp")
    return float(int(pts[1]) * Fraction(tb[1])) - origin


def displayed_time(times, requested):
    index_at = bisect.bisect_right(times, round(requested, 9), key=lambda t: round(t, 9)) - 1
    if index_at < 0:
        raise ValueError(f"no frame is displayed at {requested:g} source seconds")
    return times[index_at]


def extract_displayed_frame(video, dest, seek, *, origin=0, compact=False, canvas=None, aspect=None, deadline=None):
    try:
        actual = extract_frame(video, dest, seek, origin=origin, compact=compact, canvas=canvas,
                               aspect=aspect, deadline=deadline)
        if abs(actual - seek) <= 0.000001:
            return actual
    except (subprocess.SubprocessError, ValueError):
        pass
    Path(dest).unlink(missing_ok=True)
    actual = extract_frame(video, dest, seek, origin=origin, compact=compact, canvas=canvas,
                           aspect=aspect, sequential=True, deadline=deadline)
    if abs(actual - seek) > 0.000001:
        Path(dest).unlink(missing_ok=True)
        raise ValueError(f"could not decode the expected frame at {seek:g} source seconds")
    return actual


def load_caption_font(ImageFont, size=18):
    for candidate in (
        "C:/Windows/Fonts/consola.ttf",
        "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/System/Library/Fonts/Menlo.ttc",
    ):
        if Path(candidate).is_file():
            try:
                return ImageFont.truetype(candidate, size)
            except OSError:
                pass
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def pair_with_reference(ours, reference, dest):
    """reference | ours at the size of ours; the reference fits the picture, top-aligned, so a draft's strip stays under ours."""
    width, height = image_dimensions(ours)
    fit = f"scale=w={width}:h={height}:force_original_aspect_ratio=decrease,setsar=1,pad={width}:{height}:(ow-iw)/2:0:black"
    left = ["-i", str(reference)] if reference else ["-f", "lavfi", "-i", f"color=black:s={width}x{height}"]
    command(["ffmpeg", "-nostdin", "-v", "error", "-y", *left, "-i", str(ours), "-filter_complex",
             f"[0:v]{fit},format=yuvj420p[r];[1:v]setsar=1,format=yuvj420p[o];[r][o]hstack=inputs=2",
             "-frames:v", "1", "-q:v", "2", str(dest)])
    # the side is named on the picture: a reviewer handed a bare pair has blamed ours for the reference's own logos
    from PIL import Image, ImageDraw, ImageFont
    with Image.open(dest) as opened:
        pair = opened.convert("RGB")
    draw = ImageDraw.Draw(pair)
    font = load_caption_font(ImageFont, max(12, height // 40))
    for x, label in ((0, "REFERENCE" if reference else "REFERENCE (ended)"), (width, "OURS")):
        box = draw.textbbox((x + 8, 8), label, font=font)
        draw.rectangle((box[0] - 6, box[1] - 4, box[2] + 6, box[3] + 4), fill=(0, 0, 0))
        draw.text((x + 8, 8), label, fill=(255, 255, 255), font=font)
    pair.save(dest, quality=92)


def rule_grid(frame, step, crop):
    """The frame cut to crop (x0, y0, x1, y1 in its pixels) with a line every step px, each labelled with its own pixel."""
    from PIL import Image, ImageDraw, ImageFont
    x0, y0, x1, y1 = crop
    with Image.open(frame) as opened:
        picture = opened.convert("RGB").crop((x0, y0, x1, y1))
    draw = ImageDraw.Draw(picture, "RGBA")
    font = load_caption_font(ImageFont, 12)
    for x in range(-(-x0 // step) * step, x1, step):
        draw.line([(x - x0, 0), (x - x0, y1 - y0)], fill=(255, 255, 255, 170))
        draw.text((x - x0 + 2, 1), str(x), fill=(255, 255, 0), font=font, stroke_width=2, stroke_fill=(0, 0, 0))
    for y in range(-(-y0 // step) * step, y1, step):
        draw.line([(0, y - y0), (x1 - x0, y - y0)], fill=(255, 255, 255, 170))
        if y - y0 >= 14:  # the top row holds the x labels
            draw.text((2, y - y0 + 1), str(y), fill=(255, 255, 0), font=font, stroke_width=2, stroke_fill=(0, 0, 0))
    picture.save(frame, quality=92)


def review(video, mode, spec, start, first, stop, origin, stream, render_context, clock, vs=None, grid=None):
    try:
        times = samples(spec, mode, start + first, stop - first, clock)
    except ValueError as e:
        print(f"{e}; bun run sheet --help", file=sys.stderr)
        raise SystemExit(2)
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    if grid:
        width, height = display_size(stream)
        crop = grid["crop"] or [0, 0, width, height]
        if not (0 <= crop[0] < crop[2] <= width and 0 <= crop[1] < crop[3] <= height):
            print(f"--crop {','.join(map(str, crop))} must lie inside the {width}x{height} picture, x0 < x1 and y0 < y1",
                  file=sys.stderr)
            raise SystemExit(2)
        grid = {"step": grid["step"], "crop": crop}
    context, lines, cuts = timeline_context(render_context, clock)
    if context["status"] != "ready":
        print(f"context {context['status']}: {context['reason']}", file=sys.stderr)
    renders = Path.cwd() / "renders"
    renders.mkdir(exist_ok=True)
    stem = re.sub(r"[^A-Za-z0-9_-]", "_", Path(video).stem)[:60]
    out = Path(tempfile.mkdtemp(prefix=f"review_{stem}_", dir=renders))
    index = out / "index.json"
    data = {
        "complete": False, "mode": mode,
        "source": {"path": str(Path(video).resolve()), "start": start, "clock": clock, "pictureFrom": round(start + first, 9), "pictureTo": start + stop,
                   "duration": stop - first,
                   "width": stream["width"], "height": stream["height"]},
        "context": context,
        "reference": {"path": str(Path(vs).resolve()), "clock": "file"} if vs else None,
        "entries": [],
    }
    at_end = timeline_length(Path.cwd()) if context.get("timeline") == "fresh" else 0
    for i, t in enumerate(times):
        entry = {"requestedTime": t}
        entry["commands"] = {"frames": {
            "argv": ["bun", "run", "sheet", str(Path(video).resolve()), "frames", seconds(t),
                     *(["--vs", str(Path(vs).resolve())] if vs else [])],
            "env": {"START": seconds(start)},
        }}
        if t < at_end:
            entry["commands"]["at"] = {"argv": ["bun", "run", "at", seconds(t)]}
        if mode == "overview":
            entry.update({"sheet": str(out / f"overview_{i // 16 + 1:02d}.jpg"), "cell": i % 16 + 1})
        else:
            entry["frame"] = str(out / f"frame_{i:03d}.jpg")
            if grid:
                entry["grid"] = grid
            if vs:
                entry["vs"] = str(out / f"vs_{i:03d}.jpg")
        data["entries"].append(entry)
    index.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    print(f"index: {index}", flush=True)
    print(f"{clock} seconds from {start:g}", flush=True)
    if vs:
        print(f"pairs: reference | ours, {Path(vs).name} at the same heard second (its file second, its exact frame)", flush=True)
    ended = job(Path.cwd(), "sheet", f"Extracting {len(times)} {mode} samples from {Path(video).name}")
    try:
        displayed = presentation_times(video, origin)
        for entry in data["entries"]:
            entry["seekTime"] = displayed_time(displayed, entry["requestedTime"] - start)
        aspects = sample_aspects(video, origin, data["entries"][-1]["seekTime"])
        if vs:
            ref_first, ref_stop, ref_origin, _ = video_bounds(vs)
            ref_times = presentation_times(vs, ref_origin)
            ref_seeks = {e["requestedTime"]: displayed_time(ref_times, e["requestedTime"]) for e in data["entries"]
                         if ref_first <= e["requestedTime"] < ref_stop}
            ref_aspects = sample_aspects(vs, ref_origin, max(ref_seeks.values())) if ref_seeks else {}
        canvas = None
        for i, entry in enumerate(data["entries"]):
            dest = str(out / f"{'ours' if vs else 'tile'}_{i:03d}.jpg") if mode == "overview" else entry["frame"]
            aspect = aspects.get(round(entry["seekTime"], 9))
            entry["sampleAspectRatio"] = str(aspect) if aspect is not None else None
            entry["sourceTime"] = extract_displayed_frame(video, dest, entry["seekTime"], origin=origin,
                                                          compact=mode == "overview", canvas=canvas, aspect=aspect)
            if mode == "overview" and canvas is None:
                canvas = image_dimensions(dest)
            if grid:
                rule_grid(dest, grid["step"], grid["crop"])
            if vs:
                seek = ref_seeks.get(entry["requestedTime"])
                ref_dest = out / f"reference_{i:03d}.jpg"
                entry["reference"] = None if seek is None else {"frame": str(ref_dest), "sourceTime": extract_displayed_frame(
                    vs, ref_dest, seek, origin=ref_origin, aspect=ref_aspects.get(round(seek, 9)))}
                pair_with_reference(dest, ref_dest if seek is not None else None,
                                    out / f"tile_{i:03d}.jpg" if mode == "overview" else entry["vs"])
                if mode == "overview":
                    Path(dest).unlink()
                    ref_dest.unlink(missing_ok=True)
                    entry["reference"] = entry["reference"] and {"sourceTime": entry["reference"]["sourceTime"]}
            entry["time"] = start + entry["sourceTime"]
            requested = entry["requestedTime"]
            if context["shots"] != "unavailable":
                entry["shot"] = bisect.bisect_right(cuts, requested)
            spoken = [line for line in lines if line["s"] <= requested < line["e"]]
            if spoken:
                entry["narration"] = {k: spoken[0][k] for k in ("text", "s", "e")}
            if mode == "frames":
                print(f"{entry['time']:g}s\t{entry.get('vs', entry['frame'])}", flush=True)
        if mode == "overview":
            command(["ffmpeg", "-nostdin", "-v", "error", "-y", "-framerate", "1",
                     "-i", "tile_%03d.jpg", "-vf", "tile=4x4", "-q:v", "2",
                     "overview_%02d.jpg"], cwd=out)
            for sheet in dict.fromkeys(e["sheet"] for e in data["entries"]):
                print(sheet, flush=True)
        data["complete"] = True
        index.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    except (OSError, ValueError, subprocess.SubprocessError) as e:
        ended("Frame extraction failed", level="error")
        detail = e.stderr.decode("utf8", errors="replace").strip() if isinstance(e, subprocess.CalledProcessError) else str(e)
        index.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
        print(f"frame extraction failed: {detail}; partial output kept at {index}; inspect the source and retry with bun run sheet --help", file=sys.stderr)
        raise SystemExit(1)
    ended(f"Extracted {len(times)} {mode} samples")
    print(f"{len(times)} samples; cells read left to right, top to bottom" if mode == "overview" else f"{len(times)} native frames")
    followup = ("use commands.at to locate timeline rows" if any(t < at_end for t in times)
                else "timeline rows are unavailable at these times")
    print(f"next: open every {'sheet' if mode == 'overview' else 'frame'} and {index}; "
          f"{'use each entry commands.frames for detail; ' if mode == 'overview' else ''}"
          f"{followup}")
