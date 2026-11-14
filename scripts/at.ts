// bun run at <second>: everything the film has at one heard second, each with the file and row that holds it. Every
// timeline is read through its own clock as the studio plays it (src/timing-state.mjs): shots in narration seconds
// (fromSource), camera and key files in scene seconds (before Speed/Freeze), sound/text/adjust through their layer clocks.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { TRANSITIONS } from "../packages/film-stage/src/transitions";
import { noteScene, noteSecond } from "../packages/live-studio/app/notes/note-card-meta.ts";
import { cliArgs, jsonFile, needFilm, secondArg } from "../packages/live-studio/src/cli.mjs";
import { checkFiles } from "../packages/live-studio/src/contract.ts";
import { contractFiles } from "../packages/live-studio/src/film.mjs";
import { overlayTime } from "../packages/live-studio/src/layer-timing.mjs";
import { noteState, wholeNote } from "../packages/live-studio/src/note-state.mjs";
import { audioInfo, openSound } from "../packages/live-studio/src/sound.mjs";
import { staleVideo } from "../packages/live-studio/src/stale.mjs";
import { tell } from "../packages/live-studio/src/tell.mjs";
import { mapTimeline } from "../packages/live-studio/src/timing-data.mjs";
import { transitionAvailable } from "../packages/live-studio/src/timing-effects.mjs";
import {
  clockForTimeline,
  layerDuration,
  setTiming,
  timingClock,
} from "../packages/live-studio/src/timing-state.mjs";
import {
  frameAt,
  frameVisible,
  freezeRange,
  freezesOf,
  segmentAt,
} from "../packages/live-studio/src/timing.mjs";
import { velocityAt } from "../packages/live-studio/src/velocity.mjs";
import { warp } from "../packages/live-studio/src/warp.mjs";
import { buildVoiceCues } from "./voice/cues.ts";

