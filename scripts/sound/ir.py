"""Deterministic acoustic space IR synthesizer and convolution reverb."""

from __future__ import annotations

import math
import os
from typing import TYPE_CHECKING, Callable, Iterable, Mapping

if TYPE_CHECKING:
    import numpy as np

REVERB_SPACES = (
    "dry",
    "small-room",
    "hall",
    "stairwell",
    "cave",
    "outdoor",
)

SPACE_PRESETS: dict[str, dict] = {
    "small-room": {
        "duration_sec": 0.55,
        "default_wet": 0.18,
        "default_predelay_ms": 6.0,
        "rt60_low": 0.42,
        "rt60_high": 0.24,
        "crossover_hz": 1400.0,
        "density": 2400.0,
        "tail_gain": 0.34,
        "tail_fade_in_sec": 0.018,
        "seed": 0x11A2B3C4,
        "early": (
            (4.2, 0.85, -0.65),
            (6.8, 0.72, 0.60),
            (10.1, 0.58, -0.35),
            (13.7, 0.46, 0.80),
            (18.4, 0.35, -0.75),
            (23.2, 0.26, 0.30),
        ),
    },
    "hall": {
        "duration_sec": 1.85,
        "default_wet": 0.28,
        "default_predelay_ms": 18.0,
        "rt60_low": 1.75,
        "rt60_high": 1.05,
        "crossover_hz": 1500.0,
        "density": 2400.0,
        "tail_gain": 0.48,
        "tail_fade_in_sec": 0.045,
        "seed": 0x22B3C4D5,
        "early": (
            (11.5, 0.78, -0.75),
            (16.2, 0.72, 0.70),
            (22.8, 0.62, -0.40),
            (29.4, 0.55, 0.55),
            (37.6, 0.44, -0.85),
            (46.1, 0.38, 0.85),
            (58.3, 0.29, -0.25),
            (71.0, 0.22, 0.35),
        ),
    },
    "stairwell": {
        "duration_sec": 1.45,
        "default_wet": 0.32,
        "default_predelay_ms": 10.0,
        "rt60_low": 1.15,
        "rt60_high": 1.38,
        "crossover_hz": 1800.0,
        "density": 1650.0,
        "tail_gain": 0.44,
        "tail_fade_in_sec": 0.025,
        "seed": 0x33C4D5E6,
        "early": (
            (5.5, 0.92, -0.80),
            (9.8, 0.84, 0.85),
            (17.5, 0.70, -0.70),
            (25.0, 0.60, 0.75),
            (38.2, 0.48, -0.50),
            (51.0, 0.39, 0.55),
            (69.5, 0.28, -0.60),
            (88.0, 0.21, 0.45),
        ),
    },
    "cave": {
        "duration_sec": 2.90,
        "default_wet": 0.42,
        "default_predelay_ms": 24.0,
        "rt60_low": 2.85,
        "rt60_high": 1.30,
        "crossover_hz": 1100.0,
        "density": 1400.0,
        "tail_gain": 0.56,
        "tail_fade_in_sec": 0.060,
        "seed": 0x44D5E6F7,
        "early": (
            (14.0, 0.80, -0.60),
            (24.5, 0.74, 0.65),
            (39.0, 0.66, -0.85),
            (58.2, 0.54, 0.80),
            (83.4, 0.45, -0.45),
            (112.0, 0.36, 0.50),
            (148.5, 0.27, -0.75),
            (192.0, 0.20, 0.35),
        ),
    },
    "outdoor": {
        "duration_sec": 0.75,
        "default_wet": 0.16,
        "default_predelay_ms": 28.0,
        "rt60_low": 0.36,
        "rt60_high": 0.22,
        "crossover_hz": 1200.0,
        "density": 450.0,
        "tail_gain": 0.18,
        "tail_fade_in_sec": 0.035,
        "seed": 0x55E6F708,
        "early": (
            (22.0, 0.85, -0.85),
            (38.5, 0.68, 0.80),
            (64.0, 0.52, -0.55),
            (96.0, 0.38, 0.65),
            (145.0, 0.25, -0.40),
            (210.0, 0.16, 0.45),
        ),
    },
}

CUSTOM_DEFAULT_WET = 0.25
CUSTOM_DEFAULT_PREDELAY_MS = 0.0
IR_TARGET_RMS = 0.45
MAX_CUSTOM_GAIN = 4.0


def is_preset_space(space: str) -> bool:
    return space in REVERB_SPACES


def is_safe_relative_ir_path(space: str) -> bool:
    if not space or "\0" in space:
        return False
    if space.startswith("/") or space.startswith("\\"):
        return False
    if len(space) >= 2 and space[1] == ":" and space[0].isalpha():
        return False
    parts = space.replace("\\", "/").split("/")
    return ".." not in parts


