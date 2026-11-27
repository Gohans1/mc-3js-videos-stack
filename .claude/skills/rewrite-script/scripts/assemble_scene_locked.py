#!/usr/bin/env python3
"""Hardened Scene-Locked Scratch Audio & Preview Assembler for `rewrite-script`.

Takes ONE contiguous post-processed TTS WAV + WhisperX word timestamps + either
unified `beats.json` (preferred) or a legacy `plan.json`, and builds:
  - <out-prefix>_synced.wav           (48kHz mono, cosine fades, gentle room-tone floor)
  - <out-prefix>_assembled.words.json (exact scripts/voice/words.py format for audit_alignment.py)
  - <out-prefix>_text.json            (caption timeline JSON)
  - <out-prefix>_report.json          (full P2/P3/P4 telemetry + alignment audit)
  - <out-prefix>_preview.mp4          (optional isolated scratch MP4 preview; read-only on source video)

Hardened guarantees:
  1. Auto-probes real video width/height via ffprobe (supports 1080x1920, 720x1352, or any WxH).
  2. Full-sequence caption & beat token matching via alignment_core (no repeated-word bug, handles hyphen splits).
  3. True 10ms cosine fades (0.5 * (1 - cos(pi * t))).
  4. Subtle -62 dBFS filtered room-tone floor instead of harsh digital -inf dBFS black.
  5. Enforces --max-tempo ceiling (default 1.08x) and flags any tail overflow or P2/P3 drift under --strict.
"""
from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
from alignment_core import (  # noqa: E402
    evaluate_alignment,
    load_beats_doc,
    load_words_doc,
    match_phrase_span,
    parse_slot,
    tokenize_words,
)
from audit_rewrite import count_syllables  # noqa: E402


def probe_video_info(video_path: Path) -> dict[str, Any]:
    cmd = [
        "ffprobe",
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-show_entries", "format=duration",
        "-of", "json",
        str(video_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=True)
    data = json.loads(proc.stdout)
    stream = data["streams"][0]
    dur = float(data["format"]["duration"])
    return {"width": int(stream["width"]), "height": int(stream["height"]), "duration": dur}


def time_stretch_ffmpeg(seg: np.ndarray, sr: int, factor: float) -> np.ndarray:
    """Stretch audio by `factor` (>1.0 = faster, <1.0 = slower) via ffmpeg atempo."""
    if abs(factor - 1.0) < 0.005:
        return seg
    with tempfile.TemporaryDirectory() as td:
        inp = Path(td) / "in.wav"
        outp = Path(td) / "out.wav"
        sf.write(str(inp), seg, sr, subtype="PCM_16")
        # Chain atempo filters if outside [0.5, 2.0]
        factors: list[float] = []
        rem = factor
        while rem > 2.0:
            factors.append(2.0)
            rem /= 2.0
        while rem < 0.5:
            factors.append(0.5)
            rem /= 0.5
        factors.append(rem)
        af = ",".join(f"atempo={f:.6f}" for f in factors)
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-i", str(inp), "-filter:a", af, "-ar", str(sr), "-ac", "1", str(outp)],
            check=True,
        )
        y, _ = sf.read(str(outp), dtype="float32")
        if y.ndim > 1:
            y = y.mean(axis=1)
        return y


