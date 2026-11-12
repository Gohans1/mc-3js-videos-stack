"""Ears for an AI that cannot hear: the film's mix measured (EBU R128 / ITU-R BS.1770 through ffmpeg's ebur128), from two
stems the film's own mix graph renders (scripts/sound/mix.py, before the master limiter): the narration alone, and every
bed and sound effect without it. Run inside the film.
  bun run listen               where the voice is buried, sounds louder than the narration, level jumps at cuts, dead
                               air, an abrupt end; each with the second (bun run at <second> names the rows to change)
  bun run listen --sheet       also renders/listen_sheet.png, about 2 minutes more (earshot sheet: spectrogram, loudness, events, cuts,
                               the draft video's frames), a picture of the soundtrack to look at
  bun run listen --at 35.2     the 2 s either side of one heard second, half a second at a time: the voice, the rest, what
                               plays, and the rest's level at the last listen, so a gain change shows what it did there
Voice over the rest, measured per spoken stretch: 15 LU or more keeps every word (AES TD1009: speech 15 dB over a steady
masker is fully intelligible), under 8 LU words get lost; narrated documentaries keep beds 24-31 LU under the voice.
A sound effect may hit close to the voice (about 10 LU under), not over it. Gains live in src/timeline/audio.json."""
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

GOOD, LOST = 15.0, 8.0  # LU of voice over the rest: every word kept / words lost
FLOOR = -120.0


def momentary(wav):
    """[(t, M)] every 0.1 s: the 400 ms momentary loudness, LUFS."""
    out = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(wav), "-af",
                          "ebur128=metadata=1,ametadata=print:key=lavfi.r128.M:file=-", "-f", "null", "-"],
                         capture_output=True, text=True, timeout=600).stdout
    # silence reads -inf or nan: the floor
    pairs = re.findall(r"pts_time:(\S+)\s+lavfi\.r128\.M=(\S+)", out)
    return [(float(t), m if (m := float(v)) == m and m > FLOOR else FLOOR) for t, v in pairs]


def power_mean(values):
    """Loudness of a stretch from its momentary readings: the mean of their power, back in LUFS."""
    return 10 * math.log10(sum(10 ** (v / 10) for v in values) / len(values)) if values else FLOOR


YOUTUBE = -14.0  # LUFS YouTube plays every video at: louder ones are turned down, quieter ones are left as they are


def loudness(media):
    """Integrated loudness (LUFS), loudness range (LU) and true peak (dBTP, 4x oversampled) of a file's sound: ffmpeg ebur128"""
    err = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(media), "-af", "ebur128=peak=true", "-f", "null", "-"],
                         capture_output=True, text=True, timeout=600).stderr
    summary = err[err.rfind("Summary:"):]
    read = lambda key: float(re.search(rf"{key}:\s+(-?[\d.]+|-inf)", summary).group(1))  # noqa: E731
    return read("I"), read("LRA"), read("Peak")


def loudness_report(wav, target):
    """The finished mix as an upload is judged (ffmpeg ebur128, true peak 4x oversampled): what bun run mix prints last."""
    i, lra, tp = loudness(wav)
    out = [f"{wav}: {i:.1f} LUFS integrated, true peak {tp:.1f} dBTP, loudness range {lra:.1f} LU"]
    if abs(i - target) > 1:
        out.append(f"  {abs(i - target):.1f} LU {'over' if i > target else 'under'} audio.json lufs ({target:g})"
                   + (": the -1 dBTP ceiling held it back (the loudness pass stays linear, it does not squash)" if i < target else ""))
    if i > YOUTUBE + 1:
        out.append(f"  YouTube turns it down {i - YOUTUBE:.1f} dB to {YOUTUBE:g} LUFS: the loudness bought with limiting is thrown away")
    elif i < YOUTUBE - 1:
        out.append(f"  YouTube never turns it up: it plays {YOUTUBE - i:.1f} dB quieter than the videos around it "
                   f"(audio.json lufs {YOUTUBE:g} is what it plays at)")
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


BURIED = 6.0  # dB a sound effect must lift the bed it lands on to be heard as a hit


