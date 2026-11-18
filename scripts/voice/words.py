"""Word timings for voice takes with whisperX (GPU), plus the pitch range of each take as a rough check that the acting is
not flat. Run through bun run voice:align in a film (a python with whisperX: WHISPERX_PYTHON, INSTALL.md).
Writes FILE.words.json beside each take. Unprimed on purpose: no script is given, so a mumbled word shows up as wrong text."""
from __future__ import annotations

import json
import math
import os
import re
import sys
from pathlib import Path

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

HELP = """Writes whisperX word timings (FILE.words.json) beside each audio take.
Usage: words.py [--lang <code>] <audio-file> [<audio-file> ...]
Options:
  --lang <code>   Override WhisperX language code for all files (else WHISPERX_LANGS / src/edit.json / en)
  -h, --help      Show this help and exit
Environment:
  WHISPERX_LANGS         Optional JSON object mapping audio path -> language code
  WHISPER_DEVICE         cuda or cpu (auto-detected if unset)
  WHISPER_COMPUTE_TYPE   float16 or int8 (auto-selected per device if unset)
"""

_VIET_RE = re.compile(
    r"[ăâđêôơưĂÂĐÊÔƠƯáàãíìĩóòõúùũýỳỹÁÀÃÍÌĨÓÒÕÚÙŨÝỲỸ\u1EA0-\u1EF9]|[\u0306\u0309\u031B\u0323]"
)
_AUDIO_TAG_RE = re.compile(r"\[[^\]\r\n]{1,400}\]")


def _normalize_lang(code: object) -> str | None:
    if not isinstance(code, str):
        return None
    base = code.strip().lower().split("-")[0].split("_")[0]
    return base if base.isalpha() and 2 <= len(base) <= 3 else None


def _parse_args(argv: list[str]) -> tuple[str | None, list[str]]:
    if "-h" in argv or "--help" in argv or (argv and argv[0] == "help"):
        print(HELP.rstrip())
        sys.exit(0)
    forced_lang: str | None = None
    files: list[str] = []
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--":
            files.extend(argv[i + 1 :])
            break
        if arg.startswith("-") and len(arg) > 1:
            if "=" in arg:
                sys.stderr.write(
                    f"write {arg.replace('=', ' ', 1)}: a space between an option and its value, not =\n"
                )
                sys.exit(2)
            if arg == "--lang":
                if i + 1 >= len(argv) or (argv[i + 1].startswith("-") and len(argv[i + 1]) > 1):
                    sys.stderr.write("--lang needs a value: --lang <code> (--help for everything)\n")
                    sys.exit(2)
                lang = _normalize_lang(argv[i + 1])
                if lang is None:
                    sys.stderr.write(
                        f"invalid --lang {argv[i + 1]!r}: expected ISO language code like en or vi\n"
                    )
                    sys.exit(2)
                forced_lang = lang
                i += 2
                continue
            sys.stderr.write(
                f"unknown option {arg}: this command takes --lang <code> (--help for everything)\n"
            )
            sys.exit(2)
        files.append(arg)
        i += 1
    if not files:
        sys.stderr.write("need at least one audio file (--help for everything)\n")
        sys.exit(2)
    return forced_lang, files


def _load_lang_map() -> dict[str, str]:
    raw = os.environ.get("WHISPERX_LANGS")
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except Exception:
        return {}
    if not isinstance(parsed, dict):
        return {}
    out: dict[str, str] = {}
    for k, v in parsed.items():
        lang = _normalize_lang(v)
        if isinstance(k, str) and lang:
            out[os.path.normcase(os.path.abspath(k))] = lang
    return out


def _lang_from_edit_json(audio_path: Path) -> str | None:
    resolved = audio_path.resolve()
    if resolved.parent.name != "takes" or resolved.parent.parent.name != "voice":
        return None
    edit_file = resolved.parent.parent.parent / "src" / "edit.json"
    if not edit_file.is_file():
        return None
    try:
        takes = json.loads(edit_file.read_text(encoding="utf-8")).get("takes")
    except Exception:
        return None
    if not isinstance(takes, list):
        return None
    stem = resolved.stem
    matched: dict | None = None
    best_len = -1
    for take in takes:
        if not isinstance(take, dict) or not isinstance(take.get("id"), str):
            continue
        tid = take["id"]
        if stem == tid or (
            len(tid) > best_len
            and any(stem.startswith(f"{tid}{sep}") for sep in (".", "_", "-"))
        ):
            matched = take
            best_len = len(tid)
    if not matched:
        return None
    explicit = _normalize_lang(matched.get("language"))
    if explicit:
        return explicit
    text = matched.get("text")
    if isinstance(text, str):
        clean = _AUDIO_TAG_RE.sub(" ", text)
        if _VIET_RE.search(clean):
            return "vi"
    return None


