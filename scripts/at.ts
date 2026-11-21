// bun run at <second>: everything the film has at one heard second, each with the file and row that holds it. Every
// timeline is read through its own clock as the studio plays it (src/timing-state.mjs): shots in narration seconds
// (fromSource), camera and key files in scene seconds (before Speed/Freeze), sound/text/adjust through their layer clocks.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { shake } from "../packages/film-kit/src/shake";
import {
  cameraAt,
  type CameraOpticsTracks,
  type CameraRig,
  cameraTrackOptions,
  pixelOnPlane,
  rigTurnsCamera,
  screenAxes,
} from "../packages/film-stage/src/camera";
import { hasGradeEffect } from "../packages/film-stage/src/grade";
import { TRANSITIONS } from "../packages/film-stage/src/transitions";
import { noteScene, noteSecond } from "../packages/live-studio/app/notes/note-card-meta.ts";
import { cliArgs, jsonFile, needFilm, secondArg } from "../packages/live-studio/src/cli.mjs";
import { checkFiles } from "../packages/live-studio/src/contract.ts";
import { contractFiles } from "../packages/live-studio/src/film.mjs";
import { ratioOf, sizeOf } from "../packages/live-studio/src/frame.ts";
import { overlayTime } from "../packages/live-studio/src/layer-timing.mjs";
import { noteNudge } from "../packages/live-studio/src/note-cli.mjs";
import { noteState, wholeNote } from "../packages/live-studio/src/note-state.mjs";
import { deletedSaid, findNote, noteNumbers } from "../packages/live-studio/src/notes.mjs";
import { openSound, pickSoundClip, probeAudio } from "../packages/live-studio/src/sound.mjs";
import { staleVideo } from "../packages/live-studio/src/stale.mjs";
import { mapTimeline } from "../packages/live-studio/src/timing-data.mjs";
import { transitionAvailable } from "../packages/live-studio/src/timing-effects.mjs";
import {
  cameraTimesAt,
  clockForTimeline,
  layerDuration,
  setTiming,
  timingClock,
} from "../packages/live-studio/src/timing-state.mjs";
import {
  frameVisible,
  freezeRange,
  freezesOf,
  playRanges,
  segmentAt,
} from "../packages/live-studio/src/timing.mjs";
import { velocityAt } from "../packages/live-studio/src/velocity.mjs";
import { renderCuts } from "../packages/live-studio/src/video.mjs";
import { warp } from "../packages/live-studio/src/warp.mjs";
import { buildVoiceCues } from "./voice/cues.ts";

type Row = Record<string, any>;
const fmt = (x: number) => x.toFixed(2);
// as notes, the studio and a draft's strip print a heard second
const mmss = (t: number) => {
  // rounded once, to the millisecond: 59.9999 rounds up to a whole minute, never to 60 s of the one before
  const ms = Math.round(t * 1000);
  return `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${((ms % 60000) / 1000).toFixed(3).padStart(6, "0")}`;
};

