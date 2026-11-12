"""Render Earshot's 252 DSP sound-bank recipes into vault/sound/sfx/<category>/*.wav (resume-safe, 48 kHz 16-bit PCM)."""
import json
import os
import sys
import wave
from pathlib import Path
import numpy as np

CATEGORY_MAP = {
    "whoosh_fast": "transitions", "whoosh_big": "transitions", "pro_whoosh_big": "transitions",
    "swish": "transitions", "swipe": "transitions", "riser": "transitions", "pro_riser": "transitions",
    "reverse_swell": "transitions", "downlifter": "transitions", "pro_zip": "transitions",
    "impact": "impacts", "pro_impact": "impacts", "cut_hit": "impacts", "sub_drop": "impacts",
    "pro_sub_drop": "impacts", "logo_sting": "impacts", "pro_logo_sting": "impacts",
    "click": "clicks", "pro_click": "clicks", "hover_tick": "clicks", "pro_hover_tick": "clicks",
    "tap": "clicks", "pro_tap": "clicks", "toggle": "clicks", "pop": "clicks", "pro_pop": "clicks",
    "pro_pop_in": "clicks", "ui_pop": "clicks", "knock": "clicks",
    "typing_key": "typing", "pro_typing_key": "typing", "pro_typing_run": "typing",
    "notify": "notifications", "pro_notify": "notifications",
    "shimmer": "musical", "pro_shimmer": "musical", "mallet": "musical", "pluck": "musical", "drip": "musical",
    "shutter": "shutter", "glitch": "glitch", "pro_glitch": "glitch",
}

SWEETENER_ROLES = {
    "downlifter/air_fall": "downlifter",
    "downlifter/flange_air": "downlifter",
    "riser/air": "riser",
    "whoosh_fast/crisp": "whoosh",
    "cut_hit/kick": "impact",
}


def fit_category(sound_id: str) -> str:
    role = sound_id.split("/")[1] if "/" in sound_id else ""
    if role.startswith("whoosh"):
        return "transitions"
    if role == "hit":
        return "impacts"
    if role.startswith("key"):
        return "typing"
    if role == "bell":
        return "musical"
    return "clicks"


def move_into_category(target: Path) -> None:
    """A rebuild that re-files a sound moves it, so it never sits in two categories."""
    if target.exists():
        return
    for old in target.parent.parent.glob(f"*/{target.name}"):
        target.parent.mkdir(parents=True, exist_ok=True)
        os.replace(old, target)
        return


def valid_wav(path: Path) -> bool:
    if not path.exists() or path.stat().st_size <= 44:
        return False
    head = path.open("rb").read(12)
    return head[:4] == b"RIFF" and head[8:12] == b"WAVE"


def write_pcm16(path: Path, y: np.ndarray, sr: int = 48000) -> None:
    arr = np.clip(np.asarray(y, dtype=np.float32), -1.0, 1.0)
    channels = 1 if arr.ndim == 1 else arr.shape[1]
    pcm = np.round(arr * 32767.0).astype("<i2").tobytes()
    path.parent.mkdir(parents=True, exist_ok=True)
    part = path.with_suffix(f".{os.getpid()}.part")
    try:
        with wave.open(str(part), "wb") as wf:
            wf.setnchannels(channels)
            wf.setsampwidth(2)
            wf.setframerate(sr)
            wf.writeframes(pcm)
        os.replace(part, path)
    finally:
        if part.exists():
            part.unlink()


def main() -> None:
    earshot_dir = Path(sys.argv[1]).resolve()
    vault_sound = Path(sys.argv[2]).resolve()
    sys.path.insert(0, str(earshot_dir))
    from earshot.forge import bank

    sources = {}
    rendered = reused = 0
    for row in bank.list_sounds():
        sid = row["id"]
        cat = fit_category(sid) if row["category"] == "fit" else CATEGORY_MAP.get(row["category"], "other")
        name = "ear-" + sid.replace("/", "-")
        target = vault_sound / "sfx" / cat / f"{name}.wav"
        move_into_category(target)
        if valid_wav(target):
            reused += 1
        else:
            y, meta = bank.render(sid, checks=False)
            write_pcm16(target, y, int(meta.get("sr", 48000)))
            rendered += 1
        fit_src = row.get("source") or {}
        label = sid.replace("_", " ").replace("/", " · ")
        clean_label = label[:1].upper() + label[1:]
        entry = {
            "title": f"{fit_src['title']} (fit)" if fit_src.get("title") else clean_label,
            "license": f"{fit_src.get('license', 'CC0 1.0')} (Earshot fit)" if fit_src else "Earshot Forge (Synthesized / CC0)",
            "for": row.get("notes") or row["category"],
            "source": "earshot",
            "kind": "sfx",
            "origin": "synth",
        }
        if fit_src.get("url"):
            entry["url"] = fit_src["url"]
        if sid in SWEETENER_ROLES:
            entry["role"] = SWEETENER_ROLES[sid]
        sources[name] = entry

    print(json.dumps({"rendered": rendered, "reused": reused, "sources": sources}))


if __name__ == "__main__":
    main()
