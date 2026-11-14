// The creator's notes for the AI about to act on them; HELP below
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { cliArgs, needFilm, numberArg } from "./src/cli.mjs";
import { LESSONS, lessonsFor, lessonTopics } from "./src/lessons.mjs";
import { noteState, noteThread, wholeNote, WORD_NEAR } from "./src/note-state.mjs";
import { deletedSaid, findNote, noteNumbers } from "./src/notes.mjs";
import { tell } from "./src/tell.mjs";

const ROOT = resolve(process.env.LIVE_PROJECT ?? process.cwd());
const posix = (rel) => join(ROOT, rel).replaceAll("\\", "/");
const pct = (x) => `${Math.round(x * 100) + 0}%`;
const list = (v) => `[${v.join(", ")}]`;

const loadNotes = () => {
  const file = join(ROOT, "notes/notes.jsonl");
  const lines = existsSync(file)
    ? readFileSync(file, "utf8")
        .split(/\r?\n/)
        .filter((l) => l.trim())
    : [];
  const notes = lines.map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  });
  const whole = notes.filter(wholeNote);
  if (whole.length !== notes.length)
    console.error(`${notes.length - whole.length} malformed notes skipped: see notes/notes.jsonl`);
  // #N counts every note, done and deleted ones too, so a note keeps its number as the round goes on
  const numbers = noteNumbers(ROOT);
  for (const n of whole) n.n = numbers.get(n.id).n;
  const deleted = [...numbers.values()].filter((x) => x.gone).length;
  return { notes: whole, deleted };
};

const DEFAULT_LIMIT = 25;
const LINE_TEXT_MAX = 120;
const isOpen = (n) => noteState(n) === "open";
const isBack = (n) => isOpen(n) && Boolean(n.fixes?.length);
const backKind = (n, thread = noteThread(n, { rewordings: true })) => {
  const last = thread.slice(thread.findLastIndex((m) => m.by === "ai") + 1).at(-1);
  return !last ? "plain" : last.reworded ? "reworded" : "answered";
};
const SORT_RANK = { back: 0, open: 1, check: 2, done: 3 };
const rankOf = (n) => SORT_RANK[isBack(n) ? "back" : noteState(n)];
const SORT = {
  written: { label: "in the order written", cmp: (a, b) => a.n - b.n },
  back: {
    label: "back-to-you first, then order written",
    cmp: (a, b) => rankOf(a) - rankOf(b) || a.n - b.n,
  },
  film: { label: "in film order", cmp: (a, b) => a.t - b.t || a.n - b.n },
  newest: { label: "newest first", cmp: (a, b) => b.n - a.n },
};

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
  `(${pct(pt[0])}, ${pct(pt[1])}) on "${hit?.what ?? "?"}"${hit?.world ? ` world ${list(hit.world)}` : ""}`;

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
  if (n.pin) tags.push(`tap ${n.pin.what ?? "?"}`);
  if (n.marks?.length)
    tags.push(`drew ${n.marks.length}${n.range ? ` over ${n.range[0]}-${n.range[1]}s` : ""}`);
  if (n.refs?.length)
    tags.push(`${n.refs.length} reference picture${n.refs.length > 1 ? "s" : ""}`);
  if (n.context?.playing) tags.push("while playing");
  const asked = (n.fixes ?? []).filter((f) => f.ask).length,
    tried = (n.fixes?.length ?? 0) - asked;
  if (tried) tags.push(`tried ${tried}x`);
  if (asked) tags.push(`asked ${asked}x`);
  if (n.asks?.length) tags.push(`creator answered ${n.asks.length}x`);
  if (n.remember) tags.push("remember");
  const state = noteState(n);
  if (isBack(n)) tags.push(backKind(n) === "reworded" ? "back to you: reworded" : "back to you");
  else if (state !== "open")
    tags.push(state === "check" ? "waits for the creator's check" : "done");
  const raw = n.text.trim().split(/\s+/).filter(Boolean).join(" ");
  const chars = [...raw];
  const text =
    chars.length > LINE_TEXT_MAX ? `${chars.slice(0, LINE_TEXT_MAX - 1).join("")}…` : raw;
  return `#${n.n} ${n.id} ${n.time} shot ${n.shot}${tags.length ? ` [${tags.join(", ")}]` : ""} ${text}`;
};

