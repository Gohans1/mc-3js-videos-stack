"""Ears for an AI that cannot hear: the film's mix measured (EBU R128 / ITU-R BS.1770 through ffmpeg's ebur128), from two
stems the film's own mix graph renders (scripts/sound/mix.py, before the master limiter): the narration alone, and every
bed and sound effect without it. Run inside the film.
  bun run listen               where the voice is buried, sounds louder than the narration, level jumps at cuts, dead
                               air, an abrupt end, a sound that cancels in one speaker (mono); each with the second (bun run at <second> names the rows to change)
                               every fault also lands in renders/listen.json; the first run renders the stems (about a
                               second per film second), later runs reuse renders/listen_stems/ until src/ or the film's sounds change
  bun run listen --fresh       force a new render of the stems
  bun run listen --sheet       spectrogram and events of the pre-master stems, with frames from a current draft if available.
                               Writes renders/listen_sheet.png; add --at to limit the sheet to the same window.
  bun run listen --at 35.2     the 2 s either side of one heard second using rolling 400 ms LUFS readings: the voice, the rest, what
                               plays, and the rest's level at the last listen, so a gain change shows what it did there
Voice over the rest is a masking estimate: 15 LU is the target margin, below 8 LU flags a high risk. Use an audio
model or listen to the exported file to verify what the audience hears.
A sound effect may hit close to the voice (about 10 LU under), not over it. Gains live in src/timeline/audio.json."""
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from seconds import heard_second, meant  # noqa: E402
from studio_tell import job  # noqa: E402
from review.stale import render_context  # noqa: E402

GOOD, LOST = 15.0, 8.0
FLOOR = -120.0


def momentary(wav, duration=None):
    """400 ms momentary LUFS, timed at the end of each 100 ms reporting block."""
    pad = f"apad=whole_dur={math.ceil(duration * 10 - 1e-9) / 10:g}," if duration is not None else ""
    r = subprocess.run(["ffmpeg", "-xerror", "-hide_banner", "-nostats", "-i", str(wav), "-af",
                        pad + "ebur128=metadata=1,ametadata=print:key=lavfi.r128.M:file=-", "-f", "null", "-"],
                       capture_output=True, text=True, timeout=600)
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg ebur128 failed on {wav}: {r.stderr.strip()[-300:] or f'exit {r.returncode}'}")
    pairs = re.findall(r"pts_time:(\S+)\s+lavfi\.r128\.M=(\S+)", r.stdout)
    result = []
    for stamp, value in pairs:
        start, level = float(stamp), float(value)
        end = start + 0.1
        if duration is not None:
            if start >= duration:
                break
            end = min(end, duration)
        result.append((round(end, 9), max(FLOOR, level) if math.isfinite(level) else FLOOR))
    return result


def power_mean(values):
    """Loudness of a stretch from its momentary readings: the mean of their power, back in LUFS."""
    return 10 * math.log10(sum(10 ** (v / 10) for v in values) / len(values)) if values else FLOOR


YOUTUBE = -14.0


def loudness(media, audio="0:a:0"):
    """Integrated loudness (LUFS), loudness range (LU) and true peak (dBTP, 4x oversampled) of a file's sound: ffmpeg ebur128"""
    r = subprocess.run(["ffmpeg", "-xerror", "-hide_banner", "-nostats", "-i", str(media), "-map", audio, "-af", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True, timeout=600)
    if r.returncode != 0:
        details = r.stderr.rsplit("Summary:", 1)[0].strip()[-500:]
        raise RuntimeError(f"ffmpeg ebur128 failed on {media}: {details or f'exit {r.returncode}'}")
    err = r.stderr
    idx = err.rfind("Summary:")
    if idx < 0:
        raise RuntimeError(f"ffmpeg ebur128 produced no loudness summary for {media}")
    summary = err[idx:]

    def read(key):
        m = re.search(rf"{key}:\s+(-?[\d.]+|-inf)", summary)
        if m is None:
            raise RuntimeError(f"ffmpeg ebur128 summary missing {key} for {media}")
        return float(m.group(1))

    integrated = read("I")
    # FFmpeg prints the absolute gate when no 400 ms block qualified.
    return (integrated if integrated > -70 else None), read("LRA"), read("Peak")


def measured_loudness(integrated, peak):
    level = f"{integrated:.1f} LUFS" if integrated is not None else "integrated loudness unavailable (EBU gate)"
    return f"{level}, peak {peak:+.1f} dBTP"


CEILING = -1.5


def level(raw, out, target, ceiling=CEILING):
    """Linear gain up to `target` LUFS, or only as far as the true peak stays under `ceiling` (AES TD1004 6a), never a dynamic
    loudnorm that lifts every quiet stretch. Returns the dB it stopped short of the target, 0 when it got there."""
    i, _, tp = loudness(raw)
    want = target - i if i is not None else 0.0
    gain = min(want, ceiling - tp) if math.isfinite(tp) else want
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-af", f"volume={gain:.3f}dB", "-ar", "48000",
                    "-c:a", "pcm_s16le", str(out)], check=True, timeout=300)
    return round(max(0.0, want - gain), 1)


def fit_encoded(raw, out, target, encode, limit=-1.0):
    """level() into out, then encode(out) -> the encoded file. When the codec's overshoot lifts that file's true peak over
    `limit` (the upload spec), level again with the ceiling lowered by the overshoot and encode again, so the file that
    goes out is measured, not the wav before it (AES TD1004: lossy codecs overshoot). Returns held gain, codec correction, and the last encode's loudness and peak."""
    held, ceiling, taken = level(raw, out, target), CEILING, 0.0
    for tries in range(4):
        measured, _, tp = loudness(encode(out))
        if not math.isfinite(tp) or tp <= limit or tries == 3:
            break
        over = tp - limit + 0.1
        ceiling = min(ceiling, loudness(out)[2]) - over
        taken = round(taken + over, 1)
        held = level(raw, out, target, ceiling)
    return held, taken, measured, tp


