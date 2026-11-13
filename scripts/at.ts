// bun run at <second>: everything the film has at one heard second, each with the file and row that holds it. Every
// timeline is read through its own clock as the studio plays it (src/timing-state.mjs): shots in narration seconds
// (fromSource), camera and key files in scene seconds (before Speed/Freeze), sound/text/adjust through their layer clocks.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { noteScene, noteSecond } from "../packages/live-studio/app/notes/note-card-meta.ts";
import { cliArgs, jsonFile, needFilm, secondArg } from "../packages/live-studio/src/cli.mjs";
import { overlayTime } from "../packages/live-studio/src/layer-timing.mjs";
import { audioInfo, openSound } from "../packages/live-studio/src/sound.mjs";
import { mapTimeline } from "../packages/live-studio/src/timing-data.mjs";
import {
  clockForTimeline,
  layerDuration,
  setTiming,
  timingClock,
} from "../packages/live-studio/src/timing-state.mjs";
import { frameAt } from "../packages/live-studio/src/timing.mjs";
import { warp } from "../packages/live-studio/src/warp.mjs";
import { buildVoiceCues } from "./voice/cues.ts";

type Row = Record<string, any>;
const fmt = (x: number) => x.toFixed(2);
// as notes, the studio and a draft's strip print a heard second
const mmss = (t: number) =>
  `${String(Math.floor(t / 60)).padStart(2, "0")}:${(t % 60).toFixed(3).padStart(6, "0")}`;

