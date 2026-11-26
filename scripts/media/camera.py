"""The camera in a video on CPU with OpenCV: its motion frame by frame and its whip pans (motion), or one shot's camera
solved from surveyed points of our set (solve, a matchmove: camera_solve.py has the shot file).

  bun run media camera motion reference.mp4
  bun run media camera motion reference.mp4 --from 2 --to 6
  bun run media camera solve references/ref.mp4 --shot shots/pour.json

Each frame pair: corners (Shi-Tomasi) on the earlier frame, followed into the next by pyramidal Lucas-Kanade, then one
similarity (move, zoom, turn) fitted by RANSAC, so a subject moving on its own counts less than the frame around it.
Pixels that hold still for half a second (burned-in captions, a logo) are left out: on a reference they pinned a plain
phase correlation to zero during its fastest moves.
motion.json, per frame from the one before: dx, dy in frame widths/heights (dx < 0: the picture slides left, the
camera turns right), zoom (above 1: the picture grows, the camera pushes in), turn (degrees), inliers (0..1, low on a
smeared or cut frame), or lost when too few corners follow. Whips: over 6% of the frame (or 6% zoom, or 3.4 degrees)
a frame for 2 frames or more, gaps of up to 3 frames merged; read beside a cut list, a whip around a cut is a whip
transition. Estimates, not a solved camera: no depth, a foreground filling the frame moves it.
--dry-run validates and prints the plan without decoding or writing files.
"""
import argparse
import json
import math
import os
import sys
from pathlib import Path

from camera_solve import read_shot, solve

LONG_SIDE = 360
STILL_GREY = 3.0
STILL_FRAMES = 8
WHIP = 0.06
WHIP_FRAMES = 2
WHIP_GAP = 3


def track(prev, grey, mask, grid=1):
    import cv2
    import numpy as np

    h, w = prev.shape
    ys = np.linspace(0, h, grid + 1, dtype=int)
    xs = np.linspace(0, w, grid + 1, dtype=int)
    mask = mask.astype(np.uint8) * 255
    picked = []
    for y0, y1 in zip(ys, ys[1:]):
        for x0, x1 in zip(xs, xs[1:]):
            area = np.s_[y0:y1, x0:x1]
            corners = cv2.goodFeaturesToTrack(prev[area], 400 // grid**2, 0.01, 6, mask=mask[area])
            if corners is not None:
                picked.append(corners + np.array([x0, y0], dtype=np.float32))
    if not picked:
        return None
    corners = np.concatenate(picked)
    if len(corners) < 8:
        return None
    moved, found, _ = cv2.calcOpticalFlowPyrLK(prev, grey, corners, None, winSize=(21, 21), maxLevel=4)
    kept = found.ravel() == 1
    if kept.sum() < 8:
        return None
    return corners[kept].reshape(-1, 2), moved[kept].reshape(-1, 2)


def follow(prev, grey, mask, grid=1):
    import cv2

    points = track(prev, grey, mask, grid)
    if points is None:
        return None
    src, dst = points
    matrix, inliers = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=2.0)
    if matrix is None:
        return None
    return matrix, inliers.ravel() == 1, src, dst


def measure(source, start, end):
    import cv2
    import numpy as np

    cap = cv2.VideoCapture(str(source))
    fps = cap.get(cv2.CAP_PROP_FPS)
    if not fps or not math.isfinite(fps):
        raise ValueError("no frame rate in the source")
    first = round(start * fps)
    last = None if end is None else round(end * fps)
    cap.set(cv2.CAP_PROP_POS_FRAMES, first)
    frames = []
    while last is None or first + len(frames) <= last:
        ok, image = cap.read()
        if not ok:
            break
        h, w = image.shape[:2]
        scale = LONG_SIDE / max(h, w)
        small = cv2.resize(image, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
        frames.append(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY))
    if len(frames) < 2:
        raise ValueError("fewer than 2 frames in the span")
    height, width = frames[0].shape
    rows = [{"frame": first, "t": round(first / fps, 4), "dx": 0.0, "dy": 0.0, "zoom": 1.0, "turn": 0.0, "inliers": 1.0}]
    for i in range(1, len(frames)):
        row = {"frame": first + i, "t": round((first + i) / fps, 4)}
        moving = np.stack(frames[max(0, i - STILL_FRAMES):i + STILL_FRAMES]).astype(np.float32).std(axis=0) >= STILL_GREY
        if moving.mean() < 0.02:
            rows.append({**row, "dx": 0.0, "dy": 0.0, "zoom": 1.0, "turn": 0.0, "inliers": 1.0})
            continue
        fit = follow(frames[i - 1], frames[i], moving)
        if fit is None:
            row["lost"] = True
        else:
            m, inliers, _, _ = fit
            share = float(inliers.mean())
            cx, cy = width / 2, height / 2
            row.update(
                dx=round((m[0, 0] * cx + m[0, 1] * cy + m[0, 2] - cx) / width, 5),
                dy=round((m[1, 0] * cx + m[1, 1] * cy + m[1, 2] - cy) / height, 5),
                zoom=round(float(math.hypot(m[0, 0], m[1, 0])), 4),
                turn=round(math.degrees(math.atan2(m[1, 0], m[0, 0])), 3),
                inliers=round(share, 3),
            )
        rows.append(row)
    return fps, rows


