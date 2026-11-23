import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { lessonsFor, lessonTopics } from "../src/lessons.mjs";

const lessons = (files) => {
  const root = mkdtempSync(join(tmpdir(), "repo-")),
    dir = join(root, "lessons");
  mkdirSync(dir);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return { dir, cache: join(root, "cache.json") };
};
const HANDS =
  "# Hands\n\n## Hands holding a prop follow the carry rig\nwhy\n\n## Fingers stay on the prop\nwhy\n";
const CUTS = "# Cuts\n\n## Transitions under 0.4 s, ease-out\nwhy\n";
const note = (id, text) => ({ id, text });
const judgeBy =
  (fits, calls = []) =>
  (text, pool, show) => {
    calls.push(text);
    const fit = (x) => fits[x.path] ?? 0;
    const voted = pool.map((x) => [fit(x), x]).sort((a, b) => b[0] - a[0]);
    return Promise.resolve(voted.map(([p, x], i) => (i < show ? [p, x, fit(x)] : [p, x])));
  };

test("a note gets the lesson files Jev says it needs, best first, sure or maybe, each with its headings and their lines", async () => {
  const { dir, cache } = lessons({
    "hands.md": HANDS,
    "cuts.md": CUTS,
    "sound.md": "# Sound\n\n## Doors\n",
  });
  const judge = judgeBy({
    "lessons/hands.md": 0.9,
    "lessons/cuts.md": 0.5,
    "lessons/sound.md": 0.1,
  });
  const got = await lessonsFor([note("a", "tay lệch, transition nhanh hơn")], {
    dir,
    cache,
    judge,
  });
  assert.deepEqual(got.get("a"), {
    picks: [
      {
        path: "lessons/hands.md",
        sure: true,
        heads: [
          { line: 1, head: "# Hands" },
          { line: 3, head: "## Hands holding a prop follow the carry rig" },
          { line: 6, head: "## Fingers stay on the prop" },
        ],
      },
      {
        path: "lessons/cuts.md",
        sure: false,
        heads: [
          { line: 1, head: "# Cuts" },
          { line: 3, head: "## Transitions under 0.4 s, ease-out" },
        ],
      },
    ],
  });
  const none = await lessonsFor([note("b", "đẹp")], { dir, cache, judge: judgeBy({}) });
  assert.deepEqual(none.get("b"), { picks: [] });
});

test("Jev reads each file's path, frontmatter and every heading, never the words under them", async () => {
  const { dir, cache } = lessons({
    "hands.md": HANDS,
    "free.md": "tay cầm đồ\n\n  phải bám   theo rig\n",
    "cam.md":
      "---\r\nwhen: camera   moves\r\n---\r\n# Camera\r\nbody\r\n```sh\r\n# not a heading\r\n```\r\n  ### No roll ###\r\n#nospace\r\n",
  });
  let seen;
  await lessonsFor([note("a", "x")], {
    dir,
    cache,
    judge: (_, pool) => ((seen = pool.map((x) => x.jev)), Promise.resolve([])),
  });
  assert.deepEqual(seen, [
    "lessons/cam.md: when: camera moves | # Camera ### No roll ###",
    "lessons/free.md",
    "lessons/hands.md: # Hands ## Hands holding a prop follow the carry rig ## Fingers stay on the prop",
  ]);
});

test("a change under a heading asks Jev nothing again and the heading lines follow the file; a heading's change asks again", async () => {
  const { dir, cache } = lessons({ "hands.md": HANDS });
  const calls = [],
    judge = judgeBy({ "lessons/hands.md": 0.9 }, calls);
  await lessonsFor([note("a", "tay lệch")], { dir, cache, judge });
  writeFileSync(join(dir, "hands.md"), HANDS.replace("why", "because\nthe rig says so"));
  const moved = await lessonsFor([note("a", "tay lệch")], { dir, cache, judge });
  assert.equal(calls.length, 1);
  assert.equal(moved.get("a").picks[0].heads[2].line, 7);
  writeFileSync(join(dir, "hands.md"), `${HANDS}\n## Knuckles face out\n`);
  await lessonsFor([note("a", "tay lệch")], { dir, cache, judge });
  assert.equal(calls.length, 2);
});

test("Jev reads the creator's answers on a note too, and asks again when a new one comes", async () => {
  const { dir, cache } = lessons({ "hands.md": HANDS });
  const calls = [],
    judge = judgeBy({}, calls),
    door = note("a", "the door is too fast");
  await lessonsFor([door], { dir, cache, judge });
  await lessonsFor([{ ...door, asks: [{ text: "and the hinge squeak is missing", at: "t" }] }], {
    dir,
    cache,
    judge,
  });
  assert.deepEqual(calls, [
    "the door is too fast",
    "the door is too fast\nand the hinge squeak is missing",
  ]);
});

