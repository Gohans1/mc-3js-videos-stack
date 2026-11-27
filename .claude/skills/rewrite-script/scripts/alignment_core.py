#!/usr/bin/env python3
"""Shared alignment, token-matching, and beats.json helpers for rewrite-script.

Zero external dependencies (Python stdlib only). Used by both audit_alignment.py
and assemble_scene_locked.py so timing, gap, WPM, and anchor-drift math are
never duplicated.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


def norm_token(text: str) -> str:
    s = text.lower().replace("\u2019", "'").replace("\u2018", "'")
    s = re.sub(r"[^a-z0-9']", "", s)
    return s.strip("'")


def tokenize_words(text: str) -> list[str]:
    """Split text into normalized word tokens (also splitting hyphens like WhisperX)."""
    cleaned = text.replace("\u2019", "'").replace("\u2018", "'")
    parts = re.split(r"[\s\-—–/]+", cleaned)
    out: list[str] = []
    for p in parts:
        tok = norm_token(p)
        if tok:
            out.append(tok)
    return out


def parse_slot(beat: dict[str, Any]) -> tuple[float | None, float | None]:
    """Read (slot_start, slot_end) from explicit floats or legacy 'time': '0.05-3.52s'."""
    if "slot_start" in beat and "slot_end" in beat:
        try:
            return float(beat["slot_start"]), float(beat["slot_end"])
        except (TypeError, ValueError):
            pass
    t_str = str(beat.get("time", "")).strip()
    m = re.search(r"(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)", t_str)
    if m:
        return float(m.group(1)), float(m.group(2))
    return None, None


def load_beats_doc(path: str | Path) -> dict[str, Any]:
    """Load unified beats.json (or legacy raw list of beats) into a normalized dict."""
    raw = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    if isinstance(raw, list):
        return {
            "film": Path(path).stem,
            "total_dur": None,
            "content_risk": "green",
            "target_sps": 3.6,
            "allow_words": [],
            "beats": raw,
        }
    return {
        "film": raw.get("film") or Path(path).stem,
        "total_dur": raw.get("total_dur"),
        "content_risk": str(raw.get("content_risk", "green")).lower(),
        "risk_acknowledged": bool(raw.get("risk_acknowledged", False)),
        "target_sps": float(raw.get("target_sps", 3.6)),
        "allow_words": list(raw.get("allow_words", [])),
        "beats": list(raw.get("beats", [])),
    }


def load_words_doc(path: str | Path) -> dict[str, Any]:
    """Load scripts/voice/words.py JSON format: {'dur': float, 'words': [{'w','s','e'}]}."""
    raw = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    if isinstance(raw, list):
        words = raw
        dur = float(words[-1]["e"]) if words else 0.0
        return {"dur": dur, "words": words}
    words = list(raw.get("words", []))
    dur = float(raw.get("dur") or (words[-1]["e"] if words else 0.0))
    return {"dur": dur, "words": words}


def _tokens_match(a: str, b: str) -> bool:
    if a == b:
        return True
    # Allow minor contraction/apostrophe differences (e.g., "dont" vs "don't")
    if a.replace("'", "") == b.replace("'", ""):
        return True
    return False


def match_phrase_span(
    words: list[dict[str, Any]],
    phrase: str,
    start_idx: int = 0,
    end_idx: int | None = None,
) -> tuple[int, int] | None:
    """Find the full sequential span (first_idx, last_idx) of `phrase` in `words`.

    Avoids the greedy single-word bug (where a repeated word ends a caption early)
    and handles WhisperX compound splits/merges (e.g., 'mid-air' <-> 'midair').
    """
    target = tokenize_words(phrase)
    if not target or not words:
        return None

    hi = len(words) if end_idx is None else min(len(words), end_idx)
    norm_w = [norm_token(str(w.get("w", ""))) for w in words]

    # Pass 1: exact sequential token match (with compound merge tolerance)
    for i in range(max(0, start_idx), hi):
        ti = 0
        wi = i
        while ti < len(target) and wi < hi:
            if _tokens_match(norm_w[wi], target[ti]):
                wi += 1
                ti += 1
            elif (
                ti + 1 < len(target)
                and _tokens_match(norm_w[wi], target[ti] + target[ti + 1])
            ):
                # WhisperX merged 2 tokens ("midair" vs ["mid", "air"])
                wi += 1
                ti += 2
            elif (
                wi + 1 < hi
                and _tokens_match(norm_w[wi] + norm_w[wi + 1], target[ti])
            ):
                # WhisperX split 1 token (["mid", "air"] vs "midair")
                wi += 2
                ti += 1
            else:
                break
        if ti == len(target):
            return (i, wi - 1)

    # Pass 2: anchored fuzzy window (first & last token match within expected length +/- 2)
    if len(target) >= 2:
        first_t, last_t = target[0], target[-1]
        min_len = max(1, len(target) - 2)
        max_len = len(target) + 3
        for i in range(max(0, start_idx), hi):
            if not _tokens_match(norm_w[i], first_t):
                continue
            for j in range(i + min_len - 1, min(hi, i + max_len)):
                if _tokens_match(norm_w[j], last_t):
                    # Verify majority of interior tokens overlap
                    span_set = {t.replace("'", "") for t in norm_w[i : j + 1]}
                    hits = sum(1 for t in target if t.replace("'", "") in span_set)
                    if hits >= max(2, int(len(target) * 0.65)):
                        return (i, j)
    return None


def map_beats_to_words(
    beats: list[dict[str, Any]],
    words: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Sequentially map every beat's spoken text onto its exact word span."""
    mapped: list[dict[str, Any]] = []
    cursor = 0
    for idx, beat in enumerate(beats):
        spoken = str(beat.get("tts_text") or beat.get("after") or "").strip()
        span = match_phrase_span(words, spoken, start_idx=cursor)
        if span is None:
            # Fallback: try matching first 3 and last 3 tokens
            toks = tokenize_words(spoken)
            if len(toks) >= 2:
                head = match_phrase_span(words, " ".join(toks[: min(3, len(toks))]), start_idx=cursor)
                if head is not None:
                    tail_search = max(head[0], head[1])
                    tail = match_phrase_span(
                        words,
                        " ".join(toks[-min(3, len(toks)) :]),
                        start_idx=tail_search,
                        end_idx=min(len(words), head[0] + len(toks) + 6),
                    )
                    if tail is not None:
                        span = (head[0], tail[1])
        if span is not None:
            s_i, e_i = span
            cursor = e_i + 1
            mapped.append({
                "index": idx,
                "id": beat.get("id") or f"b{idx + 1}",
                "beat": beat,
                "start_idx": s_i,
                "end_idx": e_i,
                "actual_start": float(words[s_i]["s"]),
                "actual_end": float(words[e_i]["e"]),
                "matched": True,
            })
        else:
            mapped.append({
                "index": idx,
                "id": beat.get("id") or f"b{idx + 1}",
                "beat": beat,
                "start_idx": None,
                "end_idx": None,
                "actual_start": None,
                "actual_end": None,
                "matched": False,
            })
    return mapped


