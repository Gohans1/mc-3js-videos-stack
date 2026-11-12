"""The last look before upload: the finished video checked against YouTube's upload spec (support.google.com/youtube/answer/
1722171), each fault with the command or setting that fixes it. Run inside the film.
  bun run deliver                  renders/final.mp4, the file to upload (bun run mix renders/final_video.mp4 makes it)
  bun run deliver <video>          any other video
  bun run deliver --youtube        also how the picture looks after YouTube's own re-encode: renders/youtube_preview.mp4 (AV1 at
                                   4 Mbps, 1440 lines, about YouTube's 1440p rung; Shorts 1080x1920 at 3 Mbps; YouTube picks the
                                   bitrate per video and serves 1080p at about 0.4-3 Mbps, where smooth gradients band whatever
                                   is done), and the seconds where that re-encode bands smooth light the upload kept smooth
                                   (Netflix CAMBI, 0 none, 5 a little, 24 unwatchable), each with a picture of it. About 3x the
                                   video's length on this PC: a 10 min film takes half an hour, so name seconds
  bun run deliver --youtube 9-15   the same for those seconds of the video only, in seconds
Checked: MP4 with the moov atom up front and no edit lists, H.264 High 8-bit 4:2:0 in BT.709 at a constant frame rate, a
keyframe at least every second, 1440p or 2160p (Shorts: 1080x1920, 3 min at most), AAC stereo 48 kHz (asked at 384 kbps: bun run mix
asks that; ffmpeg's AAC lands under it on purpose, so the rate is shown, not judged), sound as long
as the picture, -14 LUFS (YouTube turns louder down, never quieter up) with true peak at -1 dBTP or under.
Exit 0 ready, 1 something to fix (each FIX line), 2 a wrong word. Why these numbers: packages/live-studio/RENDER.md."""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "sound"))
from listen import YOUTUBE, loudness  # noqa: E402

USAGE = "bun run deliver [<video>] [--youtube [<from>-<to>]] (--help for more)"
SHORTS_LONGEST = 180
PREVIEW = {"wide": (2560, "4M"), "upright": (1080, "3M")}  # (width, AV1 bitrate)
BANDS = 5.0  # CAMBI a viewer starts to notice
ADDED = 3.0  # how much more the re-encode bands than the upload before it is the re-encode's doing


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
        while (head := f.read(8)) and len(head) == 8:
            size, kind = int.from_bytes(head[:4], "big"), head[4:8].decode("latin1")
            skip = size - 8
            if size == 1:
                skip = int.from_bytes(f.read(8), "big") - 16
            order.append(kind)
            if size == 0:
                break
            if kind == "moov":
                walk(f.read(skip), b"moov")
            else:
                f.seek(skip, 1)
    return order, edits


def key_gap(video):
    """The longest stretch between two keyframes, in seconds (reads only the keyframes)"""
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-skip_frame", "nokey", "-show_entries",
                        "frame=pts_time", "-of", "csv=p=0", str(video)], capture_output=True, text=True, timeout=600)
    keys = [float(x) for x in re.findall(r"-?\d+(?:\.\d+)?", r.stdout)]
    return max((b - a for a, b in zip(keys, keys[1:])), default=0.0)


def rate(stream):
    num, den = (stream.get("avg_frame_rate") or "0/1").split("/")
    return float(num) / float(den) if float(den) else 0.0


