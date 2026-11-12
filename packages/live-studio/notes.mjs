// The creator's notes for the AI about to act on them (Bun counterpart to notes_report.py); HELP below
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { cliArgs, needFilm } from "./src/cli.mjs";
import { noteState, noteThread } from "./src/note-state.mjs";

const ROOT = resolve(process.env.LIVE_PROJECT ?? process.cwd());
const posix = (rel) => join(ROOT, rel).replaceAll("\\", "/");
// Matches Python's :.0f (banker's round half-to-even)
const pct = (x) => {
  const v = x * 100,
    f = Math.floor(v),
    d = v - f;
  const r = d > 0.5 ? f + 1 : d < 0.5 ? f : f % 2 === 0 ? f : f + 1;
  return `${Object.is(r, -0) ? 0 : r}%`;
};
const pyRepr = (v) => {
  if (Array.isArray(v)) return `[${v.map(pyRepr).join(", ")}]`;
  if (typeof v === "string") return `'${v.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
  return String(v);
};

const loadNotes = () => {
  const file = join(ROOT, "notes/notes.jsonl");
  const lines = existsSync(file)
    ? readFileSync(file, "utf8")
        .split(/\r?\n/)
        .filter((l) => l.trim())
    : [];
  const notes = lines.map((l) => JSON.parse(l));
  const whole = notes.filter(
    (n) => "id" in n && "t" in n && "text" in n && "shot" in n && "time" in n,
  );
  if (whole.length !== notes.length)
    console.error(`${notes.length - whole.length} malformed notes skipped: see notes/notes.jsonl`);
  // #N counts every note, done ones too, so a note keeps its number as the round goes on
  const sorted = whole.toSorted((a, b) =>
    (a.at ?? "") < (b.at ?? "") ? -1 : (a.at ?? "") > (b.at ?? "") ? 1 : 0,
  );
  sorted.forEach((n, i) => {
    n.n = i + 1;
  });
  return whole;
};

const written = (notes) => notes.toSorted((a, b) => a.n - b.n);

const workedOut = (n) => {
  const t = n.srcT ?? n.t,
    out = { beats: [] };
  try {
    const lines = JSON.parse(readFileSync(join(ROOT, "renders/live/voice_map.json"), "utf8")).lines;
    const here = lines.findIndex((l) => l.s <= t && t <= l.e + 0.35);
    const after = lines.findIndex((l) => l.s > t);
    const afterIdx = after < 0 ? lines.length : after;
    const [before, nxt] = here >= 0 ? [here - 1, here + 1] : [afterIdx - 1, afterIdx];
    out.line = here >= 0 ? lines[here].text : null;
    out.silence = here < 0;
    out.before = before >= 0 ? lines[before].text : null;
    out.next = nxt < lines.length ? lines[nxt].text : null;
    const beats = JSON.parse(readFileSync(join(ROOT, "src/edit.json"), "utf8")).beats;
    out.beats = Object.entries(beats)
      .filter(([, b]) => b.at - 1.5 <= t && t <= b.at + (b.dur || 0) + 1.5)
      .map(([k, b]) => ({
        id: k,
        title: b.title ?? null,
        at: b.at,
        dur: b.dur ?? null,
        sounds: b.sounds ?? null,
      }));
  } catch {
    /* optional files */
  }
  return out;
};

const filmNow = () => {
  try {
    const r = spawnSync("git", ["describe", "--tags", "--always", "--dirty"], {
      cwd: ROOT,
      encoding: "utf8",
      windowsHide: true,
    });
    return (r.stdout ?? "").trim() || "(not in git)";
  } catch {
    return "(not in git)";
  }
};

const where = (pt, hit) =>
  `(${pct(pt[0])}, ${pct(pt[1])}) on "${hit?.what ?? "?"}"${hit?.world ? ` world ${pyRepr(hit.world)}` : ""}`;

const drawn = (m) => {
  const hits = m.hits || [],
    hit = (i) => (i < hits.length ? hits[i] : null);
  if (m.kind === "path") {
    const n = Math.min(m.ts.length, m.pts.length);
    const steps = [];
    for (let i = 0; i < n; i++) steps.push(`${m.ts[i]}s ${where(m.pts[i], hit(i))}`);
    return `path ${steps.join(" -> ")}`;
  }
  if (m.kind === "box") {
    const [x0, y0] = m.pts[0],
      [x1, y1] = m.pts[m.pts.length - 1];
    return `box at ${m.t}s: ${pct(Math.min(x0, x1)).slice(0, -1)}-${pct(Math.max(x0, x1))} across, ${pct(Math.min(y0, y1)).slice(0, -1)}-${pct(Math.max(y0, y1))} down, middle ${where([(x0 + x1) / 2, (y0 + y1) / 2], hit(0))}`;
  }
  const ends = { pen: ["from", "to"], arrow: ["tail", "head"] }[m.kind];
  return `${m.kind} at ${m.t}s: ${ends[0]} ${where(m.pts[0], hit(0))}, ${ends[1]} ${where(m.pts[m.pts.length - 1], hit(1))}`;
};

const oneLine = (n) => {
  const tags = [];
  if (n.pin) tags.push(`tap ${n.pin.what ?? "None"}`);
  if (n.marks?.length)
    tags.push(`drew ${n.marks.length}${n.range ? ` over ${n.range[0]}-${n.range[1]}s` : ""}`);
  if (n.context?.playing) tags.push("while playing");
  if (n.fixes?.length) tags.push(`tried ${n.fixes.length}x`);
  if (n.asks?.length) tags.push(`creator answered ${n.asks.length}x`);
  if (n.remember) tags.push("remember");
  const state = noteState(n);
  if (state !== "open") tags.push(state === "check" ? "waits for the creator's check" : "done");
  const text = n.text.trim().split(/\s+/).filter(Boolean).join(" ");
  return `#${n.n} ${n.id} ${n.time} shot ${n.shot}${tags.length ? ` [${tags.join(", ")}]` : ""} ${text}`;
};