def levels_around(curve, at, last=None, reach=2.0, step=0.5):
    """listen --at: the voice, the rest and the voice's margin over it, each step from at - reach to at + reach, from the
    momentary curve [(t, voice, rest)]; was: the rest's level at the same place in the last listen's curve."""
    def mean(points, k, a, b):
        return round(power_mean([p[k] for p in points if a < p[0] <= b + 1e-9]), 1) if points else None
    rows = []
    b = at - reach
    while b < at + reach - 1e-9:
        v, r = mean(curve, 1, b, b + step), mean(curve, 2, b, b + step)
        rows.append({"from": round(b, 2), "voice": v, "rest": r, "margin": round(v - r, 1), "was": mean(last, 2, b, b + step)})
        b += step
    return rows


def analyse(voice_wav, rest_wav, cuts=(), hits=()):
    """What a listener would notice, measured on the two stems; every time is a heard second. hits: (at, length, name) of the
    placed sound effects, each judged by how far it lifts the rest stem over the second before it."""
    voice, rest = momentary(voice_wav), momentary(rest_wav)
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
    # the rest over the voice's own level: a hit or a swell the viewer reaches for the volume over
    # over the voice as it speaks, or over nothing said, kept apart: the first wants the rest lowered under the words, the
    # second only lowered, never the voice raised
    over = []
    if talk:
        said = dict(voice)
        for t, r in rest:
            if r <= ref + 1:
                continue
            speaking = said.get(t, FLOOR) > -70
            if not over or t - over[-1]["to"] > 0.5 or over[-1]["speaking"] != speaking:
                over.append({"from": round(t - 0.4, 2), "to": round(t, 2), "peak": round(r - ref, 1), "speaking": speaking})
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
    abrupt = bool(tail) and power_mean(tail) > whole - 15
    buried, together = [], {}
    for at, length, name in sorted(hits):  # sounds placed on the same moment are heard, and judged, as one hit
        key = next((k for k in together if abs(k - at) < 0.05), at)
        was = together.get(key)
        together[key] = (max(was[0], length or 1.0), f"{was[1]} + {name}") if was else (length or 1.0, name)
    for at, (length, name) in together.items():
        bed = power_mean([m for t, m in rest if at - 1.0 <= t <= at - 0.1])
        # the 400 ms momentary window still holds a short hit until 0.4 s after it ends
        hit = max((m for t, m in rest if at + 0.1 <= t <= at + min(length, 1.0) + 0.4), default=FLOOR)
        if bed > -70 and hit - bed < BURIED:
            buried.append({"at": round(at, 2), "name": name, "rise": round(hit - bed, 1)})
    return {"loudness": round(whole, 1), "voice": round(ref, 1), "lines": lines, "over": over, "jumps": jumps,
            "dead": dead, "abrupt_end": abrupt, "buried": buried, "length": round(full[-1][0], 2) if full else 0,
            "curve": [(round(t, 2), round(v, 1), round(r, 1)) for (t, v), (_, r) in zip(voice, rest)]}


def stems(folder):
    """The narration alone and the rest, through the film's own graph (mix.py build), before the master limiter."""
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import mix  # reads the film in the current folder, as mix.py does
    narr = mix.A.get("narration")
    beds = [c for b in mix.A["beds"] if (c := mix.chosen(b))]
    sfx = [c for s in mix.A["sfx"] if (c := mix.chosen(s))]
    voice, rest = folder / "voice.wav", folder / "rest.wav"
    # the time-stretcher prints a line per clip at the C level: kept in a file, shown only if the build fails
    log = (folder / "build.log").open("w+")
    sys.stdout.flush(), sys.stderr.flush()
    saved = os.dup(1), os.dup(2)
    os.dup2(log.fileno(), 1), os.dup2(log.fileno(), 2)
    try:
        mix.build(voice, [], [s for s in sfx if s.get("name") == narr] if narr else [], voice=not narr, master=False, float_output=True)
        mix.build(rest, beds, [s for s in sfx if s.get("name") != narr], voice=False, master=False, float_output=True)
    except BaseException:
        sys.stdout.flush(), sys.stderr.flush()
        os.dup2(saved[0], 1), os.dup2(saved[1], 2)
        log.seek(0)
        sys.stderr.write(log.read()[-2000:])
        raise
    sys.stdout.flush(), sys.stderr.flush()
    os.dup2(saved[0], 1), os.dup2(saved[1], 2)
    hits = [(float(s["at"]), float(s["length"]) if s.get("length") else mix.seconds(s["name"]), s["name"]) for s in sfx if s.get("name") != narr]
    return voice, rest, hits


