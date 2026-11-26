"""Videos' look every half second on CPU with OpenCV, for bun run reference compare: the camera's move and what
moves on its own in the frame, CIELAB brightness and warmth, and how blurred the edges of the top third are against
the centre's.

  python shot_look.py reference.mp4 remake.mp4 --out look.json

look.json: {videos: [{fps, bin, bins: [...]}, ...]} in the order given, one bin per half second, every 2nd frame read
(null when none was): t (its start), frames, pairs (frame pairs followed) of tried;
camera dx, dy (frame widths/heights over the bin; dx < 0: the picture slides left, the camera pans right), zoom
(above 1 pushes in), turn (degrees), null when under half the pairs were followed; subject dx, dy (screen travel of
corners not following the camera, dy > 0 down) and share (the mean part of the followed corners doing it), null with the
camera; light L, a, b (CIELAB means); focus centre and top (median blur sigma in pixels at 720 px on the long side at
the Canny edges of the middle ninth and of the top third, Zhuo and Sim 2011, on one frame of the bin), null when
either has under 40 edge pixels.
Per frame pair: camera.py's follow (Shi-Tomasi corners, pyramidal Lucas-Kanade, one similarity fitted by RANSAC).
When at least half the frame changes, exclude unchanged pixels such as burned-in captions. For local motion, fit
the quiet background if its corners span enough of the image. Otherwise try the changing region under the same
coverage requirement. When the quiet background anchors the fit, track moving corners separately for the subject.
For subject direction, measure screen travel of corners that move by over a pixel and differ from the fit.
Pairs across a cut (grey histograms correlating under 0.6), fitted by under half
their corners, or unchanged with no corners to follow (a black or plain frame) are not followed.
Estimates: a foreground filling the frame reads as the camera, a plain sky has no edges to read blur on.
"""
import argparse
import json
import math
import sys
from collections import deque
from pathlib import Path

from camera import LONG_SIDE, STILL_FRAMES, STILL_GREY, follow, track

BIN = 0.5
FOCUS_SIDE = 720
STEP = 2
OWN_MOTION_PX = 1.0
CUT_CORREL = 0.6
FIT_SHARE = 0.5
STILL_SHARE = 0.02
WIDE_MOTION_SHARE = 0.5
MIN_CAMERA_COVERAGE = 0.2
CAMERA_GRID = 4
REBLUR = 3.0
MIN_EDGES = 40
MAX_SIGMA = 8.0


