"""Read text from local images or sampled video frames with CPU RapidOCR.

  bun run media ocr image.png
  bun run media ocr reference.mp4 --at 0:05,0:10
  bun run media ocr reference.mp4 --from 10 --to 30 --frames 12
  bun run media ocr image.png --language vi --config config.yaml
  bun run media ocr reference.mp4 --from 0 --to 60 --frames 120 --crop 0,0.7,1,0.2

--at, --from and --to use input-file seconds, without film offsets or speed changes.
Default: 12 evenly spaced video frames; images have no timestamp. Source frames,
text boxes and model scores are retained in frames.jsonl and result.json.
Scores are model estimates, not verified correctness. No uploads or paid APIs.
First inference may download official model files; later runs use the kept cache.
--config preserves RapidOCR's native model/engine options; --language selects the
recognizer language route. Models/default routes follow RapidOCR 3.10.0.
--crop x,y,w,h (fractions of the picture) reads only that band, as a caption strip: a full 1080x1920
frame takes about 2.4 s, the band about 1 s. Text boxes stay in the whole picture's pixels.
--captions (with --crop) reads burnt-in captions: the band every 0.25 s (--frames sets how many), keeping the
caption's own line (a label on a prop or a watermark is left out); reads alike join, and each change of text is then
read down to its first frame. captions.json lists {from, to, text, score} in input-file seconds, rewritten after every
read ("complete": false and "readUntil" until the frames are read); a caption shown under 0.25 s can fall between
reads. A minute of video takes 6 to 10 minutes: pass --minutes 15.
--dry-run validates and prints the plan without loading OCR or writing files.
"""
import argparse
import difflib
import hashlib
import importlib.metadata
import json
import math
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from seconds import heard_second  # noqa: E402


def second(value):
    number = heard_second(value)
    if number is None or not math.isfinite(number):
        raise argparse.ArgumentTypeError("takes a finite file second, e.g. 1:05.250")
    return number


def crop_band(value):
    try:
        x, y, w, h = (float(v) for v in value.split(","))
    except ValueError:
        raise argparse.ArgumentTypeError("takes x,y,w,h fractions of the picture, e.g. 0,0.7,1,0.2") from None
    if not (0 <= x < 1 and 0 <= y < 1 and 0 < w <= 1 - x + 1e-9 and 0 < h <= 1 - y + 1e-9):
        raise argparse.ArgumentTypeError(f"{value} leaves the picture: x+w and y+h must stay within 1")
    return [x, y, w, h]


def crop_origin(source, crop):
    """The band's top-left in the picture as ffmpeg shows it: a rotated phone video's coded width and height swap."""
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                            "stream=width,height:stream_side_data=rotation", "-of", "json", str(source)],
                           capture_output=True, text=True, check=True, timeout=15)
    stream = json.loads(probe.stdout)["streams"][0]
    turn = next((float(d["rotation"]) for d in stream.get("side_data_list", []) if "rotation" in d), 0)
    width, height = (stream["height"], stream["width"]) if abs(turn) % 180 == 90 else (stream["width"], stream["height"])
    return [int(width * crop[0]), int(height * crop[1])]


def frame_times(start, end, count, pins, duration):
    end = duration if end is None else end
    if not 0 <= start < end <= duration:
        raise ValueError("range must be inside the input video and --to must be after --from")
    if pins:
        if any(not start <= t < end for t in pins):
            raise ValueError("--at times must be inside the source range, before its end")
        if len(set(pins)) > count:
            raise ValueError("more --at times than --frames; raise --frames")
        return sorted(set(pins))
    return [start + (end - start) * (i + 0.5) / count for i in range(count)]