const printVal = (v) => (v === null || v === undefined ? "None" : v);
const STATE_HEAD = { open: "", check: " (WAITS FOR THE CREATOR'S CHECK)", done: " (DONE)" };
const SCOPE = { film: "this film", all: "every film" };
const LEARN =
  "keep it as a rule that outlives this chat, in code where you can (a default, or a check that fails), else in the repo's skill .claude/skills/gohans-3js-videos-skills; a this-film rule stays in this film's src; then";
const toLearn = (n) => n.remember && !(n.learned && n.learned.at >= n.remember.at);

const detail = (n, showCam) => {
  const c = n.context;
  console.log(
    `\n## #${n.n} ${n.id} ${n.time} frame ${printVal(n.frame)}, shot ${n.shot}: ${n.shotName ?? ""}${STATE_HEAD[noteState(n)]}`,
  );
  console.log(`NOTE: ${n.text}`);
  for (const e of n.edits ?? []) console.log(`earlier wording: ${e.was}`);
  if (n.pin)
    console.log(
      `tap: ${pct(n.pin.x)} across, ${pct(n.pin.y)} down, on "${printVal(n.pin.what)}"${n.pin.world ? `, world ${pyRepr(n.pin.world)}` : ""}`,
    );
  else if (n.marks?.length) console.log("tap: none, it was drawn on");
  else console.log("tap: none (note button), about the moment as a whole");
  if (n.range) console.log(`about ${n.range[0]}-${n.range[1]}s, not one moment`);
  for (const m of n.marks ?? []) console.log(`drawn: ${drawn(m)}`);
  let v;
  if (c) {
    const s = c.shot;
    console.log(`in shot: ${s.into}s of ${s.from}-${s.to}s`);
    if (c.playing)
      console.log(`pressed while PLAYING at ${c.rate ?? 1}x: it may be about a moment earlier`);
    v = c.voice;
  } else v = workedOut(n);
  const suffix = c ? "" : " (today's edit)";
  if (v.word)
    console.log(
      `word: "${v.word}" at ${printVal(v.wordAt)}s in "...${printVal(v.around)}..." (heard second when written; now: bun run voice:cues)`,
    );
  for (const [name, key] of [
    ["before", "before"],
    ["saying", "line"],
    ["next", "next"],
  ]) {
    if (v[key]) console.log(`${name}${suffix}: ${v[key]}`);
  }
  if (v.silence) console.log(`voice${suffix}: silent here`);
  for (const b of (c || v).beats || []) {
    console.log(
      `action${suffix}: ${b.id} "${printVal(b.title)}" ${b.at}s +${printVal(b.dur)}s${b.sounds ? `, sounds ${pyRepr(b.sounds)}` : ""}`,
    );
  }
  if (c?.view?.lite)
    console.log("seen on a phone with small textures: softness may not be in the film");
  if (n.freeCam) console.log("seen through the free camera");
  if (n.finalLook) console.log("seen in final quality");
  if (n.version) console.log(`said about version: ${n.version}`);
  // the thread after the note itself, oldest first: what was tried or asked, and what the creator said back
  for (const m of noteThread(n).slice(1))
    console.log(
      m.by === "creator"
        ? `creator answered: ${m.text}`
        : m.ask
          ? `you asked: ${m.text}`
          : `tried: ${m.text} (${m.checkpoint})`,
    );
  if (n.learned) console.log(`learned (${SCOPE[n.learned.scope]}): ${n.learned.what}`);
  if (toLearn(n))
    console.log(
      `the creator asked you to remember this (${SCOPE[n.remember.scope]}): ${LEARN} bun run note learned ${n.id} "the rule, where"`,
    );
  if (showCam && n.cam)
    console.log(`camera: ${printVal(n.cam.line)}${n.cam.warn ? ` (${n.cam.warn})` : ""}`);
  for (const [label, key] of [
    ["seconds around (-2 -1 0 +1)", "strip"],
    ["frame", "img"],
    ["under the tap", "crop"],
  ]) {
    if (n[key]) console.log(`${label}: ${posix(n[key])}`);
  }
  for (const f of n.frames ?? []) console.log(`drawn at ${f.t}s: ${posix(f.img)}`);
};