def defocus(image):
    import cv2
    import numpy as np

    h, w = image.shape[:2]
    s = min(1.0, FOCUS_SIDE / max(h, w))
    grey = cv2.cvtColor(cv2.resize(image, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(grey, 10, 30) > 0
    level = grey.astype(np.float32)
    sharp = np.hypot(cv2.Sobel(level, cv2.CV_32F, 1, 0), cv2.Sobel(level, cv2.CV_32F, 0, 1))
    soft = cv2.GaussianBlur(level, (0, 0), REBLUR)
    blurred = np.hypot(cv2.Sobel(soft, cv2.CV_32F, 1, 0), cv2.Sobel(soft, cv2.CV_32F, 0, 1))
    ratio = sharp / np.maximum(blurred, 1e-6)
    sigma = np.full(grey.shape, np.nan, np.float32)
    usable = edges & (ratio > 1.0 + 1e-3)
    sigma[usable] = np.minimum(MAX_SIGMA, REBLUR / np.sqrt(ratio[usable] ** 2 - 1))
    gh, gw = grey.shape

    def median(region):
        values = region[np.isfinite(region)]
        return round(float(np.median(values)), 3) if values.size >= MIN_EDGES else None

    centre = median(sigma[gh // 3:2 * gh // 3, gw // 3:2 * gw // 3])
    top = median(sigma[:gh // 3])
    return None if centre is None or top is None else {"centre": centre, "top": top}


def spans_frame(points, shape):
    import numpy as np

    h, w = shape
    x, y = np.ptp(points, axis=0)
    return (x / w) * (y / h) >= MIN_CAMERA_COVERAGE


def camera_fit(prev, grey, mask):
    fit = follow(prev, grey, mask, grid=CAMERA_GRID)
    if fit is None:
        return None
    _, inliers, src, _ = fit
    return fit if inliers.mean() >= FIT_SHARE and spans_frame(src[inliers], prev.shape) else None


def motion(prev, grey, recent, acc):
    import cv2
    import numpy as np

    acc["tried"] += 1
    hists = [cv2.normalize(cv2.calcHist([g], [0], None, [32], [0, 256]), None) for g in (prev, grey)]
    if cv2.compareHist(hists[0], hists[1], cv2.HISTCMP_CORREL) < CUT_CORREL:
        return
    moving = np.stack(recent).astype(np.float32).std(axis=0) >= STILL_GREY
    change_share = moving.mean()
    background = camera_fit(prev, grey, ~moving) if change_share < WIDE_MOTION_SHARE else None
    fit = background
    if fit is None and change_share >= STILL_SHARE:
        fit = camera_fit(prev, grey, moving)
    if fit is None:
        return
    matrix, _, src, dst = fit
    h, w = prev.shape
    cx, cy = w / 2, h / 2
    acc["dx"] += (matrix[0, 0] * cx + matrix[0, 1] * cy + matrix[0, 2] - cx) / w
    acc["dy"] += (matrix[1, 0] * cx + matrix[1, 1] * cy + matrix[1, 2] - cy) / h
    acc["log_zoom"] += math.log(math.hypot(matrix[0, 0], matrix[1, 0]))
    acc["turn"] += math.degrees(math.atan2(matrix[1, 0], matrix[0, 0]))
    acc["pairs"] += 1
    tracked = len(src)
    if background is not None:
        foreground = track(prev, grey, moving) if change_share >= STILL_SHARE else None
        if foreground is None:
            return
        src, dst = foreground
        tracked += len(src)
    left = dst - (src @ matrix[:, :2].T + matrix[:, 2])
    travel = dst - src
    own = (np.hypot(left[:, 0], left[:, 1]) >= OWN_MOTION_PX) & (np.hypot(travel[:, 0], travel[:, 1]) >= OWN_MOTION_PX)
    acc["share"] += own.sum() / tracked
    if own.sum() >= 4:
        acc["sdx"] += float(travel[own, 0].mean()) / w
        acc["sdy"] += float(travel[own, 1].mean()) / h


def fresh(t):
    return {"t": t, "frames": 0, "tried": 0, "pairs": 0, "dx": 0.0, "dy": 0.0, "log_zoom": 0.0, "turn": 0.0,
            "sdx": 0.0, "sdy": 0.0, "share": 0.0, "L": 0.0, "a": 0.0, "b": 0.0, "focus": None}


def summary(acc):
    if not acc["frames"]:
        return None
    n = acc["frames"]
    followed = acc["pairs"] * 2 >= acc["tried"] > 0
    return {
        "t": acc["t"],
        "frames": n,
        "pairs": acc["pairs"],
        "tried": acc["tried"],
        "camera": {"dx": round(acc["dx"], 5), "dy": round(acc["dy"], 5), "zoom": round(math.exp(acc["log_zoom"]), 5), "turn": round(acc["turn"], 3)} if followed else None,
        "subject": {"dx": round(acc["sdx"], 5), "dy": round(acc["sdy"], 5), "share": round(acc["share"] / acc["pairs"], 4)} if followed else None,
        "light": {"L": round(acc["L"] / n, 2), "a": round(acc["a"] / n, 2), "b": round(acc["b"] / n, 2)},
        "focus": acc["focus"],
    }


def look(source):
    import cv2
    import numpy as np

    cv2.setNumThreads(1)
    cap = cv2.VideoCapture(str(source))
    fps = cap.get(cv2.CAP_PROP_FPS)
    if not fps or not math.isfinite(fps):
        raise ValueError("no frame rate in the source")
    bins, prev, index = [], None, -1
    recent = deque(maxlen=STILL_FRAMES)
    focused = set()
    while True:
        index += 1
        if index % STEP:
            if not cap.grab():
                break
            continue
        ok, image = cap.read()
        if not ok:
            break
        k = int(index / fps / BIN + 1e-9)
        while len(bins) <= k:
            bins.append(fresh(round(len(bins) * BIN, 3)))
        acc = bins[k]
        h, w = image.shape[:2]
        s = LONG_SIDE / max(h, w)
        small = cv2.resize(image, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA)
        lab = cv2.cvtColor(small.astype(np.float32) / 255, cv2.COLOR_BGR2LAB)
        acc["frames"] += 1
        acc["L"] += float(lab[..., 0].mean())
        acc["a"] += float(lab[..., 1].mean())
        acc["b"] += float(lab[..., 2].mean())
        if k not in focused:
            focused.add(k)
            acc["focus"] = defocus(image)
        grey = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        recent.append(grey)
        if prev is not None:
            motion(prev, grey, recent, acc)
        prev = grey
    if index < STEP + 1:
        raise ValueError(f"fewer than {STEP + 1} frames in the video")
    return {"fps": fps, "bin": BIN, "bins": [summary(acc) for acc in bins]}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("sources", type=Path, nargs="+")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    for source in args.sources:
        if not source.is_file():
            parser.error(f"{source} is not a local video file")
    try:
        videos = [look(source.resolve()) for source in args.sources]
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 1
    args.out.write_text(json.dumps({"videos": videos}) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