def band_changes(source, crop, start, end):
    """Each frame's second (input-file seconds) and the band's mean change from the frame before (0-255), by ffmpeg."""
    band = "crop=w=trunc(iw*{2}):h=trunc(ih*{3}):x=trunc(iw*{0}):y=trunc(ih*{1})".format(*crop)
    run = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-ss", str(start), "-i", str(source), "-t", str(end - start),
                          "-vf", f"{band},scale=160:-2,format=gray,tblend=all_mode=difference,signalstats,"
                          "metadata=print:key=lavfi.signalstats.YAVG:file=-", "-f", "null", "-"],
                         capture_output=True, text=True, check=True, timeout=240)
    changes, at = [], None
    for line in run.stdout.splitlines():
        if "pts_time:" in line:
            at = round(start + float(line.split("pts_time:")[1].split()[0]), 3)
        elif "YAVG=" in line and at is not None:
            changes.append((at, float(line.split("=")[1])))
    return changes


def _height(box):
    return max(y for _, y in box["box"]) - min(y for _, y in box["box"])


def _middle(box):
    return sum(y for _, y in box["box"]) / 4


def reading_order(boxes):
    """A frame's text as read: lines top to bottom (box middles within half a box's height), each left to right."""
    lines = []
    for box in sorted(boxes, key=_middle):
        if lines and abs(_middle(box) - lines[-1][0]) < _height(box) / 2:
            lines[-1][1].append(box)
        else:
            lines.append((_middle(box), [box]))
    return [b for _, line in lines for b in sorted(line, key=lambda b: min(x for x, _ in b["box"]))]


