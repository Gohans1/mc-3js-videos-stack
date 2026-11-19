"""3D spatial audio math, camera/placed interpolation, and time-varying DSP."""

from __future__ import annotations

import math
from typing import TYPE_CHECKING, Any, Callable, Mapping, Sequence

if TYPE_CHECKING:
    import numpy as np

SPATIAL_DEFAULTS = {
    "refDistance": 2.0,
    "maxDistance": 40.0,
    "rolloff": 1.0,
    "occlusion": 0.0,
    "airAbsorption": True,
}

SQRT1_2 = 1.0 / math.sqrt(2.0)


def _clamp(x: float, lo: float, hi: float) -> float:
    return hi if x > hi else (lo if x < lo else x)


def _sub(a: Sequence[float], b: Sequence[float]) -> tuple[float, float, float]:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _add(a: Sequence[float], b: Sequence[float]) -> tuple[float, float, float]:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def _scale(a: Sequence[float], k: float) -> tuple[float, float, float]:
    return (a[0] * k, a[1] * k, a[2] * k)


def _dot(a: Sequence[float], b: Sequence[float]) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a: Sequence[float], b: Sequence[float]) -> tuple[float, float, float]:
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def _len(a: Sequence[float]) -> float:
    return math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])


def _norm(
    a: Sequence[float], fallback: tuple[float, float, float]
) -> tuple[float, float, float]:
    m = _len(a)
    return (a[0] / m, a[1] / m, a[2] / m) if m > 1e-9 else fallback


def is_spatial_active(spec: Mapping | None) -> bool:
    if not spec:
        return False
    if spec.get("at") is not None:
        return True
    target = spec.get("target")
    return isinstance(target, str) and len(target) > 0


def _cubic_bezier(x1: float, y1: float, x2: float, y2: float, t: float) -> float:
    if t <= 0.0:
        return 0.0
    if t >= 1.0:
        return 1.0

    def sample_x(u: float) -> float:
        inv = 1.0 - u
        return 3.0 * inv * inv * u * x1 + 3.0 * inv * u * u * x2 + u * u * u

    def sample_dx(u: float) -> float:
        inv = 1.0 - u
        return (
            3.0 * inv * inv * x1
            + 6.0 * inv * u * (x2 - x1)
            + 3.0 * u * u * (1.0 - x2)
        )

    def sample_y(u: float) -> float:
        inv = 1.0 - u
        return 3.0 * inv * inv * u * y1 + 3.0 * inv * u * u * y2 + u * u * u

    lo, hi, u = 0.0, 1.0, t
    for _ in range(8):
        err = sample_x(u) - t
        if abs(err) < 1e-7:
            return sample_y(u)
        dx = sample_dx(u)
        if abs(dx) < 1e-7:
            break
        nxt = u - err / dx
        if nxt < lo or nxt > hi:
            break
        u = nxt
    for _ in range(20):
        x = sample_x(u)
        if abs(x - t) < 1e-7:
            break
        if x < t:
            lo = u
        else:
            hi = u
        u = 0.5 * (lo + hi)
    return sample_y(u)


def _exp_out(k: float) -> Callable[[float], float]:
    d = 1.0 - math.exp(-k)
    return lambda t: 0.0 if t <= 0.0 else (1.0 if t >= 1.0 else (1.0 - math.exp(-k * t)) / d)


def _exp_in(k: float) -> Callable[[float], float]:
    d = math.exp(k) - 1.0
    return lambda t: 0.0 if t <= 0.0 else (1.0 if t >= 1.0 else (math.exp(k * t) - 1.0) / d)


def _exp_in_out(k: float) -> Callable[[float], float]:
    half = 1.0 - math.exp(-k * 0.5)
    return lambda t: (
        0.0
        if t <= 0.0
        else (
            1.0
            if t >= 1.0
            else (
                (0.5 * (1.0 - math.exp(-k * t))) / half
                if t < 0.5
                else 1.0 - (0.5 * (1.0 - math.exp(-k * (1.0 - t)))) / half
            )
        )
    )