DRIVE_MAX = 12


def loudness_report(wav, target, held=0.0, drive=0.0, *, describe_upload=True):
    """The finished mix as an upload is judged (ffmpeg ebur128, true peak 4x oversampled): what bun run mix prints last.
    held: what level() stopped short of the target to keep the true peak under the ceiling; drive: audio.json's."""
    i, lra, tp = loudness(wav)
    if i is None:
        return [f"{wav}: {measured_loudness(i, tp)}"]
    out = [f"{wav}: {i:.1f} LUFS integrated, true peak {tp:.1f} dBTP, loudness range {lra:.1f} LU"]
    short = held > 1
    if short:
        want = min(DRIVE_MAX, drive + math.ceil(3 * held))
        level_scope = (f"the upload plays {held:.1f} dB under audio.json lufs, nothing else wrong" if describe_upload
                       else f"the mix is {held:.1f} dB under audio.json lufs")
        lever = (f"drive is at +{drive:g}, the most before bun run check warns the hits flatten. Either leave it ({level_scope}) "
                 f"or raise drive past {DRIVE_MAX} and listen whether the hits still land"
                 if drive >= DRIVE_MAX else
                 f"set audio.json drive to {want:g} (now {drive:g}){', the most before the hits flatten' if want == DRIVE_MAX else ''}; "
                 "its limiter takes the peaks, each dB buying a third to a half of one; then bun run mix again")
        out.append(f"  stopped {held:.1f} dB short so its true peak stays under {CEILING:g} dBTP; louder: {lever}")
    elif abs(i - target) > 1:
        out.append(f"  {abs(i - target):.1f} LU {'over' if i > target else 'under'} audio.json lufs ({target:g})")
    if not describe_upload:
        return out
    if i > YOUTUBE + 1:
        out.append(f"  YouTube turns it down {i - YOUTUBE:.1f} dB to {YOUTUBE:g} LUFS: the loudness bought with limiting is thrown away")
    elif i < YOUTUBE - 1:
        out.append(f"  YouTube never turns it up: it plays {YOUTUBE - i:.1f} dB quieter than the videos around it"
                   + ("" if short else f" (audio.json lufs {YOUTUBE:g} is what it plays at)"))
    else:
        out.append(f"  YouTube plays it as made (within 1 LU of {YOUTUBE:g} LUFS): the loudness is ready, nothing more")
    if tp > -1:
        out.append(f"  true peak over -1 dBTP ({tp:+.1f}): the AAC encode can clip it; the mix should stay at -1 or under")
    return out


def spoken(voice, ref):
    """The stretches where the narration speaks: momentary loudness within 20 LU of its own level, gaps under 0.6 s joined."""
    out = []
    for t, m in voice:
        if m < ref - 20:
            continue
        if out and t - out[-1][1] <= 0.6:
            out[-1][1] = t
        else:
            out.append([t, t])
    # a momentary reading looks 0.4 s back: the speech began 0.4 s before the first loud reading
    return [(max(0.0, a - 0.4), b) for a, b in out if b - a >= 0.3]


BURIED = 6.0


def levels_around(curve, at, last=None, reach=2.0, step=0.5, duration=None):
    """listen --at: the voice, the rest and the voice's margin over it, each step from at - reach to at + reach, from the
    momentary curve [(t, voice, rest)]; was: the rest's level at the same place in the last listen's curve."""
    def mean(points, k, a, b, fallback=FLOOR):
        if not points:
            return None
        vals = [p[k] for p in points if a < p[0] <= b + 1e-9]
        return round(power_mean(vals), 1) if vals else fallback

    rows = []
    b = at - reach
    while b < at + reach - 1e-9:
        a, z = (max(0, b), min(duration, b + step)) if duration is not None else (b, b + step)
        if a < z - 1e-9:
            v, r = mean(curve, 1, a, z, None), mean(curve, 2, a, z, None)
            margin = round(v - r, 1) if v is not None and r is not None else None
            rows.append({"from": round(a, 9), "to": round(z, 9), "voice": v, "rest": r,
                         "margin": margin, "was": mean(last, 2, a, z, None)})
        b += step
    return rows


