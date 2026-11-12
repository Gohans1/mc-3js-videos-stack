// A note fixed, from the AI's side (note.mjs done): filed through the running studio, which owns notes.jsonl while it runs (two
// writers would lose a note), or straight into the file when no studio is running
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createNotes } from "./notes.mjs";

const version = (project) => {
  try {
    return execFileSync("git", ["describe", "--tags", "--always", "--dirty"], {
      cwd: project,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "no git";
  }
};

const studioPort = (project) => {
  try {
    return JSON.parse(readFileSync(join(project, "renders/live/studio.json"), "utf8")).port;
  } catch {
    return null;
  }
};

// A note named by its id or by the #N bun run notes shows (every whole note, done ones too, in the order written)
export const resolveNote = (project, key) => {
  const all = createNotes(project).read();
  if (all.some((n) => n.id === key)) return key;
  const n = /^#?(\d+)$/.exec(key)?.[1];
  const written = all
    .filter((x) => "id" in x && "t" in x && "text" in x && "shot" in x && "time" in x)
    .toSorted((a, b) => ((a.at ?? "") < (b.at ?? "") ? -1 : (a.at ?? "") > (b.at ?? "") ? 1 : 0));
  const hit = n && written[Number(n) - 1];
  if (!hit)
    throw new Error(
      `no such note: ${key} (the ids and #numbers: bun run notes, --done for fixed ones too)`,
    );
  return hit.id;
};

// One change from note-state.mjs ({fix}, {learned}); throws note-state's reason when it may not happen now
export const sendChange = async (project, id, change) => {
  const notes = createNotes(project);
  if (!notes.read().some((n) => n.id === id)) throw new Error(`no such note: ${id}`);
  const port = studioPort(project);
  if (port) {
    let r = null;
    try {
      r = await fetch(`http://127.0.0.1:${port}/api/notes/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(change),
        signal: AbortSignal.timeout(3000),
      });
    } catch {} // stopped since it wrote studio.json: nobody else is writing the file
    if (r && !r.ok) throw new Error(`the studio refused it: ${await r.text()}`);
    if (r) return "studio";
  }
  const r = notes.change(id, change);
  if (!r.ok) throw new Error(r.why);
  return "file";
};

export const markDone = (project, id, what, ask = false) =>
  sendChange(project, id, {
    fix: { what, checkpoint: version(project), ...(ask ? { ask: true } : {}) },
  });
