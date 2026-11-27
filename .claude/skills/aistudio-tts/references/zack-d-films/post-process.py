"""
Zack D. Films Broadcast Post-TTS Chain (Google AI Studio 3.8 TTS -> Shorts-Ready VO).

Requires: Python with numpy & soundfile, plus ffmpeg on PATH.

1. Sibilant-safe breath/gap tightening:
   - Preserves 40 ms pre-attack and 95 ms post-tail buffers (prevents clipping final /s/, /z/, /t/ tails).
   - Leaves natural inter-clause pauses (<= 260 ms between speech islands) untouched.
   - Tightens oversized breathy inter-sentence gaps (> 260 ms) down to ~185 ms total island-to-island
     silence (95 ms tail + 50 ms clean silence floor + 40 ms lead) with 20 ms cosine fade-out/fade-in tapers.
   - Never lengthens an existing gap and trims leading dead air so Word 1 lands within ~0.05-0.07 s (preserving pre-attack lead).
2. Broadcast close-mic EQ + 3:1 leveling + 2-pass linear EBU R128 loudnorm (with automatic 1-pass fallback
   for short <400 ms or silent clips, and atomic staging so in-place input == output is safe in all modes):
   - Measured Shorts outputs (22 pure flash-tts takes): I = -14.1 to -14.8 LUFS, TP = -1.5 to -1.3 dBTP, LRA = 1.0-2.3 LU, PLR = 12.6-13.3 dB.

Usage:
  python post-process.py input.wav output.wav [--preset rasalgethi|zeno|koda] [--trim-over-ms 260] [--target-gap-ms 185] [--tail-ms 95] [--no-gap-trim]
"""
import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile

import numpy as np
import soundfile as sf

PRESET_FILTERS: dict[str, str] = {
    "koda": (
        "highpass=f=90:poles=2,"
        "equalizer=f=300:t=q:w=1.3:g=-2.0,"
        "equalizer=f=2800:t=q:w=1.1:g=3.2,"
        "treble=g=2.2:f=6500,"
        "acompressor=threshold=-22dB:ratio=3.0:attack=6:release=70:makeup=2,"
        "alimiter=limit=0.80:level=false:attack=2:release=40"
    ),
    "zeno": (
        "highpass=f=95:poles=2,"
        "equalizer=f=150:t=q:w=1.0:g=2.0,"
        "equalizer=f=340:t=q:w=1.4:g=-1.8,"
        "equalizer=f=2700:t=q:w=1.2:g=1.5,"
        "treble=g=1.2:f=6500,"
        "acompressor=threshold=-22dB:ratio=3.0:attack=6:release=70:makeup=2,"
        "alimiter=limit=0.80:level=false:attack=2:release=40"
    ),
    "rasalgethi": (
        "highpass=f=95:poles=2,"
        "equalizer=f=155:t=q:w=1.1:g=1.8,"
        "equalizer=f=340:t=q:w=1.4:g=-2.0,"
        "equalizer=f=2700:t=q:w=1.2:g=1.8,"
        "treble=g=1.5:f=6500,"
        "acompressor=threshold=-22dB:ratio=3.0:attack=6:release=70:makeup=2,"
        "alimiter=limit=0.80:level=false:attack=2:release=40"
    ),
}


def validate_timing(
    trim_over_ms: float,
    target_gap_ms: float,
    lead_ms: float,
    tail_ms: float,
    xfade_ms: float,
) -> None:
    for name, value in (
        ("trim_over_ms", trim_over_ms),
        ("target_gap_ms", target_gap_ms),
        ("lead_ms", lead_ms),
        ("tail_ms", tail_ms),
        ("xfade_ms", xfade_ms),
    ):
        if not math.isfinite(value) or value < 0:
            raise ValueError(f"{name} must be a finite number >= 0 (got {value}).")
    if target_gap_ms > trim_over_ms:
        raise ValueError(
            f"target_gap_ms ({target_gap_ms}) must be <= trim_over_ms ({trim_over_ms})."
        )


def _valid_loudnorm_stats(st: dict) -> tuple[float, float, float, float, float] | None:
    try:
        in_i = float(st["input_i"])
        in_tp = float(st["input_tp"])
        in_lra = float(st["input_lra"])
        in_thresh = float(st["input_thresh"])
        offset = float(st["target_offset"])
    except (KeyError, TypeError, ValueError):
        return None
    if not all(math.isfinite(v) for v in (in_i, in_tp, in_lra, in_thresh, offset)):
        return None
    if not (
        -99.0 <= in_i <= 0.0
        and -99.0 <= in_tp <= 99.0
        and 0.0 <= in_lra <= 99.0
        and -99.0 <= in_thresh <= 0.0
        and -99.0 <= offset <= 99.0
    ):
        return None
    return in_i, in_tp, in_lra, in_thresh, offset