def check(video, info):
    """(summary line, [(FIX|ADVICE, words)]) for one video against the upload spec"""
    out = []
    fix = lambda words: out.append(("FIX", words))  # noqa: E731
    advise = lambda words: out.append(("ADVICE", words))  # noqa: E731
    remux = f"ffmpeg -i {video} -c copy -movflags +faststart -use_editlist 0 <out>.mp4 (lossless)"
    pic = next((s for s in info["streams"] if s["codec_type"] == "video"), None)
    snd = next((s for s in info["streams"] if s["codec_type"] == "audio"), None)
    if not pic:
        return f"{video}: no picture", [("FIX", "no video stream: bun run render final makes the picture")]
    order, edits = boxes(video)
    late = "moov" in order and "mdat" in order and order.index("moov") > order.index("mdat")
    box = [*(["the moov atom sits after the media (YouTube asks it up front, Fast Start)"] if late else []),
           *(["it has an edit list (YouTube asks none: the picture can shift against the sound)"] if edits else [])]
    if box:
        fix(f"{' and '.join(box)}: {remux}")
    w, h, fps = pic["width"], pic["height"], rate(pic)
    name = {"h264": "H.264"}.get(pic["codec_name"], pic["codec_name"])
    if pic["codec_name"] != "h264" or pic.get("profile") != "High":
        advise(f"{name} {pic.get('profile', '')}: YouTube asks H.264 High; bun run render final writes it")
    if pic.get("pix_fmt") != "yuv420p":
        advise(f"{pic.get('pix_fmt')}: YouTube asks 8-bit 4:2:0 (yuv420p) for SDR")
    tags = {pic.get(k, "unknown") for k in ("color_primaries", "color_transfer", "color_space")}
    if tags != {"bt709"} or pic.get("color_range") not in (None, "tv"):
        advise(f"colour tagged {'/'.join(sorted(tags))}{' ' + pic['color_range'] if 'color_range' in pic else ''}: YouTube asks BT.709 limited range, "
               f"else it guesses. ffmpeg -i {video} -c copy -bsf:v h264_metadata=colour_primaries=1:transfer_characteristics=1:"
               "matrix_coefficients=1:video_full_range_flag=0 <out>.mp4")
    if pic.get("r_frame_rate") != pic.get("avg_frame_rate"):
        advise(f"variable frame rate ({pic.get('r_frame_rate')} vs {pic.get('avg_frame_rate')} on average): YouTube asks constant")
    gap = key_gap(video)
    if gap > 1.01:
        advise(f"keyframes {gap:.1f} s apart at most: YouTube asks a closed GOP of half the frame rate (0.5 s); render final keys every 0.5 s")
    if w % 2 or h % 2:
        fix(f"{w}x{h} has an odd side: 4:2:0 needs both even")
    long = float(info["format"].get("duration") or pic.get("duration") or 0)
    if h > w:
        if w < 1080 or h * 9 != w * 16:
            fix(f"{w}x{h} upright: a Short is 1080x1920 (9:16); bun run render final with package.json live-studio.ratio 9:16")
        elif w > 1080:
            advise(f"{w}x{h}: Shorts play at 1080x1920 at most; render final makes 1080x1920 for a Shorts film unless RES says more")
        if long > SHORTS_LONGEST:
            fix(f"{long:.0f} s upright: a Short is {SHORTS_LONGEST // 60} min at most, longer plays as an ordinary video")
    elif min(w, h) < 1080:
        fix(f"{w}x{h} ({min(w, h)}p) is a draft size: bun run render final (1440p; RES=2160 for 4K)")
    elif min(w, h) < 1440:
        advise(f"{min(w, h)}p: YouTube serves a 1440p or bigger upload in better codecs even to 1080p viewers; RES=1440 bun run render final")
    if not snd:
        fix("no sound: bun run mix renders/final_video.mp4 puts the soundtrack on the picture (renders/final.mp4)")
    else:
        if snd["codec_name"] != "aac":
            advise(f"{snd['codec_name']} sound: YouTube asks AAC-LC; bun run mix renders/final_video.mp4 writes it")
        if snd.get("channels") == 1:
            fix("mono sound: YouTube asks stereo (or 5.1); bun run mix renders/final_video.mp4 writes stereo")
        if int(snd.get("sample_rate", 0)) not in (48000, 96000):
            advise(f"{int(snd.get('sample_rate', 0)) / 1000:g} kHz: YouTube asks 48 or 96 kHz; bun run mix renders/final_video.mp4 writes 48")
        heard = float(snd.get("duration") or long)
        seen = float(pic.get("duration") or long)
        if abs(heard - seen) > 0.1:
            fix(f"the sound is {abs(heard - seen):.2f} s {'shorter' if heard < seen else 'longer'} than the picture: "
                "bun run mix renders/final_video.mp4 again (it cuts the mix to the picture)")
        i, lra, tp = loudness(video)
        if i < YOUTUBE - 1:
            fix(f"{i:.1f} LUFS: YouTube never turns it up, it plays {YOUTUBE - i:.1f} dB quieter than the videos around it. "
                f"audio.json lufs {YOUTUBE:g}, then bun run mix renders/final_video.mp4")
        elif i > YOUTUBE + 1:
            advise(f"{i:.1f} LUFS: YouTube turns it down {i - YOUTUBE:.1f} dB to {YOUTUBE:g}, the loudness bought with limiting is lost; "
                   f"audio.json lufs {YOUTUBE:g}")
        if tp > -1:
            fix(f"true peak {tp:+.1f} dBTP: over -1 the AAC encode clips; bun run mix keeps -1 (audio.json lufs too high?)")
    mbps = int(pic.get("bit_rate") or info["format"].get("bit_rate") or 0) / 1e6
    sound = (f", AAC {int(snd.get('sample_rate', 0)) / 1000:g} kHz {'stereo' if snd.get('channels') == 2 else str(snd.get('channels')) + ' ch'}"
             f" {int(snd.get('bit_rate') or 0) / 1000:.0f} kbps, {i:.1f} LUFS, peak {tp:+.1f} dBTP" if snd else ", no sound")
    return f"{video}: {w}x{h} {fps:g} fps {name} {pic.get('profile', '')} {mbps:.1f} Mbps{sound}, {long:.1f} s", out