def speed(row):
    return max(abs(row["dx"]), abs(row["dy"]), abs(math.log(row["zoom"])), abs(math.radians(row["turn"])))


def whips_of(rows, fps):
    fast = [not r.get("lost") and speed(r) >= WHIP for r in rows]
    fast = [f or (rows[k].get("lost") and ((k > 0 and fast[k - 1]) or (k + 1 < len(rows) and fast[k + 1]))) for k, f in enumerate(fast)]
    spans, i = [], 0
    while i < len(rows):
        if not fast[i]:
            i += 1
            continue
        j = i
        while j < len(rows) and fast[j]:
            j += 1
        if j - i >= WHIP_FRAMES:
            if spans and i - spans[-1][1] <= WHIP_GAP:
                spans[-1][1] = j
            else:
                spans.append([i, j])
        i = j
    out = []
    for i, j in spans:
        span = [r for r in rows[i:j] if not r.get("lost")]
        dx, dy = sum(r["dx"] for r in span), sum(r["dy"] for r in span)
        zoom = math.prod(r["zoom"] for r in span) if span else 1.0
        turn = sum(r["turn"] for r in span)
        moves = {
            ("pans right" if dx < 0 else "pans left"): abs(dx),
            ("tilts down" if dy < 0 else "tilts up"): abs(dy),
            ("pushes in" if zoom > 1 else "pulls out"): abs(math.log(zoom)),
            ("rolls"): abs(math.radians(turn)),
        }
        out.append({
            "from": round(rows[i]["t"], 3),
            "to": round(rows[j - 1]["t"] + 1 / fps, 3),
            "camera": max(moves, key=moves.get),
            "lostFrames": sum(1 for r in rows[i:j] if r.get("lost")),
        })
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("action", choices=["motion", "solve"])
    parser.add_argument("source", type=Path)
    parser.add_argument("--from", dest="start", type=float, default=0.0)
    parser.add_argument("--to", dest="end", type=float)
    parser.add_argument("--shot", type=Path, help="solve: the shot file, see camera_solve.py")
    parser.add_argument("--out", type=Path, default=os.environ.get("MC_MEDIA_RUN_DIR"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    source = args.source.resolve()
    if not source.is_file():
        parser.error("source must be a local video file")
    shot = None
    if args.action == "solve":
        if args.shot is None or not args.shot.is_file():
            parser.error("solve needs --shot <shot.json>")
        try:
            shot = read_shot(args.shot)
        except (ValueError, json.JSONDecodeError) as error:
            parser.error(f"{args.shot}: {error}")
        parameters = {"shot": str(args.shot.resolve()), "name": shot["name"]}
    else:
        if not math.isfinite(args.start) or args.start < 0 or (args.end is not None and args.end <= args.start):
            parser.error("--from is a second from 0 and --to comes after it")
        parameters = {"from": args.start, "to": args.end}
    plan = {"tool": "camera", "action": args.action, "source": str(source), "requiredFiles": [], "parameters": parameters}
    if args.dry_run:
        print(json.dumps(plan))
        return 0
    if args.out is None:
        parser.error("run via bun run media or provide an empty --out")
    out = args.out.resolve()
    if out.exists() and any(p.name not in ("job.json", "process.log") for p in out.iterdir()):
        parser.error("--out must be empty; previous artifacts remain intact")
    out.mkdir(parents=True, exist_ok=True)
    try:
        if shot:
            report = solve(source, shot, out)
            result = {"status": "completed", "plan": plan, "solve": "solve.json", "sheet": "sheet.jpg",
                      "summary": report["summary"],
                      "verification": "look at sheet.jpg: cyan crosses (solved) on the yellow rings (tracked); a frame with a large err is a lost track or a wrong xyz"}
        else:
            fps, rows = measure(source, args.start, args.end)
            whips = whips_of(rows, fps)
            motion = {"fps": fps, "units": "dx, dy: frame widths/heights a frame, dx < 0 the camera turns right; zoom > 1 pushes in; turn: degrees",
                      "frames": rows, "whips": whips}
            (out / "motion.json").write_text(json.dumps(motion) + "\n", encoding="utf-8")
            result = {"status": "completed", "plan": plan, "motion": "motion.json", "whips": len(whips),
                      "verification": "estimates from tracked corners; look at the frames of a whip before matching it"}
    except (Exception, KeyboardInterrupt) as error:
        (out / "result.json").write_text(json.dumps({"status": "failed", "plan": plan, "error": str(error)}, indent=2) + "\n", encoding="utf-8")
        print(str(error), file=sys.stderr)
        return 1
    (out / "result.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(out / "result.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
