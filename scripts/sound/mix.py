"""The film's soundtrack from src/timeline/audio.json in one ffmpeg graph: the narration (assets/public/agent/full_voice.wav,
already placed on the film clock by voice/assemble.ts and the studio's voice edits), beds (room hum, CCTV hiss) and
one-shot sound effects (sound/sfx, CC0, sound/get_sfx.py). A limiter catches peaks (audio.json drive pushes into it), then
one linear gain brings it to audio.json lufs, or only as far as its true peak stays under -1.5 dBTP (listen.py level), and
ffmpeg's ebur128 measures the result. -14 LUFS is what YouTube plays at.
  bun run mix                          -> sound/mix.wav (48 kHz stereo, film length)
  bun run mix renders/draft_video.mp4  also muxes it -> renders/draft.mp4, the draft with its sound (bun run render clip
                                       makes the silent video first)
  bun run mix renders/final_video.mp4  the same for bun run render final -> renders/final.mp4, the file to upload
  bun run mix renders/span_40-44.mp4 -> a separate MP4 under renders/mixed_*/, with sound from film second 40
  bun run mix other.mp4 --start 40  the same with an explicit film offset (default 0 for external files)
Mux outputs carry the video tracks and new AAC. Other tracks remain in the source file.
Use bun run listen for pre-master measurements, then inspect the encoded audio with earshot."""
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
from functools import cache
from pathlib import Path
if str(Path(__file__).resolve().parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
from process import render as process_audio  # noqa: E402
if str(Path(__file__).resolve().parents[1]) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from studio_tell import job  # noqa: E402
from review.stale import render_context  # noqa: E402
from seconds import heard_second  # noqa: E402

ROOT = Path.cwd()  # the film's folder: bun run mix runs it there
REAL_ROOT = ROOT.resolve()
READ_DOCUMENTS = {}
ALLOWED_AUDIO_FILTER = re.compile(
    r"^(?:lowpass|highpass|bandpass|bandreject|allpass|equalizer|lowshelf|highshelf|bass|treble|acompressor|alimiter|agate|asoftclip|aecho|aphaser|aflanger|achorus|vibrato|tremolo|stereowiden|extrastereo|volume|dynaudnorm|adeclick|adeclip|afftdn|deesser)(?:=[A-Za-z0-9_.:=|+ %-]+)?$"
)


def _inside(base: Path, target: Path) -> bool:
    try:
        return target != base and target.is_relative_to(base)
    except ValueError:
        return False


def _assert_in_root(target: Path, label: str = "Path") -> Path:
    abs_root = ROOT.absolute()
    abs_target = target.absolute() if target.is_absolute() else (abs_root / target).absolute()
    norm_target = Path(os.path.normpath(abs_target))
    base = abs_root if _inside(abs_root, norm_target) else (REAL_ROOT if _inside(REAL_ROOT, norm_target) else None)
    if base is None:
        raise ValueError(f"{label} escapes film directory: {str(target)!r}")
    cur = base
    for seg in norm_target.relative_to(base).parts:
        cur = cur / seg
        try:
            st = cur.lstat()
        except OSError:
            break
        if os.path.islink(cur) or (st.st_file_attributes & 0x400 if hasattr(st, "st_file_attributes") else False):
            raise ValueError(f"{label} cannot traverse symlink or junction: {str(target)!r}")
        if not _inside(REAL_ROOT, cur.resolve()):
            raise ValueError(f"{label} escapes film directory: {str(target)!r}")
    return norm_target


def _is_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def media_identity(path):
    st = Path(path).stat()
    return {"size": st.st_size, "mtimeMs": st.st_mtime_ns // 1_000_000}


def stored_path(path):
    path = Path(path).absolute()
    return (path.relative_to(ROOT) if path.is_relative_to(ROOT) else path).as_posix()


def _read_json(path: Path, label: str, *, expect_dict: bool = False):
    try:
        READ_DOCUMENTS[stored_path(path)] = media_identity(path)
        raw = path.read_text(encoding="utf8")
    except OSError as e:
        raise SystemExit(f"{label}: could not read ({e.strerror or e})")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise SystemExit(f"{label}: invalid JSON (line {e.lineno}, col {e.colno}): fix the syntax error")
    if expect_dict and not isinstance(data, dict):
        raise SystemExit(f"{label}: not a JSON object: bun run check names every fault")
    return data


def _read_stdin_json(label: str):
    try:
        data = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        raise SystemExit(f"{label}: invalid JSON (line {e.lineno}, col {e.colno})")
    except Exception as e:
        raise SystemExit(f"{label}: could not read JSON from stdin ({e})")
    if not isinstance(data, dict):
        raise SystemExit(f"{label}: JSON input must be an object")
    return data


_IS_MAIN = __name__ == "__main__"
_MODE = "mix"
_RAW_OUT = None
_RAW_LIVE_LANES = False
_MEASURE_ARGS = None
_VIDEO_ARG = None

# bun run mix [video]: every word checked before the mix starts (--raw and --measure are the studio's own calls)
if _IS_MAIN:
    _argv = sys.argv[1:]
    if _argv[:1] == ["help"] or "-h" in _argv or "--help" in _argv:
        print(__doc__.strip())
        raise SystemExit(0)
    if _argv == ["--resolve-audio"]:
        _MODE = "resolve_audio"
    elif _argv[:1] == ["--raw"]:
        _rest = _argv[1:]
        _flags = [a for a in _rest if a.startswith("-")]
        _pos = [a for a in _rest if not a.startswith("-")]
        if any(f != "--live-lanes" for f in _flags) or len(_pos) != 1:
            print("usage: bun run mix --raw <out.wav> [--live-lanes] (--help for more)", file=sys.stderr)
            raise SystemExit(2)
        _MODE, _RAW_OUT, _RAW_LIVE_LANES = "raw", _pos[0], "--live-lanes" in _flags
    elif _argv[:1] == ["--measure"]:
        if len(_argv) != 3 or _argv[1] not in ("beds", "sfx") or not _argv[2].isdigit():
            print("usage: bun run mix --measure <beds|sfx> <index> (--help for more)", file=sys.stderr)
            raise SystemExit(2)
        _MODE, _MEASURE_ARGS = "measure", (_argv[1], int(_argv[2]))
    elif _argv:
        _audio_start = None
        if len(_argv) == 3 and _argv[1] == "--start":
            _audio_start = heard_second(_argv[2])
            if _audio_start is None or not 0 <= _audio_start < 1e6:
                print(f"--start needs a nonnegative film second, got {_argv[2]!r}", file=sys.stderr)
                raise SystemExit(2)
            _argv = _argv[:1]
        if len(_argv) != 1 or _argv[0].startswith("-"):
            print(f"bun run mix, or bun run mix <video> to put the sound on it; got {' '.join(_argv)} (--help for more)", file=sys.stderr)
            raise SystemExit(2)
        _VIDEO_ARG = _argv[0]
        try:
            _video_path = _assert_in_root(Path(_VIDEO_ARG), "Video")
        except ValueError as e:
            print(e, file=sys.stderr)
            raise SystemExit(2)
        videos = sorted(p.as_posix() for p in Path("renders").glob("*_video.mp4")) if Path("renders").is_dir() else []
        if not _video_path.is_file():
            print(f"no {_VIDEO_ARG} (the pictures here: {', '.join(videos) or 'none yet'}); bun run render clip makes renders/draft_video.mp4", file=sys.stderr)
            raise SystemExit(2)
        _probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "json", str(_video_path)],
                                capture_output=True, text=True, timeout=30)
        try:
            _streams = {stream.get("codec_type") for stream in json.loads(_probe.stdout).get("streams", [])}
            _streams.discard(None)
        except ValueError:
            _streams = set()
        if _probe.returncode != 0 or "video" not in _streams:
            print(f"{_VIDEO_ARG} is not a readable video ({', '.join(videos) or 'bun run render clip makes renders/draft_video.mp4'})", file=sys.stderr)
            raise SystemExit(2)
        if "audio" in _streams:
            print(f"{_VIDEO_ARG} already has sound: mix puts the soundtrack on a picture-only render ({', '.join(videos) or 'bun run render clip makes renders/draft_video.mp4'})", file=sys.stderr)
            raise SystemExit(2)

PKG = ROOT / "package.json"
if not PKG.exists():
    READ_DOCUMENTS[stored_path(PKG)] = None
try:
    _PKG_DATA = _read_json(_assert_in_root(PKG, "package.json"), "package.json", expect_dict=True) if PKG.exists() else {}
except ValueError as e:
    raise SystemExit(str(e))
_RAW_CFG = _PKG_DATA.get("live-studio")
if _RAW_CFG is not None and not isinstance(_RAW_CFG, dict):
    raise SystemExit('package.json: "live-studio" must be a JSON object')
CONFIG = _RAW_CFG or {}
_SOUND_CFG = CONFIG.get("soundTimeline", "src/timeline/audio.json")
if not isinstance(_SOUND_CFG, str) or not _SOUND_CFG.strip():
    raise SystemExit('package.json: "live-studio.soundTimeline" must be a relative file path')
SOUND_REL = _SOUND_CFG
try:
    SOUND_PATH = _assert_in_root(ROOT / SOUND_REL, "Sound timeline")
except ValueError as e:
    raise SystemExit(str(e))
if _MODE != "measure" and not SOUND_PATH.is_file():
    _msg = f"no {SOUND_REL} here: run it inside a film (cd films/<name>)"
    if _IS_MAIN:
        print(_msg, file=sys.stderr)
        raise SystemExit(2)
    raise SystemExit(_msg)

