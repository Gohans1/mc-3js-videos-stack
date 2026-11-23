"""Technical upload checks for an encoded file. Uses this project's delivery profile and YouTube's recommendations.
Decodes the selected picture and audio streams and checks MP4 structure, timing and loudness. Use sheet/earshot for the content, timing and creative intent.
  bun run deliver                  renders/final.mp4, the file to upload (bun run mix renders/final_video.mp4 makes it)
  bun run deliver <video>          any other video
  bun run deliver --youtube        approximate LOCAL compression preview: renders/youtube_*/preview.mp4 (AV1 at
                                   4 Mbps, 1440 lines; Shorts 1080x1920 at 3 Mbps). No upload or actual YouTube rendition.
                                   Measures where this fixed-bitrate local re-encode adds bands to smooth light
                                   (Netflix CAMBI, 0 none, 5 a little, 24 unwatchable), each with a picture of it. About 3x the
                                   video's length on this PC: a 10 min film takes half an hour, so name seconds
  bun run deliver --youtube 9-15   the same for file seconds 9-15. Choose one range per picture format.
The project targets MP4 Fast Start, H.264 High 8-bit 4:2:0 BT.709 SDR, frames at a constant rate and keys
at most 1 s apart. Landscape minimum 1080p (default master 1440p), portrait target 1080x1920. Audio target AAC stereo
48 kHz, matching track duration, -14 LUFS integrated and at most -1 dBTP. Track duration alone cannot establish sync.
Checks use the default audio track, or the first if none is marked default.
Exit 0 passes the configured checks, 1 has a FIX finding or check/preview failure, 2 is invalid input. Why these numbers: bun run skills get core --ref render."""
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
from fractions import Fraction
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "sound"))
from listen import YOUTUBE, loudness, measured_loudness  # noqa: E402
from seconds import SAY, heard_second, meant  # noqa: E402  (listen puts scripts/ on the path)
from stale import render_context  # noqa: E402
from sheet_view import DECODE_BEFORE_TRIM, audio_bounds, display_size, displayed_time, extract_displayed_frame, picture_bounds, pixel_aspect, presentation_times, seconds  # noqa: E402
from studio_tell import job  # noqa: E402

USAGE = "bun run deliver [<video>] [--youtube [<from>-<to>]] (--help for more)"
SHORTS_LONGEST = 180
PREVIEW = {"wide": (2560, "4M"), "upright": (1080, "3M")}
BANDS = 5.0
ADDED = 3.0


def probe(video):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(video)],
                       capture_output=True, text=True, timeout=120)
    if r.returncode:
        raise SystemExit(f"{video} is no video ffprobe can read: {r.stderr.strip()[-200:]}")
    return json.loads(r.stdout)


def boxes(video):
    """The file's top-level MP4 boxes in order, and whether any track has an edit list (moov/trak/edts/elst)"""
    order, edits = [], False

    def walk(data, inside):
        nonlocal edits
        at = 0
        while at + 8 <= len(data):
            size, kind = int.from_bytes(data[at:at + 4], "big"), data[at + 4:at + 8]
            head = 8
            if size == 1:
                size, head = int.from_bytes(data[at + 8:at + 16], "big"), 16
            if size < head:
                return
            if kind == b"elst":
                edits = True
            if kind in (b"trak", b"edts"):
                walk(data[at + head:at + size], kind)
            at += size

    with open(video, "rb") as f:
        end = os.fstat(f.fileno()).st_size
        while head := f.read(8):
            if len(head) != 8:
                raise ValueError("truncated MP4 box header")
            size, kind = int.from_bytes(head[:4], "big"), head[4:8].decode("latin1")
            skip = size - 8
            if size == 1:
                full = f.read(8)
                if len(full) != 8:
                    raise ValueError(f"truncated MP4 {kind} box header")
                skip = int.from_bytes(full, "big") - 16
            order.append(kind)
            if size == 0:
                break
            if skip < 0 or f.tell() + skip > end:
                raise ValueError(f"truncated or invalid MP4 {kind} box")
            if kind == "moov":
                walk(f.read(skip), b"moov")
            else:
                f.seek(skip, 1)
    return order, edits