// every id: "<x>" the film's own code writes (its transitions, anims, shapes), read as text: the code is not run here
const idsIn = (src: string) => {
  const out = new Set<string>();
  if (!existsSync(src)) return out;
  for (const rel of readdirSync(src, { recursive: true, encoding: "utf8" }))
    if (/\.[mc]?[jt]sx?$/.test(rel) && statSync(join(src, rel)).isFile())
      for (const m of readFileSync(join(src, rel), "utf8").matchAll(/\bid:\s*["'`]([^"'`]+)["'`]/g))
        out.add(m[1]!);
  return out;
};

/** Format a camera focus spec (number, target string, offset object, or blend) cleanly for inspection. */
const formatFocusSpec = (focus: unknown): string | null => {
  if (focus == null) return null;
  if (typeof focus === "number") return `${+focus.toFixed(2)}m`;
  if (typeof focus === "string") return focus;
  if (typeof focus === "object") {
    const f = focus as Record<string, any>;
    if (Array.isArray(f.point)) {
      const coords = f.point.map((n: number) => +Number(n).toFixed(2)).join(",");
      return typeof f.label === "string" && f.label.trim()
        ? `${f.label.trim()} (${coords})`
        : `point (${coords})`;
    }
    if (typeof f.target === "string")
      return f.offset
        ? `${f.target} (${f.offset.map((n: number) => +Number(n).toFixed(2)).join(",")})`
        : f.target;
    if ("from" in f || "to" in f) {
      const end = (value: unknown) => formatFocusSpec(value) ?? (value === null ? "Auto" : "unset");
      return `${end(f.from)} -> ${end(f.to)} (${Math.round((f.u ?? 0) * 100)}%)`;
    }
  }
  return null;
};

// The film's files and clocks, set up as the studio plays them (setTiming is the studio's own state)
const filmOf = (dir: string) => {
  const read = (f?: string, fallback: any = null) =>
    f && existsSync(join(dir, f)) ? jsonFile(join(dir, f), dir) : fallback;
  const conf = read("package.json", {})["live-studio"] ?? {};
  const edit = read("src/edit.json", {});
  const fromSource = (s: number) => warp(edit.voice?.warp ?? [], s, 0, 1);
  const camFile = read(conf.camTimeline ?? "src/timeline/cam.json", []);
  const cam: Row[] = Array.isArray(camFile) ? camFile : (camFile.keys ?? []);
  // edit.end is a narration second; a camera key's t is a scene second already
  const sourceEnd =
    typeof edit.end === "number" ? fromSource(edit.end) : Math.max(0, ...cam.map((k) => k.t));
  const timingSpec = read(conf.timingTimeline, {});
  // a film keeps its shots in shotsTimeline (narration seconds) or as the camera's cuts (scene seconds)
  const shotRows: Row[] = read(conf.shotsTimeline, null);
  type Shot = {
    index: number;
    t: number;
    name?: string;
    size?: string;
    row: number;
    cameraClock?: "scene" | "output";
    camera?: CameraRig;
    optics?: CameraOpticsTracks;
  };
  const shots: (Shot & { transition?: Row; anim?: Row; adjust?: Row; hits?: Row[] })[] = shotRows
    ? shotRows.map((s, i) => ({
        index: i,
        t: fromSource(s.t),
        name: s.name,
        size: s.size,
        row: i,
        ...(s.cameraClock && { cameraClock: s.cameraClock }),
        ...(s.camera && { camera: s.camera }),
        ...(s.optics && { optics: s.optics }),
        transition: s.transition,
        anim: s.anim,
        ...(s.adjust ? { adjust: s.adjust } : {}),
        ...(Array.isArray(s.hits)
          ? { hits: s.hits.map((h: Row) => ({ ...h, t: fromSource(h.t) })) }
          : {}),
      }))
    : cam.flatMap((k, i) =>
        i === 0 || k.cut ? [{ index: 0, t: k.t, name: k.what, size: k.size, row: i }] : [],
      );
  shots.forEach((s, i) => (s.index = i));
  setTiming(timingSpec, sourceEnd, shots);
  return { read, conf, edit, timingSpec, fromSource, cam, sourceEnd, shots };
};

// the picture's right and up in world terms; a rig that turns the camera as the shot plays has no one answer
const pictureAxes = (
  pose: { p: number[]; l: number[]; fov: number; roll: number },
  rig: CameraRig | undefined,
  frame: [number, number],
) => {
  if (rigTurnsCamera(rig)) return null;
  const { right, up } = screenAxes(pose, rig, frame);
  const round = (v: number[]) => v.map((x) => +x.toFixed(3) || 0);
  return { right: round(right), up: round(up) };
};
// +x for a direction within 25 degrees of the world's x, else the vector itself
const axisName = (v: number[]) => {
  const i = v.findIndex((x) => Math.abs(x) > 0.9);
  return i < 0 ? `[${v.join(", ")}]` : `${v[i]! > 0 ? "+" : "-"}${"xyz"[i]}`;
};

const readNotes = (dir: string): Row[] => {
  const file = join(dir, "notes/notes.jsonl");
  return existsSync(file)
    ? readFileSync(file, "utf8")
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .flatMap((l) => {
          try {
            return [JSON.parse(l)];
          } catch {
            return [];
          }
        })
        .filter(wholeNote)
    : [];
};

// A note keeps the heard second it was written at; Speed or Freeze edits since move that moment. Its scene second (stored
// by the studio since 2026-11-13) or its place in its shot finds the same picture now.
const heardNow = (n: Row, film: ReturnType<typeof filmOf>) =>
  noteSecond(
    n as { t: number },
    (s) => timingClock.outputAt(film.fromSource(s)),
    timingClock,
    film.shots,
  );

export const noteMoment = (dir: string, ref: string) => {
  const notes = readNotes(dir),
    numbers = noteNumbers(dir);
  const n = /^#\d+$/.test(ref)
    ? notes.find((x) => numbers.get(x.id)?.n === +ref.slice(1))
    : notes.find((x) => x.id === ref);
  if (!n) return null;
  const film = filmOf(dir);
  const scene = noteScene(n, film.shots);
  // a cut moved since may have put its moment in the next shot: the shot it is in now, said with the one it was written in
  const now = scene ? film.shots.filter((s) => s.t <= scene.at).length - 1 : -1;
  const moved =
    scene?.shot != null && now > scene.shot
      ? `; past its end now: shot ${now} starts at ${film.shots[now]!.t.toFixed(2)}, so the moment is in shot ${now}`
      : "";
  return {
    id: n.id,
    n: numbers.get(n.id)!.n,
    state: noteState(n) as string,
    text: String(n.text ?? ""),
    written: n.t as number,
    heard: heardNow(n, film),
    how: !scene
      ? n.srcT != null
        ? "its narration second through today's voice and Speed edits, since its shot has changed; the studio shows it there too"
        : "its heard second as written (its shot has changed since)"
      : scene.shot === null
        ? "its scene second, kept with it"
        : `${(n.context.shot.into as number).toFixed(2)} s into shot ${scene.shot}${n.shotName ? ` "${n.shotName}"` : ""}, as when it was written${moved}`,
  };
};

export const whatsAt = (dir: string, t: number) => {
  const film = filmOf(dir);
  const { read, conf, edit, cam, sourceEnd, shots } = film;
  const length = Math.max(timingClock.duration, layerDuration());
  const { world: scene, camera: cameraTime, worldAtCamera } = cameraTimesAt(t);
  // a gap in timing.json: the picture is black, so no shot, camera key or moving row is on screen
  const blank = !frameVisible(timingClock, t);
  const timing: Row = read(conf.timingTimeline, null) ?? {};
  // what blacks it out: past the picture's end, a gap row of main[], a Freeze left blank or its pads, else gaps[]
  const blackBy = !blank
    ? null
    : t >= timingClock.duration && !segmentAt(timingClock, t)
      ? "picture ended"
      : timing.main
        ? "main[] (a gap row)"
        : segmentAt(timingClock, t)?.kind === "freeze"
          ? "freezes[] (a Freeze left blank, or its padBefore/padAfter)"
          : "gaps[]";
  // the Freeze holding the picture here (from its first heard second, where the scene second has not yet stopped moving)
  const fi =
    blank || segmentAt(timingClock, t)?.kind !== "freeze"
      ? -1
      : freezesOf(timing).findIndex((_: Row, i: number) => {
          const [from, to] = freezeRange(timing, timingClock, i);
          return from <= t && t < to;
        });
  const held =
    fi < 0
      ? null
      : {
          row: timing.main
            ? `main[${timing.main.flatMap((it: Row, i: number) => (it.kind === "freeze" ? [i] : []))[fi]}]`
            : `freezes[${fi}]`,
          range: freezeRange(timing, timingClock, fi) as [number, number],
        };
  let ids: Set<string> | undefined;
  const filmIds = () => (ids ??= idsIn(join(dir, "src")));
  // the velocity effect on the picture here (velocityAt: scene seconds)
  const vi = blank
    ? -1
    : (timing.velocity ?? []).findIndex(
        (v: Row) => v.enabled !== false && v.intensity > 0 && scene >= v.from && scene < v.to,
      );
  // it hits at its beats (velocityAt: up to 0.25 s from each), so a frame inside its span may show no hit
  const velocity =
    vi < 0
      ? null
      : {
          row: vi,
          ...timing.velocity[vi],
          hit: velocityAt([timing.velocity[vi]], scene)?.beatIndex ?? null,
        };
  const si = blank ? -1 : shots.filter((s) => s.t <= scene).length - 1;
  const activeHits: { row: number; t: number; amount: number; decay: number; trauma: number }[] =
    [];
  if (si >= 0 && Array.isArray(shots[si]?.hits)) {
    const groups = new Map<
      string,
      { decay: number; opts: Record<string, unknown>; rows: { row: number; h: Row }[] }
    >();
    shots[si]!.hits!.forEach((h, row) => {
      if (typeof h.t !== "number" || scene < h.t) return;
      const decay = typeof h.decay === "number" ? h.decay : 1;
      const max =
        typeof h.max === "number" ? ([h.max, h.max, h.max] as [number, number, number]) : h.max;
      const key = JSON.stringify([decay, h.freq ?? 14, max ?? null, h.seed ?? 1]);
      let g = groups.get(key);
      if (!g) {
        g = {
          decay,
          opts: {
            decay,
            ...(h.freq !== undefined ? { freq: h.freq } : {}),
            ...(max !== undefined ? { max } : {}),
            ...(h.seed !== undefined ? { seed: h.seed } : {}),
          },
          rows: [],
        };
        groups.set(key, g);
      }
      g.rows.push({ row, h });
    });
    for (const g of groups.values()) {
      const sorted = [...g.rows].sort((a, b) => a.h.t - b.h.t);
      sorted.forEach((entry, idx) => {
        const trauma = +shake(
          sorted.slice(0, idx + 1).map((x) => ({ t: x.h.t, amount: Number(x.h.amount ?? 0) })),
          g.opts as Parameters<typeof shake>[1],
        )
          .trauma(scene)
          .toFixed(3);
        if (trauma > 1e-4)
          activeHits.push({
            row: entry.row,
            t: +entry.h.t.toFixed(3),
            amount: entry.h.amount,
            decay: g.decay,
            trauma,
          });
      });
    }
    activeHits.sort((a, b) => a.row - b.row);
  }
  const shotLook =
    si >= 0 && shots[si]?.adjust?.enabled !== false && typeof shots[si]?.adjust?.look === "string"
      ? shots[si]!.adjust!.look
      : null;
  const shot =
    si >= 0
      ? {
          ...shots[si]!,
          to: shots[si + 1]?.t ?? sourceEnd,
          ...(shotLook ? { look: shotLook } : {}),
          ...(activeHits.length ? { hits: activeHits } : { hits: undefined }),
        }
      : null;
  // the transition into shot i plays len/2 either side of its cut, clamped to its neighbours, as film-stage transitionLength
  // does; none where the render draws none (transitionAvailable: a gap, a Freeze or a cut-out at the cut)
  const blend = (i: number) => {
    const tr = shots[i]?.transition;
    if (!i || !tr || !Number.isFinite(tr.len) || tr.len <= 0) return null;
    if (!transitionAvailable(timingClock, shots[i]!.t)) return null;
    const len = Math.min(
      tr.len,
      shots[i]!.t - shots[i - 1]!.t,
      (shots[i + 1]?.t ?? sourceEnd) - shots[i]!.t,
    );
    if (len <= 0) return null;
    const from = shots[i]!.t - len / 2;
    // near: within 1 s of it; further off it says nothing about this frame
    if (scene < from - 1 || scene >= from + len + 1) return null;
    const builtIn = TRANSITIONS.some((x) => x.id === tr.fx);
    return {
      row: i,
      fx: tr.fx as string,
      builtIn,
      // a film's own fx is makeTransitions' last argument, {id, glsl}: its id written in the film's code
      own: !builtIn && filmIds().has(tr.fx),
      from,
      to: from + len,
      now: scene >= from && scene < from + len,
    };
  };
  const cuts = blank ? [] : shots.map((_, i) => blend(i)).filter((b) => b !== null);
  const activeCam = cam
    .map((key, row) => ({ key, row }))
    .filter(({ key, row }) => row === 0 || key.cut || !key.muted);
  const camIndex = activeCam.findLastIndex(({ key }) => key.t <= cameraTime);
  const previousCam = activeCam[camIndex];
  const nextCam = activeCam[camIndex + 1];
  const heldBeforeCut = !!previousCam && nextCam?.key.cut === true;
  const [fw, fh] = sizeOf(ratioOf({ "live-studio": conf }), 1920);
  const cameraPoint = (value: unknown, fallback: [number, number, number]) => {
    if (Array.isArray(value))
      return value.length === 3 && value.every(Number.isFinite)
        ? (value as [number, number, number])
        : fallback;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : fallback;
  };
  const camEval =
    !blank && cam.length
      ? cameraAt(
          cameraTime,
          cam.map((k) => ({
            ...k,
            p: cameraPoint(k.p, [0, 0, 0]),
            l: cameraPoint(k.l, [0, 0, -1]),
          })),
          {
            aspect: fw / fh,
            ...cameraTrackOptions(shot?.camera),
            optics: shot?.optics,
            pointKnown: (point) => {
              if (Array.isArray(point)) return true;
              const fallback = (point as Record<string, unknown>).fallback;
              return (
                Array.isArray(fallback) && fallback.length === 3 && fallback.every(Number.isFinite)
              );
            },
          },
        )
      : null;
  // the authored pose before handheld shake, as cam.json keys write it (roll in radians)
  const pose = camEval && {
    p: camEval.base.p.toArray().map((v: number) => +v.toFixed(4)),
    l: camEval.base.l.toArray().map((v: number) => +v.toFixed(4)),
    fov: +camEval.base.fov.toFixed(3),
    roll: +camEval.base.roll.toFixed(5),
  };

  const audio = read(conf.soundTimeline ?? "src/timeline/audio.json", null);
  const sounds: Row[] = [];
  // the voice's clip on a muted track: the mix leaves it out, so its lines are not heard (voice:cues drops them too)
  let narrationMuted: string | null = null;
  let narrationOff: string | null = null;
  // no narration clip: the voice is full_voice.wav, which "voice": false leaves out of the mix (mix.py)
  const rawVoiceOff = Boolean(audio && !audio.narration && audio.voice === false);
  let hasVoiceLines = false;
  let choicesFile: string | undefined;
  if (audio) {
    // the studio's pick (choices.json, or legacy sound_choices.json, as mix.py chosen() plays it): "off" leaves a sound out, a try[] name plays instead
    choicesFile = ["choices.json", "sound_choices.json"].find((f) => existsSync(join(dir, f)));
    const choices = (choicesFile ? read(choicesFile, {}) : {}) ?? {};
    if (audio.narration && choices[audio.narration]?.set === "off")
      narrationOff = choicesFile ?? "choices.json";
    const chosen = (row: Row) => pickSoundClip({ ...row, name: row.name }, choices[row.name]);
    const picked = (row: Row): string | null => {
      const c = chosen(row);
      return c ? (c.name !== row.name ? c.name : null) : "off";
    };
    // an sfx without "length" lasts as long as the sound file that plays (including a try[] swap), and explicit length still stops at start >= file EOF or file EOF / rate (mix.py)
    const vault = openSound(dir, { ...conf, sfx: conf.sfx ?? "sound/sfx" });
    const soundClock = clockForTimeline("sound");
    const clipClockFor = (c: Row, list: "beds" | "sfx") =>
      (
        soundClock as unknown as {
          forClip?: (row: Row, l: string, d: Row) => typeof soundClock;
        }
      ).forClip?.(c, list, audio) ?? soundClock;
    const sourceLengths = new Map<number, number>();
    const soundIn = {
      ...audio,
      sfx: (audio.sfx ?? []).map((c: Row, i: number) => {
        const effective = chosen(c) ?? c;
        // as_option (mix.py) drops start when swapping a clip to a try[] option, playing the replacement from 0
        const swapped = effective.name !== c.name;
        const file = vault?.fileOf(effective.name);
        // a header it cannot read is a length unknown, never 0 s (that hides a sound that plays)
        const seconds = file ? probeAudio(file)?.seconds : undefined;
        const effStart = effective.start ?? 0;
        const avail =
          seconds === undefined ? undefined : Math.max(0, (seconds - effStart) / (c.rate ?? 1));
        if (avail !== undefined) sourceLengths.set(i, avail);
        const length = c.length ?? avail;
        return {
          ...c,
          ...(swapped ? { start: effective.start } : {}),
          ...(length !== undefined ? { length } : {}),
        };
      }),
    };
    const heard = mapTimeline("sound", soundIn, soundClock, false, null, {});
    const audible = new Map<Row, { from: number; to: number }[]>();
    for (const [i, length] of sourceLengths) {
      const c = heard.sfx[i];
      const segments = c.__timing?.timeline as Parameters<typeof playRanges>[0]["segments"];
      if (segments?.length) {
        const ranges = playRanges({ segments }, 0, length)
          .map((r) => ({ from: r.from, to: Math.min(r.to, c.length ?? Infinity) }))
          .filter((r) => r.to > r.from);
        audible.set(c, ranges);
        c.length = Math.max(0, ...ranges.map((r) => r.to));
      } else c.length = Math.min(c.length ?? length, length);
    }
    const playingAt = (c: Row, list: "beds" | "sfx", start: number): boolean => {
      const ranges = audible.get(c);
      if (ranges) return ranges.some((r) => r.from <= t - start && t - start < r.to);
      const tl = c.__timing?.timeline as Row[] | undefined;
      if (tl?.length) {
        const rel = t - start;
        return tl.some(
          (seg) =>
            seg.kind === "play" &&
            !seg.blank &&
            seg.sourceTo > seg.sourceFrom &&
            seg.from <= rel &&
            rel < seg.to,
        );
      }
      // Missing-file sfx with empty timeline still follows the clip clock's freeze/gap silence
      const clipClock = clipClockFor(c, list);
      if (!frameVisible(clipClock, t)) return false;
      return !(clipClock as unknown as { segments: Row[] }).segments.some(
        (seg) => seg.kind === "freeze" && seg.from <= t && t < seg.to,
      );
    };
    // a muted track is left out of every mix (scripts/sound/mix.py MUTED)
    const muted = new Set((audio.tracks ?? []).flatMap((k: Row) => (k.mute ? [k.id] : [])));
    // the voice clip covering t decides whether narration is muted here (unclipped seconds leave unvoiced script lines visible)
    const voices = heard.sfx.flatMap((c: Row, i: number) =>
      audio.narration && c.name === audio.narration && picked(audio.sfx[i]) !== "off"
        ? [{ c, i, track: audio.sfx[i].track }]
        : [],
    );
    const here = voices.filter(
      ({ c }: Row) =>
        c.at <= t &&
        (c.length === undefined || (c.length > 0 && t < c.at + c.length)) &&
        playingAt(c, "sfx", c.at),
    );
    if (here.length && here.every((v: Row) => muted.has(v.track))) narrationMuted = here[0]!.track;
    heard.beds.forEach((c: Row, i: number) => {
      if (c.from <= t && t < c.to && playingAt(c, "beds", c.from))
        sounds.push({
          list: "beds",
          i,
          name: c.name,
          from: c.from,
          to: c.to,
          row: audio.beds[i],
          muted: muted.has(audio.beds[i].track),
          picked: picked(audio.beds[i]),
        });
    });
    heard.sfx.forEach((c: Row, i: number) => {
      if (c.name === audio.narration) return;
      const endAt = c.length === undefined ? c.at + 1 : c.length > 0 ? c.at + c.length : c.at;
      if (c.at <= t && t < endAt && playingAt(c, "sfx", c.at))
        sounds.push({
          list: "sfx",
          i,
          name: c.name,
          from: c.at,
          to: c.length === undefined ? null : c.at + c.length,
          row: audio.sfx[i],
          muted: muted.has(audio.sfx[i].track),
          picked: picked(audio.sfx[i]),
        });
    });
  }

  const layer = (file: string | undefined, kind: string) => {
    const doc = read(file, null);
    if (!doc) return [];
    const clock = clockForTimeline(kind);
    // a gap blanks the layers too (timedDraw's layersVisible, adjustmentsVisible)
    if (!frameVisible(clock, t)) return [];
    return (doc.items as Row[]).flatMap((it, i) => {
      const at = overlayTime(clock, t, it);
      return at >= it.from &&
        at < it.to &&
        (kind === "text" ? !it.hidden : true) &&
        !doc.tracks?.[it.track ?? 0]?.hidden
        ? [
            {
              i,
              // the grade is all an adjustment does: an inactive or zeroed one draws the picture as it is
              text: `${it.text ?? it.name ?? it.kind}${
                kind === "adjustment" && it.grade?.enabled === false
                  ? " (disabled)"
                  : kind === "adjustment" && !hasGradeEffect(it.grade)
                    ? " (its grade sets nothing)"
                    : kind === "adjustment" && typeof it.grade?.look === "string"
                      ? ` (look: ${it.grade.look})`
                      : ""
              }`,
              from: it.from,
              to: it.to,
            },
          ]
        : [];
    });
  };
  const texts = layer(conf.textTimeline, "text");
  const looks = layer(conf.adjustmentTimeline, "adjustment");

  // every list of {t} rows in a key file whose span holds the scene second: the moves under way there
  const keys: {
    file: string;
    path: string;
    before: number;
    after: number;
    t0: number;
    t1: number;
  }[] = [];
  for (const file of blank ? [] : Object.keys(conf.keyFiles ?? {})) {
    const walk = (v: unknown, path: string[]) => {
      if (Array.isArray(v)) {
        if (v.length > 1 && v.every((r) => r && typeof r === "object" && Number.isFinite(r.t))) {
          const b = v.filter((r) => r.t <= scene).length - 1;
          // two keys of one value hold it still: listed as moving they push the moving rows out of the 10 shown
          const changes = (x: Row, y: Row) =>
            [...new Set([...Object.keys(x), ...Object.keys(y)])].some(
              (k) => k !== "t" && JSON.stringify(x[k]) !== JSON.stringify(y[k]),
            );
          if (b >= 0 && b < v.length - 1 && changes(v[b], v[b + 1]))
            keys.push({
              file,
              path: path.join(".").replaceAll(".[", "["),
              before: b,
              after: b + 1,
              t0: v[b].t,
              t1: v[b + 1].t,
            });
          return;
        }
        // a list of objects holding rows (props: [{ keys: [...] }]): each is walked, named by its index
        v.forEach((x, i) => walk(x, [...path, `[${i}]`]));
        return;
      }
      if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, [...path, k]);
    };
    walk(read(file, null), []);
  }

  let narration: { line: number; text: string; word?: string; s: number; e: number } | null = null,
    nextLine: number | null = null,
    voiceFault: string | null = null,
    // takes made but not laid on the film (none laid, or newer than the voice): voice:assemble, never another voice:gen
    unlaid = false,
    unplaced: string[] = [];
  try {
    const cues = buildVoiceCues(dir);
    // a film with no voice lines is silent, not a voice turned off
    hasVoiceLines = cues.hasLines ?? cues.lines.length > 0;
    unlaid = !rawVoiceOff && !narrationOff && cues.unlaid;
    unplaced = rawVoiceOff || narrationOff ? [] : cues.unplaced;
    voiceFault = !rawVoiceOff && !narrationOff && !unlaid ? cues.audioFault : null;
    if (!rawVoiceOff && !narrationOff && !unlaid && !voiceFault) {
      const li = cues.lines.findIndex((l) => l.s <= t && t < l.e);
      if (li >= 0) {
        const l = cues.lines[li]!;
        narration = {
          line: li + 1,
          text: l.text,
          word: l.words.find((w) => w.s <= t && t < w.e)?.w,
          s: l.s,
          e: l.e,
        };
      } else nextLine = cues.lines.find((l) => l.s > t)?.s ?? null;
    }
  } catch (e) {
    // a film with no narration has no lines and no error: a throw is a fault, so the voice may be playing here unseen
    voiceFault = (e as Error).message;
  } finally {
    // buildVoiceCues mutates the shared timingClock singleton to voice sourceDur: restore the film's clock for script/notes below
    setTiming(film.timingSpec, film.sourceEnd, film.shots);
  }
  // the script not voiced yet (src/edit.json script_lines, scene seconds as the film's list reads them)
  const scriptLines: Row[] = edit.script_lines ?? [];
  const nextScript = () =>
    scriptLines
      .flatMap((l) => {
        const s0 = timingClock.outputAt(l.t, "after");
        const shown =
          l.until != null ? timingClock.outputAt(l.until, "before") > s0 : timingClock.visible(l.t);
        return shown && s0 > t && (nextLine === null || s0 < nextLine) ? [{ l, s0 }] : [];
      })
      .sort((a, b) => a.s0 - b.s0)[0]?.l ?? null;
  const script =
    narration || narrationMuted || (rawVoiceOff && hasVoiceLines) || narrationOff || blank
      ? null
      : (scriptLines.find((l) =>
          l.until != null ? l.t <= scene && scene < l.until : Math.abs(l.t - scene) < 0.001,
        ) ??
        // a later one only when no voiced line is heard before it
        nextScript());

  // the notes not done heard within 3 s of it now (a Speed or Freeze edit since moves where a note is heard): open ones
  // are the AI's to fix, check ones wait on the creator's look
  const notes = readNotes(dir).flatMap((n) => {
    const state = noteState(n) as string;
    if (state === "done") return [];
    const heard = heardNow(n, film);
    return Number.isFinite(heard) && heard >= 0 && Math.abs(heard - t) <= 3
      ? [{ id: n.id as string, state, text: String(n.text ?? ""), heard }]
      : [];
  });

  return {
    t,
    length,
    scene,
    blank,
    blackBy,
    shot,
    shotCount: shots.length,
    cuts,
    held,
    velocity,
    cam:
      camEval && pose
        ? {
            evaluation: "authored" as const,
            clock: worldAtCamera ? "output" : "scene",
            time: cameraTime,
            before: previousCam?.row ?? null,
            after: heldBeforeCut ? null : (nextCam?.row ?? null),
            t0: previousCam?.key.t ?? null,
            t1: heldBeforeCut ? undefined : nextCam?.key.t,
            ...(heldBeforeCut ? { heldBeforeCut: true } : {}),
            mm: camEval.lensKnown ? +camEval.mm.toFixed(1) : null,
            fov: camEval.lensKnown ? +camEval.fov.toFixed(1) : null,
            ...(camEval.fstop > 0 ? { fstop: +camEval.fstop.toFixed(1) } : {}),
            ...(formatFocusSpec(camEval.focus) !== null
              ? { focus: formatFocusSpec(camEval.focus) }
              : {}),
            ...(camEval.handheld ? { handheld: camEval.handheld } : {}),
            pose,
            frame: [fw, fh] as [number, number],
            screen: pictureAxes(pose, shot?.camera, [fw, fh]),
          }
        : null,
    sounds,
    texts,
    looks,
    keys,
    narration,
    narrationMuted,
    narrationOff,
    voiceOff: rawVoiceOff || Boolean(narrationOff),
    hasVoiceLines,
    unlaid,
    unplaced,
    nextLine,
    voiceFault,
    script,
    notes,
    conf,
    choicesFile,
  };
};

const HELP = `What the film has at one heard second (as notes, voice:cues and framecheck print them), each with the file
and row that holds it: the shot (its anim, look, hits), the camera keys and optics (mm, f/stop, focus, handheld), the narration word, the sounds playing, the text and looks on screen,
the key rows moving, the notes not done near it. Run inside the film.
  bun run at 35.6        or  bun run at 00:35.633  (mm:ss as notes print it)
  bun run at 35.6 --json   the same as data, every moving key row included
  bun run at '#52'       a note's moment (its #number, quoted: a bare # starts a shell comment; or its id, as mw9jknxt),
                         where it is heard now: a note keeps the second it was written at, and Speed or Freeze edits since
                         move that moment. A plain 52 is a second, not a note
  bun run at 7.2 --pixel 540,1500 --plane y=0.92
                         where that pixel of the frame (x right, y down, in the film's 1920 frame: a 1080x1920
                         reference's own pixels) meets the plane y = 0.92 (or x=, z=) through the camera then:
                         a reference's landmark or prop placed in our world
Rows are named as their files keep them (scene or narration seconds); the seconds after them are heard.`;

const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const argv = cliArgs(HELP, ["--json", "--pixel x,y", "--plane axis=value"], 1);
  const valueOf = (flag: string) => {
    const i = argv.indexOf(flag);
    return i < 0 ? undefined : argv[i + 1];
  };
  const arg = argv.find(
    (a, i) => !a.startsWith("--") && !["--pixel", "--plane"].includes(argv[i - 1]!),
  );
  const pixelArg = valueOf("--pixel"),
    planeArg = valueOf("--plane");
  if (["--pixel", "--plane"].some((flag) => argv.indexOf(flag) !== argv.lastIndexOf(flag))) {
    console.error("--pixel and --plane go once each: one pixel, one plane a run");
    process.exit(2);
  }
  const pixelAt = pixelArg?.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
  const planeAt = planeArg?.match(/^([xyz])=(-?\d+(?:\.\d+)?)$/);
  if (
    (pixelArg === undefined) !== (planeArg === undefined) ||
    (pixelArg && !pixelAt) ||
    (planeArg && !planeAt)
  ) {
    console.error(
      "--pixel x,y and --plane y=0.92 go together: bun run at 7.2 --pixel 540,1500 --plane y=0.92 (pixels of the film's frame, a plane x=, y= or z=)",
    );
    process.exit(2);
  }
  if (!arg) {
    console.error(
      "which second? bun run at 35.6 (a note's, a line's or a fault's: bun run notes, voice:cues). A note by its number: bun run at '#52', quoted, since a bare # starts a shell comment and reaches no command",
    );
    process.exit(2);
  }
  const film = needFilm(process.env.LIVE_PROJECT);
  // a throw is almost always a file the studio cannot read either (audio.json beds a string): name it, not the TypeError
  const crashed: (e: unknown) => never = (e) => {
    let faults: string[];
    try {
      faults = checkFiles(contractFiles(film)).map((f) => f.split("\n")[0]!);
    } catch (x) {
      // contractFiles parses package.json and only reads the rest: its own throw is package.json's
      faults = [`package.json (${(x as Error).message})`];
    }
    if (!faults.length) {
      console.error((e as Error).message);
      process.exit(1);
    }
    console.error(
      `${faults.join(", ")} ${faults.length > 1 ? "do" : "does"} not fit what the studio reads: bun run check names the fault and its fix, then run at again`,
    );
    process.exit(2);
  };
  let t: number;
  let note: ReturnType<typeof noteMoment> = null;
  // the note as bun run notes shows it: its state and what it asks, so its moment needs no second command
  const noteSays = () =>
    note
      ? `note #${note.n} (${note.id}, ${note.state}) "${note.text.length > 80 ? `${note.text.slice(0, 79)}…` : note.text}"`
      : "";
  if (/^-\.?\d/.test(arg)) {
    console.error(`${arg}: the film starts at 0; give a second from 0 on (bun run at 35.6)`);
    process.exit(2);
  } else if (/^\d+,\d+$/.test(arg)) {
    console.error(`${arg}: seconds take a dot; did you mean bun run at ${arg.replace(",", ".")}?`);
    process.exit(2);
  } else if (/^[\d.:]+s?$/.test(arg)) t = secondArg("bun run at", arg);
  else {
    // a note: #N or its id
    let n: ReturnType<typeof noteMoment> = null;
    try {
      n = noteMoment(film, arg);
    } catch (e) {
      crashed(e);
    }
    const gone = n ? null : findNote(film, arg);
    if (gone?.gone) {
      console.error(deletedSaid(gone));
      process.exit(2);
    }
    if (!n) {
      console.error(
        `no note ${arg} in notes/notes.jsonl: bun run notes lists them (#N or the id), or give a second (bun run at 35.6)`,
      );
      process.exit(2);
    }
    if (!Number.isFinite(n.heard) || n.heard < 0) {
      console.error(
        `note #${n.n} (${n.id}) has no second: its "t" in notes/notes.jsonl is ${JSON.stringify(n.written ?? null)}, not the heard second >= 0 the studio writes; bun run notes ${n.id} says what it asks`,
      );
      process.exit(2);
    }
    // to the microsecond: rounded to the millisecond, a note just before a cut lands on it, in the next shot
    t = +n.heard.toFixed(6);
    note = n;
  }
  const tellPath = fileURLToPath(new URL("../packages/live-studio/src/tell.mjs", import.meta.url));
  if (existsSync(tellPath)) {
    const mod = (await import(pathToFileURL(tellPath).href)) as {
      tell?: (film: string, event: { say: string; at?: number; notes?: string[] }) => Promise<void>;
    };
    await mod.tell?.(film, {
      say: `Looking at ${mmss(t)}${note ? ` (note #${note.n})` : ""}`,
      at: t,
      ...(note ? { notes: [note.id] } : {}),
    });
  }
  let got: ReturnType<typeof whatsAt>;
  try {
    got = whatsAt(film, t);
  } catch (e) {
    crashed(e);
  }
  const hasWritten = (n: NonNullable<typeof note>) =>
    typeof n.written === "number" && Number.isFinite(n.written) && n.written >= 0;
  if (t >= got.length) {
    if (note && process.argv.includes("--json")) {
      console.log(JSON.stringify({ note, pastEnd: true, length: got.length }, null, 2));
      process.exit(0);
    }
    if (note) {
      console.log(
        `${noteSays()} ${hasWritten(note) ? `was written at ${mmss(note.written)} heard` : `had no "t"`}; its moment (${mmss(note.heard)}, ${note.how}) is past the film's end now (${got.length.toFixed(3)} s): what it was on has been cut or shortened since.\nnext: the note in full: bun run notes ${note.id}; if its subject is gone, ask the creator: bun run note ask ${note.id} "<your question>"`,
      );
      process.exit(0);
    }
    console.error(
      got.length > 0
        ? `the film is ${got.length.toFixed(3)} s long: give a second before that`
        : `no headless timeline duration: set src/edit.json end or run AT=${t} LIST=1 bun run render stills for the live scene`,
    );
    process.exit(2);
  }
  const { conf: c, choicesFile, ...all } = got;
  // the cut a draft's sheet numbers (renders/cuts.json, heard seconds, the last bun run render clip's), when this second
  // sits on one; a src file changed since may have moved it
  const cutsFile = join(film, "renders/cuts.json");
  const draft = join(film, "renders/draft_video.mp4");
  const hasDraft = existsSync(draft);
  const cutInfo = !got.blank && hasDraft ? renderCuts(film, draft) : null;
  let legacyCuts: unknown = [];
  try {
    if (!got.blank && !hasDraft && existsSync(cutsFile)) legacyCuts = jsonFile(cutsFile, film);
  } catch {}
  const times =
    cutInfo && "times" in cutInfo
      ? [...new Set(cutInfo.times)].toSorted((a, b) => a - b)
      : Array.isArray(legacyCuts)
        ? legacyCuts.filter((s) => Number.isFinite(s) && s >= 0)
        : [];
  // the nearest within 0.3 s: two cuts close together are told apart
  const near = times.reduce(
    (best: number, s, i) =>
      Math.abs(s - t) <= 0.3 && (best < 0 || Math.abs(s - t) < Math.abs(times[best]! - t))
        ? i
        : best,
    -1,
  );
  const cut =
    near < 0
      ? null
      : {
          index: near,
          at: times[near]!,
          stale: staleVideo(film, hasDraft ? draft : cutsFile)?.file ?? null,
        };
  // a render's cuts are its shots' starts and the camera keys with cut: true: the shot a cut opens is the one after it, when
  // that differs from the one before
  const opened = cut ? whatsAt(film, cut.at + 0.004).shot : null;
  const opensShot =
    opened && opened.index !== whatsAt(film, Math.max(0, cut!.at - 0.004)).shot?.index
      ? opened.index
      : null;
  if (pixelAt && !got.cam) {
    console.error(
      `no camera at ${t}: the picture is black or the film has no camera keys, so no pixel reaches the world`,
    );
    process.exit(1);
  }
  let pixel = null;
  if (pixelAt && planeAt && got.cam) {
    const at: [number, number] = [+pixelAt[1]!, +pixelAt[2]!];
    try {
      const point = pixelOnPlane(got.cam.pose, got.shot?.camera, at, got.cam.frame, {
        axis: planeAt[1] as "x" | "y" | "z",
        at: +planeAt[2]!,
      });
      pixel = {
        at,
        plane: `${planeAt[1]}=${+planeAt[2]!}`,
        point: point?.map((v) => +v.toFixed(4)) ?? null,
        ...(got.shot?.anim ? { anim: got.shot.anim } : {}),
      };
    } catch (e) {
      console.error(
        `--pixel at ${t}: ${(e as Error).message}; place it by eye with CHECK=probe instead`,
      );
      process.exit(1);
    }
  }
  // asked by a note, that note is the moment itself, not one near it
  const data = {
    ...all,
    cut: cut && { ...cut, opensShot },
    ...(pixel && { pixel }),
    notes: all.notes.filter((n) => n.id !== note?.id),
  };
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(note ? { note, ...data } : data, null, 2));
    process.exit(0);
  }
  const out: string[] = [];
  if (note)
    out.push(
      !hasWritten(note)
        ? `${noteSays()} had no "t"; its moment is heard at ${mmss(note.heard)} now (${note.how})`
        : Math.abs(note.heard - note.written) < 0.005
          ? `${noteSays()} was written at ${mmss(note.written)} heard, still the same moment (${note.how})`
          : `${noteSays()} was written at ${mmss(note.written)} heard; that moment is heard at ${mmss(note.heard)} now (${note.how})`,
    );
  out.push(
    got.blank
      ? `${mmss(t)} heard (${+t.toFixed(3)} s); black here, ${
          got.blackBy === "gaps[]"
            ? `a gap in ${c.timingTimeline ?? "timing.json"} gaps[]`
            : got.blackBy === "picture ended"
              ? "the picture has ended (another layer plays past it)"
              : `${c.timingTimeline ?? "timing.json"} ${got.blackBy}`
        }: no picture, so no shot or camera`
      : `${mmss(t)} heard (${+t.toFixed(3)} s); the picture shows scene second ${fmt(got.scene)}${
          got.held
            ? ` (a Freeze holds it, heard ${fmt(got.held.range[0])}-${fmt(got.held.range[1])}: ${c.timingTimeline ?? "timing.json"} ${got.held.row})`
            : Math.abs(got.scene - t) > 0.005
              ? ` (Speed/Freeze in ${c.timingTimeline ?? "timing.json"})`
              : ""
        }`,
  );
  if (got.shot)
    out.push(
      `shot ${got.shot.index} (shots 0-${got.shotCount - 1}): "${got.shot.name ?? ""}"${got.shot.size ? ` ${got.shot.size}` : ""}, ` +
        `${c.shotsTimeline ? `${c.shotsTimeline} [${got.shot.row}]` : `${c.camTimeline ?? "src/timeline/cam.json"} [${got.shot.row}] (a cut key)`}`,
    );
  const shotsFile = c.shotsTimeline ?? "the shots timeline";
  for (const b of got.cuts)
    out.push(
      `  ${b.now ? "in" : "near"} the ${b.fx} transition into shot ${b.row}, scene ${fmt(b.from)}-${fmt(b.to)}: ${shotsFile} [${b.row}].transition${
        b.builtIn || b.own
          ? ""
          : ` (${b.fx} is no built-in: it plays only if src/scene.ts gives makeTransitions a transition of that id, else the cut is hard)`
      }`,
    );
  const anim = got.shot?.anim as Record<string, { fx: string; len?: number }> | undefined;
  if (anim && Object.keys(anim).length)
    out.push(
      `  shot anim: ${Object.entries(anim)
        .map(([k, a]) => `${k} ${a.fx}${a.len ? ` ${a.len} s` : ""}`)
        .join(
          ", ",
        )} (${shotsFile} [${got.shot!.row}].anim: In plays its len from the cut, Out its len up to the next cut, Combo the whole shot)`,
    );
  if (got.shot?.look)
    out.push(`  shot look: ${got.shot.look} (${shotsFile} [${got.shot.row}].adjust.look)`);
  else if (got.shot?.adjust && got.shot.adjust.enabled !== false && hasGradeEffect(got.shot.adjust))
    out.push(`  shot adjust: custom grade (${shotsFile} [${got.shot.row}].adjust)`);
  if (got.shot?.hits?.length)
    out.push(
      `  shot hits: ${got.shot.hits
        .map((h: Row) => `[${h.row}] t=${fmt(h.t)} amount=${h.amount} trauma=${fmt(h.trauma)}`)
        .join(", ")} (${shotsFile} [${got.shot.row}].hits)`,
    );
  if (got.cam) {
    out.push(
      `camera: ${c.camTimeline ?? "src/timeline/cam.json"} ${
        got.cam.before === null
          ? `holds [0] t=${fmt(got.cam.t1)} (before the first key)`
          : `[${got.cam.before}] t=${fmt(got.cam.t0)}${
              got.cam.after === null
                ? got.cam.heldBeforeCut
                  ? " (held before a cut)"
                  : " (the last key)"
                : ` -> [${got.cam.after}] t=${fmt(got.cam.t1)}`
            }`
      }`,
    );
    if (got.cam.clock === "output")
      out.push(`  camera time: ${mmss(got.cam.time)} on the output clock`);
    const optics = [
      got.cam.fov === null
        ? "lens requires live anchor positions"
        : `${got.cam.mm}mm (${got.cam.fov}°)`,
      ...(got.cam.fstop ? [`f/${got.cam.fstop}`] : []),
      ...(got.cam.focus ? [`focus ${got.cam.focus}`] : []),
      ...(got.cam.handheld ? [`handheld ${got.cam.handheld}`] : []),
    ];
    out.push(`  camera optics: ${optics.join(" · ")}`);
    if (got.cam.screen)
      out.push(
        `  picture right is world ${axisName(got.cam.screen.right)}, up is world ${axisName(got.cam.screen.up)}`,
      );
    out.push("  optics estimate uses saved camera data");
  }
  if (got.velocity)
    out.push(
      `velocity: ${got.velocity.effect}, intensity ${got.velocity.intensity}, scene ${fmt(got.velocity.from)}-${fmt(got.velocity.to)} (${
        got.velocity.hit === null
          ? "no hit on this frame: it hits at its beats"
          : "a hit on its beat plays now"
      }): ${c.timingTimeline ?? "timing.json"} velocity[${got.velocity.row}]`,
    );
  out.push(
    got.voiceOff && got.hasVoiceLines && !got.narrationOff
      ? `narration: off, ${c.soundTimeline} "voice": false and no "narration" clip: the mix leaves the voice out`
      : got.narrationOff
        ? `narration: off (${got.narrationOff} turns the narration clip off): the mix leaves the voice out`
        : got.narrationMuted
          ? `narration: muted, its clip sits on track ${got.narrationMuted}, muted in ${c.soundTimeline} tracks[]: the mix leaves the voice out`
          : got.voiceFault
            ? `narration: unknown here, the voice's seconds could not be read (${got.voiceFault}): bun run voice:cues says more`
            : got.narration
              ? `narration: ${got.narration.word ? `"${got.narration.word}" in ` : "between words of "}line ${got.narration.line} (${fmt(got.narration.s)}-${fmt(got.narration.e)}): ${got.narration.text}`
              : `narration: silent here${got.nextLine === null ? "" : `, the next line at ${fmt(got.nextLine)}`} (every line: bun run voice:cues)${
                  got.unlaid
                    ? "; voice/takes has audio not on the film yet: bun run voice:assemble lays it (no new voice:gen)"
                    : ""
                }`,
  );
  if (got.unplaced.length)
    out.push(
      `  take${got.unplaced.length > 1 ? "s" : ""} ${got.unplaced.join(", ")} newer than the film's voice: its words sit at the old take's place until bun run voice:assemble`,
    );
  if (got.script) {
    const atHere =
      got.script.until != null
        ? got.script.t <= got.scene && got.scene < got.script.until
        : Math.abs(got.script.t - got.scene) < 0.001;
    out.push(
      `  script not voiced yet (src/edit.json script_lines, scene ${fmt(got.script.t)}-${fmt(got.script.until ?? got.script.t)}${
        atHere ? "" : ", the next one"
      }): ${String(got.script.text).slice(0, 90)}${String(got.script.text).length > 90 ? "..." : ""}`,
    );
  }
  const file = c.soundTimeline;
  out.push(
    !file
      ? `sound: package.json "live-studio" names no soundTimeline, so no sound is read (the template film's: src/timeline/audio.json)`
      : got.sounds.length
        ? `sound (${file}):`
        : `sound: none playing (${file}; to add one: bun run find <words>)`,
  );
  for (const s of got.sounds)
    out.push(
      `  ${s.list}[${s.i}] ${s.name} gain ${s.row.gain ?? 0}${s.row.track ? ` track ${s.row.track}${s.muted ? " (muted: not in the mix)" : ""}` : ""}${
        s.picked === "off"
          ? `, off (${choicesFile ?? "choices.json"}): not in the mix`
          : s.picked
            ? `, plays ${s.picked} in its place (${choicesFile ?? "choices.json"})`
            : ""
      }, heard ${fmt(s.from)}-${s.to === null ? "? (its file is not on this machine)" : fmt(s.to)}`,
    );
  if (c.textTimeline)
    out.push(
      got.texts.length
        ? `text (${c.textTimeline}): ${got.texts.map((x) => `items[${x.i}] "${String(x.text).split("\n")[0]}"`).join(", ")}`
        : `text: none on screen (${c.textTimeline})`,
    );
  if (c.adjustmentTimeline && got.looks.length)
    out.push(
      `looks (${c.adjustmentTimeline}): ${got.looks.map((x) => `items[${x.i}] ${x.text}`).join(", ")}`,
    );
  if (!c.keyFiles)
    out.push(
      `moving: package.json "live-studio" names no keyFiles, so no key rows are read (keyFiles: {"<file>": "<what it moves>"} lists the files of {t} rows)`,
    );
  if (got.keys.length) {
    out.push("moving (key rows, scene seconds):");
    const shown = got.keys.slice(0, 10);
    for (const k of shown)
      out.push(`  ${k.file} ${k.path} [${k.before}] t=${fmt(k.t0)} -> [${k.after}] t=${fmt(k.t1)}`);
    if (got.keys.length > shown.length)
      out.push(
        `  and ${got.keys.length - shown.length} more rows (bun run at ${t} --json for all)`,
      );
  }
  if (data.notes.length)
    out.push(
      `notes heard within 3 s: ${data.notes.map((n) => `${n.id} (${n.state}) at ${fmt(n.heard)} "${n.text.slice(0, 40)}"`).join("; ")} (bun run notes <id>; check = fixed, the creator looks)`,
    );
  if (cut)
    out.push(
      `cut ${cut.index} at ${fmt(cut.at)} heard${opensShot !== null ? `, into shot ${opensShot}` : ""}${
        cut.stale
          ? ` (${hasDraft ? "the draft picture" : "renders/cuts.json"} is older than ${cut.stale}: numbered as the last render cut it; bun run render clip writes it again)`
          : ""
      }${!cut.stale ? `: bun run sheet renders/draft_video.mp4 cut ${cut.index} shows it frame by frame` : ""}`,
    );
  if (pixel)
    out.push(
      pixel.point
        ? `pixel ${pixel.at.join(",")} of the ${got.cam!.frame.join("x")} frame meets ${pixel.plane} at [${pixel.point.join(", ")}] (the authored camera, before handheld shake${pixel.anim ? ` and the shot's anim ${JSON.stringify(pixel.anim)}, which moves it on top` : ""})`
        : `pixel ${pixel.at.join(",")} never meets ${pixel.plane}: its ray runs parallel to it or away from it`,
    );
  out.push(
    `next: look at it with the film's own list over it (AT=${t} LIST=1 bun run render stills), change the rows named, then bun run check`,
  );
  const notesWaiting = noteNudge(film);
  if (notesWaiting) out.push(notesWaiting);
  console.log(out.join("\n"));
}
