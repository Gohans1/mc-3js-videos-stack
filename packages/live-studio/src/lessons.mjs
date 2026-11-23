import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { jevJudge } from "../../clip-catalog/jev.ts";
import { DEFAULT_LESSON_JEV_CONFIG, fillTemplate, LessonJevConfigSchema } from "./lesson-config.ts";
import { mdHeads } from "./md-heads.ts";

export const LESSONS =
  process.env.MC_LESSONS ?? fileURLToPath(new URL("../../../lessons", import.meta.url));

const mdFiles = (dir, scope = "all") =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((f) => f.isFile() && f.name.endsWith(".md"))
        .map((f) => {
          const file = join(f.parentPath, f.name);
          const rel = relative(dir, file).replaceAll("\\", "/");
          return {
            file,
            rel,
            scope,
            path: relative(dirname(dir), file).replaceAll("\\", "/"),
          };
        })
        .filter((f) => !f.rel.split("/").some((s) => s.startsWith(".")))
        .toSorted((a, b) => (a.path < b.path ? -1 : 1))
    : [];

export const lessonTopics = (dir = LESSONS) => mdFiles(dir).map(({ rel }) => rel.slice(0, -3));

const flat = (s) => s.replace(/\s+/g, " ").trim();

const lessonFile = (
  { file, path, rel, scope, text = readFileSync(file, "utf8") },
  dual,
  config,
) => {
  const { front, heads: all } = mdHeads(text),
    heads = all.map(({ line, head }) => ({ line, head }));
  const frontLines =
    config.frontmatterMode === "none"
      ? []
      : config.frontmatterMode === "when"
        ? front.filter((s) => /^when\s*:/.test(s))
        : front;
  const words =
    config.extractMode === "full"
      ? text
      : [frontLines.map(flat).filter(Boolean).join(" "), heads.map((h) => h.head).join(" ")]
          .filter(Boolean)
          .join(" | ");
  const shownPath = dual ? `lessons/${rel}` : path;
  const key = dual ? `${scope}:${rel}` : path;
  const label = dual ? (scope === "film" ? config.filmPrefix : config.allPrefix) : "";
  return {
    key,
    scope,
    rel,
    path: shownPath,
    file,
    heads,
    chars: words.length,
    truncated: words.length > config.wordsLimit,
    jev: words
      ? `${label}${shownPath}: ${words.slice(0, config.wordsLimit)}`
      : `${label}${shownPath}`,
  };
};

export const lessonQuestion = (text, config = DEFAULT_LESSON_JEV_CONFIG) => ({
  wanted: [config.systemPreamble, fillTemplate(config.wantedTemplate, { note: text })]
    .filter(Boolean)
    .join("\n\n"),
  pick: config.choiceInstructions,
  yes: config.noulYes,
  no: config.noulNo,
  text: (x) => x.jev,
});
export const jevLessons = (text, pool, show, config = DEFAULT_LESSON_JEV_CONFIG, onTrace) =>
  jevJudge(lessonQuestion(text, config), pool, show, { ...config, onTrace });

export const lessonPool = ({
  dir = LESSONS,
  projectDir = null,
  drafts = [],
  config = DEFAULT_LESSON_JEV_CONFIG,
} = {}) => {
  const dual = Boolean(projectDir && resolve(projectDir) !== resolve(dir));
  const files = dual ? [...mdFiles(projectDir, "film"), ...mdFiles(dir, "all")] : mdFiles(dir);
  const merged = new Map(files.map((f) => [`${f.scope}:${f.rel}`, f]));
  for (const draft of drafts) {
    const key = `${draft.scope}:${draft.path}`;
    if (draft.text === null) merged.delete(key);
    else {
      const base = draft.scope === "film" ? projectDir : dir;
      if (!base) throw new Error("No film lessons folder");
      merged.set(key, {
        file: join(base, draft.path),
        path: `lessons/${draft.path}`,
        rel: draft.path,
        scope: draft.scope,
        text: draft.text,
      });
    }
  }
  return [...merged.values()]
    .filter((f) => config.scopeFilter === "both" || f.scope === config.scopeFilter)
    .sort((a, b) =>
      a.scope !== b.scope
        ? a.scope === "film"
          ? -1
          : 1
        : a.rel < b.rel
          ? -1
          : a.rel > b.rel
            ? 1
            : 0,
    )
    .map((f) => lessonFile(f, dual, config));
};

