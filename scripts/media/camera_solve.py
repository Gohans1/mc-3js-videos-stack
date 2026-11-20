"""The camera of one reference shot solved from surveyed points (a matchmove), for camera.py's solve action.

A shot file names a span of reference seconds and points of OUR set: each with xyz (world metres) and where it shows in
the reference, uv {second: [x, y]} in the video's pixels. Between keyed seconds each point is followed frame to frame by
pyramidal Lucas-Kanade (forward from one key and back from the next, blended), unless "track": false (straight lines).
Each frame's camera then comes from PnP (SQPnP, refined) with the shot's lens (fov: vertical degrees, or null to fit it
on a sample of the span), optional priors (rollPrior, aim), a Gaussian smooth, and per-key offsets. Frames with 2-3
points keep the nearest full solve's turn and solve only the position.

Shot file: {"name", "from", "to", "fov": 40 | null, "cut": true, "smooth": 2,
"points": [{"name", "xyz": [x, y, z], "uv": {"12.3": [x, y]}, "track": true, "hold": false}],
"offset": {second: [dx, dy, dz]}, "rollPrior": 400, "aim": {"axis": [0, 0, 1], "weight": 300},
"optics": {"fstop": 2, "focus": "jar0"}}
"""
import json
import math
import re
from pathlib import Path

FOV_RANGE = (14, 70)
FOV_SAMPLE_FRAMES = 40
LK = dict(winSize=(31, 31), maxLevel=4)


def read_shot(path):
    shot = json.loads(Path(path).read_text(encoding="utf-8"))
    need = [k for k in ("name", "from", "to", "points") if k not in shot]
    if need:
        raise ValueError(f"the shot file lacks {', '.join(need)}")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", str(shot["name"])):
        raise ValueError("name takes letters, digits, - and _")
    if not 0 <= float(shot["from"]) < float(shot["to"]):
        raise ValueError("from is a second from 0 and to comes after it")
    for p in shot["points"]:
        if not (p.get("name") and len(p.get("xyz", [])) == 3 and p.get("uv")):
            raise ValueError(f"point {p.get('name', '?')} needs name, xyz [x, y, z] and uv {{second: [x, y]}}")
    return shot


def read_span(source, i_from, i_to):
    import cv2

    cap = cv2.VideoCapture(str(source))
    cap.set(cv2.CAP_PROP_POS_FRAMES, i_from)
    frames = {}
    for i in range(i_from, i_to + 1):
        ok, image = cap.read()
        if not ok:
            break
        frames[i] = image
    return frames


def follow(grey, i0, i1, p):
    """p followed from frame i0 to i1 (either way) -> {i: xy}, as far as the tracker holds it"""
    import cv2
    import numpy as np

    out = {i0: np.array(p, np.float32)}
    step = 1 if i1 >= i0 else -1
    cur = np.array([[p]], np.float32)
    for i in range(i0, i1, step):
        if i not in grey or i + step not in grey:
            break
        nxt, ok, _ = cv2.calcOpticalFlowPyrLK(grey[i], grey[i + step], cur, None, **LK)
        if not ok[0][0]:
            break
        cur = nxt
        out[i + step] = nxt[0][0].copy()
    return out


def point_series(grey, point, fps, i_from, i_to):
    import numpy as np

    keys = sorted((round(float(t) * fps), np.array(v, np.float32)) for t, v in point["uv"].items())
    tracked = point.get("track", True)
    res = {keys[0][0]: keys[0][1]}
    for (ka, va), (kb, vb) in zip(keys, keys[1:]):
        fw = follow(grey, ka, kb, va) if tracked else {}
        bw = follow(grey, kb, ka, vb) if tracked else {}
        for i in range(ka, kb + 1):
            w = (i - ka) / max(1, kb - ka)
            if not tracked:
                res[i] = va * (1 - w) + vb * w
            elif i in fw and i in bw:
                res[i] = fw[i] * (1 - w) + bw[i] * w
            elif i in fw or i in bw:
                res[i] = fw.get(i, bw.get(i))
    if tracked:
        for i, v in follow(grey, keys[0][0], i_from, keys[0][1]).items():
            res.setdefault(i, v)
        for i, v in follow(grey, keys[-1][0], i_to, keys[-1][1]).items():
            res.setdefault(i, v)
    if point.get("hold"):
        for i in range(i_from, keys[0][0]):
            res.setdefault(i, keys[0][1])
        for i in range(keys[-1][0] + 1, i_to + 1):
            res.setdefault(i, keys[-1][1])
    return {i: v for i, v in res.items() if i_from <= i <= i_to}


