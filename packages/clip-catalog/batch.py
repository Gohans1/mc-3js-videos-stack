"""Build measured mocap tags, retarget checks, or review sheets from a film's render page.
python ../../packages/clip-catalog/batch.py catalog|sweep|sheets [mixamo ual1 ual2] [--limit N] [--timeout SECONDS]
The .sh entries call this same runner. Requires Python and Bun; sheets/pages also need Pillow.
Writes shared vault/motion/catalog data, not a film's timeline. All clips, including fights, remain reviewable.
Chunks take up to 600 s each; --limit bounds the whole run's clip count. Logs are saved in catalog/logs.
Completed rows/sheets survive failure or Ctrl+C; rerun the same command to retry errors and missing clips.
For fresh measurements after retarget/tag code changes, archive the old per-library JSONL first.
"""
import argparse
import json
import os
from pathlib import Path
import signal
import shutil
import struct
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
MOTION = HERE.parents[1] / "vault/motion"
LIBRARIES = {"ual1": "ual1/AnimationLibrary_Godot_Standard.gltf", "ual2": "ual2/UAL2_Standard.glb"}
ENTRIES = {"catalog": "catalog.ts", "sweep": "mocap.ts", "sheets": "catalog_sheet.ts"}


def read_rows(path):
    rows = {}
    if path.exists():
        for n, line in enumerate(path.read_text(encoding="utf8").splitlines(), 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
                key = row.get("ref", row.get("clip"))
                if not isinstance(key, str):
                    raise ValueError("needs ref or clip")
                rows[key] = row
            except (ValueError, AttributeError) as e:
                raise ValueError(f"{path}:{n}: {e}; repair this JSONL line before resuming") from e
    return rows


def completed(path, mode):
    return {key.split("/", 1)[-1] if mode == "catalog" else key
            for key, row in read_rows(path).items() if "error" not in row}


def clip_names(lib):
    path = MOTION / ("mixamo/_tools/clips.json" if lib == "mixamo" else LIBRARIES[lib])
    raw = path.read_bytes()
    if lib == "mixamo":
        names = json.loads(raw)
    else:
        gltf = json.loads(raw[20:20 + struct.unpack("<I", raw[12:16])[0]] if raw[:4] == b"glTF" else raw)
        names = [a["name"] for a in gltf["animations"]]
    if any(not isinstance(n, str) or not n or "," in n or "/" in n or "\\" in n for n in names):
        raise ValueError(f"{path}: clip names must be nonempty basenames without commas (LAB_CLIPS separator)")
    return list(dict.fromkeys(names))


def stop(proc):
    if proc.poll() is None:
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True, timeout=15)
        else:
            os.killpg(proc.pid, signal.SIGKILL)
        proc.wait(timeout=15)