def default_reverb_params(space: str) -> tuple[float, float]:
    if space == "dry":
        return (0.0, 0.0)
    if space in SPACE_PRESETS:
        p = SPACE_PRESETS[space]
        return (float(p["default_wet"]), float(p["default_predelay_ms"]))
    return (CUSTOM_DEFAULT_WET, CUSTOM_DEFAULT_PREDELAY_MS)


def resolve_reverb_spec(spec: Mapping | None) -> dict | None:
    if not spec:
        return None
    space = spec.get("space")
    if not space or space == "dry":
        return None
    def_wet, def_pd = default_reverb_params(space)
    wet_val = spec.get("wet")
    wet = max(0.0, min(1.0, float(def_wet if wet_val is None else wet_val)))
    if wet <= 0.0:
        return None
    pd_val = spec.get("preDelayMs")
    pd = max(0.0, min(500.0, float(def_pd if pd_val is None else pd_val)))
    return {"space": str(space), "wet": wet, "preDelayMs": pd}


def resolve_clip_reverb(
    clip_reverb: Mapping | None,
    clip_time: float,
    spaces: Iterable[Mapping] | None,
    film_reverb: Mapping | None,
) -> dict | None:
    if clip_reverb is not None:
        return resolve_reverb_spec(clip_reverb)
    if spaces:
        matched = None
        for s in spaces:
            start = float(s.get("from", 0.0))
            end = s.get("to")
            if clip_time >= start and (end is None or clip_time < float(end)):
                matched = s
        if matched is not None:
            return resolve_reverb_spec(matched)
    return resolve_reverb_spec(film_reverb)


class _Mulberry32:
    """Bit-identical 32-bit PRNG matching JS Math.imul Mulberry32."""

    def __init__(self, seed: int) -> None:
        self.a = seed & 0xFFFFFFFF

    def next(self) -> float:
        self.a = (self.a + 0x6D2B79F5) & 0xFFFFFFFF
        a = self.a
        t = ((a ^ (a >> 15)) * (1 | a)) & 0xFFFFFFFF
        u = ((t ^ (t >> 7)) * (61 | t)) & 0xFFFFFFFF
        t = ((t + u) & 0xFFFFFFFF) ^ t
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0