def caption_row(reads):
    """The caption line's height and middle over the whole span: words the band shares with it (a label on a prop, a
    watermark) are shorter or sit off that line. None when nothing was read."""
    heights = sorted(_height(b) for r in reads for b in r["text"])
    if not heights:
        return None
    height = heights[len(heights) // 2]
    middles = sorted(_middle(b) for r in reads for b in r["text"] if _height(b) >= 0.6 * height)
    return height, middles[len(middles) // 2]


# A word read below this is a caption caught mid-animation (popping in, scaling): no answer, so a change of text is
# looked for over the wider gap around it
SURE = 0.8
# Neighbouring reads this alike are one caption misread by a letter; "more sugar" and "more salt" are two
ALIKE = 0.9


def _likeness(a, b):
    return 1.0 if a.lower() == b.lower() else difflib.SequenceMatcher(None, a.lower(), b.lower()).ratio()


def _alike(a, b):
    return _likeness(a, b) >= ALIKE


def captions_from(reads, changes, start, end, read=None):
    """Reads [{at, text: OCR boxes}] in time order into captions: neighbours read alike join, keeping the surer
    reading. Each change of text lands on the first frame showing the next caption, found by read(frame second) ->
    OCR boxes: the frame where the band changes most, checked with the frame before it, else halving the gap. Without
    read, the frame of most change stands (a background brightening under the band can win it)."""
    row = caption_row(reads)

    def caption(boxes):
        kept = [b for b in boxes if row and _height(b) >= 0.6 * row[0] and abs(_middle(b) - row[1]) <= 0.3 * row[0]]
        if any(b["score"] < SURE for b in kept):
            return None, 0
        kept = reading_order(kept)
        return " ".join(" ".join(b["text"] for b in kept).split()), round(min((b["score"] for b in kept), default=0), 3)

    runs = []
    for r in reads:
        text, score = caption(r["text"])
        if text is None:
            continue
        last = runs[-1] if runs else None
        if last and _alike(last["text"], text):
            last["last"] = r["at"]
            if score > last["score"]:
                last.update(text=text, score=score)
        else:
            runs.append({"first": r["at"], "last": r["at"], "text": text, "score": score})

    def change_of_text(before, after):
        between = [(t, d) for t, d in changes if before["last"] < t < after["first"]]
        if not between:
            return round((before["last"] + after["first"]) / 2, 3)
        top = max(range(len(between)), key=lambda i: between[i][1])
        if read is None:
            return between[top][0]
        frames = [t for t, _ in between]

        # nearer the caption before than the one after: a frame misread by a letter or two still counts
        def shows_before(i):
            text, _ = caption(read(frames[i]))
            return text is not None and _likeness(text, before["text"]) > _likeness(text, after["text"])

        if not shows_before(top) and (top == 0 or shows_before(top - 1)):
            return frames[top]
        lo, hi = -1, len(frames)
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if shows_before(mid):
                lo = mid
            else:
                hi = mid
        return frames[hi] if hi < len(frames) else after["first"]

    edges = [start, *(change_of_text(a, b) for a, b in zip(runs, runs[1:])), end]
    return [{"from": edges[i], "to": edges[i + 1], "text": r["text"], "score": r["score"]}
            for i, r in enumerate(runs) if r["text"]]


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", type=Path)
    parser.add_argument("--at", default="")
    parser.add_argument("--from", dest="start", type=second, default=0.0)
    parser.add_argument("--to", dest="end", type=second)
    parser.add_argument("--frames", type=int)
    parser.add_argument("--captions", action="store_true")
    parser.add_argument("--score", type=float)
    parser.add_argument("--language")
    parser.add_argument("--config", type=Path)
    parser.add_argument("--crop", type=crop_band)
    parser.add_argument("--out", type=Path, default=os.environ.get("MC_MEDIA_RUN_DIR"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    source = args.source.resolve()
    if not source.is_file():
        parser.error(f"not a local file: {source}")
    if args.captions and (args.at or not args.crop):
        parser.error("--captions reads a --crop band (the caption strip) over a span, not --at seconds")
    args.frames_given = args.frames
    if args.frames is None:
        args.frames = 12
    if args.frames < 1:
        parser.error("--frames must be at least 1")
    if args.score is not None and (not math.isfinite(args.score) or not 0 <= args.score <= 1):
        parser.error("--score must be between 0 and 1")
    if args.config and not args.config.is_file():
        parser.error("--config must be a local RapidOCR YAML file")
    image = source.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff")
    try:
        pins = [second(value) for value in args.at.split(",")] if args.at else []
        if image:
            if pins or args.start or args.end is not None or args.captions:
                parser.error("images do not take video times")
            times = [None]
        else:
            probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                    "-of", "json", str(source)], capture_output=True, text=True, check=True, timeout=15)
            duration = float(json.loads(probe.stdout)["format"]["duration"])
            if not math.isfinite(duration):
                raise ValueError("video duration is not finite")
            end = duration if args.end is None else args.end
            if args.captions and args.frames_given is None:
                args.frames = max(1, math.ceil((end - args.start) * 4))
            times = [round(t, 3) for t in frame_times(args.start, args.end, args.frames, pins, duration)]
    except (argparse.ArgumentTypeError, OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        parser.error(str(error))
    plan = {"source": str(source), "clock": "input-file seconds; images have null time", "times": times,
            "language": args.language, "config": str(args.config.resolve()) if args.config else None,
            "scoreThreshold": args.score, "crop": args.crop}
    if args.dry_run:
        print(json.dumps(plan, ensure_ascii=False))
        return 0
    if args.out is None:
        parser.error("--out is required outside bun run media")
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    frames = out / "frames"
    frames.mkdir(exist_ok=True)
    result = {"schemaVersion": 1, "status": "partial", "plan": plan, "frames": []}

    def save():
        pending = out / "result.json.tmp"
        pending.write_text(json.dumps(result, indent=2, ensure_ascii=False, default=str) + "\n", encoding="utf-8")
        pending.replace(out / "result.json")

    save()
    try:
        from rapidocr import RapidOCR
        from omegaconf import OmegaConf
        params = {} if args.config else {"EngineConfig.onnxruntime.intra_op_num_threads": 2,
                                        "EngineConfig.onnxruntime.inter_op_num_threads": 2}
        if args.score is not None:
            params["Global.text_score"] = args.score
        if not args.config and os.environ.get("MC_MEDIA_MODELS_DIR"):
            params["Global.model_root_dir"] = os.environ["MC_MEDIA_MODELS_DIR"]
        if args.language:
            params["Rec.lang_type"] = args.language
        engine = RapidOCR(config_path=str(args.config) if args.config else None, params=params)
        result["backend"] = {"name": "RapidOCR", "version": importlib.metadata.version("rapidocr"),
                             "onnxruntime": importlib.metadata.version("onnxruntime"), "params": params}
        with source.open("rb") as stream:
            result["sourceSha256"] = hashlib.file_digest(stream, "sha256").hexdigest()
        save()
        changes = band_changes(source, args.crop, args.start, end) if args.captions else None

        def write_captions(complete, read=None):
            """After every read, so a run stopped by its deadline keeps the captions read so far; the last pass reads
            more frames to put each change of text on its frame."""
            reads = [{"at": row["sourceSecond"], "text": row["text"]} for row in result["frames"]]
            until = end if complete else reads[-1]["at"]
            captions = captions_from(reads, changes, args.start, until, read)
            pending = out / "captions.json.tmp"
            pending.write_text(json.dumps({"source": str(source), "clock": "input-file seconds", "crop": args.crop,
                                           "complete": complete, "readUntil": until, "captions": captions},
                                          indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            pending.replace(out / "captions.json")
            return captions

        origin = None
        band = (["-vf", "crop=w=trunc(iw*{2}):h=trunc(ih*{3}):x=trunc(iw*{0}):y=trunc(ih*{1})".format(*args.crop)]
                if args.crop else [])
        evidence = (out / "frames.jsonl").open("a", encoding="utf-8")

        def read_frame(index, at, seek):
            nonlocal origin
            file = frames / f"frame-{index:04d}{source.suffix.lower() if image else '.png'}"
            if image and not band:
                shutil.copyfile(source, file)
            else:
                subprocess.run(["ffmpeg", "-v", "error", "-nostdin", *([] if image else ["-ss", str(seek)]), "-i", str(source),
                                *band, "-frames:v", "1", "-update", "1", file.name], cwd=frames, check=True, timeout=30)
            if band and origin is None:
                origin = crop_origin(source, args.crop)
            started = time.monotonic()
            read = engine(str(file))
            result["backend"]["config"] = OmegaConf.to_container(engine.cfg, resolve=True, enum_to_str=True)
            dx, dy = origin or (0, 0)
            text = [{"text": txt, "score": float(score), "box": [[x + dx, y + dy] for x, y in box.tolist()]}
                    for txt, score, box in zip(read.txts or (), read.scores or (), read.boxes if read.boxes is not None else ())]
            row = {"sourceSecond": at, "frame": file.relative_to(out).as_posix(), "text": text,
                   "secondsElapsed": round(time.monotonic() - started, 4)}
            evidence.write(json.dumps(row, ensure_ascii=False) + "\n")
            evidence.flush()
            return row

        with evidence:
            for index, at in enumerate(times):
                row = read_frame(index, at, at)
                result["frames"].append(row)
                save()
                if args.captions:
                    write_captions(False)
                print(f"frame {index + 1}/{len(times)}: {len(row['text'])} text regions", flush=True)
            if args.captions:
                extra = {}

                def read_change(at):
                    # a frame second from band_changes, rounded to the ms: seeking just before it decodes that frame
                    if at not in extra:
                        extra[at] = read_frame(len(times) + len(extra), at, max(0.0, at - 0.002))["text"]
                    return extra[at]

                captions = write_captions(True, read_change)
                result["changeReads"] = len(extra)
        if args.captions:
            for c in captions:
                print(f'{c["from"]:.3f}-{c["to"]:.3f} {c["text"]}')
            print(out / "captions.json")
        result["status"] = "completed"
        model_root = Path(engine.cfg.Global.model_root_dir)
        result["backend"]["cachedModelSha256"] = {}
        for model in model_root.glob("*.onnx"):
            with model.open("rb") as stream:
                result["backend"]["cachedModelSha256"][model.name] = hashlib.file_digest(stream, "sha256").hexdigest()
    except (Exception, KeyboardInterrupt) as error:
        result.update(status="interrupted" if isinstance(error, KeyboardInterrupt) else "failed", error=str(error))
        print(str(error), file=sys.stderr)
    save()
    print(out / "result.json")
    return 0 if result["status"] == "completed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