def intrinsics(fov, width, height):
    import numpy as np

    f = (height / 2) / math.tan(math.radians(fov) / 2)
    return np.array([[f, 0, width / 2], [0, f, height / 2], [0, 0, 1]], np.float64)


def reprojection(obj, img, rv, tv, K):
    import cv2
    import numpy as np

    proj = cv2.projectPoints(obj, rv, tv, K, None)[0].reshape(-1, 2)
    return float(np.sqrt(np.mean(np.sum((proj - img) ** 2, axis=1)))), proj


def look_of(rv, tv, dist):
    """camera centre, a look point dist ahead, and roll (radians about the view axis, from a level camera)"""
    import cv2
    import numpy as np

    R, _ = cv2.Rodrigues(rv)
    C = (-R.T @ tv).ravel()
    fwd = R.T @ np.array([0, 0, 1.0])
    up = R.T @ np.array([0, -1.0, 0])
    right0 = np.cross(fwd, [0, 1.0, 0])
    right0 /= np.linalg.norm(right0)
    up0 = np.cross(right0, fwd)
    return C, C + fwd * dist, math.atan2(-float(np.dot(up, right0)), float(np.dot(up, up0)))


def rotation(yaw, pitch, roll):
    import numpy as np

    f = np.array([math.cos(pitch) * math.sin(yaw), math.sin(pitch), math.cos(pitch) * math.cos(yaw)])
    r0 = np.cross(f, [0, 1.0, 0])
    r0 /= np.linalg.norm(r0)
    u0 = np.cross(r0, f)
    up = u0 * math.cos(roll) - r0 * math.sin(roll)
    right = r0 * math.cos(roll) + u0 * math.sin(roll)
    return np.stack([right, -up, f])


def with_priors(obj, img, K, rv, tv, roll_weight, aim):
    """The pose again with roll held near level (roll_weight: px of error a radian of roll costs): points on one line
    leave the roll about it free. aim {"axis": [x, 0, z], "weight": px a radian} holds the heading near the axis: a flat
    label's corners fit a frontal and a mirrored oblique camera about as well."""
    import cv2
    import numpy as np
    from scipy.optimize import least_squares

    C, L, roll = look_of(rv, tv, 1)
    f = L - C
    yaw, pitch = math.atan2(f[0], f[2]), math.asin(max(-1, min(1, f[1])))
    aim_yaw = None
    if aim:
        aim_yaw = math.atan2(aim["axis"][0], aim["axis"][2])
        mid = obj.mean(axis=0)
        dist = float(np.linalg.norm(mid - C))
        yaw = aim_yaw
        C = mid - np.array([math.cos(pitch) * math.sin(yaw), math.sin(pitch), math.cos(pitch) * math.cos(yaw)]) * dist

    def residual(x):
        R = rotation(*x[3:6])
        uv = (K @ (R @ (obj - x[:3]).T)).T
        prior = [roll_weight * x[5]]
        if aim_yaw is not None:
            prior.append(aim["weight"] * math.remainder(x[3] - aim_yaw, 2 * math.pi))
        return np.concatenate([(uv[:, :2] / uv[:, 2:3] - img).ravel(), prior])

    x = least_squares(residual, np.array([*C, yaw, pitch, roll])).x
    R = rotation(*x[3:6])
    return cv2.Rodrigues(R)[0], (-R @ x[:3]).reshape(3, 1)


def position_only(obj, img, K, rv, tv):
    """the camera's centre from two or three points, its turn kept from the nearest full solve"""
    import cv2
    import numpy as np
    from scipy.optimize import least_squares

    R, _ = cv2.Rodrigues(rv)

    def residual(C):
        uv = (K @ (R @ (obj - C).T)).T
        return (uv[:, :2] / uv[:, 2:3] - img).ravel()

    C = least_squares(residual, (-R.T @ tv).ravel()).x
    return rv, (-R @ C).reshape(3, 1)


