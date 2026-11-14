// The lessons the creator's notes taught, in the repo's lessons/ folder (.md files), shared by every film.
// bun run notes ID names the files a note needs, each with every heading and its line: Jev reads only a file's path,
// frontmatter and headings, never the words under them, and the AI picks the headings to open (the creator's call: Jev finds
// the topic, the AI the part). The answer is kept in the film's notes/ until the note's words or what Jev reads of the
// lessons change, so reading a note again costs nothing.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { FIT_NO, FIT_YES, jevJudge } from "../../clip-catalog/jev.ts";
import { mdHeads } from "./md-heads.ts";

// MC_LESSONS: another folder (a test points it at an empty one, so no test pays Jev)
export const LESSONS =
  process.env.MC_LESSONS ?? fileURLToPath(new URL("../../../lessons", import.meta.url));
const SHOW = 5,
  // the most Jev reads of one file, so one file with hundreds of headings cannot crowd out the rest of the request
  WORDS = 2000;

const mdFiles = (dir) =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((f) => f.isFile() && f.name.endsWith(".md"))
        .map((f) => {
          const file = join(f.parentPath, f.name);
          return { file, path: relative(dirname(dir), file).replaceAll("\\", "/") };
        })
        .toSorted((a, b) => (a.path < b.path ? -1 : 1))
    : [];

// The topics there are, as "craft/walk" for lessons/craft/walk.md
export const lessonTopics = (dir = LESSONS) =>
  mdFiles(dir).map(({ file }) => relative(dir, file).replaceAll("\\", "/").slice(0, -3));

const flat = (s) => s.replace(/\s+/g, " ").trim();

const lessonFile = ({ file, path }) => {
  const { front, heads: all } = mdHeads(readFileSync(file, "utf8")),
    heads = all.map(({ line, head }) => ({ line, head }));
  const words = [front.map(flat).filter(Boolean).join(" "), heads.map((h) => h.head).join(" ")]
    .filter(Boolean)
    .join(" | ");
  return { path, heads, jev: words ? `${path}: ${words.slice(0, WORDS)}` : path };
};

// Jev's Choice ranks every file, then a Noul each checks the first few (jev.ts jevJudge). Measured against one Noul per file
// in one request (TypeSafe's record pattern): that said yes too readily, 20/25 holdout to this 23/25. The note's frame sent
// along (docs.typesafe.ai/images) was measured on 87 real notes too: 65/87 to words alone 69/87, and 0.5 s slower a note
const jevLessons = (text, pool, show) =>
  jevJudge(
    {
      wanted: `A creator's note on their Minecraft film, for the AI about to fix what it says: ${text}`,
      pick: "Which lesson file helps most to fix what the note says?",
      yes: "The file is about what the note asks for or complains of: reading it helps fix this note",
      no: "The file is about something else",
      text: (x) => x.jev,
    },
    pool,
    show,
  );

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
export async function lessonsFor(notes, { dir = LESSONS, cache = null, judge = jevLessons } = {}) {
  const pool = mdFiles(dir).map(lessonFile),
    out = new Map();
  if (!pool.length) return out;
  const kept = readCache(cache),
    shelf = pool.map((x) => x.jev).join("\n"),
    byPath = new Map(pool.map((x) => [x.path, x]));
  let changed = false;
  for (const n of notes) {
    // the creator's answers after it as well: "and the hinge squeak is missing" may need another lesson than the note's words
    const words = [n.text, ...(n.asks ?? []).map((a) => a.text)].join("\n"),
      key = createHash("sha1").update(`${words}\n${shelf}`).digest("hex");
    // an entry from before picks (it kept paths) is asked again
    if (kept[n.id]?.key !== key || !Array.isArray(kept[n.id].picks)) {
      try {
        const voted = await judge(words, pool, Math.min(SHOW, pool.length));
        kept[n.id] = {
          key,
          // the files, not their heading lines: an edit under a heading moves them without asking Jev again
          picks: voted
            .filter(([, , fit]) => fit !== undefined && fit >= FIT_NO)
            .map(([, x, fit]) => ({ path: x.path, sure: fit >= FIT_YES })),
        };
        changed = true;
      } catch (e) {
        out.set(n.id, { why: e.message });
        continue;
      }
    }
    out.set(n.id, {
      picks: kept[n.id].picks.flatMap(({ path, sure }) =>
        byPath.has(path) ? [{ path, sure, heads: byPath.get(path).heads }] : [],
      ),
    });
  }
  if (changed && cache) writeFileSync(cache, JSON.stringify(kept, null, 1));
  return out;
}
