#!/usr/bin/env python3
"""Standalone Post-TTS Alignment & Sync Verifier for `rewrite-script`.

Works identically on:
  1. Production film alignment (`bun run voice:align` -> words.json)
  2. Scratch preview assembly (`assemble_scene_locked.py` -> *_assembled.words.json)

Checks:
  - P2 Opening attack <= 0.25s
  - P2 Untagged inter-beat / intra-beat dead air <= 0.50s
  - P2 Tagged [SFX_BEAT] pause <= 0.75s (max 2 per Short)
  - P2 Closing tail <= 0.80s (warn) / <= 1.00s (fail) / >= 0.0s (overflow fail)
  - P2 Measured spoken WPM < 180 (Flop cliff)
  - P3 Action-to-scene anchor drift <= 0.25s (warn) / <= 0.30s (fail)
  - P4 Empirical SPS calibration error vs target_sps

Usage:
  python audit_alignment.py --beats beats.json --words words.json [--strict] [--json]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
from alignment_core import evaluate_alignment, load_beats_doc, load_words_doc  # noqa: E402
from audit_rewrite import count_syllables  # noqa: E402


def format_report(res: dict) -> str:
    m = res["metrics"]
    lines = [
        f"ALIGNMENT AUDIT -> {'PASS' if res['ok'] else 'FAIL'}",
        f"  Words={m.get('word_count')} | Dur={m.get('total_dur_sec')}s | Opening={m.get('opening_attack_sec')}s (<=0.25s) | Tail={m.get('closing_tail_sec')}s (0.25-0.75s target, <=1.00s fail)",
        f"  MaxUntaggedGap={m.get('max_untagged_gap_sec')}s (<=0.50s) | MaxSfxGap={m.get('max_sfx_gap_sec')}s (<=0.75s, n={m.get('sfx_beat_count')})",
        f"  SpokenWPM={m.get('spoken_wpm')} (<180) | OverallWPM={m.get('overall_wpm')} | ActualSPS={m.get('actual_sps_span')} vs TargetSPS={m.get('target_sps')} (err={m.get('sps_error_pct')}%)",
        f"  AnchorsChecked={m.get('anchors_checked')} | MaxAnchorDrift={m.get('max_anchor_drift_sec')}s (<=0.25s target, <=0.30s fail)",
    ]
    if res["anchors"]:
        lines.append("\n  Anchors:")
        for a in res["anchors"]:
            drift_s = f"{a['drift_sec']:+.3f}s" if a["drift_sec"] is not None else "MISSING"
            lines.append(
                f"    [{a['status']}] {a['beat_id']} '{a['phrase']}' target={a['target_at']:.2f}s actual={a['actual_at']} drift={drift_s}"
            )
    if res["fails"]:
        lines.append("\n  FAILS:\n    - " + "\n    - ".join(res["fails"]))
    if res["warns"]:
        lines.append("\n  WARNS:\n    - " + "\n    - ".join(res["warns"]))
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description="Post-TTS alignment verifier for rewrite-script.")
    ap.add_argument("--beats", required=True, help="Path to unified beats.json")
    ap.add_argument("--words", required=True, help="Path to aligned words.json")
    ap.add_argument("--strict", action="store_true", help="Exit non-zero on FAIL")
    ap.add_argument("--json", action="store_true", help="Print JSON output")
    args = ap.parse_args()

    doc = load_beats_doc(args.beats)
    wdoc = load_words_doc(args.words)
    res = evaluate_alignment(doc, wdoc, syllable_fn=count_syllables)

    if args.json:
        print(json.dumps(res, indent=2, ensure_ascii=False))
    else:
        print(format_report(res))

    if args.strict and not res["ok"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
