// bun run notes, what the AI reads before acting: notes come in the order the creator wrote them, since a later note
// often builds on or takes back an earlier one, and film order would hide that
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPORT = join(dirname(fileURLToPath(import.meta.url)), "../notes.mjs");
const note = (id, t, at, extra = {}) => ({
  id,
  t,
  at,
  time: `00:${String(t).padStart(2, "0")}.000`,
  shot: 1,
  text: `note at ${t}`,
  ...extra,
});
const film = (notes) => {
  const dir = mkdtempSync(join(tmpdir(), "film-"));
  mkdirSync(join(dir, "notes"));
  writeFileSync(
    join(dir, "notes/notes.jsonl"),
    notes.map((n) => JSON.stringify(n) + "\n").join(""),
  );
  return dir;
};
const report = (dir, ...args) =>
  execFileSync("bun", [REPORT, ...args], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, MC_LESSONS: join(dir, "no-lessons") },
  });
const written = [
  note("a", 5, "2026-11-06T10:00:00Z"),
  note("b", 10, "2026-11-06T10:01:00Z"),
  note("c", 8, "2026-11-06T10:02:00Z"),
];

test("the index lists notes in the order they were written, numbered", () => {
  const lines = report(film(written))
    .split("\n")
    .filter((l) => l.startsWith("#"));
  assert.deepEqual(
    lines.map((l) => l.split(" ").slice(0, 2).join(" ")),
    ["#1 a", "#2 b", "#3 c"],
  );
});

test("a note keeps its number once the notes before it are done", () => {
  const dir = film([{ ...written[0], done: true }, written[1], written[2]]);
  const lines = report(dir)
    .split("\n")
    .filter((l) => l.startsWith("#"));
  assert.deepEqual(
    lines.map((l) => l.split(" ")[0]),
    ["#2", "#3"],
  );
});