test("a cache entry kept in an older shape is asked again, never read as picks", async () => {
  const { dir, cache } = lessons({ "hands.md": HANDS });
  const calls = [],
    judge = judgeBy({ "lessons/hands.md": 0.9 }, calls);
  await lessonsFor([note("a", "tay lệch")], { dir, cache, judge });
  const kept = JSON.parse(readFileSync(cache, "utf8"));
  writeFileSync(cache, JSON.stringify({ a: { key: kept.a.key, paths: ["lessons/hands.md"] } }));
  const again = await lessonsFor([note("a", "tay lệch")], { dir, cache, judge });
  assert.deepEqual(
    again.get("a").picks.map((p) => p.path),
    ["lessons/hands.md"],
  );
  assert.equal(calls.length, 2);
});

test("a note read again asks Jev nothing until its words or the lessons change", async () => {
  const { dir, cache } = lessons({ "hands.md": HANDS });
  const calls = [],
    judge = judgeBy({ "lessons/hands.md": 0.9 }, calls);
  await lessonsFor([note("a", "tay lệch")], { dir, cache, judge });
  const again = await lessonsFor([note("a", "tay lệch")], { dir, cache, judge });
  assert.deepEqual(
    again.get("a").picks.map((p) => p.path),
    ["lessons/hands.md"],
  );
  assert.equal(calls.length, 1);
  await lessonsFor([note("a", "tay lệch quá")], { dir, cache, judge });
  assert.equal(calls.length, 2);
  writeFileSync(join(dir, "cuts.md"), CUTS);
  await lessonsFor([note("a", "tay lệch quá")], { dir, cache, judge });
  assert.equal(calls.length, 3);
});

test("Jev failing says why, keeps nothing, and asks again next time", async () => {
  const { dir, cache } = lessons({ "hands.md": HANDS });
  const fail = () =>
    Promise.reject(new Error("Jev: no key: OPENCODE_API_KEY in ~/.secrets/opencode_zen.env"));
  const got = await lessonsFor([note("a", "x")], { dir, cache, judge: fail });
  assert.deepEqual(got.get("a"), {
    why: "Jev: no key: OPENCODE_API_KEY in ~/.secrets/opencode_zen.env",
  });
  const calls = [];
  await lessonsFor([note("a", "x")], { dir, cache, judge: judgeBy({}, calls) });
  assert.equal(calls.length, 1);
});

test("no lesson files yet: nothing to say and no Jev call", async () => {
  const { dir, cache } = lessons({});
  const calls = [];
  const got = await lessonsFor([note("a", "x")], { dir, cache, judge: judgeBy({}, calls) });
  assert.equal(got.size, 0);
  assert.equal(calls.length, 0);
  assert.equal((await lessonsFor([note("a", "x")], { dir: join(dir, "none"), cache })).size, 0);
});