def picture_cadence(video, pic, duration, origin):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "V:0", "-show_entries",
                        "frame=key_frame,best_effort_timestamp,width,height,sample_aspect_ratio,pix_fmt,"
                        "color_range,color_space,color_primaries,color_transfer,chroma_location",
                        "-of", "json", str(video)], capture_output=True, text=True, timeout=600)
    if r.returncode or r.stderr.strip():
        raise RuntimeError(r.stderr.strip()[-500:] or "ffprobe could not decode the picture")
    format_fields = ("width", "height", "sample_aspect_ratio", "pix_fmt", "color_range",
                     "color_space", "color_primaries", "color_transfer", "chroma_location")
    frames = [(f.get("key_frame"), int(f["best_effort_timestamp"]), tuple(f.get(k) for k in format_fields))
              for f in json.loads(r.stdout).get("frames", []) if "best_effort_timestamp" in f]
    if not frames:
        raise RuntimeError("ffprobe found no decoded picture timestamps")
    time_base = Fraction(pic["time_base"])
    tick = float(time_base)
    formats = [(round(t * tick - origin, 9), shape) for i, (_, t, shape) in enumerate(frames)
              if not i or shape != frames[i - 1][2]]
    keys = [t * tick for key, t, _ in frames if key]
    ends = [frames[0][1] * tick, *keys, frames[0][1] * tick + duration]
    gap = max(b - a for a, b in zip(ends, ends[1:]))
    spacing = [b[1] - a[1] for a, b in zip(frames, frames[1:])]
    if not spacing or (shortest := min(spacing)) == (longest := max(spacing)):
        return gap, None, formats
    nominal = pic.get("r_frame_rate") or "0/0"
    if longest - shortest == 1 and rate({"avg_frame_rate": nominal}):
        period = 1 / (Fraction(nominal) * time_base)
        if math.floor(period) == shortest and math.ceil(period) == longest:
            return gap, None, formats
    return gap, (shortest * tick, longest * tick), formats


def rate(stream):
    num, den = (stream.get("avg_frame_rate") or "0/1").split("/")
    return float(num) / float(den) if float(den) else 0.0


def streams(info):
    picture = next((s for s in info["streams"] if s["codec_type"] == "video" and not s.get("disposition", {}).get("attached_pic")), None)
    audio = [s for s in info["streams"] if s["codec_type"] == "audio"]
    sound = next((s for s in audio if s.get("disposition", {}).get("default")), audio[0] if audio else None)
    return picture, sound, len(audio)