def at_rows(second):
    """What plays at that second, by file and row (scripts/at.ts)."""
    r = subprocess.run(["bun", str(Path(__file__).resolve().parents[1] / "at.ts"), f"{second:.2f}", "--json"],
                       capture_output=True, text=True, timeout=60)
    try:
        return [f"{s['list']}[{s['i']}] {s['name']}" for s in json.loads(r.stdout)["sounds"]]
    except (ValueError, KeyError):
        return []


def louder(x):
    if x["speaking"]:
        return f"LOUDER than the narration {x['from']:.2f}-{x['to']:.2f}: {x['peak']:+.1f} LU over the voice as it speaks"
    return (f"LOUD with no voice {x['from']:.2f}-{x['to']:.2f}: {x['peak']:+.1f} LU over the narration's usual level "
            f"(lower the rest here; the voice is not the problem)")


def focus(got, at, last, cuts):
    """listen --at: one heard second up close."""
    print(f"around {at:.2f} s heard, every 0.5 s: the voice, the rest (everything but the voice), the voice over the rest"
          + (", and the rest at the last listen" if last else " (no earlier listen to compare with)"))
    for r in levels_around(got["curve"], at, last):
        was = f" (was {r['was']:.1f})" if last and r["was"] is not None and abs(r["was"] - r["rest"]) >= 0.5 else ""
        voice = "silent" if r["voice"] <= -70 else f"{r['voice']:.1f}"
        print((f"  {r['from']:6.2f}-{r['from'] + 0.5:.2f}  voice {voice:>6}  rest {r['rest']:6.1f}{was:<13}"
              + (f"  {r['margin']:+.1f} LU" if r["voice"] > -70 else "")).rstrip())
    rows = at_rows(at)
    print(f"playing at {at:.2f}: {', '.join(rows) if rows else 'nothing from src/timeline/audio.json'}")
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
    print(f"next: change a row there (bun run at {at:g} names each file and row), then bun run listen --at {at:g} shows it next to this run")
    return 0