def _finite_nonneg(value: object) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(num) or num < 0:
        return None
    return num


def _extract_words(segments: object) -> list[dict[str, object]]:
    if not isinstance(segments, list):
        return []
    words: list[dict[str, object]] = []
    for seg in segments:
        if not isinstance(seg, dict):
            continue
        seg_lo = _finite_nonneg(seg.get("start"))
        seg_hi = _finite_nonneg(seg.get("end"))
        raw_words = seg.get("words") if isinstance(seg.get("words"), list) else []
        tokens: list[tuple[str, float | None, float | None]] = []
        for item in raw_words:
            if not isinstance(item, dict):
                continue
            text = str(item.get("word") or "").strip()
            if text:
                tokens.append((text, _finite_nonneg(item.get("start")), _finite_nonneg(item.get("end"))))
        if not tokens:
            seg_text = str(seg.get("text") or "").strip()
            if seg_text and seg_lo is not None and seg_hi is not None:
                tokens = [(tok, None, None) for tok in seg_text.split()]
        if not tokens:
            continue

        lo_bound = seg_lo if seg_lo is not None else next((s for _, s, _ in tokens if s is not None), None)
        hi_bound = seg_hi if seg_hi is not None else next((e for _, _, e in reversed(tokens) if e is not None), None)
        if lo_bound is None and hi_bound is None:
            continue
        if lo_bound is None:
            lo_bound = hi_bound
        if hi_bound is None:
            hi_bound = lo_bound
        assert lo_bound is not None and hi_bound is not None
        hi_bound = max(lo_bound, hi_bound)

        resolved: list[tuple[str, float, float] | None] = [None] * len(tokens)
        for idx, (text, ws, we) in enumerate(tokens):
            if ws is not None and we is not None:
                s = max(0.0, ws)
                resolved[idx] = (text, s, max(s, we))

        idx = 0
        while idx < len(tokens):
            if resolved[idx] is not None:
                idx += 1
                continue
            end_run = idx
            while end_run + 1 < len(tokens) and resolved[end_run + 1] is None:
                end_run += 1
            left_t = lo_bound
            for prev in range(idx - 1, -1, -1):
                entry = resolved[prev]
                if entry is not None:
                    left_t = entry[2]
                    break
            if tokens[idx][1] is not None:
                left_t = max(left_t, tokens[idx][1] or 0.0)
            right_t = hi_bound
            for nxt in range(end_run + 1, len(tokens)):
                entry = resolved[nxt]
                if entry is not None:
                    right_t = entry[1]
                    break
            if tokens[end_run][2] is not None:
                right_t = max(left_t, tokens[end_run][2] or left_t)
            span_hi = max(left_t, right_t)
            count = end_run - idx + 1
            for k in range(idx, end_run + 1):
                t0 = left_t + (span_hi - left_t) * (k - idx) / count
                t1 = left_t + (span_hi - left_t) * (k - idx + 1) / count
                s = tokens[k][1] if (tokens[k][1] is not None and left_t <= tokens[k][1] <= t1) else t0
                e = tokens[k][2] if (tokens[k][2] is not None and s <= tokens[k][2] <= span_hi) else t1
                resolved[k] = (tokens[k][0], s, max(s, e))
            idx = end_run + 1

        for entry in resolved:
            if entry is None:
                continue
            text, s, e = entry
            s_r = round(max(0.0, s), 3)
            e_r = round(max(s_r, e), 3)
            words.append({"w": text, "s": s_r, "e": e_r})
    return words


def _validate_paths(audio_arg: str) -> None:
    src = Path(audio_arg)
    if not src.exists():
        raise FileNotFoundError(f"audio file not found: {audio_arg}")
    if src.is_symlink() or not src.is_file():
        raise ValueError(f"not a regular audio file: {audio_arg}")
    dst = Path(f"{audio_arg}.words.json")
    if dst.is_symlink():
        raise ValueError(f"refusing to overwrite symlink: {dst}")