def normalize_stereo_ir(left: np.ndarray, right: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    import numpy as np

    l64 = np.asarray(left, dtype=np.float64).copy()
    r64 = np.asarray(right, dtype=np.float64).copy()
    sum_sq = float(np.sum(l64 * l64 + r64 * r64))
    rms = math.sqrt(sum_sq * 0.5)
    if rms > 1e-12:
        scale = min(MAX_CUSTOM_GAIN, IR_TARGET_RMS / rms)
        l64 *= scale
        r64 *= scale
    return l64.astype(np.float32), r64.astype(np.float32)


def _add_tap(buf: np.ndarray, pos: float, amp: float) -> None:
    i0 = math.floor(pos)
    frac = pos - i0
    if 0 <= i0 < len(buf):
        buf[i0] += amp * (1.0 - frac)
    i1 = i0 + 1
    if 0 <= i1 < len(buf):
        buf[i1] += amp * frac


def generate_impulse_response(
    space: str, sample_rate: int = 48000
) -> tuple[np.ndarray, np.ndarray]:
    import numpy as np
    from scipy import signal

    if not is_preset_space(space) or space == "dry":
        return np.array([1.0], dtype=np.float32), np.array([1.0], dtype=np.float32)

    cfg = SPACE_PRESETS[space]
    length = max(1, round(cfg["duration_sec"] * sample_rate))
    left = np.zeros(length, dtype=np.float32)
    right = np.zeros(length, dtype=np.float32)

    for ms, gain, pan in cfg["early"]:
        pos = (ms / 1000.0) * sample_rate
        clamped_pan = max(-1.0, min(1.0, pan))
        angle = ((clamped_pan + 1.0) * math.pi) / 4.0
        _add_tap(left, pos, gain * math.cos(angle))
        _add_tap(right, pos, gain * math.sin(angle))

    rng = _Mulberry32(cfg["seed"])
    step = sample_rate / cfg["density"]
    start_sample = max(1, math.floor((cfg["early"][0][0] / 1000.0) * sample_rate))
    raw_l = np.zeros(length, dtype=np.float64)
    raw_r = np.zeros(length, dtype=np.float64)

    num_cells = math.floor((length - start_sample) / step)
    for k in range(num_cells):
        idx_l = start_sample + math.floor((k + rng.next()) * step)
        sign_l = -1.0 if rng.next() < 0.5 else 1.0
        if 0 <= idx_l < length:
            raw_l[idx_l] += sign_l

        idx_r = start_sample + math.floor((k + rng.next()) * step)
        sign_r = -1.0 if rng.next() < 0.5 else 1.0
        if 0 <= idx_r < length:
            raw_r[idx_r] += sign_r

    alpha = math.exp((-2.0 * math.pi * cfg["crossover_hz"]) / sample_rate)
    lp_l = signal.lfilter([1.0 - alpha], [1.0, -alpha], raw_l)
    lp_r = signal.lfilter([1.0 - alpha], [1.0, -alpha], raw_r)
    hp_l = raw_l - lp_l
    hp_r = raw_r - lp_r

    idx = np.arange(length, dtype=np.float64)
    t_rel = np.maximum(0.0, idx - start_sample)
    fade_in_samples = max(1.0, cfg["tail_fade_in_sec"] * sample_rate)
    fade_in = np.minimum(1.0, t_rel / fade_in_samples)

    k_low = -6.907755278982137 / (cfg["rt60_low"] * sample_rate)
    k_high = -6.907755278982137 / (cfg["rt60_high"] * sample_rate)
    env_low = np.exp(k_low * t_rel)
    env_high = np.exp(k_high * t_rel)

    tail_l = cfg["tail_gain"] * fade_in * (lp_l * env_low + hp_l * env_high)
    tail_r = cfg["tail_gain"] * fade_in * (lp_r * env_low + hp_r * env_high)

    left_f = left.astype(np.float64) + tail_l
    right_f = right.astype(np.float64) + tail_r

    fade_out_samples = min(length, max(1, round(0.02 * sample_rate)))
    fade_out_start = length - fade_out_samples
    if fade_out_start < length:
        rem = (length - 1 - np.arange(fade_out_start, length, dtype=np.float64)) / max(
            1, fade_out_samples - 1
        )
        win = 0.5 * (1.0 - np.cos(math.pi * rem))
        left_f[fade_out_start:] *= win
        right_f[fade_out_start:] *= win

    return normalize_stereo_ir(left_f, right_f)


def resolve_custom_ir_file(
    space: str,
    film_dir: str,
    assert_in_root: Callable[[str, str], None],
    audio_file_fn: Callable[[str], str | None] | None = None,
) -> str:
    if not is_safe_relative_ir_path(space):
        raise ValueError(f"unsafe reverb space path: {space}")
    candidate = os.path.join(film_dir, space)
    if os.path.lexists(candidate):
        assert_in_root(candidate, f"reverb IR '{space}'")
        if os.path.isfile(candidate):
            return os.path.realpath(candidate)
        raise ValueError(f"reverb IR '{space}' is not a regular file")
    if audio_file_fn is not None and "/" not in space and "\\" not in space:
        resolved = audio_file_fn(space)
        if resolved and os.path.lexists(resolved):
            if os.path.islink(resolved):
                raise ValueError(f"reverb IR '{space}' cannot be a symlink")
            if os.path.isfile(resolved):
                return os.path.realpath(resolved)
    raise ValueError(f"missing reverb IR '{space}'")


def apply_convolution_reverb(
    dry_stereo: np.ndarray,
    ir_left: np.ndarray,
    ir_right: np.ndarray,
    wet: float,
    pre_delay_ms: float,
    sample_rate: int = 48000,
) -> np.ndarray:
    import numpy as np
    from scipy import signal

    dry = np.asarray(dry_stereo, dtype=np.float64)
    if dry.ndim != 2 or dry.shape[1] != 2:
        raise ValueError(f"expected (N, 2) stereo audio, got {dry.shape}")
    n = dry.shape[0]
    w = max(0.0, min(1.0, float(wet)))
    if n == 0 or w <= 0.0:
        return dry.astype(np.float32)

    wet_l = signal.oaconvolve(dry[:, 0], np.asarray(ir_left, dtype=np.float64), mode="full")
    wet_r = signal.oaconvolve(dry[:, 1], np.asarray(ir_right, dtype=np.float64), mode="full")
    pd = max(0, int(round((max(0.0, float(pre_delay_ms)) / 1000.0) * sample_rate)))

    out_len = max(n, pd + len(wet_l), pd + len(wet_r))
    out = np.zeros((out_len, 2), dtype=np.float64)
    out[:n, :] += (1.0 - w) * dry
    out[pd : pd + len(wet_l), 0] += w * wet_l
    out[pd : pd + len(wet_r), 1] += w * wet_r
    return out.astype(np.float32)