def main(args):
    if args[:1] in (["-h"], ["--help"], ["help"]):
        print(__doc__)
        return 0
    at, i = None, 0
    while i < len(args):
        a = args[i]
        if a == "--at" or a.startswith("--at="):
            value = a[5:] if a != "--at" else (args[i + 1] if i + 1 < len(args) else "")
            try:
                at = float(value)
            except ValueError:
                print(f"--at takes a heard second, like --at 35.2 (the clock bun run at reads); got {value or 'nothing'}", file=sys.stderr)
                return 2
            i += 2 if a == "--at" else 1
        elif a == "--sheet":
            i += 1
        else:
            print(f"unknown {'option' if a.startswith('-') else 'word'} {a}: bun run listen [--sheet] [--at <second>] (--help for more)", file=sys.stderr)
            return 2
    root = Path(os.environ.get("LIVE_PROJECT") or Path.cwd())
    if not (root / "src/scene.ts").exists():
        print(f"{root} has no src/scene.ts: run this inside a film (cd films/<name>)", file=sys.stderr)
        return 1
    os.chdir(root)
    if not (root / "src/timeline/audio.json").exists():
        print("no src/timeline/audio.json: the film has no sound yet (bun run find <words> picks some)", file=sys.stderr)
        return 1
    with tempfile.TemporaryDirectory(prefix="listen-") as tmp:
        try:
            sys.path.insert(0, str(Path(__file__).resolve().parent))
            import mix  # the film's heard length, so a wrong --at is refused before the stems are rendered
            if at is not None and not 0 <= at <= mix.END:
                print(f"--at {at:g} is outside the film: it is {mix.END:.2f} s long (heard)", file=sys.stderr)
                return 2
            print("rendering the narration and the rest as two stems (the film's own mix graph, about a second per film second) ...", file=sys.stderr)
            voice, rest, hits = stems(Path(tmp))
        except SystemExit as e:  # mix.py names a missing sound itself
            if e.code not in (0, None):
                print(f"{e.code}\n(bun run check lists every missing sound; bun run sfx:get fetches the film's own)", file=sys.stderr)
                return 1
            raise
        cuts_file = root / "renders/cuts.json"
        cuts = json.loads(cuts_file.read_text(encoding="utf8")) if cuts_file.exists() else []
        got = analyse(voice, rest, cuts, hits)
        sheet = None
        if "--sheet" in args:
            earshot = shutil.which("earshot")
            if not earshot:
                print("no earshot on PATH for the sheet: INSTALL.md says how to set it up; the numbers below stand on their own", file=sys.stderr)
            else:
                full = Path(tmp) / "full.wav"
                subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(voice), "-i", str(rest), "-filter_complex", "amix=inputs=2:normalize=0", str(full)], check=True, timeout=300)
                video = root / "renders/draft_video.mp4"
                sheet = root / "renders/listen_sheet.png"
                (root / "renders").mkdir(exist_ok=True)
                cmd = [earshot, "sheet", str(full), "-o", str(sheet), *(["--video", str(video)] if video.exists() else []),
                       *(["--cues", ",".join(f"{c:.2f}" for c in cuts)] if cuts else [])]
                r = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
                if r.returncode:
                    print(f"earshot sheet failed: {r.stderr.strip()[-300:]}", file=sys.stderr)
                    sheet = None
    # each run keeps its curve, so the next --at shows what a gain change did
    curve_file = root / "renders/listen_curve.json"
    last = json.loads(curve_file.read_text(encoding="utf8")) if curve_file.exists() else None
    curve_file.parent.mkdir(exist_ok=True)
    curve_file.write_text(json.dumps(got["curve"]), encoding="utf8")
    if at is not None:
        return focus(got, at, last, cuts)
    lines = got["lines"]
    print(f"mix {got['loudness']} LUFS before the master (the final mix is brought to audio.json lufs), narration {got['voice']} LUFS, {got['length']} s")
    bad = [x for x in lines if x["verdict"] != "clear"]
    if not lines:
        print("voice: no narration heard in the mix (bun run voice:cues says whether it is laid on the film)")
    else:
        print(f"voice over the rest, {len(lines)} spoken stretches: {len(lines) - len(bad)} clear (15 LU or more), "
              f"{sum(x['verdict'] == 'thin' for x in lines)} thin (8-15), {sum(x['verdict'] == 'lost' for x in lines)} lost (under 8)")
    for x in bad[:8]:
        rows = at_rows((x["from"] + x["to"]) / 2)
        print(f"  {x['verdict'].upper()} {x['from']:.2f}-{x['to']:.2f}: voice {x['margin']:+.1f} LU over the rest"
              f"{' (playing: ' + ', '.join(rows) + ')' if rows else ''}")
    if len(bad) > 8:
        print(f"  and {len(bad) - 8} more")
    for x in got["over"][:5]:
        rows = at_rows(x["to"])
        print(f"{louder(x)}{' (' + ', '.join(rows) + ')' if rows else ''}")
    for b in got["buried"][:8]:
        rows = at_rows(b["at"] + 0.05)  # inside the hit, not on its rounded edge
        print(f"BURIED {b['name']} at {b['at']:.2f}: only {b['rise']:+.1f} dB over the second before it (a hit needs about +{BURIED:g})"
              f"{' (playing: ' + ', '.join(rows) + ')' if rows else ''}")
    if len(got["buried"]) > 8:
        print(f"  and {len(got['buried']) - 8} more")
    for j in got["jumps"]:
        print(f"jump at the cut {j['at']:.2f}: {j['change']:+.1f} LU (more than 6; fine when the story calls for it)")
    if cuts == []:
        print("cuts: no renders/cuts.json, so level jumps at cuts are not checked (bun run render clip writes it)")
    for d in got["dead"]:
        print(f"near silence {d['from']:.2f}-{d['to']:.2f} (30 LU under the mix): dead air, unless meant")
    if got["abrupt_end"]:
        print("abrupt end: the sound is still loud in the last 0.3 s; fade the beds out before the end")
    if sheet:
        print(f"sheet: {sheet.relative_to(root).as_posix()} (open it to look; its LUFS and peaks are the stems before the master "
              "limiter and the loudness pass, so they run hotter than the upload: bun run mix prints the upload's)")
    print("next: a buried or loud stretch: bun run at <second> names its rows; lower a bed's or a sound's gain in "
          "src/timeline/audio.json (a buried hit: raise its gain, or duck the bed under it), then bun run listen --at <second> shows what it did there")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