def cambi(video, start, length, width, tmp, tag):
    """CAMBI per sampled frame (every 5th) of a stretch of video, scaled to `width`: {second: worst}"""
    log = f"cambi_{tag}.json"
    graph = (f"[0:v]scale={width}:-2:flags=lanczos,format=yuv420p,split[a][b];"
             f"[a][b]libvmaf=feature=name=cambi:n_subsample=5:log_fmt=json:log_path={log}")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(start), "-t", str(length), "-i", str(Path(video).resolve()),
                    "-lavfi", graph, "-f", "null", "-"], check=True, timeout=600 + length * 20, cwd=tmp)
    frames = json.loads((Path(tmp) / log).read_text(encoding="utf8"))["frames"]
    fps = rate(next(s for s in probe(video)["streams"] if s["codec_type"] == "video")) or 30
    worst = {}
    for f in frames:
        score = f["metrics"].get("cambi")
        if score is not None:
            s = int(start + f["frameNum"] / fps)
            worst[s] = max(worst.get(s, 0.0), score)
    return worst


def band_picture(video, preview, second, out, offset):
    """The upload and the re-encode side by side at one second, with a row below that exaggerates small steps of light
    (each picture minus its blur, x16) so a band shows as a contour line"""
    graph = ("[0:v]scale=960:-2,format=gray,split[a][a2];[1:v]scale=960:-2,format=gray,split[b][b2];"
             "[a2]split[x][y];[y]gblur=sigma=8[yb];[x][yb]blend=all_expr='128+(A-B)*16'[ae];"
             "[b2]split[p][q];[q]gblur=sigma=8[qb];[p][qb]blend=all_expr='128+(A-B)*16'[be];"
             "[a][b]hstack[top];[ae][be]hstack[bottom];[top][bottom]vstack")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{second + 0.5:.2f}", "-i", str(video), "-ss",
                    f"{second + 0.5 - offset:.2f}", "-i", str(preview), "-lavfi", graph, "-frames:v", "1", str(out)],
                   check=True, timeout=120)