def _monotone(ys: Sequence[float]) -> Callable[[float], float]:
    n = len(ys) - 1
    d = [(ys[i + 1] - ys[i]) * n for i in range(n)]
    m = [d[0] if i == 0 else (d[n - 1] if i == n else 0.5 * (d[i - 1] + d[i])) for i in range(n + 1)]
    for i in range(n):
        if abs(d[i]) < 1e-12:
            m[i] = 0.0
            m[i + 1] = 0.0
            continue
        a = m[i] / d[i]
        b = m[i + 1] / d[i]
        s = a * a + b * b
        if s > 9.0:
            k = 3.0 / math.sqrt(s)
            m[i] = k * a * d[i]
            m[i + 1] = k * b * d[i]

    def fn(t: float) -> float:
        if t <= 0.0:
            return ys[0]
        if t >= 1.0:
            return ys[n]
        x = t * n
        i = min(n - 1, math.floor(x))
        u = x - i
        h = 1.0 / n
        u2 = u * u
        u3 = u2 * u
        return (
            (2.0 * u3 - 3.0 * u2 + 1.0) * ys[i]
            + (u3 - 2.0 * u2 + u) * h * m[i]
            + (-2.0 * u3 + 3.0 * u2) * ys[i + 1]
            + (u3 - u2) * h * m[i + 1]
        )

    return fn


_NAMED_EASES: dict[str, Callable[[float], float]] = {
    "smooth": lambda x: x * x * (3.0 - 2.0 * x) * 0.6 + x * 0.4,
    "linear": lambda x: x,
    "out": lambda x: 1.0 - pow(1.0 - x, 2.2),
    "in": lambda x: pow(x, 2.2),
    "inout": lambda x: 0.5 - 0.5 * math.cos(math.pi * x),
    "expo": lambda x: (pow(2.0, 7.0 * x) - 1.0) / 127.0,
    "snapOut": lambda x: _cubic_bezier(0.137, 0.758, 0.128, 0.926, x),
    "glideOut": lambda x: _cubic_bezier(0.172, 0.687, 0.393, 0.943, x),
    "settleOut": lambda x: _cubic_bezier(0.202, 0.579, 0.484, 0.887, x),
    "softOut": _exp_out(1.271),
    "liftOut": lambda x: _cubic_bezier(0.399, 0.329, 0.148, 0.966, x),
    "jump": _exp_out(12.0),
    "xpArrive": _exp_out(7.0),
    "stdInOut": _monotone([0, 0.04, 0.127, 0.316, 0.55, 0.756, 0.871, 0.924, 0.962, 0.986, 1]),
    "strongInOut": lambda x: _cubic_bezier(0.673, 0.077, 0.288, 0.943, x),
    "whipBuild": _monotone([0, 0.017, 0.041, 0.083, 0.143, 0.279, 0.522, 0.757, 0.902, 0.976, 1]),
    "anticipate": lambda x: _cubic_bezier(0.56, -0.303, 0.132, 0.795, x),
    "xpTravel": _exp_in_out(7.0),
    "softIn": lambda x: _cubic_bezier(0.571, 0.245, 0.76, 0.612, x),
    "buildIn": lambda x: _cubic_bezier(0.525, 0.079, 0.724, 0.331, x),
    "launchIn": lambda x: _cubic_bezier(0.556, 0.053, 0.835, 0.188, x),
    "xpLeave": _exp_in(6.0),
}


def eval_ease(ease: Any, t: float) -> float:
    t = _clamp(float(t), 0.0, 1.0)
    if isinstance(ease, (list, tuple)) and len(ease) == 4:
        return _cubic_bezier(float(ease[0]), float(ease[1]), float(ease[2]), float(ease[3]), t)
    if isinstance(ease, str) and ease in _NAMED_EASES:
        return _NAMED_EASES[ease](t)
    return _NAMED_EASES["smooth"](t)


def eval_smoothstep_ease(ease: Any, t: float) -> float:
    t = _clamp(float(t), 0.0, 1.0)
    if ease is None:
        return t * t * (3.0 - 2.0 * t)
    return eval_ease(ease, t)