def check(video, info, picked, render=None, bounds=None):
    """Delivery summary, findings and picture bounds or None for an audio-only file."""
    remix = None
    if render and not render["kind"]:
        flavor = "final" if render["final"] else "draft"
        remix = f"bun run mix renders/{flavor}_video.mp4"
    draw = "; bun run render final writes that profile" if render else ""
    out = []
    fix = lambda words: out.append(("FIX", words))  # noqa: E731
    advise = lambda words: out.append(("ADVICE", words))  # noqa: E731
    remux = f'ffmpeg -n -i "{video}" -map 0 -c copy -movflags +faststart <out>.mp4 (if all streams fit MP4)'
    pic, snd, audio_count = picked
    if not pic:
        return f"{video}: no picture", [("FIX", "no video stream; supply a file with a picture track")], None, []
    pictures = [s for s in info["streams"] if s["codec_type"] == "video" and not s.get("disposition", {}).get("attached_pic")]
    if len(pictures) > 1:
        default = next((s["index"] for s in pictures if s.get("disposition", {}).get("default")), None)
        extra = f" (default is #{default})" if default is not None and default != pic["index"] else ""
        advise(f"{len(pictures)} picture streams; checked and previewed only first picture stream #{pic['index']}{extra}.")
    if audio_count > 1:
        advise(f"{audio_count} audio streams; only stream #{snd['index']} was checked (default or first). Use media ffmpeg probe to inspect the track list.")
    container = info["format"].get("format_name", "")
    brand = info["format"].get("tags", {}).get("major_brand", "").strip()
    if "mp4" not in container.split(",") or brand == "qt" or brand.startswith(("3gp", "3g2", "mj2")):
        fix(f"container {container or 'unknown'} {brand}: project profile targets MP4. Use media ffmpeg export to inspect carry, or {remux}")
    else:
        order, edits = boxes(video)
        late = "moov" in order and "mdat" in order and order.index("moov") > order.index("mdat")
        if "moov" not in order or "mdat" not in order:
            fix("MP4 is missing required moov or mdat boxes")
        if late:
            fix(f"the moov atom sits after the media (Fast Start places it first): {remux}")
        if edits:
            advise("MP4 has an edit list. YouTube recommends avoiding them; verify A/V timing before retiming or remuxing.")
    w, h = display_size(pic)
    fps = rate(pic)
    name = {"h264": "H.264"}.get(pic["codec_name"], pic["codec_name"])
    if pic["codec_name"] != "h264" or pic.get("profile") != "High":
        advise(f"{name} {pic.get('profile', '')}: target H.264 High{draw}")
    if pic.get("pix_fmt") != "yuv420p":
        advise(f"{pic.get('pix_fmt')}: YouTube asks 8-bit 4:2:0 (yuv420p) for SDR")
    tags = {pic.get(k, "unknown") for k in ("color_primaries", "color_transfer", "color_space")}
    if tags != {"bt709"} or pic.get("color_range") not in (None, "tv"):
        advise(f"colour tagged {'/'.join(sorted(tags))}{' ' + pic['color_range'] if 'color_range' in pic else ''}: target BT.709 limited range for SDR. "
               "Confirm the source color space before converting or correcting tags.")
    bounds = bounds or picture_bounds(video, pic, info["format"])
    pic_from, pic_to, origin = bounds
    long = pic_to - pic_from
    gap, varied, formats = picture_cadence(video, pic, long, origin)
    if len(formats) > 1:
        advise("decoded picture format changes; use a constant-format range for the preview")
    if varied and varied[0] <= 0:
        advise("duplicate or out-of-order picture timestamps; inspect the stream before delivery")
    elif varied:
        advise(f"variable frame rate: decoded frame spacing {varied[0] * 1000:.2f}-{varied[1] * 1000:.2f} ms; the project targets constant cadence")
    if gap > 1.01:
        advise(f"keyframes {gap:.1f} s apart at most: YouTube asks a closed GOP of half the frame rate (0.5 s); render final keys every 0.5 s")
    if w % 2 or h % 2:
        fix(f"{w}x{h} has an odd side: 4:2:0 needs both even")
    if h > w:
        if w < 1080 or h * 9 != w * 16:
            fix(f"{w}x{h} upright: target 1080x1920 (9:16){draw}")
        elif w > 1080:
            advise(f"{w}x{h}: project target is 1080x1920{draw}")
        if long > SHORTS_LONGEST:
            fix(f"{long:.0f} s upright: a Short is {SHORTS_LONGEST // 60} min at most, longer plays as an ordinary video")
    elif min(w, h) < 1080:
        fix(f"{w}x{h} ({min(w, h)}p) is below the project's landscape minimum (1080p){draw}")
    elif min(w, h) < 1440:
        advise(f"{min(w, h)}p: this project's default landscape master is 1440p{draw}")
    if not snd:
        fix(f"no sound: {remix} puts the soundtrack on the picture" if remix else "no sound: supply or add the intended audio track")
    else:
        sound_fix = f"; {remix}" if remix else ""
        if snd["codec_name"] != "aac":
            advise(f"{snd['codec_name']} sound: target AAC-LC{sound_fix}")
        if snd.get("channels") == 1:
            fix(f"mono sound: target stereo or 5.1{sound_fix}")
        if int(snd.get("sample_rate", 0)) not in (48000, 96000):
            advise(f"{int(snd.get('sample_rate', 0)) / 1000:g} kHz: target 48 or 96 kHz{sound_fix}")
        snd_from, snd_to = audio_bounds(video, origin, snd, container)
        if max(abs(snd_from - pic_from), abs(snd_to - pic_to)) > 0.1:
            fix(f"audio covers {snd_from:g}-{snd_to:g} s and picture covers {pic_from:g}-{pic_to:g} s on the file clock{sound_fix}")
        i, _, tp = loudness(video, f"0:{snd['index']}")
        if tp == float("-inf"):
            fix(f"selected audio stream is silent{sound_fix}")
        elif i is None:
            if snd_to - snd_from >= 0.4 - 1e-6:
                fix(f"no 400 ms audio block clears the EBU gate; selected track misses the {YOUTUBE:g} LUFS target{sound_fix}")
            else:
                advise("integrated loudness needs a 400 ms audio window; inspect the true peak for this short track")
        elif i < YOUTUBE - 1:
            fix(f"{i:.1f} LUFS: {YOUTUBE - i:.1f} LU quieter than the project target ({YOUTUBE:g} LUFS){sound_fix}")
        elif i > YOUTUBE + 1:
            advise(f"{i:.1f} LUFS: above the project target ({YOUTUBE:g} LUFS){sound_fix}")
        if tp > -1:
            fix(f"true peak {tp:+.1f} dBTP: exceeds the project's -1 dBTP ceiling{sound_fix}")
    mbps = int(pic.get("bit_rate") or info["format"].get("bit_rate") or 0) / 1e6
    sound = (f", {snd['codec_name'].upper()} {int(snd.get('sample_rate', 0)) / 1000:g} kHz {'stereo' if snd.get('channels') == 2 else str(snd.get('channels')) + ' ch'}"
             f" {int(snd.get('bit_rate') or 0) / 1000:.0f} kbps, {measured_loudness(i, tp)}" if snd else ", no sound")
    return f"{video}: {w}x{h} {fps:g} fps {name} {pic.get('profile', '')} {mbps:.1f} Mbps{sound}, {long:.1f} s", out, bounds, formats