def youtube(video, span, root):
    info = probe(video)
    pic = next(s for s in info["streams"] if s["codec_type"] == "video")
    long = float(info["format"]["duration"])
    start, end = span or (0.0, long)
    if not 0 <= start < end <= long + 0.05:
        print(f"--youtube {start:g}-{end:g} is outside the video: it is {long:.2f} s long", file=sys.stderr)
        return 2
    length = end - start
    width, bitrate = PREVIEW["wide" if pic["width"] >= pic["height"] else "upright"]
    width = min(width, pic["width"])
    out = root / "renders"
    out.mkdir(exist_ok=True)
    for old in out.glob("youtube_bands_*s.png"):
        old.unlink()
    preview = out / "youtube_preview.mp4"
    print(f"re-encoding {length:.0f} s the way YouTube serves it (AV1 {bitrate}bps, {width} wide) and measuring bands in both, "
          f"about {max(10, length * 3):.0f} s ...", file=sys.stderr)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(start), "-t", str(length), "-i", str(video), "-map", "0:v:0",
                    "-map", "0:a:0?", "-vf", f"scale={width}:-2:flags=lanczos", "-c:v", "libsvtav1", "-preset", "10", "-b:v",
                    bitrate, "-c:a", "aac", "-b:a", "128k", str(preview)], check=True, timeout=600 + length * 20,
                   env={**os.environ, "SVT_LOG": "1"})  # SVT-AV1 prints its whole config to stderr unless told errors only
    with tempfile.TemporaryDirectory(prefix="deliver-") as tmp:
        before = cambi(video, start, length, width, tmp, "upload")
        after = {int(s + start): v for s, v in cambi(preview, 0, length, width, tmp, "preview").items()}
    added = sorted(s for s, v in after.items() if v >= BANDS and v - before.get(s, 0.0) >= ADDED)
    spans = []
    for s in added:
        if spans and s - spans[-1][1] <= 1:
            spans[-1][1] = s
        else:
            spans.append([s, s])
    worst_up = max(before.values(), default=0.0)
    print(f"bands (CAMBI, worst second): upload {worst_up:.1f}, after YouTube's re-encode {max(after.values(), default=0.0):.1f}; "
          f"preview in renders/youtube_preview.mp4")
    if worst_up >= BANDS:
        print(f"  the upload itself scores {worst_up:.1f}: on Minecraft's flat tiles CAMBI also counts neighbouring tile colours as "
              "bands, so judge by what the re-encode adds below")
    cuts_file = root / "renders/cuts.json"
    cuts = json.loads(cuts_file.read_text(encoding="utf8")) if cuts_file.exists() and video.parent == out else []
    for a, b in spans[:6]:
        peak = max(range(a, b + 1), key=lambda s: after[s] - before.get(s, 0.0))
        picture = out / f"youtube_bands_{peak}s.png"
        band_picture(video, preview, peak, picture, start)
        shot = f", shot {1 + sum(c <= peak for c in cuts)} (renders/cuts.json)" if cuts else ""
        print(f"BANDS {a}-{b + 1} s{shot}: the re-encode scores {after[peak]:.1f} where the upload has {before.get(peak, 0.0):.1f}; "
              f"look: {picture.relative_to(root)} (top: upload | re-encode, bottom: the same with small steps of light x16)")
    if len(spans) > 6:
        print(f"  and {len(spans) - 6} more stretches")
    if spans:
        print("fix: smooth light (a lit floor, sky, fog, a vignette) loses its in-between levels in the re-encode. The studio's "
              "Smooth dither is too fine to survive it (on a test gradient a grain of +-3 levels was wiped out, +-8 survived this "
              "rung, nothing survived 1080p at 1 Mbps). What holds: texture in the scene itself (dust, haze with noise, textured "
              "blocks instead of a bare lit plane), or visible grain over those seconds: an Adjustment in src/timeline/adjust.json "
              "with grade.basic.particles (the studio's Particles slider). bun run at <second> names the shot; then render final, "
              "mix, and bun run deliver --youtube <from>-<to> on the same seconds until it names none")
    else:
        print("the re-encode adds no bands a viewer would notice")
    return 0


def main(args):
    if args[:1] in (["-h"], ["--help"], ["help"]):
        print(__doc__)
        return 0
    video, span, preview, i = None, None, False, 0
    while i < len(args):
        a = args[i]
        if a == "--youtube":
            preview = True
            nxt = args[i + 1] if i + 1 < len(args) else ""
            m = re.fullmatch(r"(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)", nxt)
            if m:
                span = (float(m.group(1)), float(m.group(2)))
                i += 1
            elif re.fullmatch(r"[\d.\-]+", nxt):
                print(f"--youtube takes seconds as <from>-<to>, like --youtube 9-15; got {nxt}", file=sys.stderr)
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
    video = Path(video or "renders/final.mp4")
    if not video.is_file():
        print(f"{video} does not exist: bun run render final, then bun run mix renders/final_video.mp4 makes renders/final.mp4",
              file=sys.stderr)
        return 1
    if not shutil.which("ffprobe"):
        print("no ffprobe on PATH: INSTALL.md says how to set up ffmpeg", file=sys.stderr)
        return 1
    try:
        summary, found = check(video, probe(video))
    except SystemExit as e:
        print(e.code, file=sys.stderr)
        return 1
    print(summary)
    for kind, words in found:
        print(f"{kind} {words}")
    fixes = sum(kind == "FIX" for kind, _ in found)
    if fixes:
        print(f"{fixes} to fix before upload; bun run deliver {video} again after")
    else:
        print("ready to upload" + (" (the ADVICE lines are worth a look)" if found else ""))
    if preview:
        code = youtube(video, span, root)
        if code:
            return code
    elif not fixes:
        print("next: bun run deliver --youtube shows how it looks after YouTube's re-encode and where it bands")
    return 1 if fixes else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
