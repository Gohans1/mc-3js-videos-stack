#!/usr/bin/env python3
"""Comprehensive behavioral tests for rewrite-script deterministic tools.

Covers:
  - audit_rewrite.py: syllable counter, empirical spoken lexicon + stemmer,
    Gate 0 Red-risk triage, multi-layer anti-copy (4-gram, 3-content-gram,
    short-beat Jaccard guard, ROUGE-L F1), time-first SPS & WPM Flop cliff,
    Clean-Read TTS symbol check, opt-in --strict-word-delta, safe Markdown escaping.
  - alignment_core.py & audit_alignment.py: full-sequence caption matcher (no
    repeated-word bug, WhisperX hyphen splits), opening attack, untagged vs
    [SFX_BEAT] pause caps, closing tail & overflow, P3 anchor drift.
  - assemble_scene_locked.py: synthetic WAV assembly, true cosine fades, room-tone
    floor (no digital -inf zeros), tempo cap, _assembled.words.json round-trip.
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
import soundfile as sf

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from alignment_core import evaluate_alignment, match_phrase_span  # noqa: E402
from assemble_scene_locked import apply_cosine_fades, assemble, make_room_tone  # noqa: E402
from audit_rewrite import (  # noqa: E402
    audit_document,
    count_syllables,
    format_markdown,
    is_familiar_word,
    load_familiar_lexicon,
    rouge_l_f1,
)


class TestSyllablesAndLexicon(unittest.TestCase):
    def test_accurate_syllable_counter_fixes_draft_bugs(self):
        # Draft v1 regex broke all of these!
        self.assertEqual(count_syllables("somehow"), 2)
        self.assertEqual(count_syllables("started"), 2)
        self.assertEqual(count_syllables("landed"), 2)
        self.assertEqual(count_syllables("drifted"), 2)
        self.assertEqual(count_syllables("branches"), 2)
        self.assertEqual(count_syllables("crashes"), 2)
        self.assertEqual(count_syllables("idea"), 3)
        self.assertEqual(count_syllables("area"), 3)
        self.assertEqual(count_syllables("video"), 3)
        self.assertEqual(count_syllables("six-year-old"), 3)
        self.assertEqual(count_syllables("anticoagulants"), 6)

    def test_empirical_lexicon_catches_hard_short_words_and_allows_easy_long_words(self):
        lex = load_familiar_lexicon()
        allow: set[str] = set()
        # Hard 1-2 syllable & jargon words MUST be flagged unfamiliar
        for hard in ("clot", "shear", "torque", "inert", "wary", "chasm", "suture", "plight", "venomous", "gibberish", "enlistment", "unconscious"):
            self.assertFalse(is_familiar_word(hard, lex, allow), f"Expected '{hard}' to be unfamiliar")
        # Everyday 3-4 syllable words & inflections & hyphen compounds MUST pass
        for easy in ("elephant", "umbrella", "banana", "ambulance", "afternoon", "understand", "impossible", "mosquito", "butterfly", "gravity", "oxygen", "skeleton", "six-year-old", "mid-air", "girl's", "dropped", "branches", "suddenly", "somehow"):
            self.assertTrue(is_familiar_word(easy, lex, allow), f"Expected '{easy}' to be familiar")

    def test_allow_words_unlock_domain_nouns(self):
        lex = load_familiar_lexicon()
        self.assertFalse(is_familiar_word("submersible", lex, set()))
        self.assertTrue(is_familiar_word("submersible", lex, {"submersible"}))


class TestAuditRewrite(unittest.TestCase):
    def _clean_doc(self) -> dict:
        return {
            "film": "clean-test",
            "total_dur": 12.0,
            "content_risk": "green",
            "target_sps": 3.9,
            "allow_words": ["helmet", "parachute", "plane"],
            "beats": [
                {
                    "id": "b1",
                    "slot_start": 0.05,
                    "slot_end": 4.0,
                    "scene": "jumps from plane",
                    "before": "She jumped from a plane with a group of skydivers, but as they fell",
                    "after": "Right after leaving the plane, a normal jump turned deadly.",
                    "anchors": [{"at": 0.1, "phrase": "leaving the plane"}],
                },
                {
                    "id": "b2",
                    "slot_start": 4.0,
                    "slot_end": 8.0,
                    "scene": "boot hits helmet",
                    "before": "his leg slammed into her helmet, knocking her unconscious.",
                    "after": "One man slid off course, and his boot knocked her out cold.",
                    "anchors": [{"at": 5.5, "phrase": "boot knocked her"}],
                },
                {
                    "id": "b3",
                    "slot_start": 8.0,
                    "slot_end": 11.5,
                    "scene": "pulls chute and lands",
                    "before": "she managed to pull her parachute and somehow survived the rough landing.",
                    "after": "Seconds from the trees, she woke up, yanked her cord, and lived.",
                    "anchors": [{"at": 9.8, "phrase": "yanked her cord"}],
                },
            ],
        }

    def test_clean_room_rewrite_passes_strict(self):
        rep = audit_document(self._clean_doc())
        self.assertTrue(rep["ok"], f"Expected PASS, got fails: {rep['fails']}")
        self.assertLessEqual(rep["summary"]["full_jaccard"], 0.32)
        self.assertLessEqual(rep["summary"]["full_rouge_l_f1"], 0.35)
        self.assertLess(rep["summary"]["est_wpm"], 180.0)

    def test_thesaurus_spin_fails_anti_copy_even_with_zero_4grams(self):
        doc = {
            "film": "thesaurus-spin",
            "total_dur": 8.0,
            "content_risk": "green",
            "target_sps": 3.9,
            "allow_words": [],
            "beats": [
                {
                    "id": "b1",
                    "slot_start": 0.05,
                    "slot_end": 4.0,
                    "scene": "menu in diner",
                    "before": "Your brain skips every letter and sparks certainty that you read it.",
                    "after": "Your brain skips each letter and brings feeling that you read it.",
                },
                {
                    "id": "b2",
                    "slot_start": 4.0,
                    "slot_end": 7.6,
                    "scene": "clues in room",
                    "before": "Small clues around the room fill in the meal you expect.",
                    "after": "Small clues near the room fill out the meal you expect.",
                },
            ],
        }
        rep = audit_document(doc)
        self.assertFalse(rep["ok"])
        joined = " ".join(rep["fails"])
        self.assertTrue(
            "P1_content_3gram_overlap" in joined or "P1_full_jaccard" in joined or "P1_full_rouge_l" in joined,
            f"Expected anti-copy failure, got {rep['fails']}",
        )

    def test_short_beat_jaccard_guard_avoids_single_word_false_positive(self):
        doc = {
            "film": "short-beat",
            "total_dur": 4.0,
            "content_risk": "green",
            "allow_words": [],
            "beats": [
                {
                    "id": "b1",
                    "slot_start": 0.05,
                    "slot_end": 3.5,
                    "scene": "landing",
                    "before": "She hit the ground hard.",
                    "after": "The ground came up fast.",  # only 1 shared word ("ground")
                }
            ],
        }
        rep = audit_document(doc)
        self.assertFalse(any("P1_beat_jaccard" in f for f in rep["fails"]), rep["fails"])

    def test_gate0_red_risk_requires_acknowledgment(self):
        doc = self._clean_doc()
        doc["content_risk"] = "red"
        rep_unack = audit_document(doc)
        self.assertFalse(rep_unack["ok"])
        self.assertTrue(any("GATE0_RED_CONTENT_RISK" in f for f in rep_unack["fails"]))

        doc["risk_acknowledged"] = True
        rep_ack = audit_document(doc)
        self.assertTrue(rep_ack["ok"], rep_ack["fails"])
        self.assertTrue(any("GATE0_RED_CONTENT_RISK" in w for w in rep_ack["warns"]))

    def test_200_wpm_flop_cliff_fails_and_plain_expansion_beats_word_delta(self):
        # Jargon expansion: 1 word/6 syl -> 5 words/5 syl MUST PASS by default!
        doc_plain = {
            "film": "plain-expand",
            "total_dur": 3.0,
            "content_risk": "green",
            "allow_words": [],
            "beats": [
                {
                    "id": "b1",
                    "slot_start": 0.05,
                    "slot_end": 2.6,
                    "scene": "blood flow",
                    "before": "Anticoagulants work.",
                    "after": "Stuff that keeps blood thin works.",
                }
            ],
        }
        rep_default = audit_document(doc_plain)
        self.assertTrue(rep_default["ok"], rep_default["fails"])
        # Opt-in --strict-word-delta 1 catches it ONLY when explicitly requested
        rep_optin = audit_document(doc_plain, strict_word_delta=1)
        self.assertFalse(rep_optin["ok"])
        self.assertTrue(any("P4_optin_word_delta" in f for f in rep_optin["fails"]))

        # Rushed 220 WPM script MUST fail
        rushed = {
            "film": "rushed-220wpm",
            "total_dur": 5.0,
            "content_risk": "green",
            "allow_words": [],
            "beats": [
                {
                    "id": "b1",
                    "slot_start": 0.05,
                    "slot_end": 4.8,
                    "scene": "fast talk",
                    "before": "Short line.",
                    "after": "He ran down the hill and jumped over the wall and grabbed the rope and pulled the boat onto the sand fast.",
                }
            ],
        }
        rep_rushed = audit_document(rushed)
        self.assertFalse(rep_rushed["ok"])
        self.assertTrue(any("P2_projected_wpm_flop_cliff" in f for f in rep_rushed["fails"]), rep_rushed["fails"])

    def test_tts_symbol_and_markdown_pipe_escaping(self):
        doc = self._clean_doc()
        doc["beats"][0]["after"] = "45% of people | miss this."
        doc["beats"][0]["tts_text"] = "45% of people miss this."
        rep = audit_document(doc)
        self.assertTrue(any("P1_unexpanded_tts_symbol" in f for f in rep["fails"]))
        md = format_markdown(rep)
        self.assertIn("\\|", md)


class TestAlignmentAndAssembly(unittest.TestCase):
    def test_phrase_matcher_handles_repeated_words_and_hyphen_splits(self):
        words = [
            {"w": "She", "s": 0.1, "e": 0.3},
            {"w": "saw", "s": 0.3, "e": 0.5},
            {"w": "her", "s": 0.5, "e": 0.7},
            {"w": "friend", "s": 0.7, "e": 1.0},
            {"w": "behind", "s": 1.0, "e": 1.3},
            {"w": "her", "s": 1.3, "e": 1.5},
            {"w": "in", "s": 1.6, "e": 1.7},
            {"w": "mid", "s": 1.7, "e": 1.9},
            {"w": "air", "s": 1.9, "e": 2.1},
        ]
        # Repeated end word "her" MUST match indices (0, 5), NOT (0, 2)!
        self.assertEqual(match_phrase_span(words, "She saw her friend behind her"), (0, 5))
        # Hyphenated "mid-air" MUST match WhisperX split ["mid", "air"]!
        self.assertEqual(match_phrase_span(words, "in mid-air", start_idx=6), (6, 8))

    def test_alignment_audit_catches_dead_air_tail_and_drift(self):
        doc = {
            "film": "align-test",
            "total_dur": 6.0,
            "target_sps": 3.9,
            "beats": [
                {
                    "id": "b1",
                    "slot_start": 0.1,
                    "slot_end": 2.0,
                    "after": "She jumped out fast.",
                    "sfx_beat_before": False,
                    "anchors": [{"at": 0.5, "phrase": "jumped out"}],
                },
                {
                    "id": "b2",
                    "slot_start": 2.2,
                    "slot_end": 5.5,
                    "after": "Then the chute opened.",
                    "sfx_beat_before": False,
                    "anchors": [{"at": 2.3, "phrase": "chute opened"}],
                },
            ],
        }
        # Bad alignment: 0.7s untagged gap, anchor drift +1.0s, tail > 1.0s
        bad_words = {
            "dur": 6.0,
            "words": [
                {"w": "She", "s": 0.1, "e": 0.3},
                {"w": "jumped", "s": 0.5, "e": 0.8},
                {"w": "out", "s": 0.8, "e": 1.0},
                {"w": "fast.", "s": 1.0, "e": 1.3},
                {"w": "Then", "s": 2.05, "e": 2.3},
                {"w": "the", "s": 2.3, "e": 2.5},
                {"w": "chute", "s": 3.3, "e": 3.7},
                {"w": "opened.", "s": 3.7, "e": 4.2},
            ],
        }
        res = evaluate_alignment(doc, bad_words, syllable_fn=count_syllables)
        self.assertFalse(res["ok"])
        joined = " ".join(res["fails"])
        self.assertIn("P2_untagged_dead_air", joined)
        self.assertIn("P2_closing_tail", joined)
        self.assertIn("P3_anchor_drift", joined)

    def test_cosine_fade_and_synthetic_assembly_roundtrip(self):
        sr = 48000
        seg = np.ones(sr // 2, dtype=np.float32)
        faded = apply_cosine_fades(seg, sr, fade_in_ms=10.0, fade_out_ms=10.0)
        self.assertAlmostEqual(float(faded[0]), 0.0, places=5)
        self.assertAlmostEqual(float(faded[-1]), 0.0, places=5)
        # Cosine midpoint is 0.5, quarter point is 0.5*(1-cos(pi/4)) ~= 0.1464 (NOT linear 0.25!)
        n = int(sr * 0.01)
        self.assertLess(abs(float(faded[n // 4]) - 0.1464), 0.02)

        rt = make_room_tone(sr, sr, dbfs=-62.0)
        rms_db = 20.0 * np.log10(float(np.sqrt(np.mean(rt * rt))) + 1e-12)
        self.assertTrue(-65.0 <= rms_db <= -59.0, f"Unexpected room-tone RMS: {rms_db}")

        with tempfile.TemporaryDirectory() as td:
            tdp = Path(td)
            t = np.linspace(0, 4.0, sr * 4, dtype=np.float32)
            tone = 0.2 * np.sin(2.0 * np.pi * 220.0 * t)
            wav_p = tdp / "tts.wav"
            sf.write(str(wav_p), tone, sr, subtype="PCM_16")

            words_p = tdp / "words.json"
            words_p.write_text(json.dumps({
                "dur": 4.0,
                "words": [
                    {"w": "She", "s": 0.05, "e": 0.35},
                    {"w": "jumped", "s": 0.36, "e": 0.85},
                    {"w": "from", "s": 0.86, "e": 1.15},
                    {"w": "the", "s": 1.16, "e": 1.35},
                    {"w": "plane.", "s": 1.36, "e": 1.85},
                    {"w": "Her", "s": 2.05, "e": 2.35},
                    {"w": "chute", "s": 2.36, "e": 2.85},
                    {"w": "opened", "s": 2.86, "e": 3.35},
                    {"w": "fast.", "s": 3.36, "e": 3.80},
                ],
            }), encoding="utf-8")

            beats_p = tdp / "beats.json"
            beats_p.write_text(json.dumps({
                "film": "synth-test",
                "total_dur": 4.2,
                "target_sps": 3.9,
                "allow_words": ["plane", "chute"],
                "beats": [
                    {
                        "id": "b1",
                        "slot_start": 0.05,
                        "slot_end": 2.0,
                        "scene": "plane exit",
                        "before": "Left the aircraft.",
                        "after": "She jumped from the plane.",
                        "anchors": [{"at": 0.36, "phrase": "jumped"}],
                    },
                    {
                        "id": "b2",
                        "slot_start": 2.0,
                        "slot_end": 4.0,
                        "scene": "chute opens",
                        "before": "Canopy deployed.",
                        "after": "Her chute opened fast.",
                        "anchors": [{"at": 2.36, "phrase": "chute opened"}],
                    },
                ],
            }), encoding="utf-8")

            rep = assemble(wav_p, words_p, beats_p, tdp / "out")
            self.assertTrue(rep["ok"], f"Assembly failed: {rep['fails']}")
            self.assertTrue(Path(rep["outputs"]["words"]).exists())
            self.assertEqual(rep["assembly_metrics"]["pure_1x_pct"], 100.0)


if __name__ == "__main__":
    unittest.main()