EDIT_PATH = ROOT / "src/edit.json"
if not EDIT_PATH.exists():
    READ_DOCUMENTS[stored_path(EDIT_PATH)] = None
try:
    E = _read_json(_assert_in_root(EDIT_PATH, "src/edit.json"), "src/edit.json") if EDIT_PATH.is_file() else None
except ValueError as e:
    raise SystemExit(str(e))
A = _read_stdin_json("Audio timeline stdin") if _MODE == "measure" else _read_json(SOUND_PATH, SOUND_REL)
# A track muted in the studio (audio.json "tracks", mute) is left out of every mix; a track's gain (dB) is a volume after each
# clip's own chain, so normalizing a clip (measure_clip) leaves it out
_tracks = A.get("tracks") if isinstance(A, dict) and isinstance(A.get("tracks"), list) else []
MUTED = {t["id"] for t in _tracks if isinstance(t, dict) and t.get("mute") and isinstance(t.get("id"), str)}
if isinstance(A, dict) and _MODE != "measure":
    for _k in ("beds", "sfx"):
        if isinstance(A.get(_k), list):
            A[_k] = [e for e in A[_k] if not isinstance(e, dict) or not isinstance(e.get("track"), str) or e.get("track") not in MUTED]
TRACKS = {t["id"]: t for t in _tracks if isinstance(t, dict) and isinstance(t.get("id"), str)}


def track_chain(e):
    """The track's own EQ (tracks[].filters) and volume, on every clip of it: each is linear, so per clip equals the bus"""
    tid = e.get("track") if isinstance(e, dict) else None
    t = TRACKS.get(tid, {}) if isinstance(tid, str) else {}
    raw_gain = t.get("gain", 0)
    db = float(raw_gain) if raw_gain is not None else 0.0
    return [*_safe_filters(t.get("filters")), *([f"volume={db:.4g}dB"] if db else [])]


PROJECTED_VOICE = LEGACY_TIMELINE = CAM_SEGMENTS = None


@cache
def _scene_spatial_data():
    cam_keys = []
    placed_data = {}
    cam_rel = CONFIG.get("camTimeline", "src/timeline/cam.json")
    if isinstance(cam_rel, str) and cam_rel.strip():
        try:
            cam_path = _assert_in_root(ROOT / cam_rel, "camTimeline")
        except ValueError as e:
            raise SystemExit(str(e))
        if cam_path.is_file():
            raw_cam = _read_json(cam_path, cam_rel)
            if isinstance(raw_cam, list):
                cam_keys = raw_cam
            elif isinstance(raw_cam, dict) and isinstance(raw_cam.get("keys"), list):
                cam_keys = raw_cam["keys"]
    kf = CONFIG.get("keyFiles")
    placed_kf = next((rel for rel, ed in kf.items() if isinstance(rel, str) and ed == "placed"), None) if isinstance(kf, dict) else None
    placed_rel = placed_kf or CONFIG.get("placedTimeline") or CONFIG.get("placed") or "src/timeline/placed.json"
    if isinstance(placed_rel, str) and placed_rel.strip():
        try:
            placed_path = _assert_in_root(ROOT / placed_rel, "placedTimeline")
        except ValueError as e:
            raise SystemExit(str(e))
        if placed_path.is_file():
            raw_placed = _read_json(placed_path, placed_rel)
            if isinstance(raw_placed, dict):
                placed_data = raw_placed
    return cam_keys, placed_data


def _cam_source_time(t_film: float) -> float:
    segs = CAM_SEGMENTS
    if not segs or t_film < 0.0:
        return t_film
    last_to = float(segs[-1].get("to", 0.0))
    if t_film >= last_to:
        return SOURCE_END + t_film - last_to
    hit = segs[-1]
    for seg in segs:
        if t_film < float(seg.get("to", 0.0)):
            hit = seg
            break
    if hit.get("frame") is not None:
        return float(hit["frame"])
    sf = float(hit.get("sourceFrom", 0.0))
    if hit.get("kind") == "freeze":
        return sf
    st = float(hit.get("sourceTo", sf))
    r0 = float(hit.get("rate0", 1.0))
    r1 = float(hit.get("rate1", r0))
    dt = t_film - float(hit.get("from", 0.0))
    span_src = st - sf
    k = (r1 - r0) / span_src if abs(span_src) > 1e-12 else 0.0
    dist = dt * r0 if abs(k) < 1e-10 else (r0 * math.expm1(k * dt)) / k
    return sf + dist


SCENE_SAMPLE_HZ = 30
SCENE_SAMPLE_PREFIX = "SPATIAL-SAMPLES "


def _render_scene_samples(request: str):
    renderer = Path(__file__).resolve().parents[2] / "packages/live-studio"
    bun = shutil.which("bun")
    if not bun:
        raise RuntimeError("Bun is required to sample a film's named scene targets")
    # A soundtrack export uses the film's own stage, independent of any manual frame-render options.
    ignored = {"AT", "LIST", "CHECK", "CHUNKS", "SPAN", "INSPECT", "CROP", "COMPARE", "RES", "SAMPLES", "LIVE_PROJECT"}
    env = {name: value for name, value in os.environ.items() if name not in ignored}
    env["ENTRY"] = str(renderer / "render/spatial-samples.ts")
    env["CHECK"] = "spatial-samples"
    env["LAB_SPATIAL"] = request
    try:
        run = subprocess.run(
            [bun, str(renderer / "render.mjs"), "stills"],
            cwd=ROOT, env=env, capture_output=True, encoding="utf8", errors="replace", timeout=120,
        )
    except subprocess.TimeoutExpired as e:
        raise RuntimeError("named scene target render exceeded 120 seconds") from e
    payload = next((line.removeprefix(SCENE_SAMPLE_PREFIX) for line in run.stdout.split("\n")
                    if line.startswith(SCENE_SAMPLE_PREFIX)), None)
    if run.returncode or payload is None:
        detail = next((line for line in run.stderr.splitlines() if line.strip()), "no scene samples returned")
        raise RuntimeError(detail)
    return json.loads(payload)


def _runtime_spatial_samples(beds, sfx, end, *, include_options=False):
    from spatial import placed_at

    pending, required = {}, set()
    placed_data = None
    for row in (*beds, *sfx):
        spec = row.get("spatial") or {}
        target = spec.get("target")
        if not target:
            continue
        if placed_data is None:
            _, placed_data = _scene_spatial_data()
        if placed_at(placed_data, target, 0.0, None) is not None:
            continue
        if "from" in row:
            start, stop = row["from"], row["to"]
        else:
            start = row["at"]
            length = _sfx_length(row)
            if include_options and len(options(row)) > 1:
                length = max(length, _sfx_options_length(row))
            stop = start + length
        start, stop = max(0.0, start), min(stop, end)
        if stop <= start:
            continue
        pending.setdefault(target, []).append([math.floor(start * SCENE_SAMPLE_HZ), math.ceil(stop * SCENE_SAMPLE_HZ)])
        if spec.get("at") is None:
            required.add(target)
    if not pending:
        return {}, {}

    for name, ranges in pending.items():
        merged = []
        for first, last in sorted(ranges):
            if merged and first <= merged[-1][1] + 1:
                merged[-1][1] = max(merged[-1][1], last)
            else:
                merged.append([first, last])
        pending[name] = merged
    names = ", ".join(sorted(required or pending))
    try:
        if not (ROOT / "src/scene.ts").is_file():
            raise RuntimeError("src/scene.ts is missing")
        samples = _render_scene_samples(json.dumps(pending, ensure_ascii=True, separators=(",", ":")))
    except (OSError, ValueError, RuntimeError) as e:
        detail = f"cannot resolve spatial scene targets ({names}): {e}"
        if required:
            raise SystemExit(detail) from e
        print(f"Warning: {detail}; using authored XYZ fallback.", file=sys.stderr)
        return {}, {}
    missing = sorted(name for name in required if not samples["positions"].get(name))
    if missing:
        raise SystemExit(
            f"spatial target not found: {', '.join(missing)} (check the scene name or add spatial.at)"
        )
    return samples["positions"], samples["cameras"]


def _interpolate_scene_samples(positions, cameras, t, last_frame):
    at = min(max(t, 0.0) * SCENE_SAMPLE_HZ, last_frame)
    first = math.floor(at)
    left, right, amount = str(first), str(math.ceil(at)), at - first

    def blend(a, b):
        return [x + (y - x) * amount for x, y in zip(a, b)]

    p0, p1 = positions.get(left), positions.get(right)
    c0, c1 = cameras.get(left), cameras.get(right)
    position = blend(p0, p1) if p0 is not None and p1 is not None else p0 if p0 is not None else p1
    pose = {key: blend(c0[key], c1[key]) for key in ("p", "l", "up")} if c0 and c1 else c0 or c1
    return position, pose


def _is_safe_rel_ir_path(space: str) -> bool:
    if not space or "\0" in space or space.startswith("/") or space.startswith("\\"):
        return False
    if len(space) >= 2 and space[1] == ":" and space[0].isalpha():
        return False
    return ".." not in space.replace("\\", "/").split("/")