def cambi(video, input_options, deadline, picture_filter, tmp, tag):
    """CAMBI sampled every fifth frame on the same presentation clock for source and preview."""
    log = f"cambi_{tag}.json"
    graph = (f"[0:V:0]{picture_filter},format=yuv420p,split[a][b];"
             f"[a][b]libvmaf=feature=name=cambi:n_subsample=5:log_fmt=json:log_path={log}")
    subprocess.run(["ffmpeg", "-nostdin", "-xerror", "-v", "error", "-y", *input_options, "-i", str(Path(video).resolve()),
                    "-lavfi", graph, "-f", "null", "-"], check=True, timeout=deadline, cwd=tmp)
    frames = json.loads((Path(tmp) / log).read_text(encoding="utf8"))["frames"]
    return {f["frameNum"]: f["metrics"]["cambi"] for f in frames if "cambi" in f["metrics"]}


def band_picture(video, preview, at, out, offset, origin, source_times, preview_times, preview_size):
    """The upload and the re-encode side by side at one second, with a row below that exaggerates small steps of light
    (each picture minus its blur, x16) so a band shows as a contour line"""
    width, height = preview_size
    proof_height = max(2, round(960 * height / width / 2) * 2)
    scale = f"scale=960:{proof_height}:reset_sar=1,format=gray"
    graph = (f"[0:V:0]{scale},split[a][a2];[1:V:0]{scale},split[b][b2];"
             "[a2]split[x][y];[y]gblur=sigma=8[yb];[x][yb]blend=all_expr='128+(A-B)*16'[ae];"
             "[b2]split[p][q];[q]gblur=sigma=8[qb];[p][qb]blend=all_expr='128+(A-B)*16'[be];"
             "[a][b]hstack[top];[ae][be]hstack[bottom];[top][bottom]vstack")
    source_frame = displayed_time(source_times, at)
    preview_time = at - offset
    preview_frame = displayed_time(preview_times, preview_time)
    with tempfile.TemporaryDirectory(prefix="band-frames-") as tmp:
        source_image, preview_image = Path(tmp) / "source.png", Path(tmp) / "preview.png"
        extract_displayed_frame(video, source_image, source_frame, origin=origin)
        extract_displayed_frame(preview, preview_image, preview_frame)
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(source_image), "-i", str(preview_image),
                        "-lavfi", graph.replace("0:V:0", "0:v:0").replace("1:V:0", "1:v:0"), "-frames:v", "1", str(out)],
                       check=True, timeout=120)