def tighten_gaps(
    wav_in: str,
    wav_out: str,
    trim_over_ms: float = 260.0,
    target_gap_ms: float = 185.0,
    lead_ms: float = 40.0,
    tail_ms: float = 95.0,
    xfade_ms: float = 20.0,
) -> dict:
    validate_timing(trim_over_ms, target_gap_ms, lead_ms, tail_ms, xfade_ms)
    y, sr = sf.read(wav_in, dtype="float32")
    if y.ndim > 1:
        y = np.mean(y, axis=1)
    if len(y) == 0:
        raise ValueError(f"Input WAV contains zero samples: {wav_in}")

    hop = int(sr * 0.01)
    win = int(sr * 0.025)
    if len(y) < win:
        sf.write(wav_out, y, sr)
        return {"gaps_trimmed": 0, "orig_dur": round(len(y) / sr, 3), "new_dur": round(len(y) / sr, 3)}

    n_frames = (len(y) - win) // hop + 1
    rms = np.array(
        [np.sqrt(np.mean(y[i * hop : i * hop + win] ** 2) + 1e-12) for i in range(n_frames)]
    )
    rms_db = 20.0 * np.log10(rms)
    speech_p90 = float(np.percentile(rms_db, 90))
    thresh = max(speech_p90 - 27.0, -45.0)
    active = rms_db > thresh

    islands = []
    in_seg = False
    seg_s = 0
    for i, a in enumerate(active):
        if a and not in_seg:
            in_seg = True
            seg_s = i
        elif not a and in_seg:
            in_seg = False
            islands.append([seg_s * hop, min(len(y), i * hop + win)])
    if in_seg:
        islands.append([seg_s * hop, len(y)])

    if not islands:
        sf.write(wav_out, y, sr)
        return {"gaps_trimmed": 0, "orig_dur": round(len(y) / sr, 3), "new_dur": round(len(y) / sr, 3)}

    lead_samp = int(sr * lead_ms / 1000.0)
    tail_samp = int(sr * tail_ms / 1000.0)
    # Track both padded slice [es, ee] and raw island bounds [rs, re] so gap math uses true island-to-island silence.
    merged = []
    for s, e in islands:
        es = max(0, s - lead_samp)
        ee = min(len(y), e + tail_samp)
        if merged and es <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], ee)
            merged[-1][3] = max(merged[-1][3], e)
        else:
            merged.append([es, ee, s, e])

    first_s = max(0, merged[0][0] - int(sr * 0.01))
    pieces = []
    xfade = int(sr * xfade_ms / 1000.0)
    trim_over_samp = int(sr * trim_over_ms / 1000.0)
    target_gap_samp = int(sr * target_gap_ms / 1000.0)
    min_floor_samp = int(sr * 0.035)
    gaps_trimmed = 0

    for idx, (s, e, raw_s, _raw_e) in enumerate(merged):
        if idx == 0:
            seg = y[first_s:e].copy()
            fi = min(int(sr * 0.008), len(seg))
            if fi > 0:
                seg[:fi] *= np.linspace(0.0, 1.0, fi, dtype=np.float32)
            pieces.append(seg)
            continue

        prev_e = merged[idx - 1][1]
        prev_raw_e = merged[idx - 1][3]
        true_gap = raw_s - prev_raw_e
        actual_pad = (prev_e - prev_raw_e) + (raw_s - s)
        floor_len = max(min_floor_samp, target_gap_samp - actual_pad)
        if true_gap > trim_over_samp and s > prev_e and (actual_pad + floor_len) < true_gap:
            gaps_trimmed += 1
            fo = min(xfade, max(0, prev_e - prev_raw_e), len(pieces[-1]))
            if fo > 0:
                pieces[-1][-fo:] *= (0.5 * (1.0 + np.cos(np.linspace(0, np.pi, fo)))).astype(np.float32)
            pieces.append(np.zeros(floor_len, dtype=np.float32))
            seg = y[s:e].copy()
            fi = min(xfade, max(0, raw_s - s), len(seg))
            if fi > 0:
                seg[:fi] *= (0.5 * (1.0 - np.cos(np.linspace(0, np.pi, fi)))).astype(np.float32)
            pieces.append(seg)
        else:
            pieces.append(y[prev_e:e].copy())

    end_pad = min(len(y), merged[-1][1] + int(sr * 0.14))
    if end_pad > merged[-1][1]:
        tail_seg = y[merged[-1][1]:end_pad].copy()
        fo = min(xfade, len(tail_seg))
        if fo > 0:
            tail_seg[-fo:] *= np.linspace(1.0, 0.0, fo, dtype=np.float32)
        pieces.append(tail_seg)

    out = np.concatenate(pieces)
    sf.write(wav_out, out, sr)
    return {
        "gaps_trimmed": gaps_trimmed,
        "orig_dur": round(len(y) / sr, 3),
        "new_dur": round(len(out) / sr, 3),
    }


