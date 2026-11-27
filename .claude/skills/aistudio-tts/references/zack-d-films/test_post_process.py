"""Behavioral regression tests for Zack D. Films post-process.py."""
import importlib.util
import pathlib
import subprocess
import sys
import tempfile
import unittest

import numpy as np
import soundfile as sf

SCRIPT = pathlib.Path(__file__).with_name("post-process.py")


def load_module():
    spec = importlib.util.spec_from_file_location("zdf_post_process", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(mod)
    return mod


def make_tone(sr: int, dur_sec: float, freq: float = 220.0, amp: float = 0.25) -> np.ndarray:
    t = np.arange(int(sr * dur_sec), dtype=np.float32) / sr
    return (amp * np.sin(2.0 * np.pi * freq * t)).astype(np.float32)


def run_cli(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        capture_output=True,
        text=True,
    )


class PostProcessBehaviorTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = pathlib.Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_handles_short_sub_400ms_voiced_clip_without_loudnorm_crash(self):
        src = self.tmp / "short_200ms.wav"
        dst = self.tmp / "short_out.wav"
        sf.write(src, make_tone(24000, 0.20), 24000)

        res = run_cli(str(src), str(dst), "--preset", "zeno")

        self.assertEqual(res.returncode, 0, msg=res.stderr)
        data, sr = sf.read(dst)
        self.assertEqual(sr, 48000)
        self.assertEqual(data.ndim, 1)
        self.assertGreater(len(data), 0)

    def test_handles_pure_silence_without_ffmpeg_crash(self):
        src = self.tmp / "silent.wav"
        dst = self.tmp / "silent_out.wav"
        sf.write(src, np.zeros(24000, dtype=np.float32), 24000)

        res = run_cli(str(src), str(dst), "--preset", "rasalgethi")

        self.assertEqual(res.returncode, 0, msg=res.stderr)
        data, sr = sf.read(dst)
        self.assertEqual(sr, 48000)
        self.assertEqual(data.ndim, 1)

    def test_rejects_empty_zero_sample_wav_cleanly(self):
        src = self.tmp / "empty.wav"
        dst = self.tmp / "empty_out.wav"
        sf.write(src, np.zeros(0, dtype=np.float32), 24000)

        res = run_cli(str(src), str(dst))

        self.assertEqual(res.returncode, 2, msg=res.stderr)
        self.assertFalse(dst.exists())

    def test_supports_in_place_output_with_no_gap_trim(self):
        wav = self.tmp / "inplace.wav"
        sf.write(wav, make_tone(24000, 0.8), 24000)

        res = run_cli(str(wav), str(wav), "--preset", "zeno", "--no-gap-trim")

        self.assertEqual(res.returncode, 0, msg=res.stderr)
        data, sr = sf.read(wav)
        self.assertEqual(sr, 48000)
        self.assertGreater(len(data), 0)

    def test_rejects_negative_timing_flags(self):
        src = self.tmp / "tone.wav"
        dst = self.tmp / "out.wav"
        sf.write(src, make_tone(24000, 0.8), 24000)

        for flag, val in [("--tail-ms", "-50"), ("--trim-over-ms", "-10"), ("--target-gap-ms", "-5")]:
            res = run_cli(str(src), str(dst), flag, val)
            self.assertEqual(res.returncode, 2, msg=f"{flag}={val} should fail with exit 2")

    def test_rejects_target_gap_greater_than_trim_threshold(self):
        src = self.tmp / "tone.wav"
        dst = self.tmp / "out.wav"
        sf.write(src, make_tone(24000, 0.8), 24000)

        res = run_cli(str(src), str(dst), "--trim-over-ms", "200", "--target-gap-ms", "250")

        self.assertEqual(res.returncode, 2, msg=res.stderr)

    def test_tightens_oversized_stereo_gap_and_leaves_natural_pause_intact(self):
        sr = 24000
        burst = make_tone(sr, 0.45)
        long_gap = np.zeros(int(sr * 0.60), dtype=np.float32)
        short_gap = np.zeros(int(sr * 0.20), dtype=np.float32)
        mono = np.concatenate([burst, long_gap, burst, short_gap, burst])
        stereo = np.stack([mono, mono], axis=1)

        src = self.tmp / "stereo_gaps.wav"
        dst = self.tmp / "stereo_out.wav"
        sf.write(src, stereo, sr)

        res = run_cli(str(src), str(dst), "--preset", "rasalgethi")

        self.assertEqual(res.returncode, 0, msg=res.stderr)
        self.assertIn("GapTrim(1 gaps,", res.stdout)
        out, out_sr = sf.read(dst)
        self.assertEqual(out_sr, 48000)
        self.assertEqual(out.ndim, 1)
        self.assertLess(len(out) / out_sr, len(mono) / sr - 0.30)

    def test_never_lengthens_gap_when_tail_plus_lead_exceeds_target(self):
        mod = load_module()
        sr = 24000
        burst = make_tone(sr, 0.40)
        # 305 ms zero gap yields a 265 ms detected true_gap (> 260 ms trim_over_ms),
        # so the (actual_pad + floor_len) < true_gap guard (240 + 35 = 275 ms >= 265 ms) must fire.
        gap_305ms = np.zeros(int(sr * 0.305), dtype=np.float32)
        audio = np.concatenate([burst, gap_305ms, burst])

        src = self.tmp / "wide_tail.wav"
        dst = self.tmp / "wide_tail_out.wav"
        sf.write(src, audio, sr)

        info = mod.tighten_gaps(str(src), str(dst), trim_over_ms=260.0, target_gap_ms=185.0, tail_ms=200.0)

        self.assertEqual(info["gaps_trimmed"], 0)
        self.assertLessEqual(info["new_dur"], info["orig_dur"] + 0.01)

    def test_default_preset_is_rasalgethi_and_supports_in_place_gap_trim(self):
        sr = 24000
        burst = make_tone(sr, 0.40)
        long_gap = np.zeros(int(sr * 0.55), dtype=np.float32)
        wav = self.tmp / "inplace_trim.wav"
        sf.write(wav, np.concatenate([burst, long_gap, burst]), sr)

        res = run_cli(str(wav), str(wav))

        self.assertEqual(res.returncode, 0, msg=res.stderr)
        self.assertIn("GapTrim(1 gaps,", res.stdout)
        self.assertIn("BroadcastEQ(rasalgethi)", res.stdout)
        out, out_sr = sf.read(wav)
        self.assertEqual(out_sr, 48000)
        self.assertEqual(out.ndim, 1)

    def test_trims_leading_dead_air_and_applies_cosine_taper_at_trimmed_gap(self):
        mod = load_module()
        sr = 24000
        leading_silence = np.zeros(int(sr * 0.40), dtype=np.float32)
        burst = make_tone(sr, 0.40, amp=0.25)
        # Low-level constant breath floor (-44 dBFS) inside a 0.60 s gap stays below speech threshold
        # (-36 dB below peak) so the cosine taper must ramp it smoothly to zero at the silence-floor edges.
        low_floor_gap = np.full(int(sr * 0.60), 0.006, dtype=np.float32)
        audio = np.concatenate([leading_silence, burst, low_floor_gap, burst])

        src = self.tmp / "lead_and_taper.wav"
        dst = self.tmp / "lead_and_taper_out.wav"
        sf.write(src, audio, sr)

        info = mod.tighten_gaps(str(src), str(dst), trim_over_ms=260.0, target_gap_ms=185.0, tail_ms=95.0)
        out, _ = sf.read(dst)

        self.assertEqual(info["gaps_trimmed"], 1)
        first_speech_idx = int(np.argmax(np.abs(out) > 0.05))
        first_speech_sec = first_speech_idx / sr
        # Leading 0.40 s dead air is trimmed down to ~50-70 ms (keeping the 40 ms pre-attack lead).
        self.assertGreaterEqual(first_speech_sec, 0.03)
        self.assertLessEqual(first_speech_sec, 0.08)
        # Locate the inserted exact-zero floor strictly after the first burst and verify cosine tapers hit near-zero.
        search_from = first_speech_idx + int(sr * 0.35)
        zero_mask = np.abs(out[search_from:]) < 1e-6
        floor_win = int(sr * 0.04)
        floor_run = np.convolve(zero_mask.astype(np.int32), np.ones(floor_win, dtype=np.int32), mode="valid")
        floor_starts = np.where(floor_run == floor_win)[0]
        self.assertGreater(len(floor_starts), 0)
        floor_start = search_from + int(floor_starts[0])
        non_zero_after = np.where(np.abs(out[floor_start:]) >= 1e-6)[0]
        self.assertGreater(len(non_zero_after), 0)
        floor_end = floor_start + int(non_zero_after[0])
        # Cosine taper ramps the 0.006 constant floor smoothly down to <0.001 right before/after the zero floor.
        self.assertLess(abs(float(out[floor_start - 1])), 1e-3)
        self.assertLess(abs(float(out[floor_end])), 1e-3)

    def test_rejects_non_finite_timing_flags(self):
        src = self.tmp / "tone.wav"
        dst = self.tmp / "out.wav"
        sf.write(src, make_tone(24000, 0.6), 24000)

        for flag, val in [("--tail-ms", "nan"), ("--trim-over-ms", "inf")]:
            res = run_cli(str(src), str(dst), flag, val)
            self.assertEqual(res.returncode, 2, msg=f"{flag}={val} should fail with exit 2")

    def test_rejects_unknown_preset_programmatically(self):
        mod = load_module()
        src = self.tmp / "tone.wav"
        dst = self.tmp / "out.wav"
        sf.write(src, make_tone(24000, 0.6), 24000)

        with self.assertRaises(ValueError):
            mod.apply_broadcast_eq(str(src), str(dst), preset="nonexistent")


if __name__ == "__main__":
    unittest.main()
