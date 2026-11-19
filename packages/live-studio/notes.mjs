// The creator's notes for the AI about to act on them; HELP below
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { cliArgs, needFilm, numberArg } from "./src/cli.mjs";
import { readLessonConfig } from "./src/lesson-settings.mjs";
import { LESSONS, lessonsFor } from "./src/lessons.mjs";
import { recordNoteReads } from "./src/note-cli.mjs";
import { noteDetailFormat } from "./src/note-detail.mjs";
import { noteLessonFormat, toLearn } from "./src/note-format.mjs";
import { noteState, noteThread, wholeNote } from "./src/note-state.mjs";
import {
  deletedSaid,
  findNote,
  noteNumbers,
  readDeletedNotes,
  readNoteRows,
} from "./src/notes.mjs";
import { tell } from "./src/tell.mjs";

const ROOT = resolve(process.env.LIVE_PROJECT ?? process.cwd());

const loadNotes = (archived) => {
  const path = archived ? "notes/deleted.jsonl" : "notes/notes.jsonl";
  const active = readNoteRows(ROOT);
  const notes = archived ? readDeletedNotes(ROOT) : active;
  let whole = archived ? notes.filter(Boolean) : notes.filter(wholeNote);
  if (whole.length !== notes.length)
    console.error(`${notes.length - whole.length} malformed notes skipped: see ${path}`);
  const numbers = noteNumbers(ROOT);
  if (archived) {
    const activeIds = new Set(active.map((n) => n?.id));
    whole = [...new Map(whole.filter((n) => !activeIds.has(n.id)).map((n) => [n.id, n])).values()];
  }
  for (const n of whole) n.n = numbers.get(n.id)?.n ?? null;
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
const byNumber = (a, b) => (a.n ?? 0) - (b.n ?? 0);
const SORT = {
  written: { label: "in the order written", cmp: byNumber },
  back: {
    label: "back-to-you first, then order written",
    cmp: (a, b) => rankOf(a) - rankOf(b) || byNumber(a, b),
  },
  film: { label: "in film order", cmp: (a, b) => a.t - b.t || byNumber(a, b) },
  newest: { label: "newest first", cmp: (a, b) => byNumber(b, a) },
};

const canonicalDir = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};

const sameDir = (a, b) => {
  const ca = canonicalDir(a),
    cb = canonicalDir(b);
  return process.platform === "win32" ? ca.toLowerCase() === cb.toLowerCase() : ca === cb;
};