test("a note the creator deleted keeps its number: the notes after it never move to another number", () => {
  const dir = film(written.slice(1));
  writeFileSync(join(dir, "notes/deleted.jsonl"), JSON.stringify(written[0]) + "\n");
  const out = report(dir);
  assert.deepEqual(
    out
      .split("\n")
      .filter((l) => l.startsWith("#"))
      .map((l) => l.split(" ").slice(0, 2).join(" ")),
    ["#2 b", "#3 c"],
  );
  assert.match(out, /^2 open notes of 2 \(#N counts the 1 the creator deleted too/m);
  assert.match(report(dir, "#3"), /^## #3 c /m);
  for (const key of ["#1", "a"]) {
    const r = spawnSync("bun", [REPORT, key], { cwd: dir, encoding: "utf8" });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /note #1 \(a\) was deleted by the creator/);
  }
});

test("the index ends on what to do next: the first open note, else a rule to keep, else waiting for the creator", () => {
  const last = (out) => out.trim().split("\n").at(-1);
  assert.match(last(report(film(written))), /^next: bun run notes a /);
  const kept = { state: "check", done: true, fixes: [{ what: "x", at: "t" }] };
  assert.match(
    last(report(film([{ ...written[0], ...kept, remember: { scope: "film", at: "t" } }]))),
    /^next: .*bun run note learned a "the rule, where"/,
  );
  assert.match(last(report(film([{ ...written[0], ...kept }]))), /^next: nothing is yours/);
});

test("a note's line counts what the AI tried apart from what it asked", () => {
  const out = report(
    film([
      {
        ...written[0],
        fixes: [
          { what: "door or wall?", ask: true, at: "t1" },
          { what: "slowed the door", at: "t3" },
        ],
        asks: [{ text: "the door", at: "t2" }],
        state: "check",
        done: true,
      },
    ]),
    "--done",
  );
  assert.match(out, /\[tried 1x, asked 1x, creator answered 1x,/);
});

test("a reopened note says why it is back, and its rounds read in the order they happened, rewordings among them", () => {
  const dir = film([
    {
      ...written[0],
      text: "the door is too fast and too loud",
      fixes: [{ what: "slowed the door", checkpoint: "v1", at: "2026-11-06T11:00:00Z" }],
      edits: [{ was: "the door is too fast", at: "2026-11-06T12:00:00Z" }],
      state: "open",
      done: false,
    },
    {
      ...written[1],
      fixes: [{ what: "sped up", checkpoint: "v1", at: "2026-11-06T11:00:00Z" }],
      asks: [{ text: "still slow", at: "2026-11-06T12:00:00Z" }],
    },
  ]);
  const a = report(dir, "a");
  assert.match(a, /^## #1 a .* \(BACK TO YOU: the creator reworded it after your answer\)$/m);
  assert.ok(
    a.includes("tried: slowed the door (v1)\ncreator reworded it, it was: the door is too fast\n"),
    a,
  );
  assert.match(report(dir, "b"), /^## #2 b .* \(BACK TO YOU: the creator answered\)$/m);
});

test("a rule kept for every film that the creator then narrows to this film is asked to move", () => {
  const out = report(
    film([
      {
        ...written[0],
        learned: { what: "doors swing in 1 s: lessons/doors.md", scope: "all", at: "t1" },
        remember: { scope: "film", at: "t2" },
      },
    ]),
    "a",
  );
  assert.match(out, /changed it to this film after you kept it for every film: move the rule/);
});

test("the narrated word is named only when it is near the note: across a silence the nearest one is far away", () => {
  const voice = (wordAt) => ({
    context: {
      shot: { from: 0, to: 20, into: 10 },
      voice: { word: "door.", wordAt, around: "a heavy steel door.", silence: true },
    },
  });
  const dir = film([
    note("far", 10, "2026-11-06T10:00:00Z", voice(2)),
    note("near", 10, "2026-11-06T10:01:00Z", voice(9.6)),
  ]);
  assert.doesNotMatch(report(dir, "far"), /^word:/m);
  assert.match(report(dir, "near"), /^word: "door\." at 9\.6s/m);
});

test("details come in the order written too, with the number", () => {
  const heads = report(film(written), "c", "a", "b")
    .split("\n")
    .filter((l) => l.startsWith("## "));
  assert.deepEqual(
    heads.map((l) => l.split(" ").slice(1, 3).join(" ")),
    ["#1 a", "#2 b", "#3 c"],
  );
});

test("a note's next step finds where it is heard now by its id, since a Speed edit after it moves its second", () => {
  const next = report(film(written), "b")
    .split("\n")
    .find((l) => l.startsWith("next:"));
  assert.match(next, /bun run at b\b/);
  assert.match(next, /bun run note done b /);
});

test("the index says how many fixed notes wait for the creator, and lists what they asked to be remembered with how to answer", () => {
  const dir = film([
    written[0],
    { ...written[1], state: "check", done: true, fixes: [{ what: "x", at: "t" }] },
    { ...written[2], remember: { scope: "film", at: "t" } },
  ]);
  const out = report(dir);
  assert.match(out, /^#1 a /m);
  assert.doesNotMatch(out, /^#2 b /m, "a note waiting for the creator is not the AI's");
  assert.match(out, /1 more wait for the creator's check/);
  assert.match(out, /remember these:.*bun run note learned ID/);
  assert.match(out, /^\[this film\] #3 c /m);
});

test("a note's detail spells out its tap, drawings, the edit around it, its rounds and, with --cam, its camera", () => {
  const rich = [
    note("n1", 4, "2026-11-06T10:00:00Z", {
      shot: 2,
      shotName: "corridor",
      frame: 120,
      done: true,
      pin: { x: 0.25, y: 0.75, what: "torch", world: [1.5, 2, -3] },
      marks: [
        {
          kind: "path",
          ts: [4, 5],
          pts: [
            [0.1, 0.2],
            [0.4, 0.6],
          ],
          hits: [{ what: "floor", world: [0, 0, 0] }, null],
        },
        {
          kind: "box",
          t: 4,
          pts: [
            [0.8, 0.7],
            [0.2, 0.3],
          ],
          hits: [{ what: "door" }],
        },
        {
          kind: "arrow",
          t: 4,
          pts: [
            [0.1, 0.1],
            [0.9, 0.9],
          ],
          hits: [{ what: "steve" }, { what: "lever" }],
        },
      ],
      range: [3.5, 6],
      cam: { line: "{ t: 4, p: [0, 2, 5] }", warn: "free cam" },
      fixes: [{ what: "raised light", checkpoint: "abc1234" }],
      strip: "notes/img/n1_strip.jpg",
      img: "notes/img/n1.jpg",
      crop: "notes/img/n1_crop.jpg",
      frames: [{ t: 4, img: "notes/img/n1_f0.jpg" }],
    }),
    note("n2", 5, "2026-11-06T10:01:00Z", {
      shot: 3,
      text: "move\n  faster",
      fixes: [{ what: "sped up 20%", checkpoint: "abc1", at: "2026-11-06T11:00:00Z" }],
      asks: [{ text: "still slow, 20% more", at: "2026-11-06T12:00:00Z" }],
      remember: { scope: "all", at: "2026-11-06T12:00:01Z" },
    }),
    note("n3", 6, "2026-11-06T10:02:00Z", {
      shot: 3,
      state: "check",
      done: true,
      fixes: [
        { what: "iron or wooden door?", ask: true, checkpoint: "abc1", at: "2026-11-06T11:00:00Z" },
      ],
    }),
  ];
  const dir = film(rich);
  mkdirSync(join(dir, "renders/live"), { recursive: true });
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "renders/live/voice_map.json"),
    JSON.stringify({
      lines: [
        { s: 1, e: 2, text: "Earlier" },
        { s: 4.5, e: 5.5, text: "Right now" },
        { s: 7, e: 8, text: "After" },
      ],
    }),
  );
  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({
      beats: { open_door: { title: "Open door", at: 4.8, dur: 1.0, sounds: ["creak"] } },
    }),
  );
  const one = report(dir, "n1", "--cam");
  for (const line of [
    'tap: 25% across, 75% down, on "torch", world [1.5, 2, -3]',
    'drawn: path 4s (10%, 20%) on "floor" world [0, 0, 0] -> 5s (40%, 60%) on "?"',
    'drawn: box at 4s: 20-80% across, 30-70% down, middle (50%, 50%) on "door"',
    'drawn: arrow at 4s: tail (10%, 10%) on "steve", head (90%, 90%) on "lever"',
    "next (today's edit): Right now",
    `action (today's edit): open_door "Open door" 4.8s +1s, sounds creak`,
    "tried: raised light (abc1234)",
    "camera: { t: 4, p: [0, 2, 5] } (free cam)",
  ])
    assert.ok(one.includes(line), `n1 --cam lacks: ${line}\n${one}`);
  assert.ok(!report(dir, "n1").includes("camera:"), "the camera only with --cam");
  const two = report(dir, "n2");
  assert.match(two, /^## #2 n2 00:05\.000 shot 3 \(BACK TO YOU: the creator answered\)$/m);
  assert.ok(two.includes("creator answered: still slow, 20% more"));
  assert.ok(two.includes("the creator asked you to remember this (every film)"));
  assert.ok(report(dir, "n3").includes("you asked: iron or wooden door?"));
  assert.match(report(dir, "--done"), /^3 notes of 3,/);
  assert.match(report(dir), /^1 open note of 3,/);
});

test("pictures the creator pasted are named as theirs, apart from the film's own frames", () => {
  const dir = film([
    note("r", 5, "2026-11-06T10:00:00Z", {
      img: "notes/img/r.jpg",
      refs: ["notes/img/r_r0.jpg", "notes/img/r_r1.jpg"],
    }),
  ]);
  assert.match(report(dir), /^#1 r 00:05\.000 shot 1 \[2 reference pictures\] note at 5$/m);
  const one = report(dir, "r");
  assert.ok(
    one.includes(
      `reference 1 (pasted by the creator, not the film): ${dir.replaceAll("\\", "/")}/notes/img/r_r0.jpg`,
    ),
    one,
  );
  assert.ok(one.includes("reference 2 (pasted by the creator, not the film):"), one);
});

test("a note seen through the free camera prints that camera without --cam: the angle is what it is about", () => {
  const cam = { line: "p: [1, 2, 3], l: [0, 0, 0], fov: 40" };
  const dir = film([
    note("f", 4, "2026-11-06T10:00:00Z", { freeCam: true, cam }),
    note("s", 5, "2026-11-06T10:01:00Z", { cam }),
  ]);
  assert.ok(report(dir, "f").includes(`seen through the free camera: ${cam.line}`));
  assert.ok(!report(dir, "s").includes("camera"));
});

test("a note says how the creator heard and saw it when that was not the plain studio", () => {
  const ctx = (extra) => ({ shot: { from: 0, to: 9, into: 4 }, voice: {}, ...extra });
  const dir = film([
    note("m", 4, "2026-11-06T10:00:00Z", {
      context: ctx({ muted: true, view: { phone: true, screen: [412, 915] } }),
    }),
    note("q", 5, "2026-11-06T10:01:00Z", { context: ctx({ volume: 0.25 }) }),
    note("d", 6, "2026-11-06T10:02:00Z", {
      context: ctx({ view: { phone: false, screen: [1920, 1080] } }),
    }),
  ]);
  const m = report(dir, "m");
  assert.ok(m.includes("heard: the studio was MUTED"), m);
  assert.ok(m.includes("seen on a phone, screen 412x915"), m);
  assert.ok(report(dir, "q").includes("heard: the studio at 25% volume"));
  assert.doesNotMatch(report(dir, "d"), /heard:|phone/);
});

test("the ask to remember names the lesson topics there are, so a rule joins its topic's file", () => {
  const dir = film([note("r", 4, "2026-11-06T10:00:00Z", { remember: { scope: "all", at: "t" } })]);
  mkdirSync(join(dir, "lessons/craft"), { recursive: true });
  writeFileSync(join(dir, "lessons/sound.md"), "---\nwhen: sound\n---\n## Doors creak\n");
  writeFileSync(join(dir, "lessons/craft/walk.md"), "---\nwhen: walks\n---\n## Feet lock\n");
  const out = execFileSync("bun", [REPORT], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, MC_LESSONS: join(dir, "lessons") },
  });
  assert.match(out, /topics now: craft\/walk, sound;/);
});

test("a note answered and waiting, that the creator asked to remember, still names the lesson file its rule may join", async () => {
  const { lessonsFor } = await import("../src/lessons.mjs");
  const dir = film([
    note("a", 4, "2026-11-06T10:00:00Z", {
      text: "tay lệch",
      state: "check",
      done: true,
      fixes: [{ what: "x", at: "t" }],
      remember: { scope: "all", at: "t" },
    }),
  ]);
  const lessons = join(dir, "lessons");
  mkdirSync(lessons);
  writeFileSync(join(lessons, "hands.md"), "# Hands\n\n## Grip\n");
  await lessonsFor([{ id: "a", text: "tay lệch" }], {
    dir: lessons,
    cache: join(dir, "notes/lessons-cache.json"),
    judge: (_, pool) => Promise.resolve(pool.map((x) => [1, x, 0.9])),
  });
  const out = execFileSync("bun", [REPORT, "a"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, MC_LESSONS: lessons },
  });
  assert.ok(out.includes("lesson: lessons/hands.md, its headings by line:"), out);
});

test("a note in full names the lesson files Jev picked with every heading's line, marks the unsure, and says when none fits", async () => {
  const { lessonsFor } = await import("../src/lessons.mjs");
  const dir = film([
    note("a", 4, "2026-11-06T10:00:00Z", { text: "tay lệch" }),
    note("b", 5, "2026-11-06T10:01:00Z", { text: "đẹp rồi" }),
  ]);
  const lessons = join(dir, "lessons");
  mkdirSync(lessons);
  writeFileSync(
    join(lessons, "hands.md"),
    "# Hands\n\n## Grip\nwhy\n\n## Fingers stay on the prop\nwhy\nmore\n",
  );
  writeFileSync(join(lessons, "free.md"), "tay cầm đồ phải bám theo rig\n");
  const fits = { "lessons/hands.md": 0.9, "lessons/free.md": 0.5 };
  const judge = (text, pool, show) =>
    Promise.resolve(
      pool
        .map((x) => [text === "tay lệch" ? (fits[x.path] ?? 0) : 0, x])
        .sort((p, q) => q[0] - p[0])
        .map(([p, x], i) => (i < show ? [p, x, p] : [p, x])),
    );
  await lessonsFor(
    [
      { id: "a", text: "tay lệch" },
      { id: "b", text: "đẹp rồi" },
    ],
    {
      dir: lessons,
      cache: join(dir, "notes/lessons-cache.json"),
      judge,
    },
  );
  const out = (id) =>
    execFileSync("bun", [REPORT, id], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, MC_LESSONS: lessons },
    });
  const a = out("a");
  assert.ok(
    a.includes(
      "lesson: lessons/hands.md, its headings by line:\n  1 # Hands\n  3 ## Grip\n  6 ## Fingers stay on the prop\nlesson (maybe): lessons/free.md\n",
    ),
    a,
  );
  assert.ok(
    a.includes("only the file name and headings by line") &&
      a.includes("read those files directly"),
    a,
  );
  assert.ok(out("b").includes("lessons: Jev says none fits this note (all in lessons/)"));
});

test("the index caps at 25 notes by default and summarizes hidden notes by reply and shot", () => {
  const iso = (i) => `2026-11-06T10:${String(i).padStart(2, "0")}:00Z`;
  const list = Array.from({ length: 28 }, (_, i) => {
    const id = `n${String(i + 1).padStart(2, "0")}`;
    const shot = i < 25 ? 1 : i === 25 ? 3 : 4;
    const extra =
      i === 25
        ? {
            fixes: [{ what: "tried", checkpoint: "a", at: "2026-11-06T11:00:00Z" }],
            asks: [{ text: "still off", at: "2026-11-06T12:00:00Z" }],
          }
        : {};
    return note(id, i + 1, iso(i), { shot, ...extra });
  });
  const dir = film(list);

  const def = report(dir);
  assert.match(def, /^28 open notes of 28, in the order written \(showing 25; 1 back to you\)\./);
  assert.match(def, /^#25 n25 /m);
  assert.doesNotMatch(def, /^#26 n26 /m);
  assert.match(
    def,
    /\.\.\. 3 more open notes hidden \(1 back to you: #26; in shot 4 \(2\), shot 3 \(1\)\) — all: bun run notes --limit 0 \| creator replies first: bun run notes --sort back \| one shot: bun run notes --shot N/,
  );
});

test("--limit N caps printed lines, --limit 0 prints all, and overflow hints preserve active flags", () => {
  const iso = (i) => `2026-11-06T10:${String(i).padStart(2, "0")}:00Z`;
  const dir = film(
    Array.from({ length: 5 }, (_, i) =>
      note(`n${i + 1}`, i + 1, iso(i), {
        shot: i + 1,
        ...(i === 4 ? { fixes: [{ what: "fixed", checkpoint: "a", at: "t" }] } : {}),
      }),
    ),
  );

  const few = report(dir, "--limit", "2");
  assert.match(few, /\(showing 2; 1 back to you\)/);
  assert.match(few, /^#2 n2 /m);
  assert.doesNotMatch(few, /^#3 n3 /m);
  assert.match(few, /\.\.\. 3 more open notes hidden /);

  const all = report(dir, "--limit", "0");
  assert.doesNotMatch(all, /\bhidden\b/);
  assert.match(all, /^#5 n5 /m);

  const kept = report(dir, "--done", "--sort", "film", "--limit", "2");
  assert.match(
    kept,
    /all: bun run notes --done --sort film --limit 0 \| creator replies first: bun run notes --done --sort back \| one shot: bun run notes --done --sort film --shot N/,
  );
});

test("overflow hints adapt to >3 back-to-you replies, >4 hidden shots, and --sort back", () => {
  const iso = (i) => `2026-11-06T10:${String(i).padStart(2, "0")}:00Z`;
  const replies = { fixes: [{ what: "fixed", checkpoint: "a", at: "2026-11-06T11:00:00Z" }] };
  const dir = film([
    note("v1", 1, iso(0), { shot: 1 }),
    note("h1", 2, iso(1), { shot: 2, ...replies }),
    note("h2", 3, iso(2), { shot: 3, ...replies }),
    note("h3", 4, iso(3), { shot: 4, ...replies }),
    note("h4", 5, iso(4), { shot: 5, ...replies }),
    note("h5", 6, iso(5), { shot: 6 }),
  ]);

  const truncated = report(dir, "--limit", "1");
  assert.match(truncated, /\(4 back to you: #2, #3, #4, …; in .*, \+1 more shot\)/);

  const byBack = report(dir, "--sort", "back", "--limit", "1");
  assert.match(
    byBack,
    /\(3 back to you: #3, #4, #5; in .*, \+1 more shot\) — all: bun run notes --sort back --limit 0 \| one shot:/,
  );
  assert.doesNotMatch(byBack, /creator replies first:/);
});

test("--shot N also honors --limit and prints hidden shot count cleanly", () => {
  const iso = (i) => `2026-11-06T10:${String(i).padStart(2, "0")}:00Z`;
  const dir = film([note("s1", 1, iso(0), { shot: 4 }), note("s2", 2, iso(1), { shot: 4 })]);
  const shotCap = report(dir, "--shot", "4", "--limit", "1");
  assert.match(shotCap, /^## #1 s1 /m);
  assert.doesNotMatch(shotCap, /^## #2 s2 /m);
  assert.match(
    shotCap,
    /\.\.\. 1 more open note hidden on shot 4 — all: bun run notes --shot 4 --limit 0/,
  );
});

test("index lines flag reopened states clearly and truncate long text without clipping detail", () => {
  const longText = `${"x".repeat(118)}🔥 tail`;
  const dir = film([
    note("pln", 3, "2026-11-06T10:00:00Z", {
      fixes: [{ what: "nudged", checkpoint: "a", at: "2026-11-06T11:00:00Z" }],
    }),
    note("ans", 4, "2026-11-06T10:01:00Z", {
      fixes: [{ what: "nudged", checkpoint: "a", at: "2026-11-06T11:00:00Z" }],
      asks: [{ text: "more", at: "2026-11-06T12:00:00Z" }],
    }),
    note("rew", 5, "2026-11-06T10:02:00Z", {
      text: "better framing please",
      fixes: [{ what: "widened", checkpoint: "b", at: "2026-11-06T11:00:00Z" }],
      edits: [{ was: "framing please", at: "2026-11-06T12:00:00Z" }],
    }),
    note("lng", 6, "2026-11-06T10:03:00Z", { text: longText }),
  ]);

  const out = report(dir);
  assert.match(out, /^#1 pln .* \[tried 1x, back to you\] /m);
  assert.match(out, /^#2 ans .* \[tried 1x, creator answered 1x, back to you\] /m);
  assert.match(out, /^#3 rew .* \[tried 1x, back to you: reworded\] /m);
  assert.ok(out.includes(`${"x".repeat(118)}🔥…`), out);
  assert.ok(!out.includes(longText), "index should truncate long text");
  assert.ok(report(dir, "lng").includes(`NOTE: ${longText}`), "detail must keep full text");
});

test("--sort reorders list output across written, back, film, and newest", () => {
  const dir = film([
    note("a", 30, "2026-11-06T10:00:00Z"),
    note("b", 10, "2026-11-06T10:01:00Z"),
    note("c", 20, "2026-11-06T10:02:00Z", {
      fixes: [{ what: "fixed", checkpoint: "a", at: "2026-11-06T11:00:00Z" }],
      asks: [{ text: "still off", at: "2026-11-06T12:00:00Z" }],
    }),
    note("d", 5, "2026-11-06T10:03:00Z", { state: "done", done: true }),
  ]);
  const ids = (txt) => [...txt.matchAll(/^#\d+ (\w+) /gm)].map((m) => m[1]);

  const backOut = report(dir, "--sort", "back");
  assert.deepEqual(ids(backOut), ["c", "a", "b"]);
  assert.match(backOut.trim().split("\n").at(-1), /^next: bun run notes c /);

  assert.deepEqual(ids(report(dir, "--sort", "back", "--done")), ["c", "a", "b", "d"]);

  const filmOut = report(dir, "--sort", "film");
  assert.deepEqual(ids(filmOut), ["b", "c", "a"]);
  assert.match(filmOut.trim().split("\n").at(-1), /^next: bun run notes b /);

  assert.deepEqual(ids(report(dir, "--sort", "newest")), ["c", "b", "a"]);
  assert.deepEqual(ids(report(dir, "--sort", "written")), ["a", "b", "c"]);
});

test("--sort reorders explicit IDs in detail mode, and done detail ends cleanly", () => {
  const dir = film([
    note("a", 30, "2026-11-06T10:00:00Z"),
    note("c", 20, "2026-11-06T10:01:00Z"),
    note("d", 5, "2026-11-06T10:02:00Z", { state: "done", done: true }),
  ]);
  const detFilm = report(dir, "a", "c", "--sort", "film");
  assert.ok(detFilm.indexOf("## #2 c ") < detFilm.indexOf("## #1 a "), detFilm);

  const detDone = report(dir, "d");
  assert.match(
    detDone.trim().split("\n").at(-1),
    /^next: these notes are done; the open notes: bun run notes$/,
  );
});

test("invalid or conflicting flags exit 2 before touching film files, and --help prints usage", () => {
  for (const [args, want] of [
    [["--sort", "priority"], /unknown --sort "priority": expected written, back, film, newest/],
    [["--sort", "-1"], /unknown --sort "-1": expected written, back, film, newest/],
    [["--limit", "-1"], /--limit/],
    [["--limit", "abc"], /--limit/],
    [["--limit", "1.5"], /--limit/],
    [["--shot", "abc"], /--shot/],
    [["--shot", "-1"], /--shot/],
    [["-1"], /unknown option -1:/],
    [["a", "--shot", "1"], /give note IDs or --shot N, not both/],
    [["a", "--limit", "1"], /give note IDs or --limit N, not both/],
  ]) {
    const r = spawnSync("bun", [REPORT, ...args], { cwd: tmpdir(), encoding: "utf8" });
    assert.equal(r.status, 2, `${args.join(" ")} -> ${r.status}: ${r.stderr}`);
    assert.match(r.stderr, want);
  }
  const help = spawnSync("bun", [REPORT, "--help"], { cwd: tmpdir(), encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--sort.*--limit/s);
});