def solve_frames(names, xyz, series, frames, K, roll_weight=None, aim=None):
    import cv2
    import numpy as np

    out, guess = {}, None
    for i in frames:
        use = [n for n in names if i in series[n]]
        if len(use) < 4:
            continue
        obj = np.array([xyz[n] for n in use], np.float64)
        img = np.array([series[n][i] for n in use], np.float64)
        if guess is None:
            _, rv, tv = cv2.solvePnP(obj, img, K, None, flags=cv2.SOLVEPNP_SQPNP)
        else:
            rv, tv = guess[0].copy(), guess[1].copy()
        _, rv, tv = cv2.solvePnP(obj, img, K, None, rv, tv, True, cv2.SOLVEPNP_ITERATIVE)
        if roll_weight is not None or aim:
            rv, tv = with_priors(obj, img, K, rv, tv, roll_weight or 0, aim)
        err, proj = reprojection(obj, img, rv, tv, K)
        guess = (rv, tv)
        out[i] = dict(rv=rv, tv=tv, err=err, use=use, proj=proj)
    full = sorted(out)
    for i in frames:
        use = [n for n in names if i in series[n]]
        if i in out or len(use) < 2 or not full:
            continue
        near = out[min(full, key=lambda j: abs(j - i))]
        obj = np.array([xyz[n] for n in use], np.float64)
        img = np.array([series[n][i] for n in use], np.float64)
        rv, tv = position_only(obj, img, K, near["rv"], near["tv"])
        err, proj = reprojection(obj, img, rv, tv, K)
        out[i] = dict(rv=rv, tv=tv, err=err, use=use, proj=proj, positionOnly=True)
    return out


def mean_err(sol):
    return sum(s["err"] for s in sol.values()) / len(sol) if sol else float("inf")


def gaussian(rows, r):
    import numpy as np

    if r <= 0 or len(rows) < 3:
        return rows
    k = np.exp(-0.5 * (np.arange(-3 * r, 3 * r + 1) / r) ** 2)
    k /= k.sum()
    pad = np.pad(rows, ((3 * r, 3 * r), (0, 0)), mode="edge")
    return np.stack([np.convolve(pad[:, j], k, mode="valid") for j in range(rows.shape[1])], axis=1)