const HELP = `The creator's notes from the studio, for the AI about to act on them. Run inside the film.
  bun run notes                 the open notes, one line each, in the order written (#1 first)
  bun run notes ID [ID ...]     everything about those notes (ID: the id, as mw6hr1fm, or the number, as 3 or #3): where
                                they tapped, the words, the actions, the version, pictures
  bun run notes --shot 3        everything about one shot's open notes
  --done                        fixed notes too            --cam   the camera line too
A fixed note waits for the creator's check in the studio; their answer brings it back here with their words.
Answer one: bun run note done|ask|learned ID "words" (bun run note --help). Never edit notes.jsonl by hand.`;
cliArgs(HELP, ["--shot N", "--done", "--cam"]);
// a film, or at least a folder the studio has written notes into
if (!existsSync(join(ROOT, "notes/notes.jsonl"))) needFilm(ROOT);
// parseArgs reads "--shot -1" as an option missing its value: say what is wrong with the number instead
const shotAt = process.argv.indexOf("--shot");
if (shotAt > 0 && !/^\d+$/.test(process.argv[shotAt + 1] ?? "")) {
  console.error(
    `--shot takes a shot number, 0 or more (bun run notes lists them), got ${process.argv[shotAt + 1] ?? "nothing"}`,
  );
  process.exit(2);
}
let parsed;
try {
  parsed = parseArgs({
    options: {
      shot: { type: "string" },
      done: { type: "boolean", default: false },
      cam: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });
} catch (e) {
  // what cliArgs lets through as a word: a dash and a digit, as -1
  const bad = /'([^']+)'/.exec(e.message)?.[1] ?? e.message;
  console.error(
    `unknown option ${bad}: bun run notes [ID ...] [--shot N] [--done] [--cam] (--help for more)`,
  );
  process.exit(2);
}
const { values, positionals: ids } = parsed;
const shot = values.shot !== undefined ? Number(values.shot) : null;
const notes = loadNotes();
let pick;
if (ids.length) {
  // a note by its id or by the #N the list shows
  const byKey = new Map(
    notes.flatMap((n) => [
      [n.id, n],
      [`#${n.n}`, n],
      [String(n.n), n],
    ]),
  );
  const unknown = ids.filter((id) => !byKey.has(id));
  if (unknown.length) {
    console.error(
      `no such note: ${unknown.join(", ")} (the ids: bun run notes, or --done for fixed ones too)`,
    );
    process.exit(2);
  }
  const want = new Set(ids.map((id) => byKey.get(id)));
  pick = notes.filter((n) => want.has(n));
} else {
  pick = notes.filter((n) => values.done || !n.done);
  if (shot !== null) pick = pick.filter((n) => n.shot === shot);
}
// how many shots the film has, when its shots file says (a number past them is a typo, not a quiet shot)
const shotCount = () => {
  try {
    const rel = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))["live-studio"]
      ?.shotsTimeline;
    return rel ? JSON.parse(readFileSync(join(ROOT, rel), "utf8")).length : null;
  } catch {
    return null;
  }
};
if (shot !== null && !pick.length) {
  const count = shotCount();
  console.log(
    `no ${values.done ? "" : "open "}notes on shot ${shot}${values.done ? "" : " (--done for fixed ones too)"}${count !== null && shot >= count ? `; the film has shots 0-${count - 1}` : ""}`,
  );
}
if (ids.length || shot !== null) {
  for (const n of written(pick)) detail(n, values.cam);
  const todo = pick.find((n) => !n.done);
  if (todo)
    console.log(
      `\nnext: where it is heard now and what the film has there, file and row: bun run at ${todo.id}; fix it, look (AT=<the second at prints> bun run render stills), then bun run note done ${todo.id} "what changed"`,
    );
} else {
  console.log(
    `${pick.length} notes, in the order written. Film now: ${filmNow()}. Detail: bun run notes ID ...\n`,
  );
  for (const n of written(pick)) console.log(oneLine(n));
  const waiting = notes.filter((n) => noteState(n) === "check");
  if (!values.done && waiting.length)
    console.log(
      `\n${waiting.length} more wait for the creator's check in the studio, not yours until they answer (--done lists them)`,
    );
  const learn = written(notes.filter(toLearn));
  if (learn.length) {
    console.log(
      `\nThe creator asked you to remember these: ${LEARN} bun run note learned ID "the rule, where"`,
    );
    for (const n of learn) console.log(`[${SCOPE[n.remember.scope]}] ${oneLine(n)}`);
  }
}