def analyse(voice_wav, rest_wav, cuts=(), hits=(), duration=None):
    """What a listener would notice, measured on the two stems; every time is a heard second. hits: (at, length, name) of the
    placed sound effects, each judged by how far it lifts the rest stem over the second before it."""
    voice, rest = momentary(voice_wav, duration), momentary(rest_wav, duration)
    n = min(len(voice), len(rest))
    voice, rest = voice[:n], rest[:n]
    level = dict(rest)
    talk = [m for _, m in voice if m > -70]
    ref = power_mean(talk) if talk else FLOOR
    lines = []
    for a, b in spoken(voice, ref) if talk else []:
        v = power_mean([m for t, m in voice if a <= t <= b])
        r = power_mean([level[t] for t, _ in voice if a <= t <= b])
        margin = v - r
        lines.append({"from": round(a, 2), "to": round(b, 2), "voice": round(v, 1), "rest": round(r, 1), "margin": round(margin, 1),
                      "verdict": "lost" if margin < LOST else "thin" if margin < GOOD else "clear"})
    full = [(t, 10 * math.log10(10 ** (v / 10) + 10 ** (r / 10))) for (t, v), (_, r) in zip(voice, rest)]
    loud = [m for _, m in full if m > -70]
    whole = power_mean(loud) if loud else FLOOR
    over = []
    if talk:
        said = dict(voice)
        for t, r in rest:
            if r <= ref + 1:
                continue
            speaking = said.get(t, FLOOR) > -70
            if not over or t - over[-1]["to"] > 0.5 or over[-1]["speaking"] != speaking:
                over.append({"from": max(0.0, round(t - 0.4, 2)), "to": round(t, 2), "peak": round(r - ref, 1), "speaking": speaking})
            else:
                over[-1]["to"] = round(t, 2)
                over[-1]["peak"] = max(over[-1]["peak"], round(r - ref, 1))
    around = lambda a, b: power_mean([m for t, m in full if a <= t < b])  # noqa: E731
    jumps = []
    for c in cuts:
        if 0.6 < c < full[-1][0] - 0.6 if full else False:
            d = around(c + 0.4, c + 0.9) - around(c - 0.5, c)
            if abs(d) > 6:
                jumps.append({"at": round(c, 2), "change": round(d, 1)})
    dead, start = [], None
    for t, m in full:
        quiet = m < whole - 30
        if quiet and start is None:
            start = t
        if not quiet and start is not None:
            if t - start >= 2:
                dead.append({"from": round(start, 2), "to": round(t, 2)})
            start = None
    tail = [m for t, m in full if t >= full[-1][0] - 0.3] if full else []
    abrupt = bool(loud) and bool(tail) and power_mean(tail) > -70 and power_mean(tail) > whole - 15
    buried, together = [], {}
    for at, length, name in sorted(hits):
        key = next((k for k in together if abs(k - at) < 0.05), at)
        was = together.get(key)
        together[key] = (max(was[0], length or 1.0), f"{was[1]} + {name}") if was else (length or 1.0, name)
    for at, (length, name) in together.items():
        bed = power_mean([m for t, m in rest if at - 1.0 <= t <= at - 0.1])
        # the 400 ms momentary window still holds a short hit until 0.4 s after it ends
        samples = [m for t, m in rest if at + 0.1 <= t <= at + min(length, 1.0) + 0.4]
        if bed > -70 and samples and max(samples) - bed < BURIED:
            buried.append({"at": round(at, 2), "name": name, "rise": round(max(samples) - bed, 1)})
    return {"loudness": round(whole, 1), "voice": round(ref, 1), "lines": lines, "over": over, "jumps": jumps,
            "dead": dead, "abrupt_end": abrupt, "buried": buried, "length": duration if duration is not None else full[-1][0] if full else 0,
            "curve": [(t, round(v, 1), round(r, 1)) for (t, v), (_, r) in zip(voice, rest)]}


MONO_LOST = {"voice": 1.5, "rest": 6.0}


def mono(voice_wav, rest_wav, duration=None):
    """Each stem folded to one speaker (a phone, a laptop, a TV in mono: left and right summed), against itself in stereo.
    A side that is the other upside down cancels; the stretches where a heard stem loses more than MONO_LOST, every 0.1 s."""
    out = {"stretches": []}
    with tempfile.TemporaryDirectory(prefix="mono-") as tmp:
        for stem, wav in (("voice", voice_wav), ("rest", rest_wav)):
            folded = Path(tmp) / f"{stem}.wav"
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(wav), "-af", "pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1",
                            str(folded)], check=True, timeout=600)
            wide, one = momentary(wav, duration), dict(momentary(folded, duration))
            heard = [(t, m, one.get(t, FLOOR)) for t, m in wide if m > -50]
            out[stem] = round(power_mean([m for _, m, _ in heard]) - power_mean([f for _, _, f in heard]), 1) if heard else 0.0
            for t, m, f in heard:
                if m - f <= MONO_LOST[stem]:
                    continue
                last = out["stretches"][-1] if out["stretches"] else None
                if last and last["stem"] == stem and t - last["to"] <= 0.5:
                    last["to"], last["loss"] = round(t, 2), max(last["loss"], round(m - f, 1))
                else:
                    out["stretches"].append({"stem": stem, "from": max(0.0, round(t - 0.4, 2)), "to": round(t, 2), "loss": round(m - f, 1)})
    return out


def _read_json(path, root):
    """Read JSON or raise ValueError naming the film-relative path and parse position."""
    rel = path.relative_to(root).as_posix() if path.is_relative_to(root) else str(path)
    try:
        return json.loads(path.read_text(encoding="utf8"))
    except json.JSONDecodeError as e:
        raise ValueError(f"{rel} is not valid JSON (line {e.lineno} column {e.colno}): fix it, bun run check says where") from e
    except UnicodeDecodeError as e:
        raise ValueError(f"{rel} is not valid UTF-8: {e}") from e


def _is_reparse(path):
    try:
        st = path.lstat()
    except OSError:
        return False
    return path.is_symlink() or bool(getattr(st, "st_file_attributes", 0) & 0x400)


def _inside_root(root, raw, label):
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError(f"{label} must be a path inside the film directory")
    real_root = root.resolve()
    target = (root / raw).resolve()
    if target == real_root or not target.is_relative_to(real_root):
        raise ValueError(f"{label} escapes film directory: {raw!r}")
    return target


def _film_config(root):
    """Read package.json live-studio sound/timing paths safely before importing mix.py."""
    pkg_path = root / "package.json"
    pkg = _read_json(pkg_path, root) if pkg_path.exists() else {}
    if not isinstance(pkg, dict):
        raise ValueError("package.json must be a JSON object")
    cfg = pkg.get("live-studio")
    cfg = {} if cfg is None else cfg
    if not isinstance(cfg, dict):
        raise ValueError('package.json: "live-studio" must be a JSON object')
    sound_path = _inside_root(root, cfg.get("soundTimeline", "src/timeline/audio.json"), "Sound timeline")
    sound_rel = sound_path.relative_to(root.resolve()).as_posix()
    timing_raw = cfg.get("timingTimeline")
    timing_path = _inside_root(root, timing_raw, "Timing timeline") if timing_raw is not None else None
    return cfg, sound_rel, sound_path, timing_path