// The film's files and clocks, set up as the studio plays them (setTiming is the studio's own state)
const filmOf = (dir: string) => {
  const read = (f?: string, fallback: any = null) =>
    f && existsSync(join(dir, f)) ? jsonFile(join(dir, f), dir) : fallback;
  const conf = read("package.json", {})["live-studio"] ?? {};
  const edit = read("src/edit.json", {});
  const fromSource = (s: number) => warp(edit.voice?.warp ?? [], s, 0, 1);
  const camFile = read(conf.camTimeline ?? "src/timeline/cam.json", []);
  const cam: Row[] = Array.isArray(camFile) ? camFile : (camFile.keys ?? []);
  const sourceEnd = fromSource(edit.end ?? Math.max(0, ...cam.map((k) => k.t)));
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

// A note keeps the heard second it was written at; Speed or Freeze edits since move that moment. Its scene second (stored
// by the studio since 2026-11-13) or its place in its shot finds the same picture now.
export const noteMoment = (dir: string, ref: string) => {
  const file = join(dir, "notes/notes.jsonl");
  const notes: Row[] = existsSync(file)
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
    : [];
  // #N counts every note in the order written, as bun run notes numbers them
  const byAge = notes.toSorted((a, b) =>
    (a.at ?? "") < (b.at ?? "") ? -1 : (a.at ?? "") > (b.at ?? "") ? 1 : 0,
  );
  const n = /^#\d+$/.test(ref) ? byAge[+ref.slice(1) - 1] : notes.find((x) => x.id === ref);
  if (!n) return null;
  const { shots, fromSource } = filmOf(dir);
  const scene = noteScene(n, shots);
  return {
    id: n.id,
    n: byAge.indexOf(n) + 1,
    written: n.t as number,
    heard: noteSecond(
      n as { t: number },
      (s) => timingClock.outputAt(fromSource(s)),
      timingClock,
      shots,
    ),
    how: !scene
      ? n.srcT != null
        ? "its narration second through today's voice and Speed edits, since its shot has changed; the studio shows it there too"
        : "its heard second as written (its shot has changed since)"
      : scene.shot === null
        ? "its scene second, kept with it"
        : `${(n.context.shot.into as number).toFixed(2)} s into shot ${scene.shot}${n.shotName ? ` "${n.shotName}"` : ""}, as when it was written`,
  };
};

export const whatsAt = (dir: string, t: number) => {
  const { read, conf, edit, cam, sourceEnd, shots } = filmOf(dir);
  const length = Math.max(timingClock.duration, layerDuration());
  const scene = frameAt(timingClock, t);
  const si = shots.filter((s) => s.t <= scene).length - 1;
  const shot = si >= 0 ? { ...shots[si]!, to: shots[si + 1]?.t ?? sourceEnd } : null;
  // the transition into shot i plays len/2 either side of its cut, clamped to its neighbours as film-stage transitionLength does
  const blend = (i: number) => {
    const tr = shots[i]?.transition;
    if (!i || !tr?.len) return null;
    const len = Math.min(
      tr.len,
      shots[i]!.t - shots[i - 1]!.t,
      (shots[i + 1]?.t ?? sourceEnd) - shots[i]!.t,
    );
    const from = shots[i]!.t - len / 2;
    return {
      row: i,
      fx: tr.fx as string,
      from,
      to: from + len,
      now: scene >= from && scene < from + len,
    };
  };
  const cuts = [blend(si), blend(si + 1)].filter((b) => b !== null);
  const ci = cam.filter((k) => k.t <= scene).length - 1;

  const audio = read(conf.soundTimeline, null);
  const sounds: Row[] = [];
  if (audio) {
    // an sfx without "length" lasts as long as its sound file, when the file is on this machine
    const vault = openSound(dir, conf);
    const durations: Record<string, number> = {};
    for (const c of audio.sfx ?? []) {
      const file = c.length === undefined && vault?.fileOf(c.name);
      if (file) durations[c.name] = audioInfo(file)?.seconds ?? 0;
    }
    const heard = mapTimeline("sound", audio, clockForTimeline("sound"), false, null, durations);
    heard.beds.forEach((c: Row, i: number) => {
      if (c.from <= t && t < c.to)
        sounds.push({ list: "beds", i, name: c.name, from: c.from, to: c.to, row: audio.beds[i] });
    });
    heard.sfx.forEach((c: Row, i: number) => {
      if (c.name === audio.narration) return;
      const len = c.length ?? ((durations[c.name] ?? 0) - (c.start ?? 0)) / (c.rate ?? 1);
      const known = c.length !== undefined || c.name in durations;
      if (c.at <= t && (known ? t < c.at + len : t < c.at + 1))
        sounds.push({
          list: "sfx",
          i,
          name: c.name,
          from: c.at,
          to: known ? c.at + len : null,
          row: audio.sfx[i],
        });
    });
  }

  const layer = (file: string | undefined, kind: string) => {
    const doc = read(file, null);
    if (!doc) return [];
    const clock = clockForTimeline(kind);
    return (doc.items as Row[]).flatMap((it, i) => {
      const at = overlayTime(clock, t, it);
      return at >= it.from && at < it.to && !doc.tracks?.[it.track ?? 0]?.hidden
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
  for (const file of Object.keys(conf.keyFiles ?? {})) {
    const walk = (v: unknown, path: string[]) => {
      if (Array.isArray(v)) {
        if (v.length > 1 && v.every((r) => r && typeof r === "object" && typeof r.t === "number")) {
          const b = v.filter((r) => r.t <= scene).length - 1;
          if (b >= 0 && b < v.length - 1)
            keys.push({
              file,
              path: path.join("."),
              before: b,
              after: b + 1,
              t0: v[b].t,
              t1: v[b + 1].t,
            });
        }
        return;
      }
      if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, [...path, k]);
    };
    walk(read(file, null), []);
  }

  let narration: { line: number; text: string; word?: string; s: number; e: number } | null = null,
    nextLine: number | null = null,
    voiceFault: string | null = null;
  try {
    const cues = buildVoiceCues(dir);
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
  const script = narration
    ? null
    : (scriptLines.find((l) => l.t <= scene && scene < (l.until ?? l.t)) ??
      scriptLines.find((l) => l.t > scene) ??
      null);

  const notesFile = join(dir, "notes/notes.jsonl");
  const notes = existsSync(notesFile)
    ? readFileSync(notesFile, "utf8")
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .flatMap((l) => {
          try {
            return [JSON.parse(l)];
          } catch {
            return [];
          }
        })
        .filter((n) => !n.done && typeof n.t === "number" && Math.abs(n.t - t) <= 3)
    : [];

  return {
    t,
    length,
    scene,
    shot,
    shotCount: shots.length,
    cuts,
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
    nextLine,
    voiceFault,
    script,
    notes,
    conf,
  };
};

const HELP = `What the film has at one heard second (as notes, voice:cues, framecheck and jumps print them), each with the file
and row that holds it: the shot, the camera keys, the narration word, the sounds playing, the text and looks on screen,
the key rows moving, the open notes near it. Run inside the film.
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
  let t: number;
  if (/^-\d/.test(arg)) {
    console.error(`${arg}: the film starts at 0; give a second from 0 on (bun run at 35.6)`);
    process.exit(2);
  } else if (/^\d+,\d+$/.test(arg)) {
    console.error(`${arg}: seconds take a dot; did you mean bun run at ${arg.replace(",", ".")}?`);
    process.exit(2);
  } else if (/^\.?\d/.test(arg)) t = secondArg("bun run at", arg);
  else {
    // a note: #N or its id
    const n = noteMoment(film, arg);
    if (!n) {
      console.error(
        `no note ${arg} in notes/notes.jsonl: bun run notes lists them (#N or the id), or give a second (bun run at 35.6)`,
      );
      process.exit(2);
    }
    t = +n.heard.toFixed(3);
    console.log(
      Math.abs(n.heard - n.written) < 0.005
        ? `note #${n.n} (${n.id}) was written at ${mmss(n.written)} heard, still the same moment (${n.how})`
        : `note #${n.n} (${n.id}) was written at ${mmss(n.written)} heard; that moment is heard at ${mmss(n.heard)} now (${n.how})`,
    );
  }
  let got: ReturnType<typeof whatsAt>;
  try {
    got = whatsAt(film, t);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
  if (t >= got.length) {
    console.error(`the film is ${got.length.toFixed(3)} s long: give a second before that`);
    process.exit(2);
  }
  const { conf: c, ...data } = got;
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(data, null, 2));
    process.exit(0);
  }
  const out: string[] = [];
  out.push(
    `${mmss(t)} heard (${t} s); the picture shows scene second ${fmt(got.scene)}${
      Math.abs(got.scene - t) > 0.005
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
      `  ${b.now ? "in" : "near"} the ${b.fx} transition into shot ${b.row}, scene ${fmt(b.from)}-${fmt(b.to)}: ${shotsFile} [${b.row}].transition`,
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
  out.push(
    got.voiceFault
      ? `narration: unknown here, the voice's seconds could not be read (${got.voiceFault}): bun run voice:cues says more`
      : got.narration
        ? `narration: ${got.narration.word ? `"${got.narration.word}" in ` : "between words of "}line ${got.narration.line} (${fmt(got.narration.s)}-${fmt(got.narration.e)}): ${got.narration.text}`
        : `narration: silent here${got.nextLine === null ? "" : `, the next line at ${fmt(got.nextLine)}`} (every line: bun run voice:cues)`,
  );
  if (got.script)
    out.push(
      `  script not voiced yet (src/edit.json script_lines, scene ${fmt(got.script.t)}-${fmt(got.script.until ?? got.script.t)}${
        got.script.t > got.scene ? ", the next one" : ""
      }): ${String(got.script.text).slice(0, 90)}${String(got.script.text).length > 90 ? "..." : ""}`,
    );
  const file = c.soundTimeline ?? "src/timeline/audio.json";
  out.push(
    got.sounds.length
      ? `sound (${file}):`
      : `sound: none playing (${file}; to add one: bun run find <words>)`,
  );
  for (const s of got.sounds)
    out.push(
      `  ${s.list}[${s.i}] ${s.name} gain ${s.row.gain ?? 0}${s.row.track ? ` track ${s.row.track}` : ""}, heard ${fmt(s.from)}-${
        s.to === null ? "? (its file is not on this machine)" : fmt(s.to)
      }`,
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
  if (got.notes.length)
    out.push(
      `open notes within 3 s: ${got.notes.map((n) => `${n.id} at ${fmt(n.t)} "${String(n.text).slice(0, 40)}"`).join("; ")} (bun run notes <id>)`,
    );
  // the cut a draft's sheet numbers (renders/cuts.json, heard seconds), when this second sits on one
  const cutsFile = join(film, "renders/cuts.json");
  const cutTimes: number[] = existsSync(cutsFile) ? jsonFile(cutsFile, film) : [];
  const near = cutTimes.findIndex((s) => Math.abs(s - t) <= 0.3);
  if (near >= 0)
    out.push(
      `cut ${near} at ${fmt(cutTimes[near]!)} heard, into shot ${near + 1}: bun run sheet renders/draft_video.mp4 cut ${near} shows it frame by frame`,
    );
  out.push(
    `next: look at it with the film's own list over it (AT=${t} LIST=1 bun run render stills), change the rows named, then bun run check`,
  );
  console.log(out.join("\n"));
}