const filmNow = () => {
  try {
    const ignored = spawnSync("git", ["check-ignore", "-q", "."], {
      cwd: ROOT,
      windowsHide: true,
    });
    if (ignored.status === 0) return "(local film)";
    const top = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: ROOT,
      encoding: "utf8",
      windowsHide: true,
    });
    if (top.status !== 0 || !(top.stdout ?? "").trim()) return "(not in git)";
    if (!sameDir(top.stdout.trim(), ROOT)) {
      const tracked = spawnSync("git", ["ls-files", "--", "."], {
        cwd: ROOT,
        encoding: "utf8",
        windowsHide: true,
      });
      if (tracked.status === 0 && !(tracked.stdout ?? "").trim()) return "(local film)";
    }
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
  const number = n.n == null ? "" : `#${n.n} `;
  const time = n.time ?? `${n.t}s`;
  const shot = n.shot == null ? "" : ` shot ${n.shot}`;
  return `${number}${n.id} ${time}${shot}${tags.length ? ` [${tags.join(", ")}]` : ""} ${text}`;
};

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
const PROJECT_LESSONS = join(ROOT, "lessons");
const hasProjectLessons = resolve(PROJECT_LESSONS) !== resolve(LESSONS);
const HELP = `The creator's notes from the studio, for the AI about to act on them. Run inside the film.
  bun run notes                 the open notes, one line each, up to ${DEFAULT_LIMIT}, in the order written (#1 first)
  bun run notes ID [ID ...]     everything about those notes (ID: the id, as mw6hr1fm, or the number, as 3 or #3): where
                                they tapped, the words, the actions, the version, pictures, and the parts of
                                ${hasProjectLessons ? `lessons/ (this film) and ${LESSONS_HERE}/ (every film), including nested .md folders,` : `${LESSONS_HERE}/ (including nested .md folders)`} Jev says the note needs — returning only file names and headings by line
                                (read those files directly for full details)
  bun run notes --shot 3        everything about one shot's open notes (up to ${DEFAULT_LIMIT})
  --sort written|back|film|newest   order: written (#1 first, default), back (BACK TO YOU replies first),
                                    film (second in the film), newest (latest #N first)
  --limit N                     max notes printed (default ${DEFAULT_LIMIT}; 0 for all)
  --deleted                     list recoverable deleted notes (restore with bun run note restore ID)
  --json                        return { notes, total } without spending on lesson lookup
  --done                        fixed notes too            --cam   the film camera's line too (a free-camera note
                                                                   always prints the one it was seen through)
A fixed note waits for the creator's check in the studio; their answer brings it back here with their words.
Lessons > AI Inspector previews the shared inputs/output without API calls; Run Jev is a manual opt-in.
Save writes notes/lessons-config.json (prompts, selection, output and CLI enable switch); matching results are cached.
Answer one: bun run note done ID "words" (--after <image> | --no-after "<reason>"), or ask/learned (bun run note --help). Never edit notes.jsonl by hand.`;
const validateSort = (mode) => {
  if (!Object.hasOwn(SORT, mode)) {
    console.error(
      `unknown --sort ${JSON.stringify(mode)}: expected ${Object.keys(SORT).join(", ")}`,
    );
    process.exit(2);
  }
  return mode;
};
const args = cliArgs(HELP, [
  "--shot N",
  "--sort MODE",
  "--limit N",
  "--done",
  "--cam",
  "--json",
  "--deleted",
]);
let shot = null;
let sort = "written";
let limitArg;
let done = false;
let cam = false;
let json = false;
let archived = false;
const ids = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--done") done = true;
  else if (a === "--cam") cam = true;
  else if (a === "--json") json = true;
  else if (a === "--deleted") archived = true;
  else if (a === "--shot") shot = numberArg("--shot", args[++i], { min: 0, int: true });
  else if (a === "--limit") limitArg = numberArg("--limit", args[++i], { min: 0, int: true });
  else if (a === "--sort") sort = validateSort(args[++i]);
  else if (a.startsWith("-")) {
    console.error(
      `unknown option ${a}: bun run notes [ID ... | --shot N] [--sort MODE] [--limit N] [--done] [--cam] [--json] [--deleted] (--help for more)`,
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
const { notes, deleted } = loadNotes(archived);
let pick;
if (ids.length) {
  // a note by its id or by the #N the list shows
  const byKey = new Map(
    notes.flatMap((n) => [
      [n.id, n],
      ...(n.n === null
        ? []
        : [
            [`#${n.n}`, n],
            [String(n.n), n],
          ]),
    ]),
  );
  if (archived) for (const n of notes) byKey.set(n.id, n);
  const unknown = ids.filter((id) => !byKey.has(id));
  if (unknown.length) {
    const none = [];
    for (const id of unknown) {
      const x = findNote(ROOT, id);
      if (x?.gone && !archived) console.error(deletedSaid(x));
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
  pick = notes.filter((n) => archived || done || isOpen(n));
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
const ordered = pick.toSorted(SORT[sort].cmp);
const hidden = !ids.length && limit > 0 ? ordered.slice(limit) : [];
const shown = hidden.length ? ordered.slice(0, limit) : ordered;
if (!archived) {
  recordNoteReads(ROOT, ids.length || shot !== null ? shown.map((n) => n.id) : [], notes);
}
if (json) {
  const rows = shown.map((n) => {
    const { n: number, t: recordedTime, time: recordedTimecode, cam: camera, ...note } = n;
    return {
      ...note,
      number,
      state: noteState(n),
      recordedTime,
      recordedTimecode,
      ...(camera && (cam || n.freeCam) ? { cam: camera } : {}),
    };
  });
  await Bun.write(Bun.stdout, JSON.stringify({ notes: rows, total: ordered.length }) + "\n");
  process.exit(0);
}
if (archived) {
  const footer = hidden.length ? ` (showing ${shown.length}; use --limit 0 for all)` : "";
  console.log(`${ordered.length} deleted notes${footer}. Restore one: bun run note restore ID`);
  for (const note of shown) console.log(oneLine(note));
  process.exit(0);
}
const lessonConfig = readLessonConfig(ROOT);
const { learnPrompt } = noteLessonFormat({
  root: ROOT,
  dir: LESSONS,
  projectDir: PROJECT_LESSONS,
  config: lessonConfig,
});

const formatDetail = noteDetailFormat({
  root: ROOT,
  dir: LESSONS,
  projectDir: PROJECT_LESSONS,
  config: lessonConfig,
});
const detail = (n, showCam, lessons) => console.log(formatDetail(n, showCam, lessons).join("\n"));

if (shot !== null && !pick.length) {
  const count = shotCount();
  console.log(
    `no ${done ? "" : "open "}notes on shot ${shot}${done ? "" : ` (${notes.filter((n) => n.shot === shot && !isOpen(n)).length} fixed or done there: --done lists them too)`}${count !== null && shot >= count ? `; the film has shots 0-${count - 1}` : ""}`,
  );
}
if (ids.length || shot !== null) {
  // only here, where one note is read in full: the list stays one line a note, and Jev is paid only once a note's words change.
  // A note to remember too, answered or not: its rule joins the file Jev picks
  const lessons = await lessonsFor(
    shown.filter((n) => isOpen(n) || toLearn(n)),
    {
      dir: LESSONS,
      ...(hasProjectLessons ? { projectDir: PROJECT_LESSONS } : {}),
      cache: join(ROOT, "notes/lessons-cache.json"),
      config: lessonConfig,
    },
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
  // the files as the studio's Lessons tab names them (scoped when project lessons are active)
  const pickedPicks = [...lessons.values()].flatMap((l) => l.picks ?? []);
  const picked = [
    ...new Set(
      pickedPicks.map((p) =>
        hasProjectLessons && p.scope && p.rel
          ? `${p.scope}:${p.rel}`
          : relative(LESSONS, join(LESSONS, "..", p.path)).replaceAll("\\", "/"),
      ),
    ),
  ];
  if (picked.length) {
    const pickedNames = [
      ...new Set(
        pickedPicks.map((p) =>
          hasProjectLessons && p.scope && p.rel
            ? `${p.rel} (${p.scope === "film" ? "this film" : "every film"})`
            : relative(LESSONS, join(LESSONS, "..", p.path)).replaceAll("\\", "/"),
        ),
      ),
    ];
    await tell(ROOT, {
      say: `Jev picked the lessons ${pickedNames.join(", ")}`,
      lessons: picked,
      notes: shown.filter((n) => lessons.get(n.id)?.picks?.length).map((n) => n.id),
    });
  }
  const todo = shown.find(isOpen) ?? ordered.find(isOpen),
    learn = shown.find(toLearn) ?? ordered.find(toLearn);
  const hasCheck = ordered.some((n) => noteState(n) === "check");
  console.log(
    todo
      ? `\nnext: where it is heard now and what the film has there, file and row: bun run at ${todo.id}; fix it, capture an after shot (AT=<sec> bun run render stills, or add INSPECT=px,py,pz,lx,ly,lz,fov if the target moved so you shoot a suitable custom view), then bun run note done ${todo.id} "what changed" --after renders/still_<sec>s.jpg [--cam px,py,pz,lx,ly,lz,fov --t <sec>] (or --no-after "<reason>" when non-visual)`
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