def youtube(video, span, root, pic, snd, picture, whole, cut_info, sequential, formats):
    first, stop, origin = picture
    start, end = span or (first, stop)
    end = min(end, stop)
    length = end - start
    change = next((t for t, _ in formats[1:] if round(start, 9) < t < round(end, 9)), None)
    if change is not None:
        print(f"Cannot compare CAMBI across a picture-format change at {seconds(change)} file seconds. "
              "Choose a range on one side of the change or normalize the source first.", file=sys.stderr)
        return 1, []
    _, frame_format = next((part for part in reversed(formats) if part[0] <= round(start, 9)), formats[0])
    frame_w, frame_h, sar = frame_format[:3]
    square_width = max(2, round(frame_w * pixel_aspect(sar, {}) / 2) * 2)
    display_w, display_h = display_size({**pic, "width": square_width, "height": frame_h})
    width, bitrate = PREVIEW["wide" if display_w >= display_h else "upright"]
    width = min(width, display_w)
    preview_height = max(2, round(display_h * width / display_w / 2) * 2)
    out = root / "renders"
    out.mkdir(exist_ok=True)
    out = Path(tempfile.mkdtemp(prefix="youtube_", dir=out))
    preview = out / "preview.mp4"
    shown = preview.relative_to(root).as_posix()
    staged = len(formats) > 1
    audio = ["-i", str(video)] if snd and staged else [
        "-ss", str(start), "-t", str(length), "-i", str(video),
    ] if snd and not sequential else []
    sound_filter = f"aresample=async=1:first_pts=0,apad,atrim=duration={length}"
    if sequential:
        absolute = origin + start
        sound_filter = f"atrim=start={absolute:.9f}:end={origin + end:.9f},asetpts=PTS-({absolute:.9f}/TB)," + sound_filter
    sound_map = ["-map", f"{1 if audio else 0}:{snd['index']}", "-af", sound_filter] if snd else []
    print(f"preview: {shown}; its second 0 starts at source file second {seconds(start)}", flush=True)
    print(f"local compression preview of {length:.3g} s (AV1 {bitrate}bps, {width} wide; approximate, not an actual YouTube rendition) and measuring bands in both, "
          f"about {max(10, length * 3):.0f} s{' (a few seconds judge banding as well: --youtube <from>-<to>)' if length > 60 else ''} ...",
          file=sys.stderr)
    with tempfile.TemporaryDirectory(prefix="deliver-") as tmp:
        try:
            source_times = presentation_times(video, origin)
            base = displayed_time(source_times, start)
            seek = max(0, base - 0.000002)
            fps = min(60, max(24, rate({"avg_frame_rate": pic.get("r_frame_rate")}) or 30))
            samples = max(1, math.ceil(length * fps - 1e-9))
            scale = f"scale={width}:{preview_height}:flags=lanczos:reset_sar=1"
            source, picture_stream = video, pic["index"]
            offset = max(0, start - base)
            if sequential:
                settings = ["-copyts"]
                window = f"trim=start={origin + base - 0.000005:.9f}:end={origin + end:.9f},"
            else:
                settings = ["-ss", str(seek), "-t", str(end - seek)]
                window = ""
            deadline = 600 + length * 20 + (start * 2 if sequential else 0)
            if staged:
                source, picture_stream = Path(tmp) / "picture.nut", 0
                # Isolate the chosen format before filters that buffer frames.
                subprocess.run(["ffmpeg", "-nostdin", "-xerror", "-v", "error", "-y", "-copyts", "-i", str(video),
                                "-map", f"0:{pic['index']}", "-vf", window + "setpts=PTS-STARTPTS," + scale,
                                "-c:v", "ffv1", "-enc_time_base", "filter", "-fps_mode", "passthrough",
                                str(source)], check=True, timeout=deadline)
                window = ""
            picture_filter = (f"{window}settb=AVTB,setpts=PTS-STARTPTS-({offset:.9f}/TB),fps={fps:.9f}:start_time=0:round=up,"
                              f"tpad=stop_mode=clone:stop_duration={length:.9f},trim=end_frame={samples},setpts=PTS-STARTPTS,{scale}")
            subprocess.run(["ffmpeg", "-nostdin", "-xerror", "-v", "error", "-y", *settings, "-i", str(source),
                            *audio, "-map", f"0:{picture_stream}", *sound_map, "-vf", picture_filter, "-c:v", "libsvtav1",
                            "-preset", "10", "-b:v", bitrate, "-c:a", "aac", "-b:a", "128k", str(preview)],
                           check=True, timeout=deadline, env={**os.environ, "SVT_LOG": "1"})
            preview_times = presentation_times(preview, 0)
            if len(preview_times) != samples or any(abs(t - i / fps) > 0.001 for i, t in enumerate(preview_times)):
                raise ValueError(f"preview did not match the {samples}-frame sample grid; output kept for investigation")
        except (subprocess.SubprocessError, OSError, ValueError, KeyError) as e:
            print(f"Local compression preview failed: {e}", file=sys.stderr)
            return 1, []
        # libvmaf CAMBI requires at least one dimension of 216 pixels.
        if max(width, preview_height) < 216:
            print(f"CAMBI unavailable for {width}x{preview_height}: both dimensions are below 216 pixels. Preview kept.")
            print(f'next: inspect "{shown}"; preview seconds are relative to {seconds(start)} s of "{video}"')
            return 0, []
        try:
            before = cambi(source, settings, deadline, picture_filter, tmp, "upload")
            after = cambi(preview, ["-t", str(length + 1 / fps)], deadline, scale, tmp, "preview")
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as e:
            print(f"CAMBI banding measurement failed: {e}", file=sys.stderr)
            return 1, []
    gain = {n: after[n] - before[n] for n in set(before) & set(after) if start + n / fps < end}
    if not gain:
        print("CAMBI returned no matching source/preview samples", file=sys.stderr)
        return 1, []
    worst = max(gain, key=gain.get)
    print(f"bands (Netflix CAMBI): largest measured gain {gain[worst]:+.1f} at source second {start + worst / fps:.6g}; "
          f"flags require gain {ADDED:g} and preview score {BANDS:g}. Source scores reach {max(before.values()):.1f}. Preview: {shown}")
    buckets = {}
    for n, delta in sorted(gain.items()):
        if delta >= ADDED and after[n] >= BANDS:
            sec = int(start + n / fps)
            if sec not in buckets or delta > gain[buckets[sec]]:
                buckets[sec] = n
    spans = []
    for sec, peak in buckets.items():
        if spans and sec == spans[-1][1] + 1:
            spans[-1][1] = sec
            if gain[peak] > gain[spans[-1][2]]:
                spans[-1][2] = peak
        else:
            spans.append([sec, sec, peak])
    cuts = cut_info.get("times") if cut_info else None
    if cut_info and cut_info.get("reason"):
        print(cut_info["reason"])
    ranges = [(max(start, a), min(end, b + 1)) for a, b, _ in spans]
    try:
        for i, ((a, b), (_, _, peak)) in enumerate(zip(ranges[:6], spans[:6])):
            at = start + peak / fps
            picture = out / f"youtube_bands_{i:02d}.png"
            band_picture(video, preview, at, picture, start, origin, source_times, preview_times,
                         (width, preview_height))
            shot = f", shot {sum(c <= at for c in cuts)} ({cut_info['file']})" if cuts is not None else ""
            print(f"BANDS {a:g}-{b:g} s{shot}: the re-encode scores {after[peak]:.1f} where the upload has {before[peak]:.1f} "
                  f"at {at:.6g} s; look: {picture.relative_to(root).as_posix()} (top: source | preview, bottom: steps of light x16)")
    except (subprocess.SubprocessError, OSError, ValueError, KeyError) as e:
        print(f"band comparison image failed: {e}", file=sys.stderr)
        return 1, []
    if len(spans) > 6:
        print(f"  and {len(spans) - 6} more stretches")
    if spans:
        print("Inspect the comparison before changing the source. Fine gradients can be sensitive to the bitrate.")
        if whole:
            print(f"bun run at {start + spans[0][2] / fps:.6g} locates the current film rows; inspect the grade or texture there.")
    else:
        print("No additional banding above the configured CAMBI thresholds in these samples.")
    print(f'next: inspect "{shown}" and the comparison images; preview seconds are relative to {seconds(start)} s of "{video}"')
    return 0, ranges