const STATE_HEAD = { open: "", check: " (WAITS FOR THE CREATOR'S CHECK)", done: " (DONE)" };
const BACK_HEAD = {
  plain: " (BACK TO YOU)",
  reworded: " (BACK TO YOU: the creator reworded it after your answer)",
  answered: " (BACK TO YOU: the creator answered)",
};
const stateHead = (n, thread) =>
  isBack(n) ? BACK_HEAD[backKind(n, thread)] : STATE_HEAD[noteState(n)];

const noteNoun = (count, done) => `${done ? "" : "open "}note${count === 1 ? "" : "s"}`;

const hiddenSummary = (hidden, { done, shot, sort }) => {
  const details = [];
  const hiddenBack = hidden.filter(isBack);
  if (hiddenBack.length) {
    const nums = hiddenBack
      .slice(0, 3)
      .map((n) => `#${n.n}`)
      .join(", ");
    details.push(`${hiddenBack.length} back to you: ${nums}${hiddenBack.length > 3 ? ", …" : ""}`);
  }
  if (shot === null) {
    const byShot = new Map();
    for (const n of hidden) byShot.set(n.shot, (byShot.get(n.shot) ?? 0) + 1);
    const ranked = [...byShot.entries()].toSorted((a, b) => b[1] - a[1] || a[0] - b[0]);
    const top = ranked
      .slice(0, 4)
      .map(([s, c]) => `shot ${s} (${c})`)
      .join(", ");
    const moreShots = ranked.length - 4;
    const rest = moreShots > 0 ? `, +${moreShots} more shot${moreShots === 1 ? "" : "s"}` : "";
    details.push(`in ${top}${rest}`);
  }
  const cmd = (...extra) =>
    [
      "bun run notes",
      ...(shot !== null ? [`--shot ${shot}`] : []),
      ...(done ? ["--done"] : []),
      ...extra,
    ].join(" ");
  const sortFlag = sort !== "written" ? [`--sort ${sort}`] : [];
  const hints = [`all: ${cmd(...sortFlag, "--limit 0")}`];
  if (hiddenBack.length && sort !== "back")
    hints.push(`creator replies first: ${cmd("--sort back")}`);
  if (shot === null) hints.push(`one shot: ${cmd(...sortFlag, "--shot N")}`);
  const where = shot !== null ? ` on shot ${shot}` : "";
  const info = details.length ? ` (${details.join("; ")})` : "";
  return `... ${hidden.length} more ${noteNoun(hidden.length, done)} hidden${where}${info} — ${hints.join(" | ")}`;
};
const SCOPE = { film: "this film", all: "every film" };
const LESSONS_HERE = relative(ROOT, LESSONS).replaceAll("\\", "/");
let cachedLearn;
const learnPrompt = () => {
  if (cachedLearn) return cachedLearn;
  const topics = lessonTopics();
  cachedLearn = `keep it as a rule that outlives this chat: in code where you can (a default, or a check that fails); else, for every film, in ${LESSONS_HERE}/<topic>.md (${topics.length ? `topics now: ${topics.join(", ")}; ` : ""}a rule joins its topic's file, a new file only for a new topic; write it any way, but Jev finds it for later notes by its path, frontmatter and headings only, never the words under them, so write those with care: a "when:" frontmatter line naming the notes the file is for, each rule a heading that says it, the details under it); a this-film rule in this film's src, beside what it rules; then`;
  return cachedLearn;
};
const toLearn = (n) => n.remember && !(n.learned && n.learned.at >= n.remember.at);

const lessonLines = (l) =>
  !l
    ? []
    : l.why
      ? [`lessons: Jev did not run (${l.why}); the files are in ${LESSONS_HERE}/`]
      : !l.picks.length
        ? [`lessons: Jev says none fits this note (all in ${LESSONS_HERE}/)`]
        : [
            ...l.picks.flatMap((p) => [
              `lesson${p.sure ? "" : " (maybe)"}: ${relative(ROOT, join(LESSONS, "..", p.path)).replaceAll("\\", "/")}${p.heads.length ? ", its headings by line:" : ""}`,
              ...p.heads.map((h) => `  ${h.line} ${h.head}`),
            ]),
            "lessons above return only the file name and headings by line — read those files directly for the full rules and details.",
          ];