def _write_json_atomic(path: Path, data: dict[str, object]) -> None:
    if path.is_symlink():
        raise ValueError(f"refusing to overwrite symlink: {path}")
    tmp = path.with_name(f".{path.name}.{os.getpid()}.part")
    payload = json.dumps(data, indent=1, allow_nan=False, ensure_ascii=False)
    try:
        with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(payload)
        os.replace(tmp, path)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise


def _pitch_spread_st(np_mod: object, audio: object, sr: int = 16000, hop: int = 640) -> list[float]:
    n = int(len(audio))
    lo, hi = sr // 300, sr // 70
    if n < hop or hi <= lo:
        return [0.0, 0.0]
    f0: list[float] = []
    for i in range(0, n - hop + 1, hop):
        frame = audio[i : i + hop]
        if not np_mod.all(np_mod.isfinite(frame)):
            continue
        x = frame.astype(np_mod.float64) - float(frame.mean())
        if math.sqrt(float((x * x).mean())) < 0.02:
            continue
        ac = np_mod.correlate(x, x, "full")[hop - 1 :]
        if ac[0] <= 0:
            continue
        lag = lo + int(np_mod.argmax(ac[lo:hi]))
        if ac[lag] > 0.3 * ac[0]:
            f0.append(sr / lag)
    if not f0:
        return [0.0, 0.0]
    med = float(np_mod.median(f0))
    if not math.isfinite(med) or med <= 0:
        return [0.0, 0.0]
    st = 12.0 * np_mod.log2(np_mod.array(f0, dtype=np_mod.float64) / med)
    return [round(float(np_mod.percentile(st, 10)), 1), round(float(np_mod.percentile(st, 90)), 1)]


def main() -> None:
    forced_lang, files = _parse_args(sys.argv[1:])
    lang_map = _load_lang_map()

    valid_files: list[str] = []
    failed = 0
    for f in files:
        try:
            _validate_paths(f)
            valid_files.append(f)
        except Exception as exc:
            sys.stderr.write(f"error {Path(f).name or f}: {exc}\n")
            failed += 1

    if not valid_files:
        sys.exit(1)

    import numpy as np

    lab_root = Path(os.environ.get("THREEJS_LAB") or "E:/threejs_lab")
    if lab_root.exists():
        os.environ.setdefault("HF_HOME", str(lab_root / ".hf"))  # models beside the lab's other caches
    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS", "1")
    import torch
    import whisperx

    device = os.environ.get("WHISPER_DEVICE") or ("cuda" if torch.cuda.is_available() else "cpu")
    compute = os.environ.get("WHISPER_COMPUTE_TYPE") or ("float16" if device == "cuda" else "int8")

    def resolve_lang(path_str: str) -> str:
        key = os.path.normcase(os.path.abspath(path_str))
        return lang_map.get(key) or forced_lang or _lang_from_edit_json(Path(path_str)) or "en"

    first_lang = resolve_lang(valid_files[0])
    model = whisperx.load_model("large-v3", device, compute_type=compute, language=first_lang)
    align_cache: dict[str, tuple[object, object]] = {}

    for f in valid_files:
        try:
            _validate_paths(f)
            lang = resolve_lang(f)
            audio = whisperx.load_audio(f)
            if len(audio) == 0:
                raise ValueError("decoded audio is empty (0 samples)")
            if not np.all(np.isfinite(audio)):
                audio = np.nan_to_num(audio, nan=0.0, posinf=0.0, neginf=0.0)
            if lang not in align_cache:
                align_cache[lang] = whisperx.load_align_model(language_code=lang, device=device)
            align_model, meta = align_cache[lang]
            seg = model.transcribe(audio, batch_size=8, language=lang)["segments"]
            out = whisperx.align(seg, align_model, meta, audio, device)
            words = _extract_words(out.get("segments"))
            if not words:
                raise ValueError("no words aligned (audio may be silent or unintelligible)")
            info = {
                "text": " ".join(str(w["w"]) for w in words),
                "dur": round(float(len(audio) / 16000), 2),
                "pitch_p10_p90_st": _pitch_spread_st(np, audio),
                "words": words,
            }
            _write_json_atomic(Path(f"{f}.words.json"), info)
            print(f"  aligned {Path(f).name}: {len(words)} words", flush=True)
            print(Path(f).name, info["dur"], info["pitch_p10_p90_st"], "|", info["text"], flush=True)
        except Exception as exc:
            sys.stderr.write(f"error {Path(f).name or f}: {exc}\n")
            failed += 1

    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