def _decode_ir_stereo_f32(path: Path):
    import numpy as np
    from ir import normalize_stereo_ir

    r = subprocess.run(
        ["ffmpeg", "-xerror", "-v", "error", "-i", str(path), "-ar", "48000", "-ac", "2", "-f", "f32le", "-"],
        capture_output=True,
        check=True,
        timeout=30,
    )
    pcm = np.frombuffer(r.stdout, dtype=np.float32)
    frames = (len(pcm) // 2) * 2
    if frames == 0:
        return np.array([1.0], dtype=np.float32), np.array([1.0], dtype=np.float32)
    stereo = pcm[:frames].reshape(-1, 2)
    return normalize_stereo_ir(stereo[:, 0], stereo[:, 1])


@cache
def _resolve_ir_buffers(space: str):
    from ir import generate_impulse_response, is_preset_space, resolve_custom_ir_file

    if is_preset_space(space):
        ir_l, ir_r = generate_impulse_response(space, 48000)
        return ir_l, ir_r, None
    try:
        resolved = resolve_custom_ir_file(
            space,
            str(ROOT),
            lambda p, l: _assert_in_root(Path(p), l),
            lambda name: str(audio_file(name)) if SAFE_NAME.match(name) else None,
        )
    except ValueError as e:
        raise SystemExit(str(e))
    ir_path = Path(resolved)
    try:
        ir_l, ir_r = _decode_ir_stereo_f32(ir_path)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as e:
        raise SystemExit(f"failed reading reverb IR '{space}': {e}")
    return ir_l, ir_r, ir_path
_SFX_CFG = CONFIG.get("sfx", "sound/sfx")
if not isinstance(_SFX_CFG, str) or not _SFX_CFG.strip():
    raise SystemExit('package.json: "live-studio.sfx" must be a folder path')
SFX = ROOT / _SFX_CFG
_SOURCES_CFG = CONFIG.get("soundSources", {})
if not isinstance(_SOURCES_CFG, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in _SOURCES_CFG.items()):
    raise SystemExit('package.json: "live-studio.soundSources" must map sound names to file paths')
SOURCES = _SOURCES_CFG
SAFE_NAME = re.compile(r"^\w[\w.-]*$")


def _safe_filters(items):
    out = []
    if items is None:
        return out
    if not isinstance(items, list):
        raise ValueError(f"Unsafe or invalid ffmpeg audio filter list: {items!r}")
    for raw in items:
        if not isinstance(raw, str) or not ALLOWED_AUDIO_FILTER.match(raw):
            raise ValueError(f"Unsafe or invalid ffmpeg audio filter: {raw!r}")
        out.append(raw)
    return out


# What was picked in the studio: {sound name: {set: option name, gain: x}}. The studio writes it, never this script
CHOICES = next((ROOT / f for f in ("choices.json", "sound_choices.json") if (ROOT / f).exists()), ROOT / "choices.json")
try:
    choice_file = _assert_in_root(CHOICES, CHOICES.name) if CHOICES.exists() else None
    audio_choices = {"file": choice_file.name, **media_identity(choice_file)} if choice_file else None
    CHOICES_MAP = _read_json(choice_file, CHOICES.name, expect_dict=True) if choice_file else {}
except ValueError as e:
    raise SystemExit(str(e))
for _cname, _centry in CHOICES_MAP.items():
    if _centry is None:
        continue
    if not isinstance(_centry, dict):
        raise SystemExit(f"{CHOICES.name}: {_cname!r} must be a JSON object")
    if _centry.get("set") is not None and not isinstance(_centry["set"], str):
        raise SystemExit(f"{CHOICES.name}: {_cname!r}.set must be a string")
    if _centry.get("gain") is not None and (not _is_num(_centry["gain"]) or _centry["gain"] <= 0):
        raise SystemExit(f"{CHOICES.name}: {_cname!r}.gain must be a positive number")
STEMS = ROOT / "assets/public/agent/stems"  # served by the studio as /agent/stems


def _repo_vault_root():
    for d in (REAL_ROOT, *REAL_ROOT.parents):
        if (d / "vault.json").exists():
            return d.resolve()
    return None


def _find_vaults():
    cfg = CONFIG.get("soundVault")
    if cfg is False:
        return ()
    if cfg is not None and not isinstance(cfg, str):
        raise SystemExit('package.json: "live-studio.soundVault" must be false or a relative directory path')
    if isinstance(cfg, str):
        cand = ROOT / cfg
        repo_root = _repo_vault_root()
        abs_cand = cand.absolute() if cand.is_absolute() else (ROOT.absolute() / cand).absolute()
        allowed_roots = [r for r in (REAL_ROOT, repo_root) if r is not None]
        for seg_base in (ROOT.absolute(), *allowed_roots):
            if abs_cand.is_relative_to(seg_base):
                cur = seg_base
                for seg in abs_cand.relative_to(seg_base).parts:
                    cur = cur / seg
                    try:
                        st = cur.lstat()
                    except OSError:
                        break
                    if os.path.islink(cur) or (st.st_file_attributes & 0x400 if hasattr(st, "st_file_attributes") else False):
                        raise ValueError(f"soundVault cannot traverse symlink or junction: {cfg!r}")
                break
        p = cand.resolve()
        allowed = any(_inside(r, p) or p == r for r in allowed_roots)
        if not allowed:
            raise ValueError(f"soundVault escapes allowed root: {cfg!r}")
        return (p,) if p.exists() else ()
    for d in (ROOT, *ROOT.parents):
        vf = d / "vault.json"
        if vf.exists():
            try:
                READ_DOCUMENTS[stored_path(vf)] = media_identity(vf)
                vcfg = json.loads(vf.read_text(encoding="utf8"))
            except Exception:
                vcfg = {}
            vroot = (d / vcfg.get("root", "./vault")).resolve()
            mc_local = vroot / "mc-sound"
            mc_dir = mc_local if mc_local.exists() else None
            snd_dir = vroot / "sound" if (vroot / "sound").exists() else None
            return tuple(x for x in (mc_dir, snd_dir) if x is not None)
    return ()


VAULTS = _find_vaults()
VAULT = VAULTS[-1] if VAULTS else None


@cache
def _sound_index():
    out = {}
    for base in (*VAULTS, SFX):
        if base and base.exists():
            is_local = base == SFX
            real_base = REAL_ROOT if is_local else base.resolve()
            if is_local and (base.is_symlink() or not _inside(REAL_ROOT, base.resolve())):
                continue
            for ext in ("*.ogg", "*.wav"):
                for f in sorted(base.rglob(ext)):
                    if f.name.startswith(".") or not SAFE_NAME.match(f.stem):
                        continue
                    if is_local and f.is_symlink():
                        continue
                    if _inside(real_base, f.resolve()):
                        out[f.stem] = f
    return out


def audio_file(name):
    if not isinstance(name, str) or not SAFE_NAME.match(name):
        raise ValueError(f"Invalid audio source name: {name!r}")
    if name in SOURCES:
        return _assert_in_root(ROOT / SOURCES[name], "Audio source")
    sfx_ok = False
    try:
        sfx_real = _assert_in_root(SFX, "SFX folder")
        sfx_ok = sfx_real is not None
    except ValueError:
        sfx_ok = False
    if sfx_ok:
        for ext in (".wav", ".ogg"):
            direct = SFX / f"{name}{ext}"
            if direct.exists():
                return _assert_in_root(direct, "Audio file")
    hit = _sound_index().get(name)
    if hit is not None:
        return hit
    if name == "narration":
        fallback = ROOT / "assets/public/agent/full_voice.wav"
        if fallback.exists():
            return _assert_in_root(fallback, "Narration audio")
    return _assert_in_root(SFX / f"{name}.wav", "Audio path")


def resolve_audio_sources(names):
    selected = {}
    for name in names:
        try:
            path = audio_file(name)
            selected[name] = stored_path(path) if path.is_file() else None
        except (ValueError, OSError):
            selected[name] = None
    return selected


@cache
def present(name):
    """The sound's file, or one line saying it is missing instead of a traceback from ffmpeg"""
    try:
        f = audio_file(name)
    except ValueError as e:
        raise SystemExit(str(e))
    if not f.exists():
        raise SystemExit(f'no sound "{name}" in {SFX.relative_to(ROOT).as_posix()}/ or the vault: bun run check names every missing one, a near name or another film that has it, and how to replace it')
    return f


def loudness(name):
    """Mean level in dB, so an option comes in at the level of the sound it stands in for (the room hum is 28 dB up)."""
    src = present(name)
    r = subprocess.run(["ffmpeg", "-xerror", "-v", "info", "-i", str(src), "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True, timeout=30)
    if r.returncode != 0:
        err = r.stderr.strip().splitlines()[-1] if r.stderr.strip() else "ffmpeg failed"
        raise SystemExit(f"{src}: could not read loudness ({err})")
    m = re.search(r"mean_volume: (-?[\d.]+) dB", r.stderr)
    return float(m.group(1)) if m else -91.0


@cache
def seconds(name):
    src = present(name)
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(src)], capture_output=True, text=True, timeout=30)
    if r.returncode != 0:
        err = r.stderr.strip().splitlines()[-1] if r.stderr.strip() else "ffprobe failed"
        raise SystemExit(f"{src}: could not probe duration ({err})")
    try:
        dur = float(r.stdout.strip())
    except ValueError:
        raise SystemExit(f"{src}: unreadable or corrupt audio file (missing duration)")
    if not math.isfinite(dur) or dur < 0:
        raise SystemExit(f"{src}: invalid audio duration ({dur})")
    return dur


def options(e):
    return list(dict.fromkeys([e["name"], *e.get("try", [])]))


_CHOICES_RESOLVED = False


def as_option(e, name, gain=1.0):
    """The same placement played with another sound. Its start offset belongs to the original file, so an option plays from its own start."""
    gain = float(gain)
    if not math.isfinite(gain) or gain <= 0:
        raise ValueError(f"{e.get('name', name)!r}: choice gain must be positive (got {gain!r})")
    if name == e["name"] and gain == 1.0:
        return e
    out = {**e, "name": name, "gain": e["gain"] + loudness(e["name"]) - loudness(name) + 20 * math.log10(gain)}
    if e.get("gainKeys"):
        out["gainKeys"] = [{**k, "gain": k["gain"] + out["gain"] - e["gain"]} for k in e["gainKeys"]]
    if name != e["name"]:
        out.pop("start", None)
        if e.get("_auto_length"):
            out.pop("length", None)
    return out


def _sfx_length(row):
    available = seconds(row["name"]) - (row.get("start") or 0)
    if available <= 0:
        return 0.0
    length = row.get("length")
    return length if length is not None else available / (row.get("rate") or 1)


def _sfx_options_length(row):
    length = row.get("length")
    if length is not None and not row.get("_auto_length"):
        return length
    rate = row.get("rate") or 1
    longest = max(
        (seconds(name) - ((row.get("start") or 0) if name == row["name"] else 0)) / rate
        for name in options(row)
    )
    return max(length, longest) if length is not None else longest


def unfit():
    """The first row missing a field every row of its list must have (the ones the mix reads), said as bun run check would
    place it; None when all rows have them. bun run mix and listen stop on it before any work, check names every fault."""
    if not isinstance(E, dict):
        return 'src/edit.json: missing or not a JSON object: bun run check names every fault'
    end = E.get("end")
    if isinstance(end, bool) or not isinstance(end, (int, float)) or end <= 0:
        return 'src/edit.json: no "end" (seconds after 0): bun run mix needs it for sound/mix.wav'
    voice = E.get("voice")
    if isinstance(voice, dict) and "lines" in voice:
        lines = voice["lines"]
        if not isinstance(lines, list) or any(not isinstance(line, list) or len(line) != 2 or not all(_is_num(t) for t in line) for line in lines):
            return 'src/edit.json: voice.lines must be a list of [start, end] seconds'
    if not isinstance(A, dict):
        return f"{SOUND_REL}: not a JSON object: bun run check names every fault"
    if A.get("voice") is True and not A.get("narration") and not (ROOT / "assets/public/agent/full_voice.wav").is_file():
        return f'{SOUND_REL}: "voice" is true without "narration", and assets/public/agent/full_voice.wav does not exist'
    for top_key in ("lufs", "drive", "voiceGain", "voiceStrength"):
        if A.get(top_key) is not None and not _is_num(A[top_key]):
            return f"{SOUND_REL}: {top_key} must be a finite number"
    if A.get("voiceStrength") is not None and not 0 <= A["voiceStrength"] <= 100:
        return f"{SOUND_REL}: voiceStrength must be between 0 and 100"
    if A.get("narration") is not None and (not isinstance(A["narration"], str) or not A["narration"]):
        return f"{SOUND_REL}: narration must be a sound name"

    def _bad_reverb(spec, where):
        if spec is None:
            return None
        if not isinstance(spec, dict):
            return f"{SOUND_REL}: {where}.reverb must be a JSON object"
        sp = spec.get("space")
        if not isinstance(sp, str) or not _is_safe_rel_ir_path(sp):
            return f"{SOUND_REL}: {where}.reverb.space invalid or unsafe path"
        if spec.get("wet") is not None and (not _is_num(spec["wet"]) or not 0 <= spec["wet"] <= 1):
            return f"{SOUND_REL}: {where}.reverb.wet must be between 0 and 1"
        if spec.get("preDelayMs") is not None and (not _is_num(spec["preDelayMs"]) or not 0 <= spec["preDelayMs"] <= 500):
            return f"{SOUND_REL}: {where}.reverb.preDelayMs must be between 0 and 500"
        return None

    def _bad_spatial(spec, where):
        if spec is None:
            return None
        if not isinstance(spec, dict):
            return f"{SOUND_REL}: {where}.spatial must be a JSON object"
        for vk in ("at", "offset"):
            v = spec.get(vk)
            if v is not None and (not isinstance(v, list) or len(v) != 3 or not all(_is_num(x) for x in v)):
                return f"{SOUND_REL}: {where}.spatial.{vk} must be [x, y, z]"
        if spec.get("target") is not None and (not isinstance(spec["target"], str) or not spec["target"]):
            return f"{SOUND_REL}: {where}.spatial.target must be a non-empty string"
        if spec.get("refDistance") is not None and (not _is_num(spec["refDistance"]) or spec["refDistance"] <= 0):
            return f"{SOUND_REL}: {where}.spatial.refDistance must be > 0"
        if spec.get("maxDistance") is not None and (not _is_num(spec["maxDistance"]) or spec["maxDistance"] <= 0):
            return f"{SOUND_REL}: {where}.spatial.maxDistance must be > 0"
        if spec.get("refDistance") is not None and spec.get("maxDistance") is not None and spec["maxDistance"] < spec["refDistance"]:
            return f"{SOUND_REL}: {where}.spatial.maxDistance must be >= refDistance"
        if spec.get("rolloff") is not None and (not _is_num(spec["rolloff"]) or not 0 <= spec["rolloff"] <= 10):
            return f"{SOUND_REL}: {where}.spatial.rolloff must be between 0 and 10"
        if spec.get("occlusion") is not None and (not _is_num(spec["occlusion"]) or not 0 <= spec["occlusion"] <= 1):
            return f"{SOUND_REL}: {where}.spatial.occlusion must be between 0 and 1"
        if spec.get("airAbsorption") is not None and not isinstance(spec["airAbsorption"], bool):
            return f"{SOUND_REL}: {where}.spatial.airAbsorption must be boolean"
        return None

    err = _bad_reverb(A.get("reverb"), "audio")
    if err:
        return err
    if A.get("spaces") is not None:
        if not isinstance(A["spaces"], list):
            return f"{SOUND_REL}: spaces must be a list"
        for i, s in enumerate(A["spaces"]):
            if not isinstance(s, dict) or not _is_num(s.get("from")) or s["from"] < 0:
                return f"{SOUND_REL}: spaces[{i}].from must be >= 0"
            if s.get("to") is not None and (not _is_num(s["to"]) or s["to"] <= s["from"]):
                return f"{SOUND_REL}: spaces[{i}].to must come after from"
            err = _bad_reverb(s, f"spaces[{i}]")
            if err:
                return err
    tracks = A.get("tracks")
    if tracks is not None:
        if not isinstance(tracks, list):
            return f"{SOUND_REL}: tracks must be a list"
        for i, t in enumerate(tracks):
            if not isinstance(t, dict) or not isinstance(t.get("id"), str) or not t["id"]:
                return f"{SOUND_REL}: tracks[{i}] must have a string id"
            if t.get("gain") is not None and not _is_num(t["gain"]):
                return f"{SOUND_REL}: tracks[{i}] gain must be a finite number"
            try:
                _safe_filters(t.get("filters"))
            except ValueError as e:
                return f"{SOUND_REL}: tracks[{i}] {e}"
    need = {"beds": ("name", "from", "to", "gain", "fadeIn", "fadeOut"), "sfx": ("name", "at", "gain")}
    for kind, keys in need.items():
        rows = A.get(kind)
        if not isinstance(rows, list):
            return f"{SOUND_REL}: no {kind} list: bun run check names every fault"
        for i, row in enumerate(rows):
            gone = next((k for k in keys if not isinstance(row, dict) or row.get(k) is None), None)
            if gone:
                return f"{SOUND_REL}: {kind}[{i}] has no {gone}: bun run check names every fault and where"
            if not isinstance(row["name"], str) or not row["name"]:
                return f"{SOUND_REL}: {kind}[{i}].name must be a non-empty string"
            num_keys = ("from", "to", "gain", "fadeIn", "fadeOut") if kind == "beds" else ("at", "gain")
            for nk in num_keys:
                if not _is_num(row[nk]):
                    return f"{SOUND_REL}: {kind}[{i}].{nk} must be a finite number"
            if kind == "beds":
                if row["from"] < -1e-4:
                    return f"{SOUND_REL}: beds[{i}].from must be >= 0 (got {row['from']})"
                if row["fadeIn"] < 0 or row["fadeOut"] < 0:
                    return f"{SOUND_REL}: beds[{i}] fadeIn/fadeOut must be >= 0"
                if row.get("duck") is not None and (not _is_num(row["duck"]) or row["duck"] < 0):
                    return f"{SOUND_REL}: beds[{i}].duck must be >= 0"
            else:
                if row["at"] < -1e-4:
                    return f"{SOUND_REL}: sfx[{i}].at must be >= 0 (got {row['at']})"
                if row.get("length") is not None and not _is_num(row["length"]):
                    return f"{SOUND_REL}: sfx[{i}].length must be a finite number"
                for fk in ("fadeIn", "fadeOut"):
                    if row.get(fk) is not None and (not _is_num(row[fk]) or row[fk] < 0):
                        return f"{SOUND_REL}: sfx[{i}].{fk} must be >= 0"
            if row.get("start") is not None and (not _is_num(row["start"]) or row["start"] < 0):
                return f"{SOUND_REL}: {kind}[{i}].start must be >= 0"
            if row.get("rate") is not None and (not _is_num(row["rate"]) or row["rate"] <= 0):
                return f"{SOUND_REL}: {kind}[{i}].rate must be > 0"
            if row.get("pan") is not None and (not _is_num(row["pan"]) or not -1 <= row["pan"] <= 1):
                return f"{SOUND_REL}: {kind}[{i}].pan must be between -1 and 1"
            if row.get("voiceStrength") is not None and (not _is_num(row["voiceStrength"]) or not 0 <= row["voiceStrength"] <= 100):
                return f"{SOUND_REL}: {kind}[{i}].voiceStrength must be between 0 and 100"
            if row.get("voiceFilter") is not None and row["voiceFilter"] not in ("none", "telephone", "walkieTalkie", "megaphone"):
                return f"{SOUND_REL}: {kind}[{i}].voiceFilter unknown: {row['voiceFilter']!r}"
            if row.get("try") is not None and (not isinstance(row["try"], list) or any(not isinstance(o, str) or not o for o in row["try"])):
                return f"{SOUND_REL}: {kind}[{i}].try must be a list of sound names"
            if row.get("gainKeys") is not None:
                if not isinstance(row["gainKeys"], list) or any(not isinstance(k, dict) or not _is_num(k.get("t")) or not _is_num(k.get("gain")) for k in row["gainKeys"]):
                    return f"{SOUND_REL}: {kind}[{i}].gainKeys entries must have finite time and gain"
            try:
                _safe_filters(row.get("filters"))
            except ValueError as e:
                return f"{SOUND_REL}: {kind}[{i}] {e}"
            err = _bad_reverb(row.get("reverb"), f"{kind}[{i}]") or _bad_spatial(row.get("spatial"), f"{kind}[{i}]")
            if err:
                return err
    return None


def _picked(e):
    c = (CHOICES_MAP.get(e["name"]) or {}) if isinstance(CHOICES_MAP, dict) else {}
    if c.get("set") == "off":
        return None
    gain = c.get("gain", 1.0)
    return as_option(e, c["set"] if c.get("set") in options(e) else e["name"], 1.0 if gain is None else gain)


def chosen(e):
    """None when the studio's Tắt was picked (set "off"): the sound is left out of the mix."""
    if e.get("_off"):
        return None
    return e if _CHOICES_RESOLVED else _picked(e)


def resolve_choices(drop_off=True):
    global _CHOICES_RESOLVED
    if _CHOICES_RESOLVED or not isinstance(A, dict):
        return
    narr = A.get("narration")
    if narr:
        narr_clips = [c for c in A.get("sfx") or [] if isinstance(c, dict) and c.get("name") == narr]
        for c in narr_clips:
            c["_narration"] = True
        nc = (CHOICES_MAP.get(narr) or {}) if isinstance(CHOICES_MAP, dict) else {}
        if nc.get("set") and nc.get("set") != "off":
            if narr_clips and all(nc["set"] in options(c) for c in narr_clips):
                A["narration"] = nc["set"]
    for list_name in ("beds", "sfx"):
        out = []
        for item in A.get(list_name) or []:
            c = _picked(item)
            if c is None:
                if not drop_off:
                    out.append({**item, "_off": True})
                continue
            out.append(c)
        A[list_name] = out
    _CHOICES_RESOLVED = True


# Ducking (a bed's "duck": N dB under the narration): the same shape as the studio's app/sound/duck.ts, change both together
ATTACK, RELEASE = 0.3, 0.8


def warped(x):
    """A source second as heard, through the voice edit's warp (live-studio src/edit.ts map)."""
    voice = E.get("voice") if isinstance(E, dict) and isinstance(E.get("voice"), dict) else {}
    w = voice.get("warp") or []
    if len(w) < 2:
        return x
    if x <= w[0][0]:
        return x - w[0][0] + w[0][1]
    if x >= w[-1][0]:
        return x - w[-1][0] + w[-1][1]
    i = max(k for k in range(len(w) - 1) if w[k][0] <= x)
    dx = w[i + 1][0] - w[i][0]
    return w[i][1] if dx == 0 else w[i][1] + (x - w[i][0]) / dx * (w[i + 1][1] - w[i][1])


_edit_end = E.get("end") if isinstance(E, dict) else None
SOURCE_END = END = warped(_edit_end) if isinstance(_edit_end, (int, float)) and not isinstance(_edit_end, bool) else 0.0


def voice_intervals(clips=None):
    voice = E.get("voice") if isinstance(E, dict) and isinstance(E.get("voice"), dict) else {}
    intervals = [[a, b] for a, b in voice.get("lines", [])]
    if A.get("narration"):
        projected = []
        for clip in A["sfx"] if clips is None else clips:
            if clip.get("_off") or not (clip.get("_narration") or clip["name"] == A["narration"]):
                continue
            rate, start = float(clip.get("rate") or 1), float(clip.get("start") or 0)
            length = float(clip["length"]) if clip.get("length") is not None else (seconds(clip["name"]) - start) / rate
            end = start + length * rate
            for a, b in intervals:
                if b <= start or a >= end:
                    continue
                a, b = max(start, a), min(end, b)
                projected.append([clip["at"] + (end - b if clip.get("reverse") else a - start) / rate,
                                  clip["at"] + (end - a if clip.get("reverse") else b - start) / rate])
        intervals = projected
    return intervals


def prepare_timing(apply_choices=True, drop_off=True):
    global A, END, PROJECTED_VOICE, LEGACY_TIMELINE, CAM_SEGMENTS
    END, PROJECTED_VOICE, LEGACY_TIMELINE, CAM_SEGMENTS = SOURCE_END, None, None, None
    if unfit():
        return
    if apply_choices:
        resolve_choices(drop_off=drop_off)
    path = CONFIG.get("timingTimeline")
    if not path:
        return
    if not isinstance(path, str) or not path.strip():
        raise SystemExit('package.json: "live-studio.timingTimeline" must be a relative file path')
    try:
        timing_path = _assert_in_root(ROOT / path, "Timing timeline")
    except ValueError as e:
        raise SystemExit(str(e))
    if not timing_path.is_file():
        raise SystemExit(f"{path}: missing timingTimeline file (set in package.json; restore it, write {{}}, or remove timingTimeline)")
    timing = _read_json(timing_path, path, expect_dict=True)
    if not timing.get("layers") and not any(timing.get(k) for k in ("speeds", "freezes", "cuts", "gaps", "main", "layerKinds")):
        return
    no_len = {i for i, c in enumerate(A["sfx"]) if c.get("length") is None}
    payload = {"timing": timing, "duration": SOURCE_END, "audio": A,
               "durations": {c["name"]: seconds(c["name"]) for c in A["sfx"] if c.get("length") is None},
               "voiceIntervals": voice_intervals(),
               "voiceClips": [{"from": c["at"],
                               "to": c["at"] + (c["length"] if c.get("length") is not None else
                                                 (seconds(c["name"]) - (c.get("start") or 0)) / (c.get("rate") or 1)),
                               "intervals": voice_intervals([c])}
                              for c in A["sfx"] if c.get("_narration") or c["name"] == A.get("narration")]
                              if A.get("narration") else None}
    cli = Path(__file__).resolve().parents[2] / "packages/live-studio/src/timing-audio-cli.mjs"
    runner = shutil.which("bun") or shutil.which("node") or "node"
    try:
        r = subprocess.run([runner, str(cli)], input=json.dumps(payload), capture_output=True, text=True, check=True, timeout=20)
        result = json.loads(r.stdout)
    except subprocess.CalledProcessError as e:
        msg = (e.stderr or e.stdout or str(e)).strip().splitlines()[-1] if (e.stderr or e.stdout) else str(e)
        raise SystemExit(f"{path}: failed to apply timing ({msg})")
    except (subprocess.TimeoutExpired, OSError, json.JSONDecodeError) as e:
        raise SystemExit(f"{path}: failed to apply timing ({e})")
    A, END = result["audio"], result["end"]
    if not apply_choices:
        for i in no_len:
            if i < len(A["sfx"]) and "length" in A["sfx"][i]:
                A["sfx"][i]["_auto_length"] = True
    PROJECTED_VOICE, LEGACY_TIMELINE, CAM_SEGMENTS = (
        result["voiceIntervals"],
        result["legacyTimeline"],
        result.get("camSegments"),
    )


def duck_windows():
    intervals = voice_intervals() if PROJECTED_VOICE is None else PROJECTED_VOICE
    out = []
    for s0, e0 in sorted(intervals):
        if out and s0 - out[-1][1] < ATTACK + RELEASE:
            out[-1][1] = max(out[-1][1], e0)
        else:
            out.append([s0, e0])
    return out


def duck_expr(start_at, end_at, db):
    """volume filter expression on a bed's own clock (t 0 at start_at): one trapezoid per window, which never overlap."""
    g = 10 ** (-db / 20)
    parts = [f"clip(min((t+{start_at - a + ATTACK:.4f})/{ATTACK},({b + RELEASE - start_at:.4f}-t)/{RELEASE}),0,1)"
             for a, b in duck_windows() if b + RELEASE > start_at and a - ATTACK < end_at]
    return f"volume='1-{1 - g:.6f}*({'+'.join(parts)})':eval=frame" if parts else None


def pan_filter(p):
    """audio.json pan (-1 left .. 1 right) as Web Audio's StereoPannerNode moves a stereo signal (equal power), the way the
    studio's live mix plays it (live-studio app/sound/mixer.ts), so both agree."""
    if p <= 0:
        x = (p + 1) * math.pi / 2
        return f"pan=stereo|c0=c0+{math.cos(x):.6f}*c1|c1={math.sin(x):.6f}*c1"
    x = p * math.pi / 2
    return f"pan=stereo|c0={math.cos(x):.6f}*c0|c1=c1+{math.sin(x):.6f}*c0"


def gain_filter(keys, base):
    """Clip-local, linear dB automation; aeval evaluates each sample, matching Web Audio's exponential gain ramps."""
    if not keys:
        return None
    ordered = sorted(keys, key=lambda k: k["t"])
    expression = f"({ordered[0]['gain'] - base:.12g})"
    for a, b in zip(ordered, ordered[1:]):
        dt = b["t"] - a["t"]
        dg = b["gain"] - a["gain"]
        if dt <= 0:
            expression += f"+({dg:.12g})*gte(t,{a['t']:.12g})"
        else:
            expression += f"+({dg:.12g})*clip((t-({a['t']:.12g}))/({dt:.12g}),0,1)"
    return f"aeval='val(ch)*pow(10,({expression})/20)':c=same"


def picture_properties(path, *, decode=False):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-count_packets",
                        *(["-count_frames"] if decode else []),
                        "-show_entries", "stream=index,nb_read_packets,nb_read_frames,duration,start_time:stream_disposition=attached_pic:format=start_time,format_name",
                        "-of", "json", str(path)], capture_output=True, text=True, timeout=600 if decode else 120)
    if r.returncode or r.stderr.strip():
        raise ValueError(f"{path}: picture check failed; previous output kept. {r.stderr.strip()[-500:]}")
    data = json.loads(r.stdout)
    streams = data.get("streams", [])
    from review.sheet_view import picture_bounds, presentation_bounds
    picture_end = 0
    for stream in streams:
        stream["attached"] = bool(stream.get("disposition", {}).get("attached_pic"))
        if stream["attached"]:
            continue
        if decode and not stream.get("nb_read_frames"):
            raise ValueError(f"{path}: no decoded frames in a picture track; previous output kept")
        selector = str(stream["index"])
        _, stop, origin = picture_bounds(path, stream, data["format"], selector=selector)
        stream["presentation"] = presentation_bounds(path, origin, selector)
        picture_end = max(picture_end, stop)
    if not picture_end:
        raise ValueError(f"{path}: no timed picture track; previous output kept")
    return streams, picture_end


