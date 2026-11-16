// The lessons the creator's notes taught: both global (the repo's lessons/) and per-film (this film's lessons/), as recursive .md files.
// bun run notes ID names the files a note needs, each with every heading and its line: by default Jev reads only a file's path,
// frontmatter and headings, never the words under them, and the AI picks the headings to open (the creator's call: Jev finds
// the topic, the AI the part). The answer is kept in the film's notes/ until the note's words or what Jev reads of the
// lessons change, so reading a note again costs nothing.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { jevJudge } from "../../clip-catalog/jev.ts";
import { DEFAULT_LESSON_JEV_CONFIG, fillTemplate, LessonJevConfigSchema } from "./lesson-config.ts";
import { mdHeads } from "./md-heads.ts";

// MC_LESSONS: another folder (a test points it at an empty one, so no test pays Jev)
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

// The topics there are, as "craft/walk" for lessons/craft/walk.md
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

// Jev's Choice ranks every file, then a Noul each checks the first few (jev.ts jevJudge). Measured against one Noul per file
// in one request (TypeSafe's record pattern): that said yes too readily, 20/25 holdout to this 23/25. The note's frame sent
// along (docs.typesafe.ai/images) was measured on 87 real notes too: 65/87 to words alone 69/87, and 0.5 s slower a note
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

// note id -> {picks: [{path, sure, heads: [{line, head}]}]} (best first; sure: Jev's yes, else it was unsure; heads: every
// heading of the file, for the AI to open the lines it needs) or {why} when Jev could not answer; no entry when there are no
// lessons yet
export async function lessonsFor(
  notes,
  {
    dir = LESSONS,
    projectDir = null,
    cache = null,
    judge = jevLessons,
    config: rawConfig = {},
  } = {},
) {
  const config = LessonJevConfigSchema.parse(rawConfig);
  const dual = Boolean(projectDir && resolve(projectDir) !== resolve(dir));
  const pool = lessonPool({ dir, projectDir, config }),
    out = new Map();
  if (!pool.length) return out;
  const kept = readCache(cache),
    byKey = new Map(pool.map((x) => [x.key, x]));
  let inspected;
  let changed = false;
  for (const n of notes) {
    // the creator's answers after it as well: "and the hinge squeak is missing" may need another lesson than the note's words
    const words = [n.text, ...(n.asks ?? []).map((a) => a.text)].join("\n"),
      key = lessonCacheKey(words, pool, config);
    // an entry from before picks (it kept paths) is asked again
    const entry = kept[n.id];
    const valid =
      entry?.key === key &&
      Array.isArray(entry.picks) &&
      entry.picks.every((p) => typeof (dual ? p?.pick : p?.path) === "string");
    if (!valid) {
      inspected ??= cache ? readCache(join(dirname(cache), "lessons-inspect-cache.json")) : [];
      const reuse = Array.isArray(inspected)
        ? inspected.find((e) => e.key === key && Array.isArray(e.ranked))
        : null;
      if (!config.enabled && !reuse) {
        out.set(n.id, { why: "Jev disabled in Lessons / AI Inspector settings" });
        continue;
      }
      try {
        const voted = reuse
          ? reuse.ranked.flatMap((r) =>
              byKey.has(r.key) ? [[r.vote, byKey.get(r.key), r.fit]] : [],
            )
          : await judge(words, pool, Math.min(config.show, pool.length), config);
        kept[n.id] = {
          key,
          // the files, not their heading lines: an edit under a heading moves them without asking Jev again
          picks: voted
            .filter(([, , fit]) => fit !== undefined && fit >= config.fitNo)
            .map(([, x, fit]) =>
              dual
                ? { pick: x.key, sure: fit >= config.fitYes }
                : { path: x.path, sure: fit >= config.fitYes },
            ),
        };
        changed = true;
      } catch (e) {
        out.set(n.id, { why: e.message });
        continue;
      }
    }
    out.set(n.id, {
      picks: kept[n.id].picks.flatMap((p) => {
        const item = byKey.get(dual ? p.pick : p.path);
        if (!item) return [];
        return dual
          ? [
              {
                scope: item.scope,
                rel: item.rel,
                path: item.path,
                file: item.file,
                sure: !!p.sure,
                heads: item.heads,
              },
            ]
          : [{ path: item.path, sure: !!p.sure, heads: item.heads }];
      }),
    });
  }
  if (changed && cache) writeFileSync(cache, JSON.stringify(kept, null, 1));
  return out;
}
