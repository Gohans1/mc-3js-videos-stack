import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { DEFAULT_LESSON_JEV_CONFIG, LessonJevConfigSchema } from "../src/lesson-config";
import { inspectLessons } from "../src/lesson-inspector.mjs";
import { lessonsFor } from "../src/lessons.mjs";

test("rejects tournament settings that cannot converge and inverted fit thresholds", () => {
  expect(LessonJevConfigSchema.safeParse({ heat: 8, keep: 8 }).success).toBe(false);
  expect(LessonJevConfigSchema.safeParse({ fitNo: 0.8, fitYes: 0.2 }).success).toBe(false);
});

test("dry inspection uses draft headings and replies, never judges or changes lessons", async () => {
  const root = mkdtempSync(join(tmpdir(), "lesson-inspect-"));
  try {
    const dir = join(root, "lessons");
    mkdirSync(dir);
    writeFileSync(join(dir, "camera.md"), "# Old\nbody secret");
    const result = await inspectLessons(
      {
        note: { text: "camera", asks: [{ text: "closer" }] },
        drafts: [{ scope: "all", path: "camera.md", text: "# New\ndraft body" }],
      },
      {
        dir,
        root,
        judge: () => {
          throw new Error("dry called judge");
        },
      },
    );
    expect(result.pool[0].jev).toContain("# New");
    expect(JSON.stringify(result.requests)).toContain("closer");
    expect(JSON.stringify(result.requests)).not.toContain("draft body");
    expect(result.status).toBe("dry");
    expect(result.learnPrompt).toContain("in headings mode");
    expect(result.learnPrompt).toEndWith('bun run note learned <note-id> "the rule, where"');
    expect(readFileSync(join(dir, "camera.md"), "utf8")).toContain("# Old");
    expect(DEFAULT_LESSON_JEV_CONFIG.wordsLimit).toBe(2000);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("live results are cached, reused offline, and refresh heading lines without paying again", async () => {
  const root = mkdtempSync(join(tmpdir(), "lesson-cache-"));
  try {
    const dir = join(root, "lessons");
    mkdirSync(dir);
    const file = join(dir, "camera.md");
    writeFileSync(file, "# Camera\n");
    let calls = 0;
    const judge = async (_words, pool) => {
      calls++;
      return [[1, pool[0], 0.8]];
    };
    const input = { note: { text: "closer" }, runJev: true };
    const result = await inspectLessons(input, { root, dir, judge });
    expect(result.status).toBe("live");
    writeFileSync(file, "body\n# Camera\n");
    const again = await inspectLessons(
      { ...input, config: { sectionLabel: "rule" } },
      { root, dir, judge },
    );
    expect(calls).toBe(1);
    expect(again.output).toContain("rule: lessons/camera.md");
    expect(again.output).toContain("2 # Camera");
    const cli = await lessonsFor([{ id: "a", text: "closer" }], {
      dir,
      cache: join(root, "notes/lessons-cache.json"),
      judge: () => {
        throw new Error("should reuse inspector cache");
      },
    });
    expect(cli.get("a").picks[0].heads[0].line).toBe(2);
    await inspectLessons({ ...input, note: { text: "different" } }, { root, dir, judge });
    expect(calls).toBe(2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("inspection rejects traversal and truthy strings before any work", async () => {
  const options = { root: tmpdir() };
  await expect(
    inspectLessons(
      { note: { text: "x" }, drafts: [{ scope: "all", path: "../secret.md", text: "x" }] },
      options,
    ),
  ).rejects.toThrow();
  await expect(inspectLessons({ note: { text: "x" }, runJev: "true" }, options)).rejects.toThrow();
});

test("output templates customize selected files, headings and the no-run message", async () => {
  const root = mkdtempSync(join(tmpdir(), "lesson-format-"));
  try {
    const dir = join(root, "lessons");
    mkdirSync(dir);
    writeFileSync(join(dir, "camera.md"), "# Camera");
    const config = {
      fileTemplate: "FILE {path}",
      headingTemplate: "HEAD {head}",
      errorTemplate: "WAIT {why}",
      footer: "",
    };
    const input = { note: { text: "camera" }, config };
    const options = { root, dir, judge: async (_words, pool) => [[1, pool[0], 1]] };
    expect((await inspectLessons(input, options)).output).toStartWith("WAIT dry simulation");
    expect((await inspectLessons({ ...input, runJev: true }, options)).output).toBe(
      "FILE lessons/camera.md\nHEAD # Camera",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("full note preview is verbatim CLI detail and a valid CLI cache prevents live calls", async () => {
  const root = mkdtempSync(join(tmpdir(), "lesson-cli-"));
  try {
    const dir = join(root, "lessons");
    mkdirSync(dir);
    mkdirSync(join(root, "notes"));
    writeFileSync(join(dir, "camera.md"), "# Camera\n");
    const note = {
      id: "a",
      at: "2026-01-01T01:00:00Z",
      t: 0,
      shot: 0,
      time: "00:00.000",
      text: "closer",
      asks: [{ text: "please", at: "2026-01-01" }],
    };
    const previous = { ...note, id: "previous", at: "2026-01-01T00:00:00Z" };
    writeFileSync(
      join(root, "notes/notes.jsonl"),
      [previous, note].map((n) => JSON.stringify(n)).join("\n") + "\n",
    );
    await lessonsFor([note], {
      dir,
      cache: join(root, "notes/lessons-cache.json"),
      judge: async (_words, pool) => [[1, pool[0], 0.8]],
    });
    const result = await inspectLessons(
      { note: { id: note.id, text: note.text, asks: note.asks }, runJev: true },
      {
        root,
        dir,
        notes: [note],
        judge: () => {
          throw new Error("cache should avoid live");
        },
      },
    );
    expect(result.status).toBe("cached");
    const cli = execFileSync("bun", [resolve(import.meta.dir, "../notes.mjs"), "a"], {
      cwd: root,
      encoding: "utf8",
      timeout: 10000,
      env: { ...process.env, MC_LESSONS: dir },
    });
    expect(cli).toContain(result.noteOutput);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Inspector evicts least recently run entry at 100 and leaves Markdown intact", async () => {
  const root = mkdtempSync(join(tmpdir(), "lesson-lru-"));
  try {
    const dir = join(root, "lessons");
    mkdirSync(dir);
    writeFileSync(join(dir, "camera.md"), "# Camera");
    const options = { root, dir, judge: async (_words, pool) => [[1, pool[0], 1]] };
    for (let i = 0; i < 100; i++)
      await inspectLessons({ note: { text: String(i) }, runJev: true }, options);
    await inspectLessons({ note: { text: "0" }, runJev: true }, options);
    await inspectLessons({ note: { text: "100" }, runJev: true }, options);
    expect((await inspectLessons({ note: { text: "0" } }, options)).cache.inspector).toBe(true);
    const evicted = await inspectLessons({ note: { text: "1" } }, options);
    expect(evicted.cache.inspector).toBe(false);
    expect(evicted.cache.entries).toBe(100);
    expect(readFileSync(join(dir, "camera.md"), "utf8")).toBe("# Camera");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