def solve(source, shot, out):
    import cv2
    import numpy as np

    def say(text):
        print(text, flush=True)

    cap = cv2.VideoCapture(str(source))
    fps = cap.get(cv2.CAP_PROP_FPS)
    width, height = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()
    if not fps or not math.isfinite(fps):
        raise ValueError("no frame rate in the source")
    i_from, i_to = round(float(shot["from"]) * fps), round(float(shot["to"]) * fps)
    images = read_span(source, i_from, i_to)
    if len(images) < 2:
        raise ValueError(f"fewer than 2 frames between {shot['from']} and {shot['to']} s")
    grey = {i: cv2.cvtColor(im, cv2.COLOR_BGR2GRAY) for i, im in images.items()}
    say(f"read {len(images)} frames ({width}x{height}, {fps:.3f} fps); following {len(shot['points'])} points")
    names = [p["name"] for p in shot["points"]]
    xyz = {p["name"]: np.array(p["xyz"], np.float64) for p in shot["points"]}
    series = {p["name"]: point_series(grey, p, fps, i_from, i_to) for p in shot["points"]}
    frames = sorted(images)
    fov = shot.get("fov")
    searched = fov is None
    if searched:
        # the lens that fits a sample of the span best: a coarse sweep, then a golden-section search around it
        sample = frames[:: max(1, len(frames) // FOV_SAMPLE_FRAMES)]

        def trial(f):
            return mean_err(solve_frames(names, xyz, series, sample, intrinsics(f, width, height)))

        best = min(np.arange(FOV_RANGE[0], FOV_RANGE[1] + 1, 2.0), key=trial)
        lo, hi = best - 2, best + 2
        for _ in range(16):
            a, b = lo + (hi - lo) * 0.382, lo + (hi - lo) * 0.618
            lo, hi = (lo, b) if trial(a) < trial(b) else (a, hi)
        fov = float((lo + hi) / 2)
        say(f"lens: {fov:.2f} deg vertical fits best")
    K = intrinsics(fov, width, height)
    sol = solve_frames(names, xyz, series, frames, K, shot.get("rollPrior"), shot.get("aim"))
    if not sol:
        raise ValueError("no frame shows 4 of the points: key more uv or add points")
    solved = sorted(sol)
    centre = np.mean(list(xyz.values()), axis=0)
    rows = []
    for i in solved:
        C, _, _ = look_of(sol[i]["rv"], sol[i]["tv"], 1)
        C, L, roll = look_of(sol[i]["rv"], sol[i]["tv"], float(np.linalg.norm(centre - C)))
        rows.append(np.concatenate([C, L, [roll]]))
    rows = gaussian(np.array(rows), shot.get("smooth", 0))
    if shot.get("offset"):
        keyed = sorted((float(k), np.array(v, np.float64)) for k, v in shot["offset"].items())
        for n, i in enumerate(solved):
            d = np.array([np.interp(i / fps, [k for k, _ in keyed], [v[j] for _, v in keyed]) for j in range(3)])
            rows[n, 0:6] += np.concatenate([d, d])

    def r4(v):
        return [round(float(x), 4) for x in v]

    keys, table = [], []
    for n, (i, row) in enumerate(zip(solved, rows)):
        t = round(i / fps, 4)
        key = {"t": t, "p": r4(row[:3]), "l": r4(row[3:6]), "fov": round(fov, 3)}
        if abs(row[6]) > 1e-4:
            key["roll"] = round(float(row[6]), 5)
        key.update({"wave": 0, "bob": 0, "ease": "linear", "id": f"mm-{shot['name']}-{n}"})
        if n == 0 and shot.get("cut"):
            key["cut"] = True
        if n == 0 and shot.get("optics"):
            key.update(shot["optics"])
        keys.append(key)
        row_info = {"t": t, "frame": i, "err": round(sol[i]["err"], 2), "points": len(sol[i]["use"])}
        if sol[i].get("positionOnly"):
            row_info["positionOnly"] = True
        table.append(row_info)
    worst = max(table, key=lambda r: r["err"])
    summary = {"solved": len(solved), "of": len(frames), "rmsMean": round(mean_err(sol), 2), "rmsMax": worst["err"],
               "worstAt": worst["t"], "positionOnly": sum(1 for r in table if r.get("positionOnly"))}
    # the check sheet: up to 8 frames across the span, each point as tracked (yellow ring) and as solved (cyan cross)
    pick = [solved[round(j * (len(solved) - 1) / 7)] for j in range(min(8, len(solved)))]
    tiles, scale = [], 640 / max(width, height)
    mark = max(4, round(0.008 * max(width, height)))
    for i in pick:
        im = images[i].copy()
        for name, pr in zip(sol[i]["use"], sol[i]["proj"]):
            u = series[name][i]
            cv2.circle(im, (int(u[0]), int(u[1])), mark, (0, 255, 255), max(1, mark // 4))
            cv2.drawMarker(im, (int(pr[0]), int(pr[1])), (255, 255, 0), cv2.MARKER_CROSS, mark * 2, max(1, mark // 4))
        tile = cv2.resize(im, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA)
        cv2.putText(tile, f"{i / fps:.3f}s {sol[i]['err']:.1f}px", (8, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
        tiles.append(tile)
    cv2.imwrite(str(out / "sheet.jpg"), np.hstack(tiles))
    report = {"name": shot["name"], "fps": fps, "width": width, "height": height, "fov": round(fov, 3),
              "fovSearched": searched, "units": "keys: cam.json keys at reference seconds; err: rms reprojection px",
              "summary": summary, "frames": table, "keys": keys}
    (out / "solve.json").write_text(json.dumps(report) + "\n", encoding="utf-8")
    say(f"{shot['name']}: lens {fov:.2f} deg, {summary['solved']} of {summary['of']} frames solved"
        f" ({summary['positionOnly']} from 2-3 points), rms {summary['rmsMean']} px mean,"
        f" {summary['rmsMax']} px worst at {summary['worstAt']} s")
    return report