test("lessonsFor evaluates both project and global lessons together without colliding on identical paths", async () => {
  const root = mkdtempSync(join(tmpdir(), "lessons-dual-"));
  const globalDir = join(root, "lessons");
  const projectDir = join(root, "films/cell-break/lessons");
  mkdirSync(globalDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    join(globalDir, "camera.md"),
    "---\nwhen: camera\n---\n# Global Camera\n## Never roll\n",
  );
  writeFileSync(join(globalDir, "hands.md"), "---\nwhen: hands\n---\n# Hands\n## Match grip\n");
  writeFileSync(
    join(projectDir, "camera.md"),
    "---\nwhen: camera\n---\n# Film Camera\n## Cut on landing\n",
  );
  writeFileSync(
    join(projectDir, "lighting.md"),
    "---\nwhen: shadows\n---\n# Cell Shadows\n## Keep warm torch\n",
  );

  const cache = join(root, "cache.json");
  const calls = [];
  const judge = async (words, pool, show) => {
    calls.push({
      words,
      show,
      pool: pool.map((x) => ({ scope: x.scope, rel: x.rel, jev: x.jev })),
    });
    return pool
      .map((x) => {
        if (x.scope === "film" && x.rel === "camera.md") return [0.9, x, 1.0];
        if (x.scope === "all" && x.rel === "camera.md") return [0.6, x, 0.5];
        if (x.scope === "film" && x.rel === "lighting.md") return [0.8, x, 0.9];
        return [0.1, x, 0.1];
      })
      .sort((a, b) => b[0] - a[0]);
  };

  const got = await lessonsFor([note("a", "shot 3 camera light")], {
    dir: globalDir,
    projectDir,
    cache,
    judge,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].pool.length, 4);
  const filmCamJev = calls[0].pool.find((x) => x.scope === "film" && x.rel === "camera.md")?.jev;
  const allCamJev = calls[0].pool.find((x) => x.scope === "all" && x.rel === "camera.md")?.jev;
  assert.notEqual(filmCamJev, allCamJev);
  assert.deepEqual(
    got.get("a")?.picks.map((p) => [p.scope, p.rel, p.sure, p.file, p.heads.map((h) => h.head)]),
    [
      [
        "film",
        "camera.md",
        true,
        join(projectDir, "camera.md"),
        ["# Film Camera", "## Cut on landing"],
      ],
      [
        "film",
        "lighting.md",
        true,
        join(projectDir, "lighting.md"),
        ["# Cell Shadows", "## Keep warm torch"],
      ],
      [
        "all",
        "camera.md",
        false,
        join(globalDir, "camera.md"),
        ["# Global Camera", "## Never roll"],
      ],
    ],
  );

  writeFileSync(
    join(projectDir, "camera.md"),
    "---\nwhen: camera\n---\n# Film Camera\n## Cut on landing\nBody details only.\n",
  );
  const cached = await lessonsFor([note("a", "shot 3 camera light")], {
    dir: globalDir,
    projectDir,
    cache,
    judge,
  });
  assert.equal(calls.length, 1);
  assert.equal(cached.get("a")?.picks.length, 3);

  writeFileSync(
    join(projectDir, "camera.md"),
    "---\nwhen: camera\n---\n# Film Camera\n## Hold 12 frames on landing\n",
  );
  const refreshed = await lessonsFor([note("a", "shot 3 camera light")], {
    dir: globalDir,
    projectDir,
    cache,
    judge,
  });
  assert.equal(calls.length, 2);
  assert.equal(refreshed.get("a")?.picks[0].heads[1].head, "## Hold 12 frames on landing");
});

test("lessonsFor deduplicates when projectDir equals dir and ignores missing projectDir", async () => {
  const { dir, cache } = lessons({ "hands.md": HANDS });
  const calls = [];
  const same = await lessonsFor([note("a", "tay")], {
    dir,
    projectDir: dir,
    cache,
    judge: judgeBy({ "lessons/hands.md": 0.9 }, calls),
  });
  assert.equal(calls.length, 1);
  assert.equal(same.get("a")?.picks.length, 1);

  const missingProj = await lessonsFor([note("b", "tay")], {
    dir,
    projectDir: join(dir, "..", "does-not-exist"),
    cache,
    judge: async (_, pool) => pool.map((x) => [0.9, x, 1.0]),
  });
  assert.equal(missingProj.get("b")?.picks.length, 1);
  assert.equal(missingProj.get("b")?.picks[0].scope, "all");
});

test("lessonsFor and lessonTopics recurse into nested subfolders across both scopes and skip hidden dot folders", async () => {
  const root = mkdtempSync(join(tmpdir(), "nested-lessons-"));
  const globalDir = join(root, "lessons");
  const projectDir = join(root, "films/cell-break/lessons");
  mkdirSync(join(globalDir, "sound/foley"), { recursive: true });
  mkdirSync(join(globalDir, ".obsidian"), { recursive: true });
  mkdirSync(join(projectDir, "craft/camera"), { recursive: true });
  mkdirSync(join(projectDir, ".git"), { recursive: true });

  writeFileSync(
    join(globalDir, "sound/foley/steps.md"),
    "---\nwhen: footsteps\n---\n# Footsteps\n\n## Match block surface\n",
  );
  writeFileSync(join(globalDir, ".obsidian/workspace.md"), "# Hidden\n");
  writeFileSync(
    join(projectDir, "craft/camera/handheld.md"),
    "---\nwhen: handheld shot\n---\n# Handheld\n\n## Dampen micro jitter\n",
  );
  writeFileSync(join(projectDir, ".git/ignored.md"), "# Ignored\n");

  assert.deepEqual(lessonTopics(globalDir), ["sound/foley/steps"]);
  assert.deepEqual(lessonTopics(projectDir), ["craft/camera/handheld"]);

  const seenPaths = [];
  const got = await lessonsFor([note("n1", "handheld shot footsteps")], {
    dir: globalDir,
    projectDir,
    cache: join(root, "cache.json"),
    judge: async (_, pool) => {
      seenPaths.push(...pool.map((x) => `${x.scope}:${x.rel}:${x.path}`));
      return pool.map((x) => [0.95, x, 1.0]);
    },
  });

  assert.deepEqual(seenPaths, [
    "film:craft/camera/handheld.md:lessons/craft/camera/handheld.md",
    "all:sound/foley/steps.md:lessons/sound/foley/steps.md",
  ]);
  assert.deepEqual(
    got.get("n1")?.picks.map((p) => [p.scope, p.rel, p.file]),
    [
      ["film", "craft/camera/handheld.md", join(projectDir, "craft/camera/handheld.md")],
      ["all", "sound/foley/steps.md", join(globalDir, "sound/foley/steps.md")],
    ],
  );
});