def _load_curve(curve_file, root):
    if not curve_file.exists():
        return None
    try:
        raw = _read_json(curve_file, root)
    except (OSError, ValueError) as e:
        print(f"warning: {e}; ignoring previous renders/listen_curve.json", file=sys.stderr)
        return None
    legacy = isinstance(raw, list)
    samples = raw if legacy else raw.get("samples") if isinstance(raw, dict) else None
    ok_pt = lambda p: isinstance(p, (list, tuple)) and len(p) >= 3 and all(type(x) in (int, float) and math.isfinite(x) for x in p[:3])  # noqa: E731
    if not isinstance(samples, list) or not all(ok_pt(p) for p in samples):
        print("warning: renders/listen_curve.json has invalid shape; ignoring it", file=sys.stderr)
        return None
    return [(round(p[0] + 0.1, 9), p[1], p[2]) for p in samples] if legacy else samples


def stems(folder, source_bindings=None):
    """The narration alone and the rest, through the film's own graph (mix.py build), before the master limiter."""
    sound_dir = str(Path(__file__).resolve().parent)
    if sound_dir not in sys.path:
        sys.path.insert(0, sound_dir)
    import mix
    narr = mix.A.get("narration")
    beds = [c for b in mix.A["beds"] if (c := mix.chosen(b))]
    sfx = [c for s in mix.A["sfx"] if (c := mix.chosen(s))]
    voice, rest = folder / "voice.wav", folder / "rest.wav"
    with (folder / "build.log").open("w+", encoding="utf8", errors="replace") as log:
        sys.stdout.flush(), sys.stderr.flush()
        saved = os.dup(1), os.dup(2)
        try:
            os.dup2(log.fileno(), 1), os.dup2(log.fileno(), 2)
            mix.build(voice, [], [s for s in sfx if s.get("_narration") or s.get("name") == narr] if narr else [], voice=not narr, master=False, float_output=True, source_bindings=source_bindings)
            mix.build(rest, beds, [s for s in sfx if not s.get("_narration") and s.get("name") != narr], voice=False, master=False, float_output=True, source_bindings=source_bindings)
        except BaseException:
            sys.stdout.flush(), sys.stderr.flush()
            os.dup2(saved[0], 1), os.dup2(saved[1], 2)
            log.seek(0)
            sys.stderr.write(log.read()[-2000:])
            raise
        finally:
            sys.stdout.flush(), sys.stderr.flush()
            os.dup2(saved[0], 1), os.dup2(saved[1], 2)
            os.close(saved[0])
            os.close(saved[1])
    hits = []
    for s in sfx:
        if s.get("_narration") or s.get("name") == narr:
            continue
        at_s = float(s["at"])
        dur_s = mix.seconds(s["name"])
        start_s = float(s.get("start", 0))
        if at_s < 0 or at_s >= mix.END or start_s >= dur_s:
            continue
        if "length" in s and s["length"] is not None:
            hit_len = float(s["length"])
        else:
            hit_len = (dur_s - start_s) / (float(s.get("rate", 1)) or 1.0)
        if hit_len <= 0:
            continue
        hits.append((at_s, min(hit_len, mix.END - at_s), s["name"]))
    return voice, rest, hits


def _hash_asset_tree(h, root, base, skip_rel=()):
    if not base.is_dir() or _is_reparse(base):
        return
    skip_set = set(skip_rel)
    for p in sorted(base.rglob("*"), key=lambda x: x.as_posix()):
        if not p.is_file() or _is_reparse(p):
            continue
        rel = p.relative_to(root).as_posix() if p.is_relative_to(root) else p.as_posix()
        if any(rel == s or rel.startswith(s + "/") for s in skip_set):
            continue
        st = p.stat()
        h.update(f"{rel} {st.st_size} {st.st_mtime_ns}\0".encode())