def apply_cosine_fades(seg: np.ndarray, sr: int, fade_in_ms: float = 6.0, fade_out_ms: float = 10.0) -> np.ndarray:
    n_in = min(int(sr * fade_in_ms / 1000.0), len(seg) // 4)
    n_out = min(int(sr * fade_out_ms / 1000.0), len(seg) // 4)
    seg = seg.copy()
    if n_in > 1:
        t_in = np.linspace(0.0, math.pi, n_in, dtype=np.float32)
        seg[:n_in] *= 0.5 * (1.0 - np.cos(t_in))
    if n_out > 1:
        t_out = np.linspace(0.0, math.pi, n_out, dtype=np.float32)
        seg[-n_out:] *= (0.5 * (1.0 - np.cos(t_out)))[::-1]
    return seg


def make_room_tone(n_samples: int, sr: int, dbfs: float = -62.0, seed: int = 42) -> np.ndarray:
    """Generate subtle warm low-passed room-tone bed so pauses never hit digital -inf dBFS."""
    rng = np.random.default_rng(seed)
    white = rng.standard_normal(n_samples).astype(np.float32)
    # Simple 1-pole lowpass (fc ~ 220 Hz) for natural warm room tone
    rc = 1.0 / (2.0 * math.pi * 220.0)
    dt = 1.0 / float(sr)
    alpha = dt / (rc + dt)
    out = np.empty(n_samples, dtype=np.float32)
    # Vectorized chunked smoothing via moving average approximation for speed & zero scipy dep
    win = max(3, int(round(1.0 / alpha)))
    kernel = np.ones(win, dtype=np.float32) / float(win)
    smooth = np.convolve(white, kernel, mode="same").astype(np.float32)
    rms = float(np.sqrt(np.mean(smooth * smooth))) + 1e-12
    target_rms = 10.0 ** (dbfs / 20.0)
    out[:] = smooth * (target_rms / rms)
    return out


def chunk_captions(text: str, max_words: int = 4) -> list[str]:
    """Split a beat's display text into crisp 2-4 word Shorts captions."""
    raw_words = text.strip().split()
    if len(raw_words) <= max_words:
        return [text.strip()] if raw_words else []
    chunks: list[str] = []
    cur: list[str] = []
    for w in raw_words:
        cur.append(w)
        ends_clause = w.endswith((",", ".", "?", ";", ":"))
        if len(cur) >= max_words or (ends_clause and len(cur) >= 2):
            chunks.append(" ".join(cur))
            cur = []
    if cur:
        if len(cur) == 1 and chunks and len(chunks[-1].split()) < max_words:
            chunks[-1] = chunks[-1] + " " + cur[0]
        else:
            chunks.append(" ".join(cur))
    return chunks


def beats_doc_to_plan(doc: dict[str, Any], total_dur: float) -> list[dict[str, Any]]:
    """Build an assembly plan directly from unified beats.json."""
    beats = doc.get("beats", [])
    plan: list[dict[str, Any]] = []
    for idx, b in enumerate(beats):
        slot_s, slot_e = parse_slot(b)
        if slot_s is None:
            slot_s = 0.05 if idx == 0 else (plan[-1]["slot_end"] if plan else 0.0)
        if slot_e is None:
            if idx + 1 < len(beats):
                nxt_s, _ = parse_slot(beats[idx + 1])
                slot_e = nxt_s if nxt_s is not None else total_dur
            else:
                slot_e = total_dur
        after = str(b.get("after", "")).strip()
        tts = str(b.get("tts_text") or after).strip()
        plan.append({
            "id": str(b.get("id") or f"b{idx + 1}"),
            "at": float(slot_s),
            "slot_end": float(slot_e),
            "after": after,
            "tts_text": tts,
            "sfx_beat_before": bool(b.get("sfx_beat_before", False)),
            "captions": chunk_captions(after, max_words=4),
        })
    return plan


def sec_to_ass(t: float) -> str:
    t = max(0.0, t)
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = t % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def write_ass(captions: list[dict[str, Any]], ass_path: Path, width: int, height: int, y_ratio: float = 0.78) -> None:
    font_size = max(36, int(round(width * 0.062)))
    outline = max(3, int(round(width * 0.0055)))
    margin_v = int(round(height * (1.0 - y_ratio)))
    margin_lr = int(round(width * 0.06))
    header = (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        f"PlayResX: {width}\n"
        f"PlayResY: {height}\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
        "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, "
        "Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Cap,Arial,{font_size},&H00FFFFFF,&H000000FF,&H001C1C1C,&H80000000,-1,0,0,0,100,100,0,0,1,{outline},2,2,{margin_lr},{margin_lr},{margin_v},1\n\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )
    lines = [header]
    for c in captions:
        txt = str(c["text"]).replace("{", "").replace("}", "").replace("\n", "\\N")
        lines.append(f"Dialogue: 0,{sec_to_ass(c['from'])},{sec_to_ass(c['to'])},Cap,,0,0,0,,{txt}\n")
    ass_path.write_text("".join(lines), encoding="utf-8")


def assemble(
    wav_path: Path,
    words_path: Path,
    beats_path: Path,
    out_prefix: Path,
    max_tempo: float = 1.08,
    min_gap_sec: float = 0.10,
    preview_video: Path | None = None,
    blur_old_captions: bool = True,
    blur_y_ratio: float = 0.72,
    blur_h_ratio: float = 0.14,
) -> dict[str, Any]:
    doc = load_beats_doc(beats_path)
    wdoc = load_words_doc(words_path)
    src_words = wdoc["words"]

    wav, sr = sf.read(str(wav_path), dtype="float32")
    if wav.ndim > 1:
        wav = wav.mean(axis=1)

    vid_info = probe_video_info(preview_video) if preview_video else None
    if doc.get("total_dur") is not None:
        total_dur = float(doc["total_dur"])
    elif vid_info is not None:
        total_dur = float(vid_info["duration"])
    else:
        total_dur = max(float(wdoc["dur"]), len(wav) / float(sr))
    doc["total_dur"] = total_dur

    plan = beats_doc_to_plan(doc, total_dur)

    n_total = int(round(total_dur * sr))
    out = make_room_tone(n_total, sr, dbfs=-62.0)

    assembled_words: list[dict[str, Any]] = []
    captions_out: list[dict[str, Any]] = []
    sub_reports: list[dict[str, Any]] = []
    assembly_fails: list[str] = []
    assembly_warns: list[str] = []

    prev_end_sec = 0.0
    cursor = 0
    pure_1x_count = 0
    max_used_tempo = 1.0

    for idx, sb in enumerate(plan):
        span = match_phrase_span(src_words, sb["tts_text"], start_idx=cursor)
        if span is None:
            # Fallback: try after text
            span = match_phrase_span(src_words, sb["after"], start_idx=cursor)
        if span is None:
            assembly_fails.append(f"slice_unmatched:{sb['id']}")
            continue

        s_i, e_i = span
        cursor = e_i + 1
        src_s = float(src_words[s_i]["s"])
        src_e = float(src_words[e_i]["e"])
        # Preserve soft consonant/glide onsets (/w/, /h/, /s/, vowels) without bleeding into prior word
        if s_i == 0:
            cut_s = max(0.0, src_s - 0.12)
        else:
            avail_pre = max(0.0, src_s - float(src_words[s_i - 1]["e"]))
            pad_pre = min(0.080, max(0.045, avail_pre * 0.72))
            cut_s = max(float(src_words[s_i - 1]["e"]) + 0.008, src_s - pad_pre)
            if cut_s > src_s:
                cut_s = max(0.0, src_s - 0.035)
        avail_post = (float(src_words[e_i + 1]["s"]) - src_e) if (e_i + 1 < len(src_words)) else 0.12
        pad_post = min(0.065, max(0.035, avail_post * 0.55))
        cut_e = min(len(wav) / float(sr), src_e + pad_post)
        raw_seg = wav[int(round(cut_s * sr)) : int(round(cut_e * sr))]
        raw_dur = len(raw_seg) / float(sr)
        leading_trim = src_s - cut_s

        # Place beat near target_at so spoken onset aligns cleanly, keeping gaps within P2 bounds
        target_at = float(sb["at"])
        if idx == 0:
            place_at = max(0.0, min(target_at, 0.12) - leading_trim)
        else:
            desired_min_gap = 0.32 if sb["sfx_beat_before"] else min_gap_sec
            desired_max_gap = 0.65 if sb["sfx_beat_before"] else 0.45
            # Account for leading_trim so actual spoken gap stays in [desired_min_gap, desired_max_gap]
            earliest = prev_end_sec + desired_min_gap - leading_trim
            latest = prev_end_sec + desired_max_gap - leading_trim
            desired_place = target_at - leading_trim
            place_at = max(earliest, min(desired_place, latest))

        # Compute available spoken window before next beat (do not double-count pad_post)
        next_target = float(plan[idx + 1]["at"]) if idx + 1 < len(plan) else (total_dur - 0.35)
        next_gap_reserve = (0.32 if plan[idx + 1]["sfx_beat_before"] else min_gap_sec) if idx + 1 < len(plan) else 0.10
        spoken_dur = max(0.05, src_e - src_s)
        avail_spoken_dur = max(0.35, next_target - (place_at + leading_trim) - next_gap_reserve)

        tempo = 1.0
        min_tempo = 0.94  # Gentle transparent slowdown up to -6% ONLY when slot would exceed 0.50s gap
        if spoken_dur > avail_spoken_dur and avail_spoken_dur > 0.35:
            needed = spoken_dur / avail_spoken_dur
            if needed <= max_tempo:
                tempo = round(needed, 4)
            else:
                tempo = max_tempo
                assembly_warns.append(
                    f"tempo_capped:{sb['id']} needed={needed:.3f}x capped={max_tempo:.2f}x"
                )
        elif (avail_spoken_dur - spoken_dur) > 0.50 and avail_spoken_dur > 0.8:
            target_spoken = avail_spoken_dur - 0.25
            needed_slow = max(min_tempo, spoken_dur / max(0.35, target_spoken))
            if needed_slow < 0.992:
                tempo = round(needed_slow, 4)
        if abs(tempo - 1.0) < 0.005:
            pure_1x_count += 1
        max_used_tempo = max(max_used_tempo, tempo)

        seg = time_stretch_ffmpeg(raw_seg, sr, tempo)
        seg = apply_cosine_fades(seg, sr, fade_in_ms=6.0, fade_out_ms=10.0)
        seg_dur = len(seg) / float(sr)

        # Place on timeline — NEVER silently truncate past total_dur!
        p_i = int(round(place_at * sr))
        end_i = p_i + len(seg)
        if end_i > n_total:
            overflow_sec = round((end_i - n_total) / float(sr), 3)
            assembly_fails.append(f"tail_overflow:{sb['id']} exceeds total_dur by {overflow_sec:.3f}s")
            # Still write what fits into WAV so audio file is inspectable
            fit = max(0, n_total - p_i)
            if fit > 0:
                out[p_i : p_i + fit] += seg[:fit]
        else:
            out[p_i:end_i] += seg

        # Map each word inside this slice onto the assembled timeline
        slice_words_mapped: list[dict[str, Any]] = []
        for wi in range(s_i, e_i + 1):
            w_s = place_at + (float(src_words[wi]["s"]) - cut_s) / tempo
            w_e = place_at + (float(src_words[wi]["e"]) - cut_s) / tempo
            entry = {
                "w": str(src_words[wi]["w"]),
                "s": round(w_s, 3),
                "e": round(w_e, 3),
            }
            assembled_words.append(entry)
            slice_words_mapped.append(entry)

        # Map captions using full-sequence token matcher (NEVER greedy last-word!)
        cap_cursor = 0
        for ci, cap_txt in enumerate(sb["captions"]):
            c_span = match_phrase_span(slice_words_mapped, cap_txt, start_idx=cap_cursor)
            if c_span is not None:
                c_from = slice_words_mapped[c_span[0]]["s"]
                c_to = slice_words_mapped[c_span[1]]["e"]
                cap_cursor = c_span[1] + 1
            else:
                # Proportional fallback inside beat
                frac0 = ci / max(1, len(sb["captions"]))
                frac1 = (ci + 1) / max(1, len(sb["captions"]))
                c_from = round(place_at + leading_trim / tempo + frac0 * (seg_dur - leading_trim / tempo), 3)
                c_to = round(place_at + leading_trim / tempo + frac1 * (seg_dur - leading_trim / tempo), 3)
            captions_out.append({
                "kind": "text",
                "from": round(c_from, 3),
                "to": round(max(c_from + 0.12, c_to), 3),
                "text": cap_txt,
                "x": 0.5,
                "y": 0.781,
                "size": 72,
                "bold": True,
                "font": "dm-sans",
                "color": "#FFFFFF",
                "stroke": {"color": "#1c1c1c", "width": 5},
            })

        actual_spoken_start = slice_words_mapped[0]["s"]
        actual_spoken_end = slice_words_mapped[-1]["e"]
        gap_before = round(actual_spoken_start - prev_end_sec, 3) if idx > 0 else round(actual_spoken_start, 3)
        prev_end_sec = actual_spoken_end

        sub_reports.append({
            "id": sb["id"],
            "target_at": round(target_at, 3),
            "placed_at": round(place_at, 3),
            "spoken_start": actual_spoken_start,
            "spoken_end": actual_spoken_end,
            "gap_before_sec": gap_before,
            "tempo": tempo,
            "raw_dur_sec": round(raw_dur, 3),
            "final_dur_sec": round(seg_dur, 3),
            "drift_sec": round(actual_spoken_start - target_at, 3),
        })

    # Smooth continuous caption timing within beats (tiny 0.03s gaps closed)
    for i in range(len(captions_out) - 1):
        g = captions_out[i + 1]["from"] - captions_out[i]["to"]
        if 0.0 < g < 0.08:
            captions_out[i]["to"] = round(captions_out[i + 1]["from"] - 0.02, 3)

    out_prefix.parent.mkdir(parents=True, exist_ok=True)
    wav_out = Path(f"{out_prefix}_synced.wav")
    words_out = Path(f"{out_prefix}_assembled.words.json")
    text_out = Path(f"{out_prefix}_text.json")
    report_out = Path(f"{out_prefix}_report.json")

    sf.write(str(wav_out), np.clip(out, -0.99, 0.99), sr, subtype="PCM_16")
    assembled_words_doc = {"dur": round(total_dur, 3), "words": assembled_words}
    words_out.write_text(json.dumps(assembled_words_doc, indent=2, ensure_ascii=False), encoding="utf-8")
    text_out.write_text(json.dumps({"items": captions_out}, indent=2, ensure_ascii=False), encoding="utf-8")

    # Run unified post-TTS alignment audit
    align_res = evaluate_alignment(doc, assembled_words_doc, syllable_fn=count_syllables)
    all_fails = assembly_fails + align_res["fails"]
    all_warns = assembly_warns + align_res["warns"]

    pure_1x_pct = round(pure_1x_count / max(1, len(plan)) * 100.0, 1)

    preview_out_path = None
    if preview_video is not None and vid_info is not None:
        W, H = vid_info["width"], vid_info["height"]
        ass_path = Path(f"{out_prefix}_captions.ass")
        write_ass(captions_out, ass_path, width=W, height=H, y_ratio=0.785)
        preview_out_path = Path(f"{out_prefix}_preview.mp4")

        ass_escaped = str(ass_path).replace("\\", "/").replace(":", "\\:")
        if blur_old_captions:
            by = int(round(H * blur_y_ratio))
            bh = int(round(H * blur_h_ratio))
            vf = (
                f"[0:v]split=2[bg][cap];"
                f"[cap]crop={W}:{bh}:0:{by},boxblur=16:2[bcap];"
                f"[bg][bcap]overlay=0:{by},ass='{ass_escaped}'[vout]"
            )
            cmd = [
                "ffmpeg", "-y", "-v", "error",
                "-i", str(preview_video),
                "-i", str(wav_out),
                "-filter_complex", vf,
                "-map", "[vout]", "-map", "1:a",
                "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "192k", "-shortest",
                str(preview_out_path),
            ]
        else:
            cmd = [
                "ffmpeg", "-y", "-v", "error",
                "-i", str(preview_video),
                "-i", str(wav_out),
                "-vf", f"ass='{ass_escaped}'",
                "-map", "0:v", "-map", "1:a",
                "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "192k", "-shortest",
                str(preview_out_path),
            ]
        subprocess.run(cmd, check=True)

    full_report = {
        "ok": len(all_fails) == 0,
        "film": doc.get("film"),
        "outputs": {
            "wav": str(wav_out),
            "words": str(words_out),
            "text_json": str(text_out),
            "preview_mp4": str(preview_out_path) if preview_out_path else None,
        },
        "video_info": vid_info,
        "assembly_metrics": {
            "beats_total": len(plan),
            "pure_1x_beats": pure_1x_count,
            "pure_1x_pct": pure_1x_pct,
            "max_tempo": round(max_used_tempo, 4),
            "max_tempo_limit": max_tempo,
        },
        "alignment": align_res,
        "sub_beats": sub_reports,
        "fails": all_fails,
        "warns": all_warns,
    }
    report_out.write_text(json.dumps(full_report, indent=2, ensure_ascii=False), encoding="utf-8")
    return full_report


def main() -> int:
    ap = argparse.ArgumentParser(description="Scene-locked scratch audio & preview assembler.")
    ap.add_argument("--wav", required=True, help="Post-processed contiguous TTS WAV")
    ap.add_argument("--words", required=True, help="WhisperX aligned words.json for the TTS WAV")
    ap.add_argument("--beats", required=True, help="Unified beats.json")
    ap.add_argument("--out-prefix", required=True, help="Output file path prefix (in scratch/)")
    ap.add_argument("--max-tempo", type=float, default=1.08, help="Hard atempo ceiling (default 1.08)")
    ap.add_argument("--min-gap", type=float, default=0.10, help="Minimum inter-beat gap in seconds")
    ap.add_argument("--preview-video", default=None, help="Optional read-only MP4 to build scratch preview")
    ap.add_argument("--no-blur-old-captions", action="store_true", help="Do not blur existing caption band")
    ap.add_argument("--blur-y-ratio", type=float, default=0.72)
    ap.add_argument("--blur-h-ratio", type=float, default=0.14)
    ap.add_argument("--strict", action="store_true", help="Exit non-zero if any FAIL is detected")
    args = ap.parse_args()

    rep = assemble(
        wav_path=Path(args.wav),
        words_path=Path(args.words),
        beats_path=Path(args.beats),
        out_prefix=Path(args.out_prefix),
        max_tempo=args.max_tempo,
        min_gap_sec=args.min_gap,
        preview_video=Path(args.preview_video) if args.preview_video else None,
        blur_old_captions=not args.no_blur_old_captions,
        blur_y_ratio=args.blur_y_ratio,
        blur_h_ratio=args.blur_h_ratio,
    )
    am = rep["assembly_metrics"]
    alm = rep["alignment"]["metrics"]
    print(
        f"ASSEMBLE [{rep['film']}] -> {'PASS' if rep['ok'] else 'FAIL'} | "
        f"1.00x={am['pure_1x_pct']}% max_tempo={am['max_tempo']}x | "
        f"open={alm.get('opening_attack_sec')}s tail={alm.get('closing_tail_sec')}s "
        f"max_gap={alm.get('max_untagged_gap_sec')}s wpm={alm.get('spoken_wpm')} "
        f"max_drift={alm.get('max_anchor_drift_sec')}s"
    )
    if rep["fails"]:
        print("FAILS:", rep["fails"])
    if rep["warns"]:
        print("WARNS:", rep["warns"])
    return 0 if (rep["ok"] or not args.strict) else 1


if __name__ == "__main__":
    raise SystemExit(main())