def publish(outputs, scratch):
    backups = []
    for i, (_, destination) in enumerate(outputs):
        backup = scratch / f"backup-{i}"
        if destination.exists():
            os.link(destination, backup)
        backups.append(backup)
    published = []
    try:
        for (source, destination), backup in zip(outputs, backups):
            source.replace(destination)
            published.append((destination, backup))
    except OSError:
        for destination, backup in reversed(published):
            if backup.exists():
                backup.replace(destination)
            else:
                destination.unlink()
        raise


def build(out, beds, sfx, voice=True, span=None, master=True, float_output=False, end=None, source_bindings=None, scene_samples=None):
    with tempfile.TemporaryDirectory(prefix="studio-mix-clips-") as folder:
        _build(out, beds, sfx, voice, span, master, float_output, end, Path(folder), source_bindings, scene_samples)


def _build(out, beds, sfx, voice, span, master, float_output, end, folder, source_bindings, scene_samples):
    from ir import resolve_clip_reverb
    from spatial import is_spatial_active

    inputs, chains = [], []
    end = END if end is None else end
    scene_positions, scene_cameras = scene_samples if scene_samples is not None else _runtime_spatial_samples(beds, sfx, end)

    def add(path, at, gain, start=0.0, length=None, fade_in=0.0, fade_out=0.0, loop=False, extra=(), gain_keys=None, processing=None, reverb_spec=None, spatial_spec=None):
        if length is not None and length <= 0:
            return
        if source_bindings is not None:
            stored = stored_path(path)
            source_bindings["files"][stored] = media_identity(path)
            if processing and processing.get("name"):
                source_bindings["names"][processing["name"]] = stored
        i = len(chains)  # one chain per input file, so this is the input's index
        timing = (processing or {}).get("__timing")
        rate = float((processing or {}).get("rate") or 1)
        # a bed that runs past its file's end crossfades into the next pass (process.py loop_xfade), never a hard -stream_loop jump
        file = seconds(processing["name"]) if loop and processing else 0
        wraps = bool(loop and processing and length is not None) and start + length * rate > file
        if processing and (timing or wraps or processing.get("dialogue") or rate != 1 or (processing.get("pitch") or 0) or processing.get("reverse") or ((processing.get("voiceFilter") or "none") != "none" and (processing.get("voiceStrength") if processing.get("voiceStrength") is not None else 100) > 0)):
            length = length if length is not None else (seconds(processing["name"]) - start) / rate
            if length <= 0 and not timing:
                return
            processed = folder / f"{i}.wav"
            settings = {**processing, "start": start, "duration": timing["duration"] if timing else length, "loop": loop}
            if timing:
                settings["timeline"] = timing["timeline"]
            try:
                process_audio(path, processed, settings)
            except (RuntimeError, ValueError, subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as e:
                msg = (e.stderr or e.stdout or str(e)).strip().splitlines()[-1] if isinstance(e, subprocess.CalledProcessError) and (e.stderr or e.stdout) else str(e)
                raise SystemExit(f"audio processing failed for {processing.get('name', path)}: {msg}")
            path, start = processed, 0
        f = [f"atrim=start={start}" + (f":duration={length}" if length else ""), "asetpts=PTS-STARTPTS",
             "aformat=sample_rates=48000:channel_layouts=stereo", f"volume={gain}dB", *extra]
        automation = gain_filter(gain_keys, gain)
        if automation:
            f.append(automation)
        if fade_in:
            f.append(f"afade=t=in:d={fade_in}")
        if fade_out and length:
            f.append(f"afade=t=out:st={max(0, length - fade_out)}:d={fade_out}")
        samples = max(0, math.floor(at * 48000 + 0.5))
        spatial_on = is_spatial_active(spatial_spec)
        if spatial_on or reverb_spec is not None:
            pre_wav = folder / f"{i}_pre.wav"
            pre_graph = f"[0:a]{','.join(f)}[p]"
            try:
                subprocess.run(
                    ["ffmpeg", "-xerror", "-v", "error", "-y", "-i", str(path), "-filter_complex", pre_graph, "-map", "[p]", "-ar", "48000", "-ac", "2", "-c:a", "pcm_f32le", str(pre_wav)],
                    check=True,
                    capture_output=True,
                    text=True,
                    timeout=120,
                )
            except subprocess.CalledProcessError as e:
                detail = next(iter((e.stderr or "").splitlines()), f"exit {e.returncode}")
                raise SystemExit(f"ffmpeg spatial pre-render failed for {path}: {detail}")
            import numpy as np
            from scipy.io import wavfile
            from ir import apply_convolution_reverb
            from spatial import apply_spatial_audio

            _, raw_buf = wavfile.read(str(pre_wav))
            if raw_buf.ndim == 1:
                raw_buf = np.column_stack((raw_buf, raw_buf))
            buf = raw_buf.astype(np.float32)
            if spatial_on:
                cam_keys, placed_data = _scene_spatial_data()
                track = scene_positions.get(spatial_spec.get("target"))
                clip_end = min(at + length, end) if length is not None else end
                end_frame = clip_end * SCENE_SAMPLE_HZ
                nearest_frame = round(end_frame)
                # Decimal sums such as 0.2 + 0.1 can land just above the cut frame.
                if abs(end_frame - nearest_frame) <= 4 * math.ulp(end_frame):
                    end_frame = nearest_frame
                last_frame = math.nextafter(end_frame, -math.inf)

                def scene_sample(t):
                    return _interpolate_scene_samples(track, scene_cameras, t, last_frame)

                try:
                    buf = apply_spatial_audio(
                        buf, at, 48000, spatial_spec, cam_keys, placed_data, _cam_source_time,
                        scene_sample_fn=scene_sample if track is not None and at < clip_end else None,
                    )
                except ValueError as e:
                    raise SystemExit(str(e)) from e
            if reverb_spec is not None:
                ir_l, ir_r, ir_path = _resolve_ir_buffers(reverb_spec["space"])
                if source_bindings is not None and ir_path is not None:
                    source_bindings["files"][stored_path(ir_path)] = media_identity(ir_path)
                buf = apply_convolution_reverb(buf, ir_l, ir_r, reverb_spec["wet"], reverb_spec["preDelayMs"], 48000)
            fx_wav = folder / f"{i}_fx.wav"
            wavfile.write(str(fx_wav), 48000, np.asarray(buf, dtype=np.float32))
            inputs.extend(["-i", str(fx_wav)])
            chains.append(f"[{i}:a]adelay={samples}S|{samples}S[a{i}]")
            return
        inputs.extend(["-i", str(path)])
        f.append(f"adelay={samples}S|{samples}S")
        chains.append(f"[{i}:a]{','.join(f)}[a{i}]")

    # Dialogue compression (4:1 above -30 dBFS, fast attack) and a voice limiter bring the hushed narration's peaks to
    # about 11 dB over its loudness, so the loudness pass below can stay linear
    has_voice = A.get("voice") is True or (A.get("voice") is None and (ROOT / "assets/public/agent/full_voice.wav").is_file())
    if voice and not A.get("narration") and has_voice:
        add(_assert_in_root(ROOT / "assets/public/agent/full_voice.wav", "Voice audio"), 0, float(A.get("voiceGain") or 0), length=END,
            processing={"dialogue": True, **({"__timing": {"duration": SOURCE_END, "timeline": LEGACY_TIMELINE}} if LEGACY_TIMELINE else {})})
    spaces = A.get("spaces")
    film_reverb = A.get("reverb")
    for b in beds:
        if b["to"] <= b["from"]:
            continue
        duck_db = float(b["duck"]) if b.get("duck") is not None else 0.0
        duck = duck_expr(b["from"], b["to"], duck_db) if duck_db and (A.get("narration") or has_voice) else None
        mid_t = 0.5 * (float(b["from"]) + float(b["to"]))
        rev = resolve_clip_reverb(b.get("reverb"), _cam_source_time(mid_t), spaces, film_reverb)
        add(present(b["name"]), float(b["from"]), float(b["gain"]), float(b.get("start") or 0), float(b["to"] - b["from"]), float(b["fadeIn"]), float(b["fadeOut"]), loop=True, gain_keys=b.get("gainKeys"), processing=b, extra=[*_safe_filters(b.get("filters")), *track_chain(b), *([duck] if duck else []), *([pan_filter(float(b["pan"]))] if b.get("pan") else [])], reverb_spec=rev, spatial_spec=b.get("spatial"))
    for s in sfx:
        start_at = float(s.get("start") or 0)
        if (s.get("length") is not None and float(s["length"]) <= 0) or start_at >= seconds(s["name"]):
            continue
        s_len = float(s["length"]) if s.get("length") is not None else None
        eff_len = s_len if s_len is not None else max(0.0, (seconds(s["name"]) - start_at) / float(s.get("rate") or 1.0))
        mid_t = float(s["at"]) + 0.5 * eff_len
        rev = resolve_clip_reverb(s.get("reverb"), _cam_source_time(mid_t), spaces, film_reverb)
        add(present(s["name"]), float(s["at"]), float(s["gain"]), start_at, s_len, float(s.get("fadeIn") or 0), float(s.get("fadeOut") or 0), gain_keys=s.get("gainKeys"), processing=s, extra=[*_safe_filters(s.get("filters")), *track_chain(s), *([pan_filter(float(s["pan"]))] if s.get("pan") else [])], reverb_spec=rev, spatial_spec=s.get("spatial"))
    if not chains:  # a film with no sound yet: silence as long as the film
        inputs.extend(["-f", "lavfi", "-t", str(end), "-i", "anullsrc=r=48000:cl=stereo"])
        chains.append("[0:a]anull[a0]")
    drive_db = float(A.get("drive") or 0)
    graph = chains + [
        # audio.drive dB into the limiter first: hits (a slam, a drawer) stand ~20 dB over the average, too far apart for the
        # linear -14 LUFS pass below; the limiter trims them so the gap fits. Then the
        # safety limiter at about -7 dBFS. The loudness pass after it stays linear (listen.level): a dynamic one lifts
        # every quiet stretch (the CCTV hiss came up level with the voice), so drive is the only lever for more loudness
        f"{''.join(f'[a{i}]' for i in range(len(chains)))}amix=inputs={len(chains)}:normalize=0,apad=whole_dur={end},asetpts=N/SR/TB,atrim=duration={end}"
        + (f",volume={drive_db}dB,alimiter=limit=0.45:level=false:latency=true" if master else "")
        + (f",atrim={span[0]}:{span[1]},asetpts=PTS-STARTPTS" if span else "") + "[out]",
    ]
    out.parent.mkdir(parents=True, exist_ok=True)
    script = out.with_name(out.name + ".graph.txt")
    script.write_text(";\r\n".join(graph), encoding="utf8")
    codec = ["-c:a", "libopus", "-b:a", "96k"] if out.suffix == ".webm" else ["-c:a", "pcm_f32le" if float_output else "pcm_s16le"]
    try:
        subprocess.run(["ffmpeg", "-xerror", "-v", "error", "-y", *inputs, "-/filter_complex", str(script), "-map", "[out]", "-ar", "48000", *codec, str(out)],
                       check=True, stderr=subprocess.PIPE, text=True, errors="replace", timeout=120 if float_output else 300)
    except subprocess.CalledProcessError as e:
        source = re.search(r"\bin#(\d+)[/ ]", e.stderr)
        paths = [inputs[i + 1] for i, arg in enumerate(inputs) if arg == "-i"]
        detail = next(iter(e.stderr.splitlines()), f"exit {e.returncode}")
        name = f" reading {paths[int(source[1])]}" if source and int(source[1]) < len(paths) else ""
        raise SystemExit(f"ffmpeg mix failed{name}: {detail}")
    except subprocess.TimeoutExpired:
        raise SystemExit("ffmpeg mix timed out")
    finally:
        script.unlink(missing_ok=True)


def measure_clip(kind, index):
    if kind not in ("beds", "sfx"):
        raise ValueError(f"Unknown clip kind: {kind!r}")
    rows = A.get(kind)
    if not isinstance(rows, list) or index < 0 or index >= len(rows) or not isinstance(rows[index], dict):
        raise ValueError(f"{kind}[{index}] does not exist")
    c = chosen({**rows[index], "track": None})  # --measure reads the unsaved lanes, unfiltered, from stdin
    if c is None:
        raise ValueError("Choose an audible sound option before normalizing")
    start_key = "from" if kind == "beds" else "at"
    if c.get("name") is None or c.get(start_key) is None or c.get("gain") is None or (kind == "beds" and c.get("to") is None):
        raise ValueError(f"{kind}[{index}] is missing required clip fields")
    start = float(c[start_key])
    if kind == "beds":
        length = float(c["to"]) - start
    elif c.get("length") is not None:
        length = float(c["length"])
    else:
        length = (seconds(c["name"]) - float(c.get("start") or 0)) / float(c.get("rate") or 1)
    if length < 0.4:
        raise ValueError("Loudness needs at least 0.4 seconds of audio")
    with tempfile.TemporaryDirectory(prefix="studio-loudness-") as folder:
        out = Path(folder) / "clip.wav"
        build(out, [c] if kind == "beds" else [], [c] if kind == "sfx" else [], voice=False, span=(start, start + length), master=False, float_output=True, end=start + length)
        r = subprocess.run(["ffmpeg", "-v", "info", "-i", str(out), "-af", "loudnorm=I=-14:TP=-1:LRA=11:print_format=json", "-f", "null", "-"], capture_output=True, text=True, check=True, timeout=120)
        stats, _ = json.JSONDecoder().raw_decode(r.stderr[r.stderr.rfind("{"):])
        finite = lambda key: float(stats[key]) if math.isfinite(float(stats[key])) else None
        return {"loudness": finite("input_i"), "peak": finite("input_tp")}


def studio(out):
    """The studio's mix without the sounds that have options, plus one stem per option covering just the stretch where that
    sound plays, and trials.json beside the mix saying where they are: switching an option is heard at once, with no remix."""
    groups = {}
    for kind, entries in (("bed", A["beds"]), ("sfx", A["sfx"])):
        for e in entries:
            groups.setdefault(e["name"], []).append((kind, e))
    alternatives = {name: list(dict.fromkeys(o for _, e in group for o in options(e))) for name, group in groups.items()}
    tried = lambda e: len(alternatives[e["name"]]) > 1
    scene_samples = _runtime_spatial_samples(A["beds"], A["sfx"], END, include_options=True)
    build(out, [b for b in A["beds"] if not tried(b)], [s for s in A["sfx"] if not tried(s)],
          scene_samples=scene_samples)
    vault_sources = {}
    for v in VAULTS:
        if (v / "SOURCES.json").exists():
            data = _read_json(v / "SOURCES.json", str(v / "SOURCES.json"), expect_dict=True)
            vault_sources.update(data)
    film_sources_file = _assert_in_root(SFX / "SOURCES.json", "Film SOURCES.json")
    film_sources = _read_json(film_sources_file, f"{SFX.relative_to(ROOT).as_posix()}/SOURCES.json", expect_dict=True) if film_sources_file.exists() else {}
    sources = {**vault_sources, **film_sources}
    safe_stems = _assert_in_root(STEMS, "Stems directory")
    shutil.rmtree(safe_stems, ignore_errors=True)
    trials = {}
    for name, group in groups.items():
        if len(alternatives[name]) < 2:
            continue
        spans = []
        for kind, e in group:
            if kind == "bed":
                spans.append((float(e["from"]), float(e["to"])))
            else:  # a one-shot without a length rings as long as its longest option
                spans.append((float(e["at"]), float(e["at"] + _sfx_options_length(e))))
        span = (min(a for a, _ in spans), max(b for _, b in spans))
        (safe_stems / name).mkdir(parents=True, exist_ok=True)
        opts = []
        for o in alternatives[name]:
            one = [(kind, as_option(e, o if o in options(e) else e["name"])) for kind, e in group]
            build(safe_stems / name / f"{o}.webm", [e for kind, e in one if kind == "bed"],
                  [e for kind, e in one if kind == "sfx"], voice=False, span=span, scene_samples=scene_samples)
            opts.append({"id": o, "title": sources.get(o, {}).get("title", o), "files": [f"/agent/stems/{name}/{o}.webm"], "source": sources.get(o, {}).get("url", "")})
        kinds = "/".join(dict.fromkeys(kind for kind, _ in group))
        trials[name] = {"title": f"{name.replace('_', ' ')} ({kinds})", "kind": "stem", "from": span[0], "to": span[1], "options": opts}
    out.with_name("trials.json").write_text(json.dumps(trials, ensure_ascii=False), encoding="utf8")


if _IS_MAIN and _MODE == "resolve_audio":
    names = _read_stdin_json("Audio source names").get("names")
    if not isinstance(names, list) or not all(isinstance(name, str) and SAFE_NAME.fullmatch(name) for name in names):
        raise SystemExit("audio source names must be a JSON array of valid names")
    print(json.dumps(resolve_audio_sources(names)))
    raise SystemExit(0)

if _IS_MAIN and _MODE == "raw" and _RAW_LIVE_LANES:
    A = {**(A if isinstance(A, dict) else {}), "beds": [], "sfx": []}

if not _IS_MAIN:
    prepare_timing()


if _IS_MAIN:
    if _MODE == "measure":
        try:
            prepare_timing(drop_off=False)
            print(json.dumps(measure_clip(*_MEASURE_ARGS)))
            raise SystemExit(0)
        except SystemExit:
            raise
        except Exception as e:
            print(str(e), file=sys.stderr)
            raise SystemExit(1)
    if why := unfit():
        print(why, file=sys.stderr)
        raise SystemExit(1)
    prepare_timing(apply_choices=(_MODE != "raw" or _RAW_LIVE_LANES))
    if _MODE == "raw":
        try:
            raw_out = _assert_in_root(Path(_RAW_OUT), "Raw mix output")
            if _RAW_LIVE_LANES:
                build(raw_out, [], [], master=False)
                shutil.rmtree(_assert_in_root(STEMS, "Stems directory"), ignore_errors=True)
                raw_out.with_name("trials.json").write_text("{}", encoding="utf8")
            else:
                studio(raw_out)
            raise SystemExit(0)
        except SystemExit:
            raise
        except Exception as e:
            print(str(e), file=sys.stderr)
            raise SystemExit(1)
    onto = f" onto {Path(_VIDEO_ARG).as_posix()}" if _VIDEO_ARG else ""
    context = render_context(_video_path) if _VIDEO_ARG else None
    render = context["render"] if context else None
    if context and context.get("error") and _audio_start is None:
        raise SystemExit(f"{context['error']}; pass --start explicitly to create a separate preview")
    start = _audio_start if _VIDEO_ARG and _audio_start is not None else render["start"] if render else 0
    whole = bool(render and not render["kind"] and not render["mixed"] and start == 0)
    if _VIDEO_ARG and start >= END:
        print(f"mix starts at {start:g} s, past the soundtrack ({END:g} s)", file=sys.stderr)
        raise SystemExit(2)
    if context and context["stale"]:
        print(f"STALE: {context['stale']['message']}", file=sys.stderr)
    ended = job(ROOT, "mix", f"Mixing the sound{onto}")
    try:
        if _VIDEO_ARG:
            directory = _assert_in_root(ROOT / "renders", "Mux output directory")
            directory.mkdir(exist_ok=True)
            final = bool(whole and render["final"])
            if whole:
                output = directory / ("final.mp4" if final else "draft.mp4")
            else:
                run = Path(tempfile.mkdtemp(prefix="mixed_", dir=directory))
                output = run / "preview.mp4"
            muxed = _assert_in_root(output, "Muxed mp4 output")
        if _VIDEO_ARG:
            print(f"Checking picture before replacing {output.relative_to(ROOT).as_posix()} (full decode; it may take several minutes) ...", file=sys.stderr)
            picture_input = media_identity(_video_path)
            before, picture_end = picture_properties(_video_path, decode=True)
        with tempfile.TemporaryDirectory(prefix="mix-", dir=ROOT) as tmp:
            scratch = Path(tmp)
            raw, out = scratch / "raw.wav", scratch / "mix.wav"
            outputs = []
            used = {"files": {}, "names": {}} if _VIDEO_ARG else None
            build(raw, [c for b in A["beds"] if (c := chosen(b))], [c for s in A["sfx"] if (c := chosen(s))],
                  source_bindings=used)
            from listen import fit_encoded, level, loudness_report, measured_loudness
            target_lufs = float(A["lufs"]) if A.get("lufs") is not None else -14.0
            if _VIDEO_ARG:
                staged = scratch / "mux.mp4"

                def mux(wav):
                    try:
                        subprocess.run(["ffmpeg", "-xerror", "-v", "error", "-y", "-i", str(_video_path), "-ss", f"{start:.9f}",
                                        "-i", str(wav), "-map", "0:v", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac",
                                        "-b:a", "384k" if final else "192k", "-af", f"apad,atrim=duration={picture_end:.9f}",
                                        "-movflags", "+faststart", str(staged)], check=True, timeout=300)
                    except subprocess.CalledProcessError as e:
                        raise SystemExit(f"ffmpeg mux failed (exit {e.returncode})")
                    except subprocess.TimeoutExpired:
                        raise SystemExit("ffmpeg mux timed out")
                    return staged

                held, taken, measured, peak = fit_encoded(raw, out, target_lufs, mux)
                if peak > -1.0:
                    raise ValueError(f"encoded peak is still {peak:+.1f} dBTP; previous output kept")
                after, _ = picture_properties(staged)
                if len(before) != len(after):
                    raise ValueError("mux changed the number of picture tracks; previous output kept")
                for original, copied in zip(before, after):
                    if not original.get("nb_read_packets") or original["nb_read_packets"] != copied.get("nb_read_packets"):
                        raise ValueError("mux changed a picture packet count; previous output kept")
                    if original["attached"] != copied["attached"]:
                        raise ValueError("mux changed a picture attachment; previous output kept")
                    if original["attached"]:
                        continue
                    original_times, original_end = original["presentation"]
                    copied_times, copied_end = copied["presentation"]
                    if (len(original_times) != len(copied_times) or abs(original_end - copied_end) > 0.001
                            or any(abs(a - b) > 0.001 for a, b in zip(original_times, copied_times))):
                        raise ValueError("mux changed a picture's presentation timing; previous output kept")
                if media_identity(_video_path) != picture_input:
                    raise ValueError("picture changed during mux; previous output kept")
                bindings = [{"path": path, **(stamp if stamp is not None else {"missing": True})}
                            for path, stamp in {**used["files"], **READ_DOCUMENTS}.items()]
                evidence = {**media_identity(staged), "audioInputs": bindings, "audioSources": used["names"],
                            "audioChoices": audio_choices, "pictureInput": picture_input}
                if whole:
                    cut_info = context["cuts"] or {}
                    evidence["cuts"] = cut_info.get("times")
                sidecar = scratch / "review.json"
                sidecar.write_text(json.dumps(evidence), encoding="utf8")
                outputs.extend([(staged, muxed), (sidecar, muxed.with_suffix(".mp4.review.json"))])
            else:
                held, taken = level(raw, out, target_lufs), 0.0
            if _VIDEO_ARG and not whole:
                status = f"preview audio {measured_loudness(measured, peak)}"
                report = [status]
            else:
                raw_output = _assert_in_root(ROOT / "sound/mix_raw.wav", "Mix raw output")
                mix_output = _assert_in_root(ROOT / "sound/mix.wav", "Mix output")
                raw_output.parent.mkdir(exist_ok=True)
                outputs.extend([(raw, raw_output), (out, mix_output)])
                report = loudness_report(out, target_lufs, held, float(A.get("drive") or 0), describe_upload=False)
                report[0] = report[0].replace(str(out), "sound/mix.wav", 1)
                status = report[0].split(": ", 1)[1]
            publish(outputs, scratch)
        print("\r\n".join(report))
        job_level = "ok"
        if _VIDEO_ARG:
            shown = muxed.relative_to(ROOT).as_posix()
            omitted = _streams - {"video", "audio"}
            if omitted:
                print(f"  source tracks kept only in the source file: {', '.join(sorted(omitted))}")
            if whole:
                status = f"encoded audio: {measured_loudness(measured, peak)}"
                print(f"  {status}")
                if peak == float("-inf"):
                    print("  encoded audio is silent")
                    if final:
                        job_level = "warn"
                elif measured is not None and measured < target_lufs - 1:
                    print(f"  encoded audio is {target_lufs - measured:.1f} LU below the mix target")
                if picture_end + 0.001 < END:
                    print(f"  picture ends at {picture_end:g} s; soundtrack from there to {END:g} s stays in sound/mix.wav")
            if taken:
                print(f"  the AAC encode lifted its true peak over -1 dBTP: the mix went {taken:.1f} dB lower")
            print(f"muxed {shown}" + (" (technical upload check: bun run deliver)" if final else ""))
            if not whole:
                print(f"  file second 0 uses film audio from {start:g} s; inspect this exact file with sheet or earshot")
        ended(f"Mixed the sound{onto}: {status}", level=job_level)
        if _VIDEO_ARG and not whole:
            print(f'next: bun run sheet "{shown}" overview for the picture; earshot timeline "{shown}" for encoded audio events')
        else:
            print("next: bun run listen for masking, cut levels and mono (first run renders the stems)"
                  + ("" if _VIDEO_ARG else "; bun run mix renders/draft_video.mp4 puts it on the draft"))
    except SystemExit as e:
        detail = str(e.code).strip() if isinstance(e.code, str) else "mix stopped"
        ended(f"Mix stopped: {detail}", level="fail")
        raise
    except Exception as e:
        ended(f"Mix failed: {e}", level="fail")
        raise SystemExit(f"mix failed: {e}")