def kept_stems(root, *, fresh=False):
    """stems(), kept in renders/listen_stems/ while what they are made of is unchanged: the film's src/**/*.json,
    choices, timelines, its own sound/voice files, mix code and the actual used source bindings (including the vault)."""
    here = Path(__file__).resolve().parent
    h = hashlib.sha256(b"listen-stems-v3\0")
    try:
        cfg, _, sound_path, timing_path = _film_config(root)
    except ValueError:
        cfg, sound_path, timing_path = {}, None, None
    h.update(json.dumps(cfg, sort_keys=True, ensure_ascii=False).encode() + b"\0")
    studio_src = here.parents[1] / "packages/live-studio/src"
    code_files = [here / "mix.py", here / "process.py", Path(__file__).resolve()]
    if studio_src.is_dir():
        for name in ("timing-audio-cli.mjs", "timing-data.mjs", "timing-state.mjs", "timing.mjs", "timing-effects.mjs",
                     "layer-timing.mjs", "main-track.mjs", "speed-curve.mjs", "linkage.mjs", "velocity.mjs", "bisect.mjs"):
            code_files.append(studio_src / name)
    json_cands = [
        *root.glob("src/**/*.json"),
        *(p for p in (sound_path, timing_path, root / "choices.json", root / "sound_choices.json") if p is not None and p.is_file()),
    ]
    seen_json = {}
    for p in [*code_files, *json_cands]:
        if p.is_file() and not _is_reparse(p):
            seen_json.setdefault(p.resolve(), p)
    for p in sorted(seen_json.values(), key=lambda x: x.as_posix()):
        rel = p.relative_to(root).as_posix() if p.is_relative_to(root) else p.as_posix()
        h.update(rel.encode() + b"\0" + p.read_bytes() + b"\0")
    _hash_asset_tree(h, root, root / "sound", skip_rel=("sound/mix.wav", "sound/mix_raw.wav"))
    _hash_asset_tree(h, root, root / "assets/public/agent", skip_rel=("assets/public/agent/stems",))
    if isinstance(cfg.get("sfx"), str) and cfg["sfx"].strip():
        try:
            sfx_dir = _inside_root(root, cfg["sfx"], "sfx")
            if not sfx_dir.is_relative_to((root / "sound").resolve()):
                _hash_asset_tree(h, root, sfx_dir)
        except ValueError:
            pass
    if isinstance(cfg.get("soundSources"), dict):
        for k, raw in sorted(cfg["soundSources"].items()):
            h.update(f"{k}={raw}\0".encode())
            if isinstance(raw, str):
                try:
                    sp = _inside_root(root, raw, "soundSource")
                    if sp.is_file() and not _is_reparse(sp):
                        st = sp.stat()
                        h.update(f"{sp.relative_to(root.resolve()).as_posix()} {st.st_size} {st.st_mtime_ns}\0".encode())
                except ValueError:
                    pass
    keep, stamp = root / "renders/listen_stems", h.hexdigest()
    voice, rest, meta = keep / "voice.wav", keep / "rest.wav", keep / "stamp.json"
    import mix
    if not fresh and meta.exists() and voice.exists() and rest.exists():
        try:
            was = json.loads(meta.read_text(encoding="utf8"))
            if (isinstance(was, dict) and was.get("stamp") == stamp and isinstance(was.get("hits"), list)
                    and all(isinstance(x, list) and len(x) == 3 for x in was["hits"])):
                bindings = was["bindings"]
                if (all(mix.media_identity(root / p) == identity for p, identity in bindings["files"].items())
                        and mix.resolve_audio_sources(bindings["names"]) == bindings["names"]):
                    return voice, rest, [tuple(x) for x in was["hits"]], True
        except (OSError, ValueError, TypeError, KeyError, AttributeError):
            pass
    bindings = {"files": {}, "names": {}}
    keep.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="listen-stems-", dir=keep.parent) as tmp:
        scratch = Path(tmp)
        made_voice, made_rest, hits = stems(scratch, bindings)
        made_meta = scratch / "stamp.json"
        made_meta.write_text(json.dumps({"stamp": stamp, "hits": hits, "bindings": bindings}), encoding="utf8")
        keep.mkdir(exist_ok=True)
        mix.publish([(made_voice, voice), (made_rest, rest), (made_meta, meta)], scratch)
    return voice, rest, hits, False


def _fetch_at_rows(key):
    if not Path("src/scene.ts").exists():
        return []
    r = subprocess.run(["bun", str(Path(__file__).resolve().parents[1] / "at.ts"), key, "--json"],
                       capture_output=True, text=True, timeout=60)
    rows = []
    try:
        data = json.loads(r.stdout)
        for s in data["sounds"]:
            if s.get("muted") or s.get("picked") == "off":
                continue
            picked = s.get("picked")
            name = f"{s['name']} -> {picked}" if picked and picked != s["name"] else s["name"]
            rows.append(f"{s['list']}[{s['i']}] {name}")
        if data.get("narration") and not any(s.get("narration") for s in data["sounds"]):
            rows.append(f"narration line {data['narration']['line']} (voice:cues)")
    except (ValueError, KeyError, TypeError):
        return []
    return rows


def row_time(second):
    return f"{max(0.0, second):.9f}".rstrip("0").rstrip(".")


def at_rows(second, cache=None):
    """What plays at that second, by file and row (scripts/at.ts)."""
    key = row_time(second)
    if cache is not None and key in cache:
        return cache[key]
    rows = _fetch_at_rows(key)
    if cache is not None:
        cache[key] = rows
    return rows


def _over_rows(x, cache):
    mid = (x["from"] + x["to"]) / 2
    return at_rows(mid, cache) or at_rows(max(0.0, x["to"] - 0.05), cache)


def louder(x):
    if x["speaking"]:
        return f"LOUDER than the narration {x['from']:.2f}-{x['to']:.2f}: {x['peak']:+.1f} LU over the voice as it speaks"
    return (f"LOUD with no voice {x['from']:.2f}-{x['to']:.2f}: {x['peak']:+.1f} LU over the narration's usual level "
            f"(lower the rest here; the voice is not the problem)")


def draft_for_listening():
    draft = Path("renders/draft.mp4")
    if not draft.is_file():
        return None, "no mixed draft; bun run mix renders/draft_video.mp4 makes it"
    context = render_context(draft)
    if context.get("error") or not context["render"] or context["stale"]:
        return None, context.get("error") or (context["stale"] or {}).get("message") or "draft is outside the film render paths"
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0",
                        "-show_entries", "stream=duration", "-of", "json", str(draft)],
                       capture_output=True, text=True, timeout=30)
    try:
        duration = float(json.loads(r.stdout)["streams"][0]["duration"])
        if r.returncode or not math.isfinite(duration) or duration <= 0:
            raise ValueError("invalid audio duration")
    except (ValueError, KeyError, IndexError):
        return None, f"{draft.as_posix()} has no usable audio track; check it with media ffmpeg probe"
    return duration, None