export const lessonCacheKey = (words, pool, config = DEFAULT_LESSON_JEV_CONFIG) => {
  const retrievalKeys = [
    "wordsLimit",
    "extractMode",
    "frontmatterMode",
    "filmPrefix",
    "allPrefix",
    "scopeFilter",
    "dedupe",
    "show",
    "fitNo",
    "fitYes",
    "choiceMax",
    "heat",
    "keep",
    "route",
    "freeModel",
    "paidModel",
    "spendCap",
    "systemPreamble",
    "wantedTemplate",
    "choiceInstructions",
    "noulInstructionsTemplate",
    "noulYes",
    "noulNo",
  ];
  const requestConfig = Object.fromEntries(retrievalKeys.map((k) => [k, config[k]]));
  const standard = Object.fromEntries(retrievalKeys.map((k) => [k, DEFAULT_LESSON_JEV_CONFIG[k]]));
  return createHash("sha1")
    .update(
      `${words}\n${pool.map((x) => x.jev).join("\n")}${JSON.stringify(requestConfig) === JSON.stringify(standard) ? "" : JSON.stringify(requestConfig)}`,
    )
    .digest("hex");
};

const readCache = (file) => {
  try {
    return file && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  } catch {
    return {};
  }
};

export async function lessonsFor(
  notes,
  {
    dir = LESSONS,
    projectDir = null,
    cache = null,
    judge = jevLessons,
    config: rawConfig = {},
    concurrency = 4,
  } = {},
) {
  const config = LessonJevConfigSchema.parse(rawConfig);
  const dual = Boolean(projectDir && resolve(projectDir) !== resolve(dir));
  const pool = lessonPool({ dir, projectDir, config }),
    out = new Map();
  if (!pool.length) return out;
  const kept = readCache(cache),
    byKey = new Map(pool.map((x) => [x.key, x]));
  const maxWorkers = Number.isFinite(concurrency) && concurrency >= 1 ? Math.floor(concurrency) : 4;
  let inspected;
  let changed = false;

  const toStoredPicks = (voted) =>
    voted
      .filter(([, , fit]) => fit !== undefined && fit >= config.fitNo)
      .map(([, x, fit]) =>
        dual
          ? { pick: x.key, sure: fit >= config.fitYes }
          : { path: x.path, sure: fit >= config.fitYes },
      );

  const plan = [];
  const pendingByKey = new Map();
  for (const n of notes) {
    const words = [n.text, ...(n.asks ?? []).map((a) => a.text)].join("\n"),
      key = lessonCacheKey(words, pool, config);
    const entry = kept[n.id];
    const valid =
      entry?.key === key &&
      Array.isArray(entry.picks) &&
      entry.picks.every((p) => typeof (dual ? p?.pick : p?.path) === "string");
    if (valid) {
      plan.push({ n, key, status: "cached" });
      continue;
    }
    inspected ??= cache ? readCache(join(dirname(cache), "lessons-inspect-cache.json")) : [];
    const reuse = Array.isArray(inspected)
      ? inspected.find((e) => e.key === key && Array.isArray(e.ranked))
      : null;
    if (reuse) {
      const voted = reuse.ranked.flatMap((r) =>
        byKey.has(r.key) ? [[r.vote, byKey.get(r.key), r.fit]] : [],
      );
      kept[n.id] = { key, picks: toStoredPicks(voted) };
      changed = true;
      plan.push({ n, key, status: "cached" });
      continue;
    }
    if (!config.enabled) {
      plan.push({ n, key, status: "disabled" });
      continue;
    }
    if (!pendingByKey.has(key)) pendingByKey.set(key, words);
    plan.push({ n, key, status: "pending" });
  }

  const judged = new Map();
  if (pendingByKey.size > 0) {
    const tasks = [...pendingByKey.entries()];
    const showCount = Math.min(config.show, pool.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(maxWorkers, tasks.length) }, async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= tasks.length) break;
        const [key, words] = tasks[idx];
        try {
          const voted = await judge(words, pool, showCount, config);
          judged.set(key, { ok: true, picks: toStoredPicks(voted) });
        } catch (e) {
          judged.set(key, { ok: false, why: e instanceof Error ? e.message : String(e) });
        }
      }
    });
    await Promise.all(workers);
  }

  for (const item of plan) {
    const { n, key, status } = item;
    if (status === "disabled") {
      out.set(n.id, { why: "Jev disabled in Lessons / AI Inspector settings" });
      continue;
    }
    if (status === "pending") {
      const res = judged.get(key);
      if (!res?.ok) {
        out.set(n.id, { why: res?.why || "lesson lookup failed" });
        continue;
      }
      kept[n.id] = {
        key,
        picks: res.picks.map((p) => ({ ...p })),
      };
      changed = true;
    }
    out.set(n.id, {
      picks: kept[n.id].picks.flatMap((p) => {
        const found = byKey.get(dual ? p.pick : p.path);
        if (!found) return [];
        return dual
          ? [
              {
                scope: found.scope,
                rel: found.rel,
                path: found.path,
                file: found.file,
                sure: !!p.sure,
                heads: found.heads,
              },
            ]
          : [{ path: found.path, sure: !!p.sure, heads: found.heads }];
      }),
    });
  }
  if (changed && cache) writeFileSync(cache, JSON.stringify(kept, null, 1));
  return out;
}