type Row = Record<string, any>;
const fmt = (x: number) => x.toFixed(2);
// as notes, the studio and a draft's strip print a heard second
const mmss = (t: number) =>
  `${String(Math.floor(t / 60)).padStart(2, "0")}:${(t % 60).toFixed(3).padStart(6, "0")}`;

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
  setTiming(read(conf.timingTimeline, {}), sourceEnd);
  // a film keeps its shots in shotsTimeline (narration seconds) or as the camera's cuts (scene seconds)
  const shotRows: Row[] = read(conf.shotsTimeline, null);
  type Shot = { index: number; t: number; name?: string; size?: string; row: number };
  const shots: (Shot & { transition?: Row; anim?: Row })[] = shotRows
    ? shotRows.map((s, i) => ({
        index: i,
        t: fromSource(s.t),
        name: s.name,
        size: s.size,
        row: i,
        transition: s.transition,
        anim: s.anim,
      }))
    : cam.flatMap((k, i) =>
        i === 0 || k.cut ? [{ index: 0, t: k.t, name: k.what, size: k.size, row: i }] : [],
      );
  shots.forEach((s, i) => (s.index = i));
  return { read, conf, edit, fromSource, cam, sourceEnd, shots };
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
  const notes = readNotes(dir);
  // #N counts every note in the order written, as bun run notes numbers them
  const byAge = notes.toSorted((a, b) =>
    (a.at ?? "") < (b.at ?? "") ? -1 : (a.at ?? "") > (b.at ?? "") ? 1 : 0,
  );
  const n = /^#\d+$/.test(ref) ? byAge[+ref.slice(1) - 1] : notes.find((x) => x.id === ref);
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
    n: byAge.indexOf(n) + 1,
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
  const scene = frameAt(timingClock, t);
  // a gap in timing.json: the picture is black, so no shot, camera key or moving row is on screen
  const blank = !frameVisible(timingClock, t);
  const timing: Row = read(conf.timingTimeline, null) ?? {};
  // what blacks it out: a gap row of main[], a Freeze left blank or its pads, else gaps[]
  const blackBy = !blank
    ? null
    : timing.main
      ? "main[] (a gap row)"
      : segmentAt(timingClock, t)?.kind === "freeze"
        ? "freezes[] (a Freeze left blank, or its padBefore/padAfter)"
        : "gaps[]";
  // the Freeze holding the picture here (from its first heard second, where the scene second has not yet stopped moving)
  const fi = blank
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
  const shot = si >= 0 ? { ...shots[si]!, to: shots[si + 1]?.t ?? sourceEnd } : null;
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
  const cuts = blank ? [] : [blend(si), blend(si + 1)].filter((b) => b !== null);
  const ci = blank ? -1 : cam.filter((k) => k.t <= scene).length - 1;

  const audio = read(conf.soundTimeline, null);
  const sounds: Row[] = [];
  // the voice's clip on a muted track: the mix leaves it out, so its lines are not heard (voice:cues drops them too)
  let narrationMuted: string | null = null;
  // no narration clip: the voice is full_voice.wav, which "voice": false leaves out of the mix (mix.py)
  let voiceOff = Boolean(audio && !audio.narration && audio.voice === false);
  if (audio) {
    // an sfx without "length" lasts as long as its sound file, when the file is on this machine
    const vault = openSound(dir, conf);
    const durations: Record<string, number> = {};
    for (const c of audio.sfx ?? []) {
      const file = c.length === undefined && vault?.fileOf(c.name);
      // a header it cannot read is a length unknown, never 0 s (that hides a sound that plays)
      const seconds = file ? audioInfo(file)?.seconds : undefined;
      if (seconds) durations[c.name] = seconds;
    }
    const heard = mapTimeline("sound", audio, clockForTimeline("sound"), false, null, durations);
    // a muted track is left out of every mix (scripts/sound/mix.py MUTED)
    const muted = new Set((audio.tracks ?? []).flatMap((k: Row) => (k.mute ? [k.id] : [])));
    // the studio's pick (choices.json, as mix.py chosen() plays it): "off" leaves a sound out, a try[] name plays instead
    const choices = read("choices.json", {}) ?? {};
    const picked = (row: Row): string | null => {
      const c = choices[row.name];
      if (c?.set === "off") return "off";
      return c?.set && c.set !== row.name && (row.try ?? []).includes(c.set) ? c.set : null;
    };
    const lenOf = (c: Row): number | undefined =>
      c.length ??
      (c.name in durations ? (durations[c.name]! - (c.start ?? 0)) / (c.rate ?? 1) : undefined);
    // the voice split in clips: the one playing here decides; between clips, muted only when every clip is
    const voices = heard.sfx.flatMap((c: Row, i: number) =>
      audio.narration && c.name === audio.narration ? [{ c, track: audio.sfx[i].track }] : [],
    );
    const here = voices.filter(({ c }: Row) => {
      const len = lenOf(c);
      return c.at <= t && (len === undefined || t < c.at + len);
    });
    const judged = here.length ? here : voices;
    if (judged.length && judged.every((v: Row) => muted.has(v.track)))
      narrationMuted = judged[0]!.track;
    heard.beds.forEach((c: Row, i: number) => {
      if (c.from <= t && t < c.to)
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
      const len = lenOf(c);
      if (c.at <= t && t < c.at + (len ?? 1))
        sounds.push({
          list: "sfx",
          i,
          name: c.name,
          from: c.at,
          to: len === undefined ? null : c.at + len,
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
      return at >= it.from && at < it.to && !it.hidden && !doc.tracks?.[it.track ?? 0]?.hidden
        ? [{ i, text: it.text ?? it.name ?? it.kind, from: it.from, to: it.to }]
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
        if (v.length > 1 && v.every((r) => r && typeof r === "object" && typeof r.t === "number")) {
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
    voiceOff &&= cues.lines.length > 0;
    const takes = join(dir, "voice/takes");
    unlaid =
      !cues.lines.length &&
      existsSync(takes) &&
      readdirSync(takes).some((f) => /\.(mp3|wav)$/.test(f));
    unplaced = cues.lines.length ? cues.unplaced : [];
    const li = cues.lines.findIndex((l) => l.s <= t && t <= l.e);
    if (li >= 0) {
      const l = cues.lines[li]!;
      narration = {
        line: li + 1,
        text: l.text,
        word: l.words.find((w) => w.s <= t && t <= w.e)?.w,
        s: l.s,
        e: l.e,
      };
    } else nextLine = cues.lines.find((l) => l.s > t)?.s ?? null;
  } catch (e) {
    // a film with no narration has no lines and no error: a throw is a fault, so the voice may be playing here unseen
    voiceFault = (e as Error).message;
  }
  // the script not voiced yet (src/edit.json script_lines, scene seconds as the film's list reads them)
  const scriptLines: Row[] = edit.script_lines ?? [];
  const script =
    narration || narrationMuted || voiceOff || blank
      ? null
      : (scriptLines.find((l) => l.t <= scene && scene < (l.until ?? l.t)) ??
        // a later one only when no voiced line is heard before it
        scriptLines.find(
          (l) =>
            l.t > scene && (nextLine === null || timingClock.outputAt(l.t, "before") < nextLine),
        ) ??
        null);

  // the notes not done heard within 3 s of it now (a Speed or Freeze edit since moves where a note is heard): open ones
  // are the AI's to fix, check ones wait on the creator's look
  const notes = readNotes(dir).flatMap((n) => {
    const state = noteState(n) as string;
    if (state === "done" || typeof n.t !== "number") return [];
    const heard = heardNow(n, film);
    return Math.abs(heard - t) <= 3
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
      ci >= 0
        ? {
            before: ci,
            after: ci + 1 < cam.length ? ci + 1 : null,
            t0: cam[ci]!.t,
            t1: cam[ci + 1]?.t,
          }
        : null,
    sounds,
    texts,
    looks,
    keys,
    narration,
    narrationMuted,
    voiceOff,
    unlaid,
    unplaced,
    nextLine,
    voiceFault,
    script,
    notes,
    conf,
  };
};

const HELP = `What the film has at one heard second (as notes, voice:cues and framecheck print them), each with the file
and row that holds it: the shot, the camera keys, the narration word, the sounds playing, the text and looks on screen,
the key rows moving, the notes not done near it. Run inside the film.
  bun run at 35.6        or  bun run at 00:35.633  (mm:ss as notes print it)
  bun run at 35.6 --json   the same as data, every moving key row included
  bun run at '#52'       a note's moment (its #number, quoted: a bare # starts a shell comment; or its id, as mw9jknxt),
                         where it is heard now: a note keeps the second it was written at, and Speed or Freeze edits since
                         move that moment. A plain 52 is a second, not a note
Rows are named as their files keep them (scene or narration seconds); the seconds after them are heard.`;

const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const arg = cliArgs(HELP, ["--json"], 1).find((a) => a !== "--json");
  if (!arg) {
    console.error(
      "which second? bun run at 35.6 (a note's, a line's or a fault's: bun run notes, voice:cues). A note by its number: bun run at '#52', quoted, since a bare # starts a shell comment and reaches no command",
    );
    process.exit(2);
  }
  const film = needFilm(process.env.LIVE_PROJECT);
  // a throw is almost always a file the studio cannot read either (audio.json beds a string): name it, not the TypeError
  const crashed: (e: unknown) => never = (e) => {
    const faults = checkFiles(contractFiles(film)).map((f) => f.split("\n")[0]);
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
    if (!n) {
      console.error(
        `no note ${arg} in notes/notes.jsonl: bun run notes lists them (#N or the id), or give a second (bun run at 35.6)`,
      );
      process.exit(2);
    }
    // to the microsecond: rounded to the millisecond, a note just before a cut lands on it, in the next shot
    t = +n.heard.toFixed(6);
    note = n;
  }
  await tell(film, {
    say: `Looking at ${mmss(t)}${note ? ` (note #${note.n})` : ""}`,
    at: t,
    ...(note ? { notes: [note.id] } : {}),
  });
  let got: ReturnType<typeof whatsAt>;
  try {
    got = whatsAt(film, t);
  } catch (e) {
    crashed(e);
  }
  if (t >= got.length) {
    if (note && process.argv.includes("--json")) {
      console.log(JSON.stringify({ note, pastEnd: true, length: got.length }, null, 2));
      process.exit(0);
    }
    if (note) {
      console.log(
        `${noteSays()} was written at ${mmss(note.written)} heard; its moment (${mmss(note.heard)}, ${note.how}) is past the film's end now (${got.length.toFixed(3)} s): what it was on has been cut or shortened since.\nnext: the note in full: bun run notes ${note.id}; if its subject is gone, ask the creator: bun run note ask ${note.id} "<your question>"`,
      );
      process.exit(0);
    }
    console.error(`the film is ${got.length.toFixed(3)} s long: give a second before that`);
    process.exit(2);
  }
  const { conf: c, ...all } = got;
  // the cut a draft's sheet numbers (renders/cuts.json, heard seconds, the last bun run render clip's), when this second
  // sits on one; a src file changed since may have moved it
  const cutsFile = join(film, "renders/cuts.json");
  // not a list of seconds (a broken or hand-made file): no cut is named; bun run render clip writes it again
  let cutTimes: unknown = [];
  try {
    cutTimes = !got.blank && existsSync(cutsFile) ? jsonFile(cutsFile, film) : [];
  } catch {}
  const times = Array.isArray(cutTimes) ? cutTimes.filter((s) => typeof s === "number") : [];
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
      : { index: near, at: times[near]!, stale: staleVideo(film, cutsFile)?.file ?? null };
  // asked by a note, that note is the moment itself, not one near it
  const data = { ...all, cut, notes: all.notes.filter((n) => n.id !== note?.id) };
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(note ? { note, ...data } : data, null, 2));
    process.exit(0);
  }
  const out: string[] = [];
  if (note)
    out.push(
      Math.abs(note.heard - note.written) < 0.005
        ? `${noteSays()} was written at ${mmss(note.written)} heard, still the same moment (${note.how})`
        : `${noteSays()} was written at ${mmss(note.written)} heard; that moment is heard at ${mmss(note.heard)} now (${note.how})`,
    );
  out.push(
    got.blank
      ? `${mmss(t)} heard (${+t.toFixed(3)} s); black here, ${got.blackBy === "gaps[]" ? "a gap in " : ""}${c.timingTimeline ?? "timing.json"} ${got.blackBy}: no picture, so no shot or camera`
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
  if (got.cam)
    out.push(
      `camera: ${c.camTimeline ?? "src/timeline/cam.json"} [${got.cam.before}] t=${fmt(got.cam.t0)}${
        got.cam.after === null ? " (the last key)" : ` -> [${got.cam.after}] t=${fmt(got.cam.t1)}`
      }`,
    );
  if (got.velocity)
    out.push(
      `velocity: ${got.velocity.effect}, intensity ${got.velocity.intensity}, scene ${fmt(got.velocity.from)}-${fmt(got.velocity.to)} (${
        got.velocity.hit === null
          ? "no hit on this frame: it hits at its beats"
          : "a hit on its beat plays now"
      }): ${c.timingTimeline ?? "timing.json"} velocity[${got.velocity.row}]`,
    );
  out.push(
    got.voiceOff
      ? `narration: off, ${c.soundTimeline} "voice": false and no "narration" clip: the mix leaves the voice out`
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
  if (got.script)
    out.push(
      `  script not voiced yet (src/edit.json script_lines, scene ${fmt(got.script.t)}-${fmt(got.script.until ?? got.script.t)}${
        got.script.t > got.scene ? ", the next one" : ""
      }): ${String(got.script.text).slice(0, 90)}${String(got.script.text).length > 90 ? "..." : ""}`,
    );
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
          ? ", off (choices.json): not in the mix"
          : s.picked
            ? `, plays ${s.picked} in its place (choices.json)`
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
      `cut ${cut.index} at ${fmt(cut.at)} heard, into shot ${cut.index + 1}${
        cut.stale
          ? ` (renders/cuts.json is older than ${cut.stale}: numbered as the last render cut it; bun run render clip writes it again)`
          : ""
      }: bun run sheet renders/draft_video.mp4 cut ${cut.index} shows it frame by frame`,
    );
  out.push(
    `next: look at it with the film's own list over it (AT=${t} LIST=1 bun run render stills), change the rows named, then bun run check`,
  );
  console.log(out.join("\n"));
}
