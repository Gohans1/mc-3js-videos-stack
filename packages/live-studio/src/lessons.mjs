// The lessons the creator's notes taught, in the repo's lessons/ folder (one .md per topic, each ## heading a rule), shared by
// every film. bun run notes ID names the files a note needs: Jev reads the note and each file's title and headings. The
// answer is kept in the film's notes/ until the note's words or the lessons change, so reading a note again costs nothing.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { FIT_NO, jevJudge } from "../../clip-catalog/jev.ts";

// MC_LESSONS: another folder (a test points it at an empty one, so no test pays Jev)
export const LESSONS =
  process.env.MC_LESSONS ?? fileURLToPath(new URL("../../../lessons", import.meta.url));
const SHOW = 5;

const lessonFiles = (dir) =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((f) => f.isFile() && f.name.endsWith(".md"))
        .map((f) => {
          const file = join(f.parentPath, f.name),
            text = readFileSync(file, "utf8").replace(/\r\n/g, "\n"),
            lines = text.split("\n");
          const path = relative(dirname(dir), file).replaceAll("\\", "/");
          const title =
            lines
              .find((l) => l.startsWith("# "))
              ?.slice(2)
              .trim() ?? f.name.slice(0, -3);
          const heads = lines.filter((l) => l.startsWith("## ")).map((l) => l.slice(3).trim());
          return {
            path,
            lines: lines.length - (text.endsWith("\n") ? 1 : 0),
            title,
            jev: `${path}: ${title}.${heads.length ? ` ${heads.join("; ")}` : ""}`,
          };
        })
        .toSorted((a, b) => (a.path < b.path ? -1 : 1))
    : [];

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

// note id -> {picks: [{path, lines, title}]} or {why} when Jev could not answer; no entry when there are no lessons yet
export async function lessonsFor(notes, { dir = LESSONS, cache = null, judge = jevLessons } = {}) {
  const pool = lessonFiles(dir),
    out = new Map();
  if (!pool.length) return out;
  const byPath = new Map(pool.map((x) => [x.path, x])),
    kept = readCache(cache),
    shelf = pool.map((x) => x.jev).join("\n");
  let changed = false;
  for (const n of notes) {
    const key = createHash("sha1").update(`${n.text}\n${shelf}`).digest("hex");
    if (kept[n.id]?.key !== key) {
      try {
        const voted = await judge(n.text, pool, Math.min(SHOW, pool.length));
        const paths = voted
          .filter(([, , fit]) => fit !== undefined && fit >= FIT_NO)
          .map(([, x]) => x.path);
        kept[n.id] = { key, paths };
        changed = true;
      } catch (e) {
        out.set(n.id, { why: e.message });
        continue;
      }
    }
    out.set(n.id, {
      picks: kept[n.id].paths.flatMap((p) => {
        const x = byPath.get(p);
        return x ? [{ path: x.path, lines: x.lines, title: x.title }] : [];
      }),
    });
  }
  if (changed && cache) writeFileSync(cache, JSON.stringify(kept, null, 1));
  return out;
}