def short_window_line(window):
    def peak(key):
        value = window[key]
        return "silent" if value is None else f"{value:+.1f} dBTP"
    return (f"0-{row_time(window['to'])} s, 400 ms loudness window unavailable; "
            f"measured peaks: voice {peak('voicePeakDbtp')}, rest {peak('restPeakDbtp')}")


def focus(got, at, last, cuts, sound_rel="src/timeline/audio.json", sheet=None, cache=None):
    """listen --at: one heard second up close."""
    row_cache = {} if cache is None else cache
    end = got.get("length")
    if short := got.get("shortWindow"):
        print(short_window_line(short))
        bins = []
    else:
        print(f"around {row_time(at)} s heard, every 0.5 s: the voice, the rest (everything but the voice), the voice over the rest"
              + (", and the rest at the last listen" if last else " (no earlier listen to compare with)"))
        print("  LUFS averages rolling 400 ms readings. Earlier sound can contribute to the next row.")
        bins = levels_around(got["curve"], at, last, duration=end)
    def show_level(value):
        return "unmeasured" if value is None else "silent" if value <= -70 else f"{value:.1f}"
    for r in bins:
        was = f" (was {r['was']:.1f})" if last and r["was"] is not None and r["rest"] is not None and abs(r["was"] - r["rest"]) >= 0.5 else ""
        voice, rest = show_level(r["voice"]), show_level(r["rest"])
        margin = "" if voice in ("unmeasured", "silent") or rest == "unmeasured" else "  voice alone" if rest == "silent" else f"  {r['margin']:+.1f} LU"
        print(f"  {row_time(r['from']):>6}-{row_time(r['to'])}  voice {voice:>6}  rest {rest:>6}{was:<13}{margin}".rstrip())
    if Path("src/scene.ts").exists():
        all_keys = [row_time(at + k / 10) for k in range(6)]
        missing = [k for k in dict.fromkeys(all_keys) if k not in row_cache]
        if missing:
            with ThreadPoolExecutor(max_workers=len(missing)) as pool:
                for k, res in zip(missing, pool.map(_fetch_at_rows, missing)):
                    row_cache[k] = res
    rows = at_rows(at, row_cache)
    print(f"timeline rows at {row_time(at)}: {', '.join(rows) if rows else f'nothing from {sound_rel}'}")
    soon = list(dict.fromkeys(r for k in range(1, 6) for r in at_rows(at + k / 10, row_cache) if r not in rows))
    if soon:
        print(f"  starting by {at + 0.5:.2f}: {', '.join(soon)}")
    near = lambda a, b: a <= at + 2 and b >= at - 2  # noqa: E731
    for x in got["lines"]:
        if x["verdict"] != "clear" and near(x["from"], x["to"]):
            print(f"  {x['verdict'].upper()} line {x['from']:.2f}-{x['to']:.2f}: voice {x['margin']:+.1f} LU over the rest")
    for x in got["over"]:
        if near(x["from"], x["to"]):
            print(f"  {louder(x)}")
    for b in got["buried"]:
        if near(b["at"], b["at"]):
            print(f"  BURIED {b['name']} at {b['at']:.2f}: only {b['rise']:+.1f} dB over the second before it (a hit needs about +{BURIED:g})")
    for c in cuts:
        if near(c, c):
            print(f"  cut at {c:.2f}")
    if sheet:
        print(f"sheet: {sheet} (pre-master stems; open it to inspect the window)")
    print(f"next: change a row there (bun run at {at:g} names each file and row), then bun run listen --at {at:g} shows it next to this run")
    if not shutil.which("earshot"):
        print("      earshot is not on PATH: INSTALL.md sets it up, earshot doctor checks it")
    else:
        duration, reason = draft_for_listening()
        a, b = max(0, at - 2), min(duration or 0, at + 2)
        if reason:
            print(f"      Rendered audio follow-up unavailable: {reason}")
        elif at > duration or b <= a:
            print(f"      renders/draft.mp4 audio ends at {duration:g} s; mix the current cut and retry")
        else:
            cue_arg = " --cues " + ",".join(f"{c:g}" for c in cuts if a < c < b) if any(a < c < b for c in cuts) else ""
            print(f"      Encoded draft in this window: earshot timeline renders/draft.mp4{cue_arg} --from {a:g} --to {b:g} --detail low")
    return 0


