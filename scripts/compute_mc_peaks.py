"""Batch-computes duration and 50 Hz (0.02 s) waveform peak envelopes for .ogg/.wav files in a vault directory.
Incrementally reuses unchanged entries from PEAKS.json and checkpoints every 500 files so interrupted runs lose nothing."""

from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import subprocess
import sys

STEP = 0.02

try:
    import numpy as np
    import soundfile as sf

    HAS_SF = True
except Exception:
    HAS_SF = False


def peaks_via_soundfile(path: Path):
    data, sr = sf.read(str(path), dtype="float32", always_2d=True)
    frames = len(data)
    if frames == 0 or sr <= 0:
        return {"seconds": 0.0, "step": STEP, "peaks": []}
    seconds = round(frames / sr, 3)
    mono = np.max(np.abs(data), axis=1)
    n_bins = max(1, round(frames / sr / STEP))
    edges = np.linspace(0, frames, n_bins + 1, dtype=np.int64)
    # Vectorized reduceat over bin starts; clamp empty slices safely
    starts = np.minimum(edges[:-1], frames - 1)
    raw = np.maximum.reduceat(mono, starts)
    empty = edges[1:] <= edges[:-1]
    if np.any(empty):
        raw[empty] = 0.0
    peaks = np.minimum(1.0, np.round(raw.astype(np.float64), 3)).tolist()
    return {"seconds": seconds, "step": STEP, "peaks": peaks}


def peaks_via_ffmpeg(path: Path):
    rate = 8000
    res = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(rate), "-f", "s16le", "-"],
        capture_output=True,
        timeout=30,
        check=True,
    )
    pcm = memoryview(res.stdout).cast("h")
    frames = len(pcm)
    if frames == 0:
        return {"seconds": 0.0, "step": STEP, "peaks": []}
    seconds = round(frames / rate, 3)
    n_bins = max(1, round(frames / rate / STEP))
    peaks = []
    for i in range(n_bins):
        a = int(i * frames / n_bins)
        b = max(a + 1, int((i + 1) * frames / n_bins))
        hi = max(abs(s) for s in pcm[a:b]) / 32768.0
        peaks.append(min(1.0, round(hi, 3)))
    return {"seconds": seconds, "step": STEP, "peaks": peaks}


def compute_one(item):
    name, path, size, mtime_ns = item
    info = peaks_via_soundfile(path) if HAS_SF else peaks_via_ffmpeg(path)
    return name, {**info, "_s": size, "_m": mtime_ns}


def write_atomic(target: Path, payload: dict):
    tmp = target.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf8")
    os.replace(tmp, target)


def main():
    vault = Path(sys.argv[1]).resolve()
    out_file = vault / "PEAKS.json"
    cache_file = vault / ".peaks-cache.json"

    cached = {}
    if cache_file.exists():
        try:
            cached = json.loads(cache_file.read_text(encoding="utf8"))
        except Exception:
            cached = {}

    files = {}
    for sub in ("mc", "bgm", "sfx"):
        base = vault / sub
        if not base.exists():
            continue
        for p in sorted(base.rglob("*")):
            if p.is_file() and p.suffix.lower() in (".ogg", ".wav") and not p.name.startswith("."):
                files[p.stem] = p

    todo = []
    kept = {}
    for name, p in files.items():
        st = p.stat()
        prev = cached.get(name)
        if (
            isinstance(prev, dict)
            and prev.get("_s") == st.st_size
            and prev.get("_m") == st.st_mtime_ns
            and isinstance(prev.get("peaks"), list)
        ):
            kept[name] = prev
        else:
            todo.append((name, p, st.st_size, st.st_mtime_ns))

    if todo:
        workers = min(8, max(1, (os.cpu_count() or 4)))
        done_count = 0
        with ThreadPoolExecutor(max_workers=workers) as pool:
            for name, entry in pool.map(compute_one, todo):
                kept[name] = entry
                done_count += 1
                if done_count % 500 == 0:
                    write_atomic(cache_file, kept)

    write_atomic(cache_file, kept)
    public = {
        k: {"seconds": kept[k]["seconds"], "step": kept[k]["step"], "peaks": kept[k]["peaks"]}
        for k in sorted(kept)
    }
    write_atomic(out_file, public)
    print(f"PEAKS.json: {len(public)} entries ({len(todo)} computed, {len(public) - len(todo)} cached)")


if __name__ == "__main__":
    main()