def _run_ffmpeg(cmd: list[str], step: str) -> subprocess.CompletedProcess[str]:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(f"ffmpeg failed during {step} (exit {proc.returncode}): {detail}")
    return proc


def apply_broadcast_eq(wav_in: str, wav_out: str, preset: str = "rasalgethi") -> None:
    if preset not in PRESET_FILTERS:
        raise ValueError(f"Unknown preset '{preset}'. Expected one of: {', '.join(PRESET_FILTERS)}.")
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg was not found on PATH. Install ffmpeg before running post-process.py.")
    if sf.info(wav_in).frames == 0:
        raise ValueError(f"Input WAV contains zero samples: {wav_in}")

    pre = PRESET_FILTERS[preset]
    p1 = _run_ffmpeg(
        [
            "ffmpeg",
            "-nostdin",
            "-v",
            "info",
            "-i",
            wav_in,
            "-af",
            f"{pre},loudnorm=I=-14:TP=-1.5:LRA=20:print_format=json",
            "-f",
            "null",
            "-",
        ],
        step="pass-1 loudnorm analysis",
    )
    m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", p1.stderr, re.S)
    parsed = _valid_loudnorm_stats(json.loads(m.group(0))) if m else None
    if parsed is not None:
        in_i, in_tp, in_lra, in_thresh, offset = parsed
        ln = (
            f"loudnorm=I=-14:TP=-1.5:LRA=20:linear=true"
            f":measured_I={in_i:.2f}:measured_TP={in_tp:.2f}"
            f":measured_LRA={in_lra:.2f}:measured_thresh={in_thresh:.2f}"
            f":offset={offset:.2f}"
        )
        af = f"{pre},{ln}"
    else:
        af = f"{pre},loudnorm=I=-14:TP=-1.5:LRA=20"

    out_abs = os.path.abspath(wav_out)
    out_dir = os.path.dirname(out_abs)
    os.makedirs(out_dir, exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix=".wav", dir=out_dir, delete=False) as staged:
        staged_path = staged.name
    try:
        _run_ffmpeg(
            [
                "ffmpeg",
                "-nostdin",
                "-v",
                "error",
                "-y",
                "-i",
                wav_in,
                "-af",
                af,
                "-ar",
                "48000",
                "-ac",
                "1",
                "-c:a",
                "pcm_s16le",
                staged_path,
            ],
            step="pass-2 broadcast EQ & loudnorm render",
        )
        os.replace(staged_path, out_abs)
    finally:
        if os.path.exists(staged_path):
            os.remove(staged_path)


def main():
    ap = argparse.ArgumentParser(description="Zack D. Films Broadcast Post-TTS Chain")
    ap.add_argument("input", help="Raw AI Studio TTS WAV file")
    ap.add_argument("output", help="Processed 48 kHz mono broadcast WAV")
    ap.add_argument("--preset", default="rasalgethi", choices=list(PRESET_FILTERS))
    ap.add_argument("--trim-over-ms", type=float, default=260.0, help="Trim island-to-island gaps longer than this (ms)")
    ap.add_argument("--target-gap-ms", type=float, default=185.0, help="Target island-to-island silence after trimming (ms)")
    ap.add_argument("--tail-ms", type=float, default=95.0, help="Post-word sibilant preservation tail (ms)")
    ap.add_argument("--no-gap-trim", action="store_true")
    args = ap.parse_args()

    try:
        validate_timing(args.trim_over_ms, args.target_gap_ms, 40.0, args.tail_ms, 20.0)
    except ValueError as err:
        ap.error(str(err))

    try:
        if args.no_gap_trim:
            apply_broadcast_eq(args.input, args.output, args.preset)
            print(f"BroadcastEQ({args.preset}) -> {args.output}")
            return

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp_path = tmp.name
        try:
            info = tighten_gaps(
                args.input,
                tmp_path,
                trim_over_ms=args.trim_over_ms,
                target_gap_ms=args.target_gap_ms,
                tail_ms=args.tail_ms,
            )
            apply_broadcast_eq(tmp_path, args.output, args.preset)
            print(
                f"GapTrim({info['gaps_trimmed']} gaps, {info['orig_dur']}s->{info['new_dur']}s) + BroadcastEQ({args.preset}) -> {args.output}"
            )
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
    except ValueError as err:
        print(f"Invalid input: {err}", file=sys.stderr)
        sys.exit(2)
    except Exception as err:
        print(f"Error: {err}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
