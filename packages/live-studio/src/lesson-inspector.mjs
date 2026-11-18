import { createHash } from "node:crypto";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import * as z from "zod";

import { choiceRequest, fitRequest } from "../../clip-catalog/jev.ts";
import {
  DEFAULT_LESSON_JEV_CONFIG,
  InspectorNoteSchema,
  JEV_ENGINE_FIELDS,
  LessonJevConfigSchema,
} from "./lesson-config.ts";
import { readLessonConfig, writeLessonJson } from "./lesson-settings.mjs";
import { LESSON_TEXT_MAX } from "./lesson-template.ts";
import { jevLessons, lessonCacheKey, lessonPool, lessonQuestion, LESSONS } from "./lessons.mjs";
import { noteDetailFormat } from "./note-detail.mjs";
import { noteLessonFormat } from "./note-format.mjs";
import { noteNumbers } from "./notes.mjs";

export const InspectInput = z
  .object({
    note: InspectorNoteSchema,
    config: LessonJevConfigSchema.optional(),
    drafts: z
      .array(
        z.object({
          scope: z.enum(["film", "all"]),
          path: z
            .string()
            .max(200)
            .regex(/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.md$/),
          text: z.string().max(LESSON_TEXT_MAX).nullable(),
        }),
      )
      .max(500)
      .default([]),
    runJev: z.boolean().default(false),
  })
  .strict();
const cacheFile = (root) => join(root, "notes/lessons-inspect-cache.json");
const readJson = (file, fallback) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};
const readEntries = (root) => {
  const data = readJson(cacheFile(root), []);
  return Array.isArray(data)
    ? data.filter((e) => typeof e?.key === "string" && Array.isArray(e?.ranked)).slice(-100)
    : [];
};
export const clearInspectCache = (root) => {
  if (existsSync(cacheFile(root))) unlinkSync(cacheFile(root));
};
const keyPresent = (env, file) =>
  Boolean(
    process.env[env]?.trim() ||
    (() => {
      try {
        return readFileSync(join(homedir(), ".secrets", file), "utf8")
          .split(/\r?\n/)
          .some(
            (line) => line.trim() && !line.trim().startsWith("#") && line.split("=").at(-1).trim(),
          );
      } catch {
        return false;
      }
    })(),
  );
export const inspectorInfo = ({ root }) => ({
  defaults: DEFAULT_LESSON_JEV_CONFIG,
  config: readLessonConfig(root),
  fields: JEV_ENGINE_FIELDS,
  keys: {
    free: keyPresent("OPENCODE_API_KEY", "opencode_zen.env"),
    paid: keyPresent("OPENROUTER_API_KEY", "openrouter.env"),
  },
  cache: {
    inspector: readEntries(root).length,
    cli: Object.keys(readJson(join(root, "notes/lessons-cache.json"), {})).length,
    limit: 100,
  },
  engine: {
    wire: "{model, state, questions}; no separate system role",
    freeEndpoint: "https://opencode.ai/zen/v1/systemone",
    paidEndpoint: "https://openrouter.ai/api/v1/systemone",
    quota: "~/.cache/mc-films/jev-quota.json; exhausted routes tried last",
    timeout: "180 seconds shared across the whole Jev run; each subprocess gets the remaining time",
    retries: "5, 10, 20, 40, 80, 160 seconds; timeout bounds the whole subprocess",
    concurrency: "4 heats",
    seed: 7,
    cost: "Provider-reported response cost only; null means unknown. Caps are checked after billing per request.",
  },
});