test("lessonsFor runs uncached note lookups concurrently with bounded pool, deduplicates identical queries, preserves order, and isolates failures", async () => {
  const { dir, cache } = lessons({ "hands.md": HANDS, "cuts.md": CUTS });
  const input = [
    note("n1", "alpha"),
    note("n2", "beta"),
    note("n3", "fail-me"),
    note("n4", "gamma"),
    note("n5", "alpha"),
    note("n6", "delta"),
    note("n7", "epsilon"),
  ];
  let inFlight = 0;
  let maxInFlight = 0;
  const called = [];
  const gates = new Map();
  let releaseFirstWave;
  const firstWaveReady = new Promise((r) => {
    releaseFirstWave = r;
  });

  const judge = async (words, pool) => {
    called.push(words);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    if (inFlight === 4) releaseFirstWave();
    await new Promise((r) => {
      const timer = setTimeout(
        r,
        inFlight >= 4 || words === "delta" || words === "epsilon" ? 15 : 150,
      );
      gates.set(words, () => {
        clearTimeout(timer);
        r();
      });
    });
    inFlight--;
    if (words === "fail-me") throw new Error("jev unreachable");
    return pool.map((x) => [0.9, x, x.path === "lessons/hands.md" ? 0.95 : 0.1]);
  };

  const runPromise = lessonsFor(input, { dir, cache, judge, concurrency: 4 });
  let waitTimer;
  await Promise.race([
    firstWaveReady,
    new Promise((r) => {
      waitTimer = setTimeout(r, 500);
    }),
  ]);
  clearTimeout(waitTimer);
  for (const r of [...gates.values()].reverse()) r();
  const got = await runPromise;

  assert.equal(maxInFlight, 4, `expected 4 concurrent Jev lookups, saw ${maxInFlight}`);
  assert.equal(called.length, 6, "duplicate text note n5 must share n1 judge call");
  assert.deepEqual([...got.keys()], ["n1", "n2", "n3", "n4", "n5", "n6", "n7"]);
  assert.deepEqual(got.get("n3"), { why: "jev unreachable" });
  assert.equal(got.get("n1")?.picks?.[0]?.path, "lessons/hands.md");
  assert.equal(got.get("n5")?.picks?.[0]?.path, "lessons/hands.md");
  const saved = JSON.parse(readFileSync(cache, "utf8"));
  assert.equal(Object.keys(saved).length, 6);
  assert.equal(saved.n3, undefined);
});

test("notes CLI --no-lessons skips Jev lookup in text mode while printing full note detail", () => {
  const notesCli = join(dirname(fileURLToPath(import.meta.url)), "../notes.mjs");
  const root = mkdtempSync(join(tmpdir(), "notes-nolessons-"));
  try {
    mkdirSync(join(root, "notes"), { recursive: true });
    mkdirSync(join(root, "lessons"), { recursive: true });
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src/scene.ts"), "export const DURATION = 10;\n");
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "tmp-film", "live-studio": {} }),
    );
    writeFileSync(join(root, "lessons/hands.md"), HANDS);
    writeFileSync(
      join(root, "notes/notes.jsonl"),
      `${JSON.stringify({ id: "n1", n: 1, t: 2, time: "0:02.0", shot: 0, text: "hands clip desk", at: "2026-11-20T00:00:00Z" })}\n`,
    );
    writeFileSync(join(root, "notes/lessons-config.json"), JSON.stringify({ enabled: false }));
    const cleanEnv = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => k.toUpperCase() !== "LIVE_PROJECT"),
    );
    const withLessons = spawnSync(process.execPath, [notesCli, "n1"], {
      cwd: root,
      env: cleanEnv,
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
    });
    assert.equal(withLessons.status, 0, withLessons.stderr);
    assert.match(withLessons.stdout, /Jev disabled/);

    const withoutLessons = spawnSync(process.execPath, [notesCli, "n1", "--no-lessons"], {
      cwd: root,
      env: cleanEnv,
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
    });
    assert.equal(withoutLessons.status, 0, withoutLessons.stderr);
    assert.match(withoutLessons.stdout, /hands clip desk/);
    assert.doesNotMatch(withoutLessons.stdout, /Jev disabled|lessons:/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