def evaluate_alignment(
    doc: dict[str, Any],
    words_doc: dict[str, Any],
    syllable_fn=None,
    opening_max_sec: float = 0.25,
    untagged_gap_max_sec: float = 0.50,
    sfx_gap_max_sec: float = 0.75,
    tail_warn_sec: float = 0.80,
    tail_fail_sec: float = 1.00,
    wpm_ceiling: float = 180.0,
) -> dict[str, Any]:
    """Deterministic post-TTS P2 + P3 + P4 verification on aligned words.json."""
    words = words_doc.get("words", [])
    beats = doc.get("beats", [])
    total_dur = float(doc["total_dur"]) if doc.get("total_dur") is not None else float(words_doc.get("dur") or 0.0)
    target_sps = float(doc.get("target_sps", 3.9))

    fails: list[str] = []
    warns: list[str] = []

    if not words:
        return {
            "ok": False,
            "fails": ["no_words_in_alignment"],
            "warns": [],
            "metrics": {},
            "beats": [],
            "anchors": [],
        }

    opening_attack = round(float(words[0]["s"]), 3)
    speech_end = round(float(words[-1]["e"]), 3)
    closing_tail = round(total_dur - speech_end, 3)

    if opening_attack > opening_max_sec:
        fails.append(f"P2_opening_attack:{opening_attack:.3f}s>{opening_max_sec:.2f}s")
    if closing_tail < -0.02:
        fails.append(f"P2_tail_overflow:{closing_tail:.3f}s (speech exceeds video by {-closing_tail:.3f}s)")
    elif closing_tail > tail_fail_sec:
        fails.append(f"P2_closing_tail:{closing_tail:.3f}s>{tail_fail_sec:.2f}s")
    elif closing_tail > tail_warn_sec:
        warns.append(f"P2_closing_tail_long:{closing_tail:.3f}s>{tail_warn_sec:.2f}s")

    mapped = map_beats_to_words(beats, words) if beats else []
    sfx_count = 0
    max_untagged_gap = 0.0
    max_sfx_gap = 0.0
    beat_reports: list[dict[str, Any]] = []
    anchors_report: list[dict[str, Any]] = []

    # Track beat-level boundary gaps
    beat_boundary_indices: dict[int, bool] = {}
    for m in mapped:
        beat = m["beat"]
        slot_s, slot_e = parse_slot(beat)
        is_sfx = bool(beat.get("sfx_beat_before", False))
        if is_sfx:
            sfx_count += 1
        if m["matched"] and m["start_idx"] is not None and m["start_idx"] > 0:
            beat_boundary_indices[m["start_idx"]] = is_sfx
        if not m["matched"]:
            fails.append(f"beat_unmatched:{m['id']}")
        beat_reports.append({
            "id": m["id"],
            "slot_start": slot_s,
            "slot_end": slot_e,
            "actual_start": m["actual_start"],
            "actual_end": m["actual_end"],
            "sfx_beat_before": is_sfx,
            "matched": m["matched"],
        })

    if sfx_count > 2:
        warns.append(f"P2_too_many_sfx_beats:{sfx_count}>2")

    # Inspect every real pause between consecutive words
    gaps_detail: list[dict[str, Any]] = []
    for i in range(1, len(words)):
        gap = round(float(words[i]["s"]) - float(words[i - 1]["e"]), 3)
        if gap <= 0.0:
            continue
        is_sfx_boundary = beat_boundary_indices.get(i, False)
        if is_sfx_boundary:
            max_sfx_gap = max(max_sfx_gap, gap)
            if gap > sfx_gap_max_sec:
                fails.append(
                    f"P2_sfx_gap_exceeded:{gap:.3f}s>{sfx_gap_max_sec:.2f}s "
                    f"(before '{words[i]['w']}' at {words[i]['s']:.2f}s)"
                )
        else:
            max_untagged_gap = max(max_untagged_gap, gap)
            if gap > sfx_gap_max_sec:
                fails.append(
                    f"P2_hard_dead_air:{gap:.3f}s>{sfx_gap_max_sec:.2f}s "
                    f"(before '{words[i]['w']}' at {words[i]['s']:.2f}s)"
                )
            elif gap > untagged_gap_max_sec:
                fails.append(
                    f"P2_untagged_dead_air:{gap:.3f}s>{untagged_gap_max_sec:.2f}s "
                    f"(before '{words[i]['w']}' at {words[i]['s']:.2f}s)"
                )
        if gap >= 0.12:
            gaps_detail.append({
                "from": round(float(words[i - 1]["e"]), 3),
                "to": round(float(words[i]["s"]), 3),
                "gap_sec": gap,
                "sfx_beat": is_sfx_boundary,
                "next_word": words[i]["w"],
            })

    # Verify P3 anchors
    max_anchor_drift = 0.0
    for m in mapped:
        beat = m["beat"]
        anchors = beat.get("anchors") or []
        for anc in anchors:
            target_at = float(anc["at"])
            phrase = str(anc["phrase"]).strip()
            tol = float(anc.get("tolerance_sec", 0.25))
            hard_tol = max(0.30, tol + 0.05)

            span = None
            if m["matched"] and m["start_idx"] is not None and m["end_idx"] is not None:
                span = match_phrase_span(words, phrase, start_idx=m["start_idx"], end_idx=m["end_idx"] + 1)
            if span is None:
                # Fallback: find closest occurrence across full script to target_at
                best_span = None
                best_dist = 1e9
                pos = 0
                while pos < len(words):
                    cand = match_phrase_span(words, phrase, start_idx=pos)
                    if cand is None:
                        break
                    dist = abs(float(words[cand[0]]["s"]) - target_at)
                    if dist < best_dist:
                        best_dist = dist
                        best_span = cand
                    pos = cand[0] + 1
                span = best_span

            if span is None:
                fails.append(f"P3_anchor_not_found:{m['id']}:'{phrase}'")
                anchors_report.append({
                    "beat_id": m["id"],
                    "phrase": phrase,
                    "target_at": target_at,
                    "actual_at": None,
                    "drift_sec": None,
                    "status": "FAIL_NOT_FOUND",
                })
                continue

            actual_at = round(float(words[span[0]]["s"]), 3)
            drift = round(actual_at - target_at, 3)
            abs_drift = abs(drift)
            max_anchor_drift = max(max_anchor_drift, abs_drift)

            status = "PASS"
            if abs_drift > hard_tol:
                status = "FAIL"
                fails.append(
                    f"P3_anchor_drift:{m['id']}:'{phrase}' target={target_at:.2f}s "
                    f"actual={actual_at:.2f}s drift={drift:+.3f}s (>{hard_tol:.2f}s)"
                )
            elif abs_drift > tol:
                status = "WARN"
                warns.append(
                    f"P3_anchor_drift_warn:{m['id']}:'{phrase}' target={target_at:.2f}s "
                    f"actual={actual_at:.2f}s drift={drift:+.3f}s (>{tol:.2f}s)"
                )
            anchors_report.append({
                "beat_id": m["id"],
                "phrase": phrase,
                "target_at": target_at,
                "actual_at": actual_at,
                "drift_sec": drift,
                "abs_drift_sec": round(abs_drift, 3),
                "tolerance_sec": tol,
                "status": status,
            })

    # WPM & empirical SPS calibration
    spoken_span_sec = max(0.1, speech_end - opening_attack)
    active_word_sec = sum(max(0.01, float(w["e"]) - float(w["s"])) for w in words)
    overall_wpm = round(len(words) / max(0.1, total_dur) * 60.0, 1) if total_dur > 0 else 0.0
    spoken_wpm = round(len(words) / spoken_span_sec * 60.0, 1)

    if spoken_wpm >= wpm_ceiling:
        fails.append(f"P2_wpm_flop_cliff:spoken_wpm={spoken_wpm:.1f}>={wpm_ceiling:.0f}")
    elif overall_wpm >= wpm_ceiling:
        fails.append(f"P2_wpm_flop_cliff:overall_wpm={overall_wpm:.1f}>={wpm_ceiling:.0f}")

    total_syls = None
    actual_sps_span = None
    actual_sps_active = None
    sps_error_pct = None
    if syllable_fn is not None:
        total_syls = sum(syllable_fn(str(w["w"])) for w in words)
        actual_sps_span = round(total_syls / spoken_span_sec, 2)
        actual_sps_active = round(total_syls / max(0.1, active_word_sec), 2)
        if target_sps > 0:
            sps_error_pct = round(abs(actual_sps_span - target_sps) / actual_sps_span * 100.0, 1) if actual_sps_span > 0 else 0.0

    return {
        "ok": len(fails) == 0,
        "fails": fails,
        "warns": warns,
        "metrics": {
            "word_count": len(words),
            "total_dur_sec": round(total_dur, 3),
            "opening_attack_sec": opening_attack,
            "speech_end_sec": speech_end,
            "closing_tail_sec": closing_tail,
            "max_untagged_gap_sec": round(max_untagged_gap, 3),
            "max_sfx_gap_sec": round(max_sfx_gap, 3),
            "sfx_beat_count": sfx_count,
            "overall_wpm": overall_wpm,
            "spoken_wpm": spoken_wpm,
            "target_sps": target_sps,
            "total_syllables": total_syls,
            "actual_sps_span": actual_sps_span,
            "actual_sps_active": actual_sps_active,
            "sps_error_pct": sps_error_pct,
            "max_anchor_drift_sec": round(max_anchor_drift, 3),
            "anchors_checked": len(anchors_report),
        },
        "beats": beat_reports,
        "anchors": anchors_report,
        "gaps": gaps_detail,
    }
