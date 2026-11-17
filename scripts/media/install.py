"""Install the pinned native assets of a media profile; invoked by media setup.
Downloads resume in the persistent cache, verify size/SHA-256 and retain source records.
Archives keep upstream notices and refuse traversal, symlinks or changed existing files.
"""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path


def sha256(file):
    with Path(file).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def verify(file, digest, size):
    if Path(file).stat().st_size != size or sha256(file) != digest:
        raise ValueError(f"size/SHA-256 mismatch; retained for inspection: {file}")


def extract_verified(file, destination, digest, size):
    verify(file, digest, size)
    root = Path(destination).resolve()
    with zipfile.ZipFile(file) as archive:
        for entry in archive.infolist():
            target = (root / entry.filename).resolve()
            if not target.is_relative_to(root) or (entry.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError(f"unsafe archive path: {entry.filename}")
            if target.is_file() and not entry.is_dir():
                with archive.open(entry) as source:
                    expected = hashlib.file_digest(source, "sha256").hexdigest()
                if sha256(target) != expected:
                    raise ValueError(f"existing file changed; left intact: {target}")
        root.mkdir(parents=True, exist_ok=True)
        for entry in archive.infolist():
            target = root / entry.filename
            if entry.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            elif not target.exists():
                target.parent.mkdir(parents=True, exist_ok=True)
                with tempfile.NamedTemporaryFile(dir=target.parent, suffix=".part", delete=False) as pending:
                    temporary = Path(pending.name)
                try:
                    with archive.open(entry) as source, temporary.open("wb") as destination:
                        shutil.copyfileobj(source, destination)
                    os.replace(temporary, target)
                finally:
                    temporary.unlink(missing_ok=True)


def prepare_source(repository, revision, source):
    fresh = not source.exists()
    if fresh:
        subprocess.run(["git", "-c", "core.symlinks=false", "clone", "--filter=blob:none", "--no-checkout", repository, str(source)], check=True, timeout=180)
    current = subprocess.run(["git", "-C", str(source), "rev-parse", "HEAD"], capture_output=True, text=True, timeout=15)
    if current.returncode or current.stdout.strip() != revision:
        subprocess.run(["git", "-C", str(source), "fetch", "--depth", "1", "origin", revision], check=True, timeout=180)
    subprocess.run(["git", "-C", str(source), "checkout", "--detach", revision], check=True, timeout=180)


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("tool")
    parser.add_argument("--home", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    profiles = json.loads((root / "scripts/media/tools.json").read_text(encoding="utf-8"))
    if args.tool not in profiles:
        parser.error("unknown media tool")
    profile = profiles[args.tool]
    home = (args.home / args.tool).resolve()
    home.mkdir(parents=True, exist_ok=True)
    records = []

    def receipt(status):
        pending = home / "installed.json.tmp"
        pending.write_text(json.dumps({"tool": args.tool, "status": status, "assets": records}, indent=2) + "\n")
        pending.replace(home / "installed.json")

    for asset in profile.get("assets", []):
        if not asset["url"].startswith("https://"):
            raise ValueError("native asset URLs require HTTPS")
        target = (home / asset["path"]).resolve()
        if not target.is_relative_to(home):
            raise ValueError("asset path must stay in its tool cache")
        if not target.is_file() or target.stat().st_size != asset["size"]:
            target.parent.mkdir(parents=True, exist_ok=True)
            subprocess.run(["curl", "--fail", "--location", "--retry", "2", "--connect-timeout", "20",
                            "--max-time", "300", "--continue-at", "-", "--output", str(target), asset["url"]],
                           check=True, timeout=330)
        verify(target, asset["sha256"], asset["size"])
        if asset.get("unpackTo"):
            destination = (home / asset["unpackTo"]).resolve()
            if not destination.is_relative_to(home):
                raise ValueError("archive destination must stay in its tool cache")
            extract_verified(target, destination, asset["sha256"], asset["size"])
        record = {**asset, "verified": True}
        records.append(record)
        receipt("partial")
        print(f"verified: {target}", flush=True)
    build = profile.get("build")
    if build:
        source, directory = home / "source", home / "build"
        prepare_source(build["repository"], build["revision"], source)
        subprocess.run(["cmake", "-S", str(source), "-B", str(directory), "-G", "MinGW Makefiles",
                        "-DGGML_NATIVE=OFF", "-DGGML_CUDA=OFF", "-DLLAMA_CURL=OFF", "-DCMAKE_BUILD_TYPE=Release"], check=True, timeout=180)
        subprocess.run(["cmake", "--build", str(directory), "--target", build["target"], "--parallel", "2"], check=True, timeout=900)
    receipt("completed")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, subprocess.SubprocessError, zipfile.BadZipFile) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