def _catmull_centripetal(
    p0: Sequence[float],
    p1: Sequence[float],
    p2: Sequence[float],
    p3: Sequence[float],
    u: float,
) -> tuple[float, float, float]:
    """Exact match to THREE.CatmullRomCurve3(..., false, 'centripetal') CubicPoly."""

    def sq_pow(a: Sequence[float], b: Sequence[float]) -> float:
        d2 = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
        return max(1e-4, pow(d2, 0.25))

    dt0 = sq_pow(p0, p1)
    dt1 = sq_pow(p1, p2)
    dt2 = sq_pow(p2, p3)

    u2 = u * u
    u3 = u2 * u
    out = []
    for axis in range(3):
        x0, x1, x2, x3 = p0[axis], p1[axis], p2[axis], p3[axis]
        t1 = ((x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1) * dt1
        t2 = ((x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2) * dt1
        c0 = x1
        c1 = t1
        c2 = -3.0 * x1 + 3.0 * x2 - 2.0 * t1 - t2
        c3 = 2.0 * x1 - 2.0 * x2 + t1 + t2
        out.append(c0 + c1 * u + c2 * u2 + c3 * u3)
    return (out[0], out[1], out[2])


def _extract_vec3(val: Any, placed_data: Any, t: float) -> tuple[float, float, float]:
    if isinstance(val, (list, tuple)) and len(val) >= 3:
        return (float(val[0]), float(val[1]), float(val[2]))
    if isinstance(val, Mapping):
        for k in ("eye", "at", "p", "pos"):
            inner = val.get(k)
            if isinstance(inner, (list, tuple)) and len(inner) >= 3:
                return (float(inner[0]), float(inner[1]), float(inner[2]))
        target = val.get("target") or val.get("object")
        if isinstance(target, str) and placed_data is not None:
            pos = placed_at(placed_data, target, t)
            off = val.get("off") or val.get("offset")
            if isinstance(off, (list, tuple)) and len(off) >= 3:
                return _add(pos, (float(off[0]), float(off[1]), float(off[2])))
            return pos
    return (0.0, 0.0, 0.0)


def camera_at(keys: Sequence[Mapping], t: float, placed_data: Any = None) -> dict:
    if not keys:
        return {"p": (0.0, 1.6, 5.0), "l": (0.0, 1.6, 0.0), "roll": 0.0}
    ordered = sorted(keys, key=lambda k: float(k.get("t", 0.0)))
    if len(ordered) == 1 or t <= float(ordered[0].get("t", 0.0)):
        k0 = ordered[0]
        t0 = float(k0.get("t", 0.0))
        return {
            "p": _extract_vec3(k0.get("p"), placed_data, t0),
            "l": _extract_vec3(k0.get("l"), placed_data, t0),
            "roll": float(k0.get("roll", 0.0) or 0.0),
        }
    if t >= float(ordered[-1].get("t", 0.0)):
        kn = ordered[-1]
        tn = float(kn.get("t", 0.0))
        return {
            "p": _extract_vec3(kn.get("p"), placed_data, tn),
            "l": _extract_vec3(kn.get("l"), placed_data, tn),
            "roll": float(kn.get("roll", 0.0) or 0.0),
        }

    # Group continuous cut segments matching camera.ts conventions.
    segments: list[list[Mapping]] = [[]]
    for idx, k in enumerate(ordered):
        if idx > 0 and k.get("cut"):
            segments.append([k])
        else:
            segments[-1].append(k)

    seg = segments[-1]
    for si, s in enumerate(segments):
        next_start = float(segments[si + 1][0].get("t", 0.0)) if si + 1 < len(segments) else float("inf")
        if t < next_start:
            seg = s
            break

    if len(seg) == 1 or t <= float(seg[0].get("t", 0.0)):
        k0 = seg[0]
        return {
            "p": _extract_vec3(k0.get("p"), placed_data, t),
            "l": _extract_vec3(k0.get("l"), placed_data, t),
            "roll": float(k0.get("roll", 0.0) or 0.0),
        }
    if t >= float(seg[-1].get("t", 0.0)):
        kn = seg[-1]
        return {
            "p": _extract_vec3(kn.get("p"), placed_data, t),
            "l": _extract_vec3(kn.get("l"), placed_data, t),
            "roll": float(kn.get("roll", 0.0) or 0.0),
        }

    i = 0
    for idx in range(len(seg) - 1):
        if float(seg[idx + 1].get("t", 0.0)) > t:
            i = idx
            break
    k1 = seg[i]
    k2 = seg[i + 1]
    t1 = float(k1.get("t", 0.0))
    t2 = float(k2.get("t", 0.0))
    span = t2 - t1
    u_raw = 0.0 if span <= 1e-9 else (t - t1) / span
    u = eval_ease(k2.get("ease"), u_raw)

    p1 = _extract_vec3(k1.get("p"), placed_data, t1)
    p2 = _extract_vec3(k2.get("p"), placed_data, t2)
    l1 = _extract_vec3(k1.get("l"), placed_data, t1)
    l2 = _extract_vec3(k2.get("l"), placed_data, t2)

    p0 = (
        _extract_vec3(seg[i - 1].get("p"), placed_data, float(seg[i - 1].get("t", 0.0)))
        if i > 0
        else _sub(_scale(p1, 2.0), p2)
    )
    p3 = (
        _extract_vec3(seg[i + 2].get("p"), placed_data, float(seg[i + 2].get("t", 0.0)))
        if i + 2 < len(seg)
        else _sub(_scale(p2, 2.0), p1)
    )
    l0 = (
        _extract_vec3(seg[i - 1].get("l"), placed_data, float(seg[i - 1].get("t", 0.0)))
        if i > 0
        else _sub(_scale(l1, 2.0), l2)
    )
    l3 = (
        _extract_vec3(seg[i + 2].get("l"), placed_data, float(seg[i + 2].get("t", 0.0)))
        if i + 2 < len(seg)
        else _sub(_scale(l2, 2.0), l1)
    )
    pos = _catmull_centripetal(p0, p1, p2, p3, u)
    look = _catmull_centripetal(l0, l1, l2, l3, u)

    u_roll = eval_smoothstep_ease(k2.get("ease"), u_raw)
    r1 = float(k1.get("roll", 0.0) or 0.0)
    r2 = float(k2.get("roll", 0.0) or 0.0)
    return {"p": pos, "l": look, "roll": r1 + (r2 - r1) * u_roll}


def placed_at(
    placed_data: Any, target: str, t: float,
    fallback: tuple[float, float, float] | None = (0.0, 0.0, 0.0),
) -> tuple[float, float, float] | None:
    if not placed_data or not target:
        return fallback
    entry = None
    if isinstance(placed_data, Mapping):
        if target in placed_data:
            entry = placed_data[target]
        elif isinstance(placed_data.get("objects"), Mapping) and target in placed_data["objects"]:
            entry = placed_data["objects"][target]
    if entry is None:
        return fallback

    if isinstance(entry, (list, tuple)):
        if len(entry) == 3 and all(isinstance(v, (int, float)) for v in entry):
            return (float(entry[0]), float(entry[1]), float(entry[2]))
        keys = entry
    elif isinstance(entry, Mapping):
        if "keys" in entry and isinstance(entry["keys"], list):
            keys = entry["keys"]
        else:
            for k in ("at", "p", "pos"):
                v = entry.get(k)
                if isinstance(v, (list, tuple)) and len(v) >= 3:
                    return (float(v[0]), float(v[1]), float(v[2]))
            return fallback
    else:
        return fallback

    if not keys:
        return fallback
    ordered = sorted(keys, key=lambda k: float(k.get("t", 0.0)))

    def key_vec(k: Mapping) -> tuple[float, float, float]:
        for field in ("at", "p", "pos"):
            v = k.get(field)
            if isinstance(v, (list, tuple)) and len(v) >= 3:
                return (float(v[0]), float(v[1]), float(v[2]))
        return (0.0, 0.0, 0.0)

    idx = 0
    while idx < len(ordered) - 1 and t >= float(ordered[idx + 1].get("t", 0.0)):
        idx += 1
    k0 = ordered[idx]
    k1 = ordered[min(idx + 1, len(ordered) - 1)]
    t0 = float(k0.get("t", 0.0))
    t1 = float(k1.get("t", 0.0))
    if k1 is k0 or t <= t0:
        x = 0.0
    elif t >= t1:
        x = 1.0
    else:
        span = t1 - t0
        x = 0.0 if span <= 1e-9 else (t - t0) / span
    u = eval_smoothstep_ease(k1.get("ease"), x)
    v0 = key_vec(k0)
    v1 = key_vec(k1)
    return _add(v0, _scale(_sub(v1, v0), u))


def resolve_source_position(
    spec: Mapping, t: float, placed_data: Any = None,
    scene_position: Sequence[float] | None = None,
) -> tuple[float, float, float]:
    target, at = spec.get("target"), spec.get("at")
    base = placed_at(placed_data, target, t, None) if target else None
    position = base if base is not None else scene_position if scene_position is not None else at
    origin = (0.0, 0.0, 0.0)
    base = (float(position[0]), float(position[1]), float(position[2])) if position is not None else origin
    off = spec.get("offset")
    if isinstance(off, (list, tuple)) and len(off) >= 3:
        return _add(base, (float(off[0]), float(off[1]), float(off[2])))
    return base


def compute_spatial_params(
    cam: Mapping, source: Sequence[float], spec: Mapping
) -> dict[str, float]:
    ref_val = spec.get("refDistance")
    ref_dist = max(0.01, float(SPATIAL_DEFAULTS["refDistance"] if ref_val is None else ref_val))
    max_val = spec.get("maxDistance")
    max_dist = max(ref_dist, float(SPATIAL_DEFAULTS["maxDistance"] if max_val is None else max_val))
    rolloff_val = spec.get("rolloff")
    rolloff = max(0.0, float(SPATIAL_DEFAULTS["rolloff"] if rolloff_val is None else rolloff_val))
    occ_val = spec.get("occlusion")
    occlusion = _clamp(
        float(SPATIAL_DEFAULTS["occlusion"] if occ_val is None else occ_val), 0.0, 1.0
    )
    air_val = spec.get("airAbsorption")
    air_absorption = SPATIAL_DEFAULTS["airAbsorption"] if air_val is None else bool(air_val)

    cam_p = cam["p"]
    cam_l = cam["l"]
    cam_up_opt = cam.get("up")
    fwd = _norm(_sub(cam_l, cam_p), (0.0, 0.0, -1.0))
    world_up = _norm(cam_up_opt, (0.0, 1.0, 0.0)) if cam_up_opt else (0.0, 1.0, 0.0)
    raw_right = _cross(fwd, world_up)
    if _len(raw_right) > 1e-6:
        right_base = _norm(raw_right, (1.0, 0.0, 0.0))
    elif abs(fwd[1]) > 0.9:
        right_base = (1.0, 0.0, 0.0)
    else:
        right_base = _norm(_cross(fwd, (0.0, 1.0, 0.0)), (1.0, 0.0, 0.0))
    cam_up = _norm(_cross(right_base, fwd), (0.0, 1.0, 0.0))

    roll_rad = float(cam.get("roll", 0.0) or 0.0)
    if roll_rad != 0.0:
        eff_right = _norm(
            _add(_scale(right_base, math.cos(roll_rad)), _scale(cam_up, math.sin(roll_rad))),
            right_base,
        )
    else:
        eff_right = right_base

    rel = _sub(source, cam_p)
    distance = _len(rel)
    occ_gain = 1.0 - 0.55 * occlusion
    occ_cutoff = 20000.0 * pow(380.0 / 20000.0, occlusion)

    if distance < 1e-6:
        return {
            "pan": 0.0,
            "gain": _clamp(occ_gain, 0.0, 1.0),
            "cutoffHz": _clamp(occ_cutoff, 250.0, 20000.0),
            "distance": 0.0,
            "frontDot": 1.0,
        }

    dir_vec = (rel[0] / distance, rel[1] / distance, rel[2] / distance)
    pan = _clamp(_dot(dir_vec, eff_right), -1.0, 1.0)
    front_dot = _clamp(_dot(dir_vec, fwd), -1.0, 1.0)

    clamped_dist = _clamp(distance, ref_dist, max_dist)
    denom = ref_dist + rolloff * (clamped_dist - ref_dist)
    dist_gain = ref_dist / denom if denom > 0.0 else 1.0
    gain = _clamp(dist_gain * occ_gain, 0.0, 1.0)

    air_cutoff = 20000.0
    behind_cutoff = 20000.0
    if air_absorption:
        excess_dist = max(0.0, distance - ref_dist)
        air_cutoff = max(1200.0, 20000.0 * math.exp(-0.045 * excess_dist))
        if front_dot < 0.0:
            behind_cutoff = 20000.0 * pow(5500.0 / 20000.0, -front_dot)

    cutoff_hz = _clamp(min(air_cutoff, behind_cutoff, occ_cutoff), 250.0, 20000.0)
    return {
        "pan": pan,
        "gain": gain,
        "cutoffHz": cutoff_hz,
        "distance": distance,
        "frontDot": front_dot,
    }


def _rbj_lowpass(cutoff_hz: float, sample_rate: int) -> tuple[np.ndarray, np.ndarray]:
    import numpy as np

    fc = min(float(cutoff_hz), 0.48 * sample_rate)
    w0 = 2.0 * math.pi * fc / sample_rate
    cos_w0 = math.cos(w0)
    alpha = math.sin(w0) * SQRT1_2
    a0 = 1.0 + alpha
    b0 = (1.0 - cos_w0) * 0.5
    b = np.array([b0 / a0, (1.0 - cos_w0) / a0, b0 / a0], dtype=np.float64)
    a = np.array([1.0, (-2.0 * cos_w0) / a0, (1.0 - alpha) / a0], dtype=np.float64)
    return b, a


def apply_spatial_audio(
    stereo: np.ndarray,
    start_time: float,
    sample_rate: int,
    spec: Mapping,
    cam_keys: Sequence[Mapping],
    placed_data: Any = None,
    source_time_fn: Callable[[float], float] | None = None,
    block_size: int = 128,
    scene_sample_fn: Callable[[float], tuple[Sequence[float] | None, Mapping | None]] | None = None,
) -> np.ndarray:
    import numpy as np
    from scipy import signal

    buf = np.asarray(stereo, dtype=np.float64)
    if buf.ndim != 2 or buf.shape[1] != 2:
        raise ValueError(f"expected (N, 2) stereo audio, got {buf.shape}")
    n = buf.shape[0]
    if n == 0 or not is_spatial_active(spec):
        return buf.astype(np.float32)

    def sample_at(t_film: float) -> dict[str, float]:
        t_pic = source_time_fn(t_film) if source_time_fn is not None else t_film
        pos, pose = scene_sample_fn(t_film) if scene_sample_fn is not None else (None, None)
        if scene_sample_fn is not None and pos is None and spec.get("at") is None:
            raise ValueError(f"spatial target {spec['target']!r} is unavailable at {t_film:.3f}s")
        src = resolve_source_position(spec, t_pic, placed_data, pos)
        return compute_spatial_params(pose or camera_at(cam_keys, t_pic, placed_data), src, spec)

    bounds = list(range(0, n, block_size))
    params = [sample_at(start_time + idx / sample_rate) for idx in bounds]
    params.append(sample_at(start_time + n / sample_rate))
    skip_lpf = all(p["cutoffHz"] >= 19950.0 for p in params)

    out = np.zeros_like(buf)
    # Track Direct-Form I history (x1, x2, y1, y2) per channel and recompute exact DF-II-T initial
    # state `zi` on each block's new (b, a) so sweeping or hard-cutting cutoff never injects spikes.
    hist_l = [0.0, 0.0, 0.0, 0.0]
    hist_r = [0.0, 0.0, 0.0, 0.0]

    def run_lpf_block(x_blk: np.ndarray, b: np.ndarray, a: np.ndarray, hist: list[float]) -> np.ndarray:
        x1, x2, y1, y2 = hist
        zi = np.array(
            [
                b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2,
                b[2] * x1 - a[2] * y1,
            ],
            dtype=np.float64,
        )
        y_blk, _ = signal.lfilter(b, a, x_blk, zi=zi)
        if len(x_blk) >= 2:
            hist[0], hist[1] = float(x_blk[-1]), float(x_blk[-2])
            hist[2], hist[3] = float(y_blk[-1]), float(y_blk[-2])
        elif len(x_blk) == 1:
            hist[0], hist[1] = float(x_blk[0]), x1
            hist[2], hist[3] = float(y_blk[0]), y1
        return y_blk

    for blk_i, start_idx in enumerate(bounds):
        end_idx = min(n, start_idx + block_size)
        blk_len = end_idx - start_idx
        p_curr = params[blk_i]
        p_next = params[blk_i + 1]

        x_l = buf[start_idx:end_idx, 0]
        x_r = buf[start_idx:end_idx, 1]
        if skip_lpf:
            flt_l = x_l
            flt_r = x_r
        else:
            cutoff_mid = 0.5 * (p_curr["cutoffHz"] + p_next["cutoffHz"])
            b, a = _rbj_lowpass(cutoff_mid, sample_rate)
            flt_l = run_lpf_block(x_l, b, a, hist_l)
            flt_r = run_lpf_block(x_r, b, a, hist_r)

        gains = np.linspace(p_curr["gain"], p_next["gain"], blk_len, dtype=np.float64)
        pans = np.linspace(p_curr["pan"], p_next["pan"], blk_len, dtype=np.float64)

        flt_l = flt_l * gains
        flt_r = flt_r * gains

        # Exact Web Audio StereoPannerNode stereo-to-stereo equal-power panning law.
        left_mask = pans <= 0.0
        x = np.where(left_mask, pans + 1.0, pans)
        ang = x * (math.pi * 0.5)
        g_l = np.cos(ang)
        g_r = np.sin(ang)

        out[start_idx:end_idx, 0] = np.where(left_mask, flt_l + flt_r * g_l, flt_l * g_l)
        out[start_idx:end_idx, 1] = np.where(left_mask, flt_r * g_r, flt_r + flt_l * g_r)

    return out.astype(np.float32)
