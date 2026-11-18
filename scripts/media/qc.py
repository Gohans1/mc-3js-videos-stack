"""Optional deterministic QC: caller-defined measurements, never creative approval.

bun run media qc request.json --minutes 5 --out renders/qc
bun run media qc --contract
Use absolute input/reference/transcript paths in requests. Rules and native schema
are available in --contract; a measured FAIL/UNKNOWN is distinct from execution failure.
No models, installation or uploads. Sources and the original request stay intact.
This adapter runs fresh measurements without the upstream cache. Use cache_policy
use or bypass; only requires a cache and produces a cache-miss failure here.
"""
import argparse
import contextlib
import hashlib
import io
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "third-party/qc-skill/src"))
from qc_skill.cli import main as native_main
from qc_skill.contract import skill_contract
from qc_skill.errors import QCError
from qc_skill.schemas import parse_request


def main():
    parser = argparse.ArgumentParser(
        description=__doc__,
        allow_abbrev=False,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("request", type=Path, nargs="?")
    parser.add_argument("--contract", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--out", type=Path, default=os.environ.get("MC_MEDIA_RUN_DIR"))
    args = parser.parse_args()
    if args.contract:
        if args.request:
            parser.error("--contract takes no request")
        print(json.dumps(skill_contract(), ensure_ascii=False))
        return 0
    if not args.request:
        parser.error("provide request.json or --contract")
    try:
        raw = args.request.read_bytes()
        document = json.loads(raw)
        parse_request(document)
    except (OSError, TypeError, ValueError, QCError) as error:
        parser.error(str(error))
    if args.dry_run:
        print(json.dumps({
            "tool": "qc",
            "request": str(args.request.resolve()),
            "requiredFiles": [],
            "clock": "input-file seconds",
        }))
        return 0
    if args.out is None:
        parser.error("run via bun run media, or provide --out")
    out = args.out.resolve()
    if out.exists() and any(p.name not in ("job.json", "process.log") for p in out.iterdir()):
        parser.error("--out must be empty; keep previous evidence")
    out.mkdir(parents=True, exist_ok=True)
    (out / "request.json").write_bytes(raw)
    result = {
        "schemaVersion": 1,
        "status": "running",
        "backend": {"name": "qc-skill", "version": "1.4.0", "codeLicense": "MIT"},
        "requestSha256": hashlib.sha256(raw).hexdigest(),
        "clock": "input-file seconds",
    }

    def save():
        pending = out / "result.json.tmp"
        pending.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        pending.replace(out / "result.json")

    save()
    try:
        original_stdin = sys.stdin
        try:
            with (
                io.StringIO(json.dumps(document)) as native_request,
                (out / "native.json").open("w", encoding="utf-8") as stream,
                contextlib.redirect_stdout(stream),
            ):
                sys.stdin = native_request
                code = native_main(["run", "-", "--json", "--workspace", str(out), "--no-cache"])
        finally:
            sys.stdin = original_stdin
        result["native"] = json.loads((out / "native.json").read_text(encoding="utf-8"))
        result["status"] = "completed" if code == 0 else "failed"
    except (Exception, KeyboardInterrupt) as error:
        code = 1
        result.update(status="failed", error=str(error))
    save()
    print(out / "result.json")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
