"""Foley optional alpha sound catalog: index, search, status, describe.
Use --config with native Foley TOML: explicit [library] root and [storage] data_dir.
Paths follow the invoking directory, as in the native CLI; absolute paths are clearer.
For this PC use [models] enabled=true, device="cpu", clap=["htsat-unfused"].
Index defaults to 20 analyses/one worker; its scan may cover the complete selected root.
SQLite progress and caches survive interruption; rerun index to resume.
First CLAP use downloads an upstream pinned model; media is never uploaded.
CLI --out is an evidence parent, --minutes bounds the job (default 5).
Search similarity is not confidence; catalog license fields do not grant media rights.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tomllib
from pathlib import Path

from native import digest


def main():
    parser = argparse.ArgumentParser(prog="bun run media foley", description=__doc__, allow_abbrev=False, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("action", choices=("index", "search", "status", "describe"))
    parser.add_argument("value", nargs="?", help="quoted search phrase, or asset ID/relative path")
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--workers", type=int, default=1)
    parser.add_argument("--out", type=Path, default=os.environ.get("MC_MEDIA_RUN_DIR"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    try:
        config = tomllib.loads(args.config.read_text(encoding="utf-8"))
        if not all(isinstance(config[s][k], str) and config[s][k].strip() for s, k in (("library", "root"), ("storage", "data_dir"))):
            raise ValueError("library.root and storage.data_dir must be explicit nonempty paths")
        library = Path(config["library"]["root"]).resolve()
        storage = Path(config["storage"]["data_dir"]).resolve()
        if not library.is_dir() or storage.is_relative_to(library):
            raise ValueError("library.root must exist; storage.data_dir must be outside it")
        if args.limit < 1 or args.workers < 1:
            raise ValueError("--limit and --workers must be positive")
        if args.action in ("search", "describe") and (not args.value or not args.value.strip()):
            raise ValueError("search/describe requires a nonempty value")
        if args.action in ("index", "status") and args.value:
            raise ValueError("index/status takes no value")
    except (OSError, ValueError, TypeError, KeyError) as error:
        parser.error(str(error))
    root = Path(__file__).resolve().parents[2]
    home = Path(os.environ.get("MC_MEDIA_TOOL_HOME", root / "vault/tools/media/foley"))
    plan = {"action": args.action, "value": args.value, "config": str(args.config.resolve()),
            "library": str(library), "storage": str(storage), "limit": args.limit, "workers": args.workers}
    if args.dry_run:
        print(json.dumps(plan))
        return 0
    if args.out is None:
        parser.error("run via bun run media or provide an empty --out")
    out = args.out.resolve()
    if out.exists() and any(p.name not in ("job.json", "process.log") for p in out.iterdir()):
        parser.error("--out must be empty; existing evidence is kept intact")
    out.mkdir(parents=True, exist_ok=True)
    result = {"status": "partial", "plan": plan, "configSha256": digest(args.config)}

    def save():
        pending = out / "result.json.tmp"
        pending.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        pending.replace(out / "result.json")

    save()
    try:
        shutil.copyfile(args.config, out / "configuration.toml")
        if args.action == "index" and config.get("models", {}).get("enabled", True):
            profile = json.loads((root / "scripts/media/tools.json").read_text(encoding="utf-8"))["foley"]
            result["pannsCache"] = {}
            for asset in profile["assets"]:
                if not asset["path"].startswith("models/panns/"):
                    continue
                cached = home / asset["path"]
                if not cached.is_file() or digest(cached) != asset["sha256"]:
                    raise ValueError("verified PANNs cache missing; run media setup foley")
                target = storage / "models/panns" / cached.name
                if target.exists():
                    if digest(target) != asset["sha256"]:
                        raise ValueError(f"existing PANNs cache differs; retained: {target}")
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    pending = target.with_suffix(".pending")
                    shutil.copyfile(cached, pending)
                    pending.replace(target)
                result["pannsCache"][cached.name] = asset["sha256"]
        env = {**os.environ, "HF_HOME": str(home / "models/hf"), "OMP_NUM_THREADS": "2", "MKL_NUM_THREADS": "2",
               "TOKENIZERS_PARALLELISM": "false"}
        base = [sys.executable, "-m", "foley.cli", "--config", str(args.config.resolve())]
        command = base + [args.action]
        if args.value:
            command += [args.value]
        if args.action in ("index", "search"):
            command += ["--limit", str(args.limit)]
        if args.action == "index":
            command += ["--workers", str(args.workers)]
        if args.action == "search":
            command += ["--json"]
        result["command"] = command
        save()
        with (out / "native.stdout.txt").open("w", encoding="utf-8") as log:
            subprocess.run(command, stdout=log, env=env, check=True)
        if args.action == "index":
            with (out / "catalog-status.json").open("w", encoding="utf-8") as log:
                subprocess.run(base + ["status"], stdout=log, env=env, check=True)
            result["catalog"] = json.loads((out / "catalog-status.json").read_text(encoding="utf-8"))
            result["completion"] = "native index completed; inspect pending/error/model stage counts in catalog"
        else:
            result["data"] = json.loads((out / "native.stdout.txt").read_text(encoding="utf-8"))
        result["status"] = "completed"
    except (Exception, KeyboardInterrupt) as error:
        result.update(status="failed", error=str(error))
        print(str(error), file=sys.stderr)
    save()
    print(out / "result.json")
    return 0 if result["status"] == "completed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