export async function inspectLessons(
  raw,
  { root, dir = LESSONS, projectDir = null, judge = jevLessons, notes = [] },
) {
  const input = InspectInput.parse(raw);
  const config = input.config ?? readLessonConfig(root);
  const pool = lessonPool({ dir, projectDir, drafts: input.drafts, config });
  const words = [input.note.text, ...input.note.asks.map((a) => a.text)].join("\n");
  const cliKey = lessonCacheKey(words, pool, config);
  const fingerprint = createHash("sha1")
    .update(JSON.stringify({ words, pool: pool.map((x) => [x.key, x.jev, x.heads]), config }))
    .digest("hex");
  const entries = readEntries(root);
  let entryCount = entries.length;
  const cached = entries.find((e) => e.key === cliKey);
  const trace = [];
  const q = lessonQuestion(words, config);
  const candidates = config.dedupe ? [...new Map(pool.map((x) => [x.jev, x])).values()] : pool;
  const first = [...candidates];
  if (first.length > config.choiceMax) {
    let seed = 7;
    for (let i = first.length - 1; i > 0; i--) {
      seed = (seed * 16807) % 2147483647;
      const j = seed % (i + 1);
      [first[i], first[j]] = [first[j], first[i]];
    }
  }
  const choice = [];
  const size = first.length > config.choiceMax ? config.heat : config.choiceMax;
  for (let i = 0; i < first.length; i += size)
    choice.push(choiceRequest(q, first.slice(i, i + size)));
  const cliEntry = input.note.id
    ? readJson(join(root, "notes/lessons-cache.json"), {})[input.note.id]
    : null;
  const cliHit = cliEntry?.key === cliKey && Array.isArray(cliEntry.picks);
  let ranked = cached?.ranked ?? null;
  let status = cached || cliHit ? "cached" : "dry";
  if (input.runJev && !cached && !cliHit && pool.length) {
    const voted = await judge(words, pool, Math.min(config.show, pool.length), config, (event) =>
      trace.push(event),
    );
    ranked = voted.map(([vote, item, fit]) => ({ key: item.key, vote, fit }));
    status = "live";
    const latest = readEntries(root).filter((e) => e.key !== cliKey);
    latest.push({ key: cliKey, ranked, trace, at: Date.now() });
    entryCount = Math.min(latest.length, 100);
    writeLessonJson(cacheFile(root), latest.slice(-100));
  } else if (cached && input.runJev) {
    writeLessonJson(cacheFile(root), [...entries.filter((e) => e.key !== cliKey), cached]);
  }
  const byKey = new Map(pool.map((p) => [p.key, p]));
  const picks = ranked
    ? ranked
        .filter((r) => r.fit != null && r.fit >= config.fitNo)
        .flatMap((r) => {
          const p = byKey.get(r.key);
          return p ? [{ ...p, sure: r.fit >= config.fitYes }] : [];
        })
    : cliHit
      ? cliEntry.picks.flatMap((r) => {
          const p = byKey.get(r.pick ?? r.path);
          return p ? [{ ...p, sure: r.sure }] : [];
        })
      : null;
  const topicPool =
    config.scopeFilter === "both"
      ? pool
      : lessonPool({
          dir,
          projectDir,
          drafts: input.drafts,
          config: { ...config, scopeFilter: "both" },
        });
  const formatOptions = {
    root,
    dir,
    projectDir,
    config,
    topics: {
      all: topicPool.filter((p) => p.scope === "all").map((p) => p.rel.slice(0, -3)),
      film: topicPool.filter((p) => p.scope === "film").map((p) => p.rel.slice(0, -3)),
    },
  };
  const format = noteLessonFormat(formatOptions);
  const selection = picks
    ? { picks }
    : pool.length
      ? { why: "dry simulation; no cached result — enable calls and press Run Jev" }
      : undefined;
  const existingNote = notes.find((n) => n.id === input.note.id);
  const detailNote = {
    id: "simulation",
    t: 0,
    time: "00:00.000",
    shot: 0,
    ...existingNote,
    ...input.note,
    n: existingNote ? (noteNumbers(root).get(existingNote.id)?.n ?? existingNote.n ?? 1) : 1,
    asks: input.note.asks.map((a, i) => ({
      ...a,
      at: a.at ?? existingNote?.asks?.[i]?.at ?? "9999",
    })),
  };
  return {
    status,
    fingerprint,
    config,
    words,
    pool,
    ranked,
    trace: cached?.trace ?? trace,
    cache: {
      inspector: Boolean(cached),
      cli: Boolean(cliHit),
      entries: entryCount,
      limit: 100,
    },
    requests: {
      choice,
      noulExample: fitRequest(q, first.slice(0, config.show), config),
      explanation:
        "Choice inputs above are exact for the first round. Later heats and Noul depend on real winners; noulExample uses the first candidates, not a prediction.",
    },
    output: format.lessonLines(selection).join("\n"),
    noteOutput: noteDetailFormat(formatOptions)(detailNote, false, selection).join("\n"),
    noteInput: detailNote,
    learnPrompt: format.learnPrompt(),
  };
}