const detail = (n, showCam, lessons) => {
  const c = n.context,
    thread = noteThread(n, { rewordings: true });
  console.log(
    `\n## #${n.n} ${n.id} ${n.time}${n.frame == null ? "" : ` frame ${n.frame},`} shot ${n.shot}${n.shotName ? `: ${n.shotName}` : ""}${stateHead(n, thread)}`,
  );
  console.log(`NOTE: ${n.text}`);
  if (n.pin)
    console.log(
      `tap: ${pct(n.pin.x)} across, ${pct(n.pin.y)} down, on "${n.pin.what ?? "?"}"${n.pin.world ? `, world ${list(n.pin.world)}` : ""}`,
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
    if (c.muted) console.log("heard: the studio was MUTED");
    else if (c.volume != null) console.log(`heard: the studio at ${pct(c.volume)} volume`);
    if (c.view?.phone)
      console.log(`seen on a phone${c.view.screen ? `, screen ${c.view.screen.join("x")}` : ""}`);
    v = c.voice;
  } else v = workedOut(n);
  const suffix = c ? "" : " (today's edit)";
  // notes written before the studio kept only a near word may name one across a silence
  if (v.word && (v.wordAt == null || Math.abs(v.wordAt - n.t) <= WORD_NEAR))
    console.log(
      `word: "${v.word}" at ${v.wordAt ?? "?"}s in "...${v.around ?? ""}..." (heard second when written; now: bun run voice:cues)`,
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
      `action${suffix}: ${b.id}${b.title ? ` "${b.title}"` : ""} ${b.at}s${b.dur == null ? "" : ` +${b.dur}s`}${b.sounds?.length ? `, sounds ${b.sounds.join(", ")}` : ""}`,
    );
  }
  if (n.freeCam) console.log(`seen through the free camera${n.cam ? `: ${n.cam.line}` : ""}`);
  if (n.finalLook) console.log("seen in final quality");
  if (n.version) console.log(`said about version: ${n.version}`);
  // the thread after the note itself, oldest first: what was tried or asked, what the creator said back or reworded
  for (const m of thread.slice(1))
    console.log(
      m.reworded
        ? `creator reworded it, it was: ${m.text}`
        : m.by === "creator"
          ? `creator answered: ${m.text}`
          : m.ask
            ? `you asked: ${m.text}`
            : `tried: ${m.text} (${m.checkpoint})`,
    );
  if (n.learned) console.log(`learned (${SCOPE[n.learned.scope]}): ${n.learned.what}`);
  if (toLearn(n))
    console.log(
      n.learned && n.learned.scope !== n.remember.scope
        ? `the creator changed it to ${SCOPE[n.remember.scope]} after you kept it for ${SCOPE[n.learned.scope]}: move the rule where ${n.remember.scope === "film" ? "this film's rules go (its src, beside what it rules)" : `every film's go (${LESSONS_HERE}/<topic>.md)`}, then bun run note learned ${n.id} "the rule, where"`
        : `the creator asked you to remember this (${SCOPE[n.remember.scope]}): ${learnPrompt()} bun run note learned ${n.id} "the rule, where"`,
    );
  for (const l of lessonLines(lessons)) console.log(l);
  if (showCam && n.cam && !n.freeCam)
    console.log(`camera: ${n.cam.line ?? "?"}${n.cam.warn ? ` (${n.cam.warn})` : ""}`);
  for (const [label, key] of [
    ["seconds around (-2 -1 0 +1)", "strip"],
    ["frame", "img"],
    ["under the tap", "crop"],
  ]) {
    if (n[key]) console.log(`${label}: ${posix(n[key])}`);
  }
  for (const f of n.frames ?? []) console.log(`drawn at ${f.t}s: ${posix(f.img)}`);
  (n.refs ?? []).forEach((r, i) =>
    console.log(`reference ${i + 1} (pasted by the creator, not the film): ${posix(r)}`),
  );
};

