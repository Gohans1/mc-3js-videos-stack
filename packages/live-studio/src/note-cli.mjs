// A note fixed, from the AI's side (note.mjs done): filed through the running studio, which owns notes.jsonl while it runs (two
// writers would lose a note), or straight into the file when no studio is running
import { execFileSync } from "node:child_process";

import { createNotes, deletedSaid, findNote } from "./notes.mjs";
import { studioPort } from "./tell.mjs";

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

// A note named by its id or by the #N bun run notes shows (notes.mjs findNote)
export const resolveNote = (project, key) => {
  const hit = findNote(project, key);
  if (hit?.gone) throw new Error(deletedSaid(hit));
  if (!hit)
    throw new Error(
      `no such note: ${key} (the ids and #numbers: bun run notes, --done for fixed ones too)`,
    );
  return hit.id;
};

// One change from note-state.mjs ({fix}, {learned}); throws note-state's reason when it may not happen now
export const sendChange = async (project, id, change) => {
  const notes = createNotes(project);
  if (!change.restore && !notes.read().some((n) => n.id === id)) throw new Error(`no such note: ${id}`);
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
    } catch (e) {
      // a studio that took the change and is slow to answer (a build, a render on the same machine) may still write it: the
      // file written too would be two writers, a fix twice or a creator's note lost
      if (e?.name === "TimeoutError")
        throw new Error(
          "the studio did not answer in 3 s (busy building or rendering?) and may still take it: see whether it did (bun run notes ID) before you send it again",
        );
    } // else stopped since it wrote studio.json: nobody else is writing the file
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
