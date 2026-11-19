"""Unit and TS <-> Python parity tests for acoustic IR & 3D spatial audio."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest

import numpy as np

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(REPO_ROOT, "scripts", "sound"))

import ir  # noqa: E402
import spatial  # noqa: E402


class TestSpatialAudioParity(unittest.TestCase):
    def test_ir_parity_with_typescript(self) -> None:
        script = r"""
import { generateImpulseResponse, resolveClipReverb, REVERB_SPACES } from "./packages/live-studio/app/sound/ir.ts";
const out: Record<string, any> = {};
for (const space of REVERB_SPACES) {
  const res = generateImpulseResponse(space, 48000);
  const idx = [0, 100, 500, 2000, 10000, Math.min(res.left.length - 1, 45000)].filter((i) => i < res.left.length);
  out[space] = {
    length: res.left.length,
    sumSqL: res.left.reduce((a, b) => a + b * b, 0),
    sumSqR: res.right.reduce((a, b) => a + b * b, 0),
    samplesL: idx.map((i) => res.left[i]),
    samplesR: idx.map((i) => res.right[i]),
    idx,
  };
}
console.log(JSON.stringify(out));
"""
        proc = subprocess.run(
            ["bun", "-e", script],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=True,
        )
        ts_data = json.loads(proc.stdout)

        for space, ts_info in ts_data.items():
            py_l, py_r = ir.generate_impulse_response(space, 48000)
            self.assertEqual(len(py_l), ts_info["length"], msg=f"length mismatch for {space}")
            self.assertEqual(len(py_r), ts_info["length"])
            self.assertAlmostEqual(float(np.sum(py_l.astype(np.float64) ** 2)), ts_info["sumSqL"], places=4)
            self.assertAlmostEqual(float(np.sum(py_r.astype(np.float64) ** 2)), ts_info["sumSqR"], places=4)
            for k, i in enumerate(ts_info["idx"]):
                self.assertAlmostEqual(float(py_l[i]), ts_info["samplesL"][k], places=5, msg=f"{space} L[{i}]")
                self.assertAlmostEqual(float(py_r[i]), ts_info["samplesR"][k], places=5, msg=f"{space} R[{i}]")

    def test_spatial_params_parity_with_typescript(self) -> None:
        cases = [
            (
                {"p": [0, 1.6, 5], "l": [0, 1.6, 0], "roll": 0},
                [3, 1.6, 2],
                {"at": [3, 1.6, 2], "refDistance": 2, "maxDistance": 30, "rolloff": 1.2, "occlusion": 0.25},
            ),
            (
                {"p": [-2, 3, -4], "l": [1, 1.5, 2], "roll": 25},
                [-12, 5, -9],
                {"at": [-12, 5, -9], "refDistance": 1.5, "maxDistance": 50, "rolloff": 0.8, "occlusion": 0.7},
            ),
            (
                {"p": [0, 10, 0], "l": [0, 0, 0], "roll": -15},
                [-5, 2, 1],
                {"at": [-5, 2, 1], "airAbsorption": False},
            ),
            (
                {"p": [1, 2, 3], "l": [1, 2, 3]},
                [1, 2, 3],
                {"at": [1, 2, 3], "occlusion": 0.5},
            ),
        ]
        script = f"""
import {{ computeSpatialParams }} from "./packages/live-studio/app/sound/spatial.ts";
const cases = {json.dumps(cases)};
console.log(JSON.stringify(cases.map(([cam, src, spec]) => computeSpatialParams(cam, src, spec))));
"""
        proc = subprocess.run(
            ["bun", "-e", script],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=True,
        )
        ts_results = json.loads(proc.stdout)
        for idx, ((cam, src, spec), ts_res) in enumerate(zip(cases, ts_results)):
            py_res = spatial.compute_spatial_params(cam, src, spec)
            for field in ("pan", "gain", "cutoffHz", "distance", "frontDot"):
                self.assertAlmostEqual(
                    py_res[field],
                    ts_res[field],
                    places=5,
                    msg=f"case {idx} field {field}",
                )

    def test_camera_at_parity_with_film_stage(self) -> None:
        cam_keys = [
            {"t": 0.0, "p": [0, 2, 10], "l": [0, 1.5, 0], "ease": "inOut", "roll": 0},
            {"t": 2.0, "p": [6, 3, 6], "l": [1, 1.5, 0], "ease": "linear", "roll": 10},
            {"t": 5.0, "p": [8, 2, -4], "l": [0, 1.5, -2], "roll": -5},
            {"t": 6.0, "p": [-5, 4, 8], "l": [0, 1.6, 0], "cut": True, "ease": "out", "roll": 0},
            {"t": 9.0, "p": [-2, 2, 4], "l": [0, 1.6, 0], "roll": 0},
        ]
        sample_times = [0.0, 0.7, 2.0, 3.5, 5.99, 6.0, 7.5, 9.0]
        script = f"""