def main(args):
    sys.stdout.reconfigure(encoding="utf8")
    sys.stderr.reconfigure(encoding="utf8")
    if args[:1] == ["help"] or "-h" in args or "--help" in args:
        print(__doc__)
        return 0
    video, span, preview, i = None, None, False, 0
    while i < len(args):
        a = args[i]
        if a == "--youtube":
            preview = True
            nxt = args[i + 1] if i + 1 < len(args) else ""
            ends = [heard_second(x) for x in nxt.split("-")] if nxt.count("-") == 1 else []
            if len(ends) == 2 and None not in ends:
                span = tuple(ends)
                if span[0] >= span[1]:
                    print(f"--youtube {nxt}: the first second must come before the second one, like --youtube 9-15", file=sys.stderr)
                    return 2
                i += 1
            elif nxt and not nxt.startswith("-") and (
                    video is not None or (re.match(r"^\d[\d:.]*-", nxt) and not Path(nxt).is_file())):
                print(f"--youtube takes heard seconds as <from>-<to> ({SAY} each), like --youtube 9-15; got {nxt}{next((meant(x) for x in nxt.split('-') if meant(x)), '')}", file=sys.stderr)
                return 2
        elif a.startswith("-"):
            print(f"unknown option {a}: {USAGE}", file=sys.stderr)
            return 2
        elif video is None:
            video = a
        else:
            print(f"one video at a time, got {video} and {a}: {USAGE}", file=sys.stderr)
            return 2
        i += 1
    root = Path.cwd()
    named = video is not None
    video = Path(video or "renders/final.mp4")
    argument = f'"{video}"' if any(c.isspace() for c in str(video)) else str(video)
    if video.is_dir():
        print(f"{video} is a folder: give it the video, as {(video / 'final.mp4').as_posix()}", file=sys.stderr)
        return 2
    if not video.is_file():
        here = sorted(p.as_posix() for p in Path("renders").glob("*.mp4")) if Path("renders").is_dir() else []
        picture = Path("renders/final_video.mp4")
        print(f"{video} does not exist"
              + (f"; videos here: {', '.join(here)}" if named and here else
                 f"; {picture.as_posix()} is there: bun run mix {picture.as_posix()} makes renders/final.mp4" if picture.is_file() else
                 ": bun run render final, then bun run mix renders/final_video.mp4 makes renders/final.mp4"), file=sys.stderr)
        return 2
    if not shutil.which("ffprobe"):
        print("no ffprobe on PATH: INSTALL.md says how to set up ffmpeg", file=sys.stderr)
        return 1
    try:
        info = probe(video)
    except SystemExit as e:
        print(e.code, file=sys.stderr)
        return 2
    picked = streams(info)
    pic, snd, _ = picked
    bounds = None
    if span and pic:
        try:
            bounds = picture_bounds(video, pic, info["format"])
        except (KeyError, ValueError, IndexError, OSError, subprocess.SubprocessError) as e:
            print(f"could not determine picture duration of {video}: {e}", file=sys.stderr)
            return 1
        first, stop, _ = bounds
        if not (first <= span[0] < stop and span[1] <= stop + 0.05):
            print(f"--youtube {span[0]:g}-{span[1]:g} is outside the picture range {first:g}-{stop:.2f} file seconds", file=sys.stderr)
            return 2
    through = " and a local compression preview" if preview else ""
    ended = job(root, "deliver", f"Checking {video.as_posix()} for upload{through}")
    context = render_context(video)
    whole = context["render"] and not context["render"]["kind"] and not context["stale"]
    print("Checking the selected picture and audio streams (full decode; longer files can take several minutes) ...", file=sys.stderr)
    try:
        summary, found, bounds, formats = check(video, info, picked, context["render"], bounds)
    except (OSError, ValueError, KeyError, IndexError, RuntimeError, subprocess.SubprocessError) as e:
        print(f"could not check {video}: {e}", file=sys.stderr)
        ended(f"Delivery check failed for {video.as_posix()}", level="fail")
        return 1
    first, stop, origin = bounds or (0, 0, 0)
    long = stop - first
    if old := context["stale"]:
        found.insert(0, ("FIX", old["message"]))
    if context.get("error"):
        found.insert(0, ("ADVICE", context["error"]))
    print(summary)
    for kind, words in found:
        print(f"{kind} {words}")
    fixes = sum(kind == "FIX" for kind, _ in found)
    if fixes:
        print(f"{fixes} to fix before upload")
    else:
        print("passes configured technical upload checks" + (" (review the ADVICE lines)" if found else ""))
    print("For picture, audio content and precise A/V timing, inspect the encoded file with sheet and earshot.")
    bands = []
    if preview and pic:
        sequential = info["format"].get("format_name") in DECODE_BEFORE_TRIM or len(formats) > 1
        code, bands = youtube(video, span, root, pic, snd, (first, stop, origin), whole,
                              context["cuts"] if whole else None, sequential, formats)
        if code:
            ended(f"Stopped checking {video.as_posix()}", level="fail")
            return code
    elif fixes:
        print(f"next: review the FIX lines, then bun run deliver {argument} again")
    else:
        print(f"next: bun run deliver {argument + ' ' if named else ''}--youtube makes an approximate local compression preview and shows where it "
              f"bands (about {max(10, long * 3):.0f} s here{'; a few seconds judge it as well: --youtube <from>-<to>' if long > 60 else ''})")
    ended(f"{video.as_posix()}: {fixes} to fix before upload" if fixes else
          f"{video.as_posix()}: technical checks pass" + (f"; local preview bands {len(bands)} stretch{'es' if len(bands) > 1 else ''}" if bands else ""),
          level="fail" if fixes else "warn" if bands else "ok",
          **({"marks": [{"at": a, "to": b, "say": "BANDS after YouTube's re-encode"} for a, b in bands]} if whole and bands else {}))
    return 1 if fixes else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