const HELP = `The creator's notes from the studio, for the AI about to act on them. Run inside the film.
  bun run notes                 the open notes, one line each, up to ${DEFAULT_LIMIT}, in the order written (#1 first)
  bun run notes ID [ID ...]     everything about those notes (ID: the id, as mw6hr1fm, or the number, as 3 or #3): where
                                they tapped, the words, the actions, the version, pictures, and the parts of
                                ${LESSONS_HERE}/ Jev says the note needs — returning only file names and headings by line
                                (read those files directly for full details)
  bun run notes --shot 3        everything about one shot's open notes (up to ${DEFAULT_LIMIT})
  --sort written|back|film|newest   order: written (#1 first, default), back (BACK TO YOU replies first),
                                    film (second in the film), newest (latest #N first)
  --limit N                     max notes printed (default ${DEFAULT_LIMIT}; 0 for all)
  --done                        fixed notes too            --cam   the film camera's line too (a free-camera note
                                                                   always prints the one it was seen through)
A fixed note waits for the creator's check in the studio; their answer brings it back here with their words.
Answer one: bun run note done|ask|learned ID "words" (bun run note --help). Never edit notes.jsonl by hand.`;
const validateSort = (mode) => {
  if (!Object.hasOwn(SORT, mode)) {
    console.error(
      `unknown --sort ${JSON.stringify(mode)}: expected ${Object.keys(SORT).join(", ")}`,
    );
    process.exit(2);
  }
  return mode;
};
const args = cliArgs(HELP, ["--shot N", "--sort MODE", "--limit N", "--done", "--cam"]);
let shot = null;
let sort = "written";
let limitArg;
let done = false;
let cam = false;
const ids = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--done") done = true;
  else if (a === "--cam") cam = true;
  else if (a === "--shot") shot = numberArg("--shot", args[++i], { min: 0, int: true });
  else if (a === "--limit") limitArg = numberArg("--limit", args[++i], { min: 0, int: true });
  else if (a === "--sort") sort = validateSort(args[++i]);
  else if (a.startsWith("-")) {
    console.error(
      `unknown option ${a}: bun run notes [ID ... | --shot N] [--sort MODE] [--limit N] [--done] [--cam] (--help for more)`,
    );
    process.exit(2);
  } else ids.push(a);
}
if (ids.length && (shot !== null || limitArg !== undefined)) {
  console.error(
    `give note IDs or --${shot !== null ? "shot N" : "limit N"}, not both (--help for more)`,
  );
  process.exit(2);
}
const limit = limitArg ?? DEFAULT_LIMIT;
// a film, or at least a folder the studio has written notes into
if (!existsSync(join(ROOT, "notes/notes.jsonl"))) needFilm(ROOT);
const { notes, deleted } = loadNotes();
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
    const none = [];
    for (const id of unknown) {
      const x = findNote(ROOT, id);
      if (x?.gone) console.error(deletedSaid(x));
      else none.push(id);
    }
    if (none.length)
      console.error(
        `no such note: ${none.join(", ")} (the ids: bun run notes, or --done for fixed ones too)`,
      );
    process.exit(2);
  }
  const want = new Set(ids.map((id) => byKey.get(id)));
  pick = notes.filter((n) => want.has(n));
} else {
  pick = notes.filter((n) => done || isOpen(n));
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
    `no ${done ? "" : "open "}notes on shot ${shot}${done ? "" : ` (${notes.filter((n) => n.shot === shot && !isOpen(n)).length} fixed or done there: --done lists them too)`}${count !== null && shot >= count ? `; the film has shots 0-${count - 1}` : ""}`,
  );
}
const ordered = pick.toSorted(SORT[sort].cmp);
const hidden = !ids.length && limit > 0 ? ordered.slice(limit) : [];
const shown = hidden.length ? ordered.slice(0, limit) : ordered;
if (ids.length || shot !== null) {
  // only here, where one note is read in full: the list stays one line a note, and Jev is paid only once a note's words change.
  // A note to remember too, answered or not: its rule joins the file Jev picks
  const lessons = await lessonsFor(
    shown.filter((n) => isOpen(n) || toLearn(n)),
    { cache: join(ROOT, "notes/lessons-cache.json") },
  );
  for (const n of shown) detail(n, cam, lessons.get(n.id));
  if (hidden.length) console.log(`\n${hiddenSummary(hidden, { done, shot, sort })}`);
  const nums = shown.map((n) => `#${n.n}`);
  if (shown.length)
    await tell(ROOT, {
      say:
        shot !== null
          ? `Reading the notes on shot ${shot}${hidden.length ? ` (${shown.length} of ${ordered.length})` : ""}: ${nums.join(", ")}`
          : shown.length === 1
            ? `Reading note ${nums[0]}: "${shown[0].text}"`
            : `Reading notes ${nums.join(", ")}`,
      notes: shown.map((n) => n.id),
    });
  // the files as the studio's Lessons tab names them, from the lessons folder
  const picked = [
    ...new Set(
      [...lessons.values()].flatMap((l) =>
        (l.picks ?? []).map((p) =>
          relative(LESSONS, join(LESSONS, "..", p.path)).replaceAll("\\", "/"),
        ),
      ),
    ),
  ];
  if (picked.length)
    await tell(ROOT, {
      say: `Jev picked the lessons ${picked.join(", ")}`,
      lessons: picked,
      notes: shown.filter((n) => lessons.get(n.id)?.picks?.length).map((n) => n.id),
    });
  const todo = shown.find(isOpen) ?? ordered.find(isOpen),
    learn = shown.find(toLearn) ?? ordered.find(toLearn);
  const hasCheck = ordered.some((n) => noteState(n) === "check");
  console.log(
    todo
      ? `\nnext: where it is heard now and what the film has there, file and row: bun run at ${todo.id}; fix it, look (AT=<the second at prints> bun run render stills), then bun run note done ${todo.id} "what changed"`
      : learn
        ? `\nnext: keep the rule as said above, then bun run note learned ${learn.id} "the rule, where"`
        : `\nnext: ${hasCheck ? "nothing here is yours until the creator answers in the studio; " : ordered.length ? "these notes are done; " : ""}the open notes: bun run notes`,
  );
} else {
  const backCount = ordered.filter(isBack).length;
  const meta = [
    ...(hidden.length ? [`showing ${shown.length}`] : []),
    ...(backCount ? [`${backCount} back to you`] : []),
  ];
  console.log(
    `${ordered.length} ${noteNoun(ordered.length, done)} of ${notes.length}${deleted ? ` (#N counts the ${deleted} the creator deleted too, so a number never moves to another note)` : ""}, ${SORT[sort].label}${meta.length ? ` (${meta.join("; ")})` : ""}. Film now: ${filmNow()}. Detail: bun run notes ID ...\n`,
  );
  for (const n of shown) console.log(oneLine(n));
  if (hidden.length) console.log(`\n${hiddenSummary(hidden, { done, shot: null, sort })}`);
  await tell(ROOT, {
    say: `Reading the ${done ? "" : "open "}notes: ${
      hidden.length
        ? `${shown.length} of ${ordered.length}${ordered.length < notes.length ? ` (${notes.length} total)` : ""}`
        : `${ordered.length} of ${notes.length}`
    }`,
  });
  const waiting = notes.filter((n) => noteState(n) === "check");
  if (!done && waiting.length)
    console.log(
      `\n${waiting.length} more wait for the creator's check in the studio, not yours until they answer (--done lists them)`,
    );
  const learn = notes.filter(toLearn).toSorted(SORT.written.cmp);
  if (learn.length) {
    console.log(
      `\nThe creator asked you to remember these: ${learnPrompt()} bun run note learned ID "the rule, where"`,
    );
    for (const n of learn) console.log(`[${SCOPE[n.remember.scope]}] ${oneLine(n)}`);
  }
  const first = shown.find(isOpen) ?? ordered.find(isOpen);
  console.log(
    first
      ? `\nnext: bun run notes ${first.id} (#${first.n} in full: where they tapped, the words, what was tried, and the matching lesson file names + headings — read those lesson files directly for full details)`
      : learn.length
        ? `\nnext: keep the rule as said above, then bun run note learned ${learn[0].id} "the rule, where"`
        : `\nnext: nothing is yours${waiting.length ? `: ${waiting.length} wait for the creator's check in the studio` : " until the creator writes a note in the studio"}`,
  );
}