import {{ cameraAt }} from "./packages/film-stage/src/camera.ts";
const keys = {json.dumps(cam_keys)};
const times = {json.dumps(sample_times)};
console.log(JSON.stringify(times.map((t) => {{
  const c = cameraAt(t, keys);
  const src = c.base ?? c;
  return {{ p: [src.p.x, src.p.y, src.p.z], l: [src.l.x, src.l.y, src.l.z], roll: src.roll }};
}})));
"""
        proc = subprocess.run(
            ["bun", "-e", script],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=True,
        )
        ts_poses = json.loads(proc.stdout)
        for t, ts_pose in zip(sample_times, ts_poses):
            py_pose = spatial.camera_at(cam_keys, t)
            for axis in range(3):
                self.assertAlmostEqual(py_pose["p"][axis], ts_pose["p"][axis], places=3, msg=f"p[{axis}] at t={t}")
                self.assertAlmostEqual(py_pose["l"][axis], ts_pose["l"][axis], places=3, msg=f"l[{axis}] at t={t}")
            self.assertAlmostEqual(py_pose["roll"], ts_pose["roll"], places=3, msg=f"roll at t={t}")

    def test_convolution_and_spatial_dsp(self) -> None:
        sr = 48000
        # 0.2s burst impulse at t=0.05s followed by silence (1.2s total)
        dry = np.zeros((int(0.5 * sr), 2), dtype=np.float32)
        t = np.arange(int(0.15 * sr)) / sr
        burst = (0.5 * np.sin(2.0 * np.pi * 880.0 * t)).astype(np.float32)
        dry[int(0.05 * sr) : int(0.20 * sr), 0] = burst
        dry[int(0.05 * sr) : int(0.20 * sr), 1] = burst

        ir_l, ir_r = ir.generate_impulse_response("hall", sr)
        wet_out = ir.apply_convolution_reverb(dry, ir_l, ir_r, wet=0.5, pre_delay_ms=15, sample_rate=sr)
        self.assertTrue(np.all(np.isfinite(wet_out)))
        self.assertGreater(len(wet_out), len(dry) + int(0.5 * sr))
        # Reverb tail rings cleanly after dry buffer ended
        tail_rms = float(np.sqrt(np.mean(wet_out[len(dry) : len(dry) + int(0.5 * sr)] ** 2)))
        self.assertGreater(tail_rms, 1e-4)

        # Hard-right 3D source should put substantially more energy into right channel
        cam_keys = [{"t": 0.0, "p": [0, 1.6, 5], "l": [0, 1.6, 0]}]
        spec = {"at": [6, 1.6, 5], "refDistance": 2, "maxDistance": 40, "rolloff": 1}
        sig = np.tile(np.sin(2.0 * np.pi * 440.0 * np.arange(sr // 2) / sr)[:, None], (1, 2)).astype(np.float32)
        sp_out = spatial.apply_spatial_audio(sig, 0.0, sr, spec, cam_keys)
        self.assertTrue(np.all(np.isfinite(sp_out)))
        rms_l = float(np.sqrt(np.mean(sp_out[:, 0] ** 2)))
        rms_r = float(np.sqrt(np.mean(sp_out[:, 1] ** 2)))
        self.assertGreater(rms_r, rms_l * 4.0)

        # Path traversal guard on custom IR
        with self.assertRaises(ValueError):
            ir.resolve_custom_ir_file("../outside.wav", REPO_ROOT, lambda p, l: None)


class TestMixPyEndToEnd(unittest.TestCase):
    MIX_PY = os.path.join(REPO_ROOT, "scripts", "sound", "mix.py")

    def _write_wav(self, path: str, samples: np.ndarray, sr: int = 48000) -> None:
        from scipy.io import wavfile

        os.makedirs(os.path.dirname(path), exist_ok=True)
        wavfile.write(path, sr, np.asarray(samples, dtype=np.float32))

    def _read_wav_f32(self, path: str) -> tuple[int, np.ndarray]:
        from scipy.io import wavfile

        sr, data = wavfile.read(path)
        if np.issubdtype(data.dtype, np.integer):
            info = np.iinfo(data.dtype)
            arr = data.astype(np.float32) / float(max(abs(info.min), info.max))
        else:
            arr = data.astype(np.float32)
        return int(sr), arr

    def test_mix_py_spatial_moving_target_and_reverb_tail(self) -> None:
        import tempfile

        sr = 48000
        with tempfile.TemporaryDirectory(prefix="mix-spatial-e2e-") as tmp:
            sfx_dir = os.path.join(tmp, "sound", "sfx")
            tl_dir = os.path.join(tmp, "src", "timeline")
            os.makedirs(sfx_dir, exist_ok=True)
            os.makedirs(tl_dir, exist_ok=True)

            # 0.25s 660Hz burst for hall reverb + left spatial pan
            t_b = np.arange(int(0.25 * sr)) / sr
            burst = 0.6 * np.sin(2.0 * np.pi * 660.0 * t_b)
            self._write_wav(os.path.join(sfx_dir, "beep.wav"), np.column_stack((burst, burst)), sr)

            # 1.8s 440Hz tone for moving target tracking (dry)
            t_d = np.arange(int(1.8 * sr)) / sr
            drone = 0.5 * np.sin(2.0 * np.pi * 440.0 * t_d)
            self._write_wav(os.path.join(sfx_dir, "drone.wav"), np.column_stack((drone, drone)), sr)

            with open(os.path.join(tmp, "package.json"), "w", encoding="utf8") as f:
                json.dump(
                    {
                        "name": "spatial-fixture",
                        "live-studio": {
                            "duration": 5.0,
                            "soundVault": False,
                        },
                    },
                    f,
                )

            with open(os.path.join(tmp, "src", "edit.json"), "w", encoding="utf8") as f:
                json.dump({"end": 5.0}, f)

            with open(os.path.join(tl_dir, "cam.json"), "w", encoding="utf8") as f:
                json.dump(
                    [
                        {"t": 0.0, "p": [0, 1.6, 5], "l": [0, 1.6, 0], "wave": 0},
                        {"t": 5.0, "p": [0, 1.6, 5], "l": [0, 1.6, 0], "wave": 0},
                    ],
                    f,
                )

            with open(os.path.join(tl_dir, "placed.json"), "w", encoding="utf8") as f:
                json.dump(
                    {
                        "moving_mob": {
                            "keys": [
                                {"t": 2.6, "at": [-6, 1.6, 5], "ease": "linear"},
                                {"t": 4.4, "at": [6, 1.6, 5]},
                            ]
                        }
                    },
                    f,
                )

            with open(os.path.join(tl_dir, "audio.json"), "w", encoding="utf8") as f:
                json.dump(
                    {
                        "beds": [],
                        "sfx": [
                            {
                                "at": 0.5,
                                "name": "beep",
                                "gain": -6,
                                "spatial": {
                                    "at": [-8, 1.6, 5],
                                    "refDistance": 2,
                                    "maxDistance": 40,
                                },
                            },
                            {
                                "at": 2.6,
                                "name": "drone",
                                "gain": -6,
                                "reverb": {"space": "dry"},
                                "spatial": {
                                    "target": "moving_mob",
                                    "refDistance": 2,
                                    "maxDistance": 40,
                                },
                            },
                        ],
                        "spaces": [{"from": 0.0, "to": 2.5, "space": "hall", "wet": 0.45}],
                    },
                    f,
                )

            proc = subprocess.run(
                [sys.executable, self.MIX_PY],
                cwd=tmp,
                capture_output=True,
                text=True,
            )
            self.assertEqual(proc.returncode, 0, msg=f"stderr:\n{proc.stderr}\nstdout:\n{proc.stdout}")

            mix_wav = os.path.join(tmp, "sound", "mix.wav")
            self.assertTrue(os.path.isfile(mix_wav))
            out_sr, out = self._read_wav_f32(mix_wav)
            self.assertEqual(out_sr, 48000)
            self.assertEqual(out.ndim, 2)
            self.assertEqual(out.shape[1], 2)
            self.assertGreaterEqual(out.shape[0], int(4.9 * sr))
            self.assertTrue(np.all(np.isfinite(out)))

            def rms(a: float, b: float, ch: int) -> float:
                sl = out[int(a * sr) : int(b * sr), ch]
                return float(np.sqrt(np.mean(sl * sl)))

            # Beep at [-8, 1.6, 5] sits hard-left at [0.5, 0.75]
            self.assertGreater(rms(0.52, 0.72, 0), rms(0.52, 0.72, 1) * 1.5)
            # Hall reverb tail from beep persists past 0.75s into [0.90, 1.80] before drone starts
            self.assertGreater(rms(0.95, 1.65, 0) + rms(0.95, 1.65, 1), 1e-3)

            # Moving target starts left at [2.6, 3.0] and pans hard right by [4.0, 4.35]
            self.assertGreater(rms(2.65, 3.00, 0), rms(2.65, 3.00, 1) * 2.0)
            self.assertGreater(rms(4.00, 4.35, 1), rms(4.00, 4.35, 0) * 2.0)

    def test_mix_py_custom_ir_occlusion_and_path_traversal_guard(self) -> None:
        import tempfile

        sr = 48000
        with tempfile.TemporaryDirectory(prefix="mix-custom-ir-") as tmp:
            sfx_dir = os.path.join(tmp, "sound", "sfx")
            tl_dir = os.path.join(tmp, "src", "timeline")
            ir_dir = os.path.join(tmp, "assets", "ir")
            os.makedirs(sfx_dir, exist_ok=True)
            os.makedirs(tl_dir, exist_ok=True)
            os.makedirs(ir_dir, exist_ok=True)

            # 0.5s high-frequency 4000Hz tone to test occlusion LPF attenuation
            t = np.arange(int(0.5 * sr)) / sr
            hi = 0.6 * np.sin(2.0 * np.pi * 4000.0 * t)
            self._write_wav(os.path.join(sfx_dir, "hiss.wav"), np.column_stack((hi, hi)), sr)

            # Custom IR WAV inside film directory
            ir_t = np.arange(int(0.6 * sr)) / sr
            rng = np.random.default_rng(7)
            custom_ir = rng.normal(0.0, 1.0, (len(ir_t), 2)) * np.exp(-6.0 * ir_t)[:, None]
            self._write_wav(os.path.join(ir_dir, "custom.wav"), custom_ir, sr)

            with open(os.path.join(tmp, "package.json"), "w", encoding="utf8") as f:
                json.dump({"name": "ir-fixture", "live-studio": {"duration": 2.5, "soundVault": False}}, f)
            with open(os.path.join(tmp, "src", "edit.json"), "w", encoding="utf8") as f:
                json.dump({"end": 2.5}, f)
            with open(os.path.join(tl_dir, "cam.json"), "w", encoding="utf8") as f:
                json.dump([{"t": 0.0, "p": [0, 0, 5], "l": [0, 0, 0], "wave": 0}], f)

            # 1) Custom IR + no occlusion
            with open(os.path.join(tl_dir, "audio.json"), "w", encoding="utf8") as f:
                json.dump(
                    {
                        "beds": [],
                        "sfx": [
                            {
                                "at": 0.2,
                                "name": "hiss",
                                "gain": -6,
                                "reverb": {"space": "assets/ir/custom.wav", "wet": 0.5, "preDelayMs": 10},
                                "spatial": {"at": [0, 0, 0], "occlusion": 0.0},
                            }
                        ],
                    },
                    f,
                )
            subprocess.run(
                [sys.executable, self.MIX_PY, "--raw", "sound/clear.wav"],
                cwd=tmp,
                check=True,
                capture_output=True,
                text=True,
            )
            _, out_clear = self._read_wav_f32(os.path.join(tmp, "sound", "clear.wav"))

            # 2) Same clip with full occlusion (LPF ~380Hz drops 4kHz tone dramatically)
            with open(os.path.join(tl_dir, "audio.json"), "w", encoding="utf8") as f:
                json.dump(
                    {
                        "beds": [],
                        "sfx": [
                            {
                                "at": 0.2,
                                "name": "hiss",
                                "gain": -6,
                                "reverb": {"space": "dry"},
                                "spatial": {"at": [0, 0, 0], "occlusion": 1.0},
                            }
                        ],
                    },
                    f,
                )
            subprocess.run(
                [sys.executable, self.MIX_PY, "--raw", "sound/occ.wav"],
                cwd=tmp,
                check=True,
                capture_output=True,
                text=True,
            )
            _, out_occ = self._read_wav_f32(os.path.join(tmp, "sound", "occ.wav"))

            clear_energy = float(np.sqrt(np.mean(out_clear[int(0.25 * sr) : int(0.65 * sr)] ** 2)))
            occ_energy = float(np.sqrt(np.mean(out_occ[int(0.25 * sr) : int(0.65 * sr)] ** 2)))
            self.assertGreater(clear_energy, occ_energy * 8.0)
            # Custom IR leaves reverb tail past 0.7s
            tail_energy = float(np.sqrt(np.mean(out_clear[int(0.8 * sr) : int(1.2 * sr)] ** 2)))
            self.assertGreater(tail_energy, 1e-3)

            # 3) Path traversal is rejected safely
            with open(os.path.join(tl_dir, "audio.json"), "w", encoding="utf8") as f:
                json.dump(
                    {
                        "beds": [],
                        "sfx": [{"at": 0.2, "name": "hiss", "gain": -6, "reverb": {"space": "../outside.wav"}}],
                    },
                    f,
                )
            bad = subprocess.run([sys.executable, self.MIX_PY], cwd=tmp, capture_output=True, text=True)
            self.assertNotEqual(bad.returncode, 0)


if __name__ == "__main__":
    unittest.main()