def run_batch(command, cwd, output, mode, lib, names, timeout):
    log_dir = output.parent / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"{mode}_{lib}_{time.time_ns()}.log"
    env = {k: v for k, v in os.environ.items() if not k.startswith("LAB_")}
    env.update(ENTRY=str(HERE / ENTRIES[mode]), LAB_LIB=lib, LAB_CLIPS=",".join(names))
    if mode == "sheets":
        for name in names:
            (cwd / "renders" / f"sheet_{lib}__{name}.jpg").unlink(missing_ok=True)
    reason = None
    with log_path.open("w", encoding="utf8") as log:
        proc = subprocess.Popen(command, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT,
                                start_new_session=os.name != "nt",
                                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0)
        try:
            proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            reason = f"timed out after {timeout}s"
        except KeyboardInterrupt:
            reason = "interrupted"
        finally:
            stop(proc)
    failed = []
    got = set()
    lines = log_path.read_text(encoding="utf8", errors="replace").splitlines()
    if mode == "sheets":
        failed = [name for name in names if any(line.startswith(f"SHEET FAIL {lib}/{name}:") for line in lines)]
        sheets = output.parent / "sheets"
        sheets.mkdir(exist_ok=True)
        for name in names:
            source = cwd / "renders" / f"sheet_{lib}__{name}.jpg"
            if source.exists() and name not in failed:
                destination = sheets / f"{lib}__{name}.jpg"
                tmp = destination.with_suffix(".jpg.new")
                shutil.copyfile(source, tmp)
                tmp.replace(destination)
                source.unlink()
                got.add(name)
    else:
        with output.open("a", encoding="utf8", newline="\n") as out:
            for line in lines:
                if not line.startswith("ROW "):
                    continue
                row = json.loads(line[4:])
                name = row.get("ref", "").removeprefix(f"{lib}/") if mode == "catalog" else row.get("clip")
                if name not in names:
                    raise ValueError(f"unexpected ROW in {log_path}: {name}")
                out.write(json.dumps(row, ensure_ascii=False) + "\n")
                out.flush()
                got.add(name)
                if "error" in row:
                    failed.append(name)
    missing = set(names) - got
    if reason or proc.returncode or missing or failed:
        raise RuntimeError(f"{mode}/{lib}: {reason or f'render exit {proc.returncode}'}; "
                           f"{len(missing)} missing, {len(failed)} failed. Completed results kept. "
                           f"Read {log_path}; fix the cause and rerun the same command")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("mode", choices=ENTRIES)
    ap.add_argument("libs", nargs="*", help="mixamo, ual1, ual2; default: all for tags/sheets, mixamo for sweep")
    ap.add_argument("--limit", type=int, help="at most this many pending clips across libraries")
    ap.add_argument("--timeout", type=float, default=600, help="seconds per chunk (default 600)")
    a = ap.parse_args(["--help"] if sys.argv[1:2] == ["help"] or sys.argv[2:3] == ["help"] else None)
    libs = a.libs or (["mixamo"] if a.mode == "sweep" else ["mixamo", "ual1", "ual2"])
    if any(lib not in ["mixamo", *LIBRARIES] for lib in libs):
        ap.error("libraries are mixamo ual1 ual2")
    if a.timeout <= 0 or not a.timeout < float("inf") or (a.limit is not None and a.limit <= 0):
        ap.error("--timeout and --limit must be positive finite numbers")
    cwd = Path.cwd()
    if not (cwd / "src/scene.ts").is_file():
        ap.error("cd films/<name> first; the batch renders on that film's page")
    cat = MOTION / "catalog"
    try:
        jobs = []
        remaining = a.limit
        for lib in dict.fromkeys(libs):
            out = cat / (f"sweep_{lib}.jsonl" if a.mode == "sweep" else f"{lib}.jsonl")
            if a.mode == "sheets":
                if not out.exists():
                    raise ValueError(f"missing {out}: run batch.py catalog {lib} first")
                names = [ref.split("/", 1)[1] for ref, row in read_rows(out).items() if "error" not in row]
                done = {n for n in names if (cat / "sheets" / f"{lib}__{n}.jpg").exists()}
            else:
                names, done = clip_names(lib), completed(out, a.mode)
            todo = [n for n in names if n not in done][:remaining]
            if remaining is not None:
                remaining -= len(todo)
            jobs.append((lib, out, todo))
    except (OSError, ValueError) as e:
        ap.error(str(e))
    try:
        for lib, out, todo in jobs:
            print(f"{lib}: {len(todo)} pending; at most {a.timeout}s per chunk; logs: {cat / 'logs'}", flush=True)
            size = 20 if a.mode == "sweep" else 40
            for i in range(0, len(todo), size):
                run_batch(["bun", "run", "render", "stills"], cwd, out, a.mode, lib, todo[i:i + size], a.timeout)
                print(f"{lib}: {min(i + size, len(todo))}/{len(todo)} saved", flush=True)
    except (OSError, ValueError, RuntimeError) as e:
        print(e, file=sys.stderr)
        return 1
    next_script = {"catalog": "catalog_check.py", "sweep": "sweep_report.py", "sheets": "catalog_review.py"}[a.mode]
    print(f"next: python ../../packages/clip-catalog/{next_script}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