def main(args):
    if args[:1] == ["help"] or "-h" in args or "--help" in args:
        print(__doc__)
        return 0
    at, i = None, 0
    while i < len(args):
        a = args[i]
        if a == "--at" or a.startswith("--at="):
            value = a[5:] if a != "--at" else (args[i + 1] if i + 1 < len(args) else "")
            at = heard_second(value)
            if at is None:
                print(f"--at takes a heard second (35.2, 0:35.2 or 00:35.200; the clock bun run at reads), got {value or 'nothing'}{meant(value)}", file=sys.stderr)
                return 2
            i += 2 if a == "--at" else 1
        elif a in ("--sheet", "--fresh"):
            i += 1
        else:
            print(f"unknown {'option' if a.startswith('-') else 'word'} {a}: bun run listen [--sheet] [--at <second>] [--fresh] (--help for more)", file=sys.stderr)
            return 2
    root = Path(os.environ.get("LIVE_PROJECT") or Path.cwd()).resolve()
    if not (root / "src/scene.ts").exists():
        print(f"{root} has no src/scene.ts: run this inside a film (cd films/<name>)", file=sys.stderr)
        return 2
    os.chdir(root)
    try:
        _, sound_rel, sound_path, timing_path = _film_config(root)
    except (OSError, ValueError) as e:
        print(e, file=sys.stderr)
        return 1
    if not sound_path.is_file():
        print(f"no {sound_rel}: the film has no sound yet (bun run find <words> picks some)", file=sys.stderr)
        return 2
    try:
        _read_json(sound_path, root)
        if (root / "src/edit.json").is_file():
            _read_json(root / "src/edit.json", root)
        choices = next((root / f for f in ("choices.json", "sound_choices.json") if (root / f).is_file()), None)
        if choices is not None:
            _read_json(choices, root)
        if timing_path is not None and timing_path.is_file():
            _read_json(timing_path, root)
    except (OSError, ValueError) as e:
        print(e, file=sys.stderr)
        return 1
    ended = None
    try:
        with tempfile.TemporaryDirectory(prefix="listen-") as tmp:
            sound_dir = str(Path(__file__).resolve().parent)
            if sound_dir not in sys.path:
                sys.path.insert(0, sound_dir)
            import mix
            if why := mix.unfit():
                print(why, file=sys.stderr)
                return 1
            if at is not None and not 0 <= at <= mix.END:
                print(f"--at {at:g} is outside the film: it is {mix.END:.2f} s long (heard)", file=sys.stderr)
                return 2
            ended = job(root, "listen", f"Listening to the mix{f' at {at:g} s' if at is not None else ''}", **({"at": at} if at is not None else {}))
            print("the narration and the rest as two stems (the film's own mix graph, about a second per film second the first "
                  "time; kept in renders/listen_stems/ until the sound changes) ...", file=sys.stderr)
            voice, rest, hits, kept = kept_stems(root, fresh="--fresh" in args)
            if kept:
                print("  unchanged since the last listen: the kept stems (--fresh forces a fresh render)", file=sys.stderr)
            cut_context = render_context(Path("renders/draft_video.mp4"))
            cut_basis = cut_context["render"] and not cut_context["stale"]
            cut_info = cut_context["cuts"] or {}
            cuts, has_cuts = cut_info.get("times", []), "times" in cut_info
            if cut_info.get("reason"):
                print(cut_info["reason"], file=sys.stderr)
            got = analyse(voice, rest, cuts, hits, duration=mix.END)
            if mix.END < 0.4:
                voice_peak, rest_peak = loudness(voice)[2], loudness(rest)[2]
                got["shortWindow"] = {"from": 0, "to": mix.END,
                                      "voicePeakDbtp": voice_peak if math.isfinite(voice_peak) else None,
                                      "restPeakDbtp": rest_peak if math.isfinite(rest_peak) else None}
            folded = mono(voice, rest, duration=mix.END) if at is None and not got.get("shortWindow") else {"stretches": []}
            sheet = None
            if "--sheet" in args:
                earshot = shutil.which("earshot")
                if not earshot:
                    print("no earshot on PATH for the sheet: INSTALL.md sets it up, earshot doctor checks it; the numbers below stand on their own", file=sys.stderr)
                else:
                    full = Path(tmp) / "full.wav"
                    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(voice), "-i", str(rest), "-filter_complex", "amix=inputs=2:normalize=0", str(full)], check=True, timeout=300)
                    video = root / "renders/draft_video.mp4" if cut_basis else None
                    sheet = root / "renders/listen_sheet.png"
                    (root / "renders").mkdir(exist_ok=True)
                    window = ["--from", f"{max(0, at - 2):g}", "--to", f"{min(got['length'], at + 2):g}"] if at is not None else []
                    cmd = [earshot, "sheet", str(full), "-o", str(sheet), *window,
                           *(["--video", str(video)] if video else []),
                           *(["--cues", ",".join(f"{c:.2f}" for c in cuts)] if cuts else [])]
                    r = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
                    if r.returncode:
                        print(f"earshot sheet failed: {r.stderr.strip()[-300:]}", file=sys.stderr)
                        sheet = None
        curve_file = root / "renders/listen_curve.json"
        last = _load_curve(curve_file, root)
        curve_file.parent.mkdir(exist_ok=True)
        curve_file.write_text(json.dumps({"sampleTime": "block-end", "samples": got["curve"]}), encoding="utf8")
        sheet_rel = sheet.relative_to(root).as_posix() if sheet else None
        row_cache = {}
        if at is not None:
            code = focus(got, at, last, cuts, sound_rel=sound_rel, sheet=sheet_rel, cache=row_cache)
            ended(f"Listened at {at:g} s")
            return code
        lines = got["lines"]
        every = root / "renders/listen.json"
        every.write_text(json.dumps({
            "basis": "current-film-pre-master-stems", "clock": "film", "duration": got["length"],
            "cutsChecked": has_cuts and "shortWindow" not in got,
            **({"shortWindow": got["shortWindow"]} if got.get("shortWindow") else {}),
            "voice": [{**x, "playing": at_rows((x["from"] + x["to"]) / 2, row_cache)} for x in lines if x["verdict"] != "clear"],
            "louder": [{**x, "playing": _over_rows(x, row_cache)} for x in got["over"]],
            "buried": [{**b, "playing": at_rows(b["at"] + 0.05, row_cache)} for b in got["buried"]],
            "jumps": got["jumps"], "dead": got["dead"], "abrupt_end": got["abrupt_end"],
            "mono": [{**s, "playing": at_rows((s["from"] + s["to"]) / 2, row_cache)} for s in folded["stretches"]]}, indent=1), encoding="utf8")
        more = "more (every one, with what plays: renders/listen.json)"
        if short := got.get("shortWindow"):
            print(short_window_line(short))
            print("next: check the encoded audio with earshot measure FILE or bun run listen --at for timeline rows")
            ended("Listened to the short pre-master window")
            return 0
        print(f"mix {got['loudness']} LUFS before the master ({sound_rel} sets the target), narration {got['voice']} LUFS, {got['length']} s")
        bad = [x for x in lines if x["verdict"] != "clear"]
        if not lines:
            print("voice: no narration heard in the mix (bun run voice:cues says whether it is laid on the film)")
        else:
            print(f"voice over the rest, {len(lines)} spoken stretches: {len(lines) - len(bad)} above target (15 LU or more), "
                  f"{sum(x['verdict'] == 'thin' for x in lines)} thin (8-15), {sum(x['verdict'] == 'lost' for x in lines)} high masking risk (under 8)")
        for x in bad[:8]:
            rows = at_rows((x["from"] + x["to"]) / 2, row_cache)
            print(f"  {x['verdict'].upper()} {x['from']:.2f}-{x['to']:.2f}: voice {x['margin']:+.1f} LU over the rest"
                  f"{' (playing: ' + ', '.join(rows) + ')' if rows else ''}")
        if len(bad) > 8:
            print(f"  and {len(bad) - 8} {more}")
        for x in got["over"][:5]:
            rows = _over_rows(x, row_cache)
            print(f"{louder(x)}{' (' + ', '.join(rows) + ')' if rows else ''}")
        if len(got["over"]) > 5:
            print(f"  and {len(got['over']) - 5} {more}")
        for b in got["buried"][:8]:
            rows = at_rows(b["at"] + 0.05, row_cache)
            print(f"BURIED {b['name']} at {b['at']:.2f}: only {b['rise']:+.1f} dB over the second before it (a hit needs about +{BURIED:g})"
                  f"{' (playing: ' + ', '.join(rows) + ')' if rows else ''}")
        if len(got["buried"]) > 8:
            print(f"  and {len(got['buried']) - 8} {more}")
        if got["jumps"]:
            jumps = got["jumps"]
            shown = ", ".join(f"{j['at']:.2f} {j['change']:+.1f}" for j in jumps[:6])
            rest_msg = f" and {len(jumps) - 6} {more}" if len(jumps) > 6 else ""
            print(f"level jumps at {len(jumps)} cut(s), more than 6 LU, fine when the story calls for it: {shown}{rest_msg}")
        if not has_cuts:
            print("cuts: no renders/cuts.json usable for a current render; level jumps at cuts were skipped (bun run render clip)")
        for d in got["dead"]:
            print(f"near silence {d['from']:.2f}-{d['to']:.2f} (30 LU under the mix): dead air, unless meant")
        if got["abrupt_end"]:
            print("abrupt end: the sound is still loud in the last 0.3 s. Check the encoded ending with earshot.")
        for s in folded["stretches"][:5]:
            rows = at_rows((s["from"] + s["to"]) / 2, row_cache)
            print(f"MONO {s['from']:.2f}-{s['to']:.2f}: {'the narration' if s['stem'] == 'voice' else 'the rest'} loses {s['loss']:.1f} dB "
                  "in one speaker (a phone, a laptop): its sides cancel. Usually a stereowiden/extrastereo filter on a row (audio.json "
                  "filters) or a recording with a flipped side: drop the widening or swap the sound; a rest driven far over 0 dBFS (the "
                  "mix line above near 0 LUFS) does it too: lower the gains"
                  f"{' (playing: ' + ', '.join(rows) + ')' if rows else ''}")
        if len(folded["stretches"]) > 5:
            print(f"  and {len(folded['stretches']) - 5} {more}")
        if not folded["stretches"]:
            print(f"mono (one speaker, as a phone plays it): the narration {-folded['voice']:+.1f} dB, the rest {-folded['rest']:+.1f} dB, "
                  "nothing cancels")
        if sheet_rel:
            print(f"sheet: {sheet_rel} (open it to look; its LUFS and peaks are the stems before the master "
                  "limiter and the loudness pass, so they run hotter than the upload: bun run mix prints the upload's)")
        marks = ([{"at": x["from"], "to": x["to"], "say": f"{x['verdict'].upper()} voice {x['margin']:+.1f} LU"} for x in bad]
                 + [{"at": x["from"], "to": x["to"], "say": "LOUDER than the voice"} for x in got["over"] if x["speaking"]]
                 + [{"at": b["at"], "say": f"BURIED {b['name']}"} for b in got["buried"]]
                 + [{"at": s["from"], "to": s["to"], "say": "MONO: cancels on a phone"} for s in folded["stretches"]]
                 + [{"at": x["from"], "to": x["to"], "say": "LOUD with no voice"} for x in got["over"] if not x["speaking"]]
                 + [{"at": d["from"], "to": d["to"], "say": "near silence"} for d in got["dead"]])
        ended(f"Measured the mix: {len(marks)} stretch{'es' if len(marks) != 1 else ''} to look at{' (the worst 20 lit)' if len(marks) > 20 else ''}"
              if marks else "Pre-master measurements found no flagged mix stretches", level="warn" if marks else "ok", marks=marks)
        print("next: a buried or loud stretch: bun run at <second> names its rows; lower a bed's or a sound's gain in "
              f"{sound_rel} (a buried hit: raise its gain, or duck the bed under it), then bun run listen --at <second> shows what it did there")
        return 0
    except SystemExit as e:
        if e.code in (0, None):
            return 0
        if isinstance(e.code, int):
            if ended:
                ended("Listening stopped", level="fail")
            return e.code
        print(e.code, file=sys.stderr)
        if ended:
            ended(f"Listening stopped: {e.code}", level="fail")
        return 1
    except (ValueError, OSError, UnicodeDecodeError, json.JSONDecodeError, subprocess.SubprocessError, RuntimeError) as e:
        print(f"listen failed: {e}", file=sys.stderr)
        if ended:
            ended(f"Listening stopped: {e}", level="fail")
        return 1
    except BaseException:
        if ended:
            ended("Listening stopped", level="fail")
        raise


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
