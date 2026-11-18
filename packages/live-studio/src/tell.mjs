// A line about what the AI is doing now, from one of the film's commands to the studio open on the film (src/activity.mjs
// shows it). Never in the command's way: with no studio running, or one slow to answer, the command goes on as if unsaid
import { readFileSync } from "node:fs";
import { join } from "node:path";

// where the running studio listens (live.mjs writes it as it starts)
export const studioPort = (project) => {
  try {
    return JSON.parse(readFileSync(join(project, "renders/live/studio.json"), "utf8")).port;
  } catch {
    return null;
  }
};

// a studio answers in ms, but in up to 1.4 s (measured) while it rebuilds the code the AI has just saved: the very moment
// its next command says something
const WAIT_MS = 2000;
const cut = (s, n) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

const second = (s) => (s === undefined ? s : Math.max(0, s));

// entry: src/activity.mjs Activity, cut to what the studio takes (a refused line is lost). Says whether a studio took it
export const tell = async (project, entry) => {
  const port = studioPort(project);
  if (!port) return false;
  const marks = entry.marks
    ?.slice(0, 20)
    .map((m) => ({
      ...m,
      at: second(m.at),
      to: second(m.to),
      say: (m.say && cut(m.say, 80)) || undefined,
    }));
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/activity`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...entry,
        say: cut(entry.say, 200),
        at: second(entry.at),
        to: second(entry.to),
        notes: entry.notes?.slice(0, 50),
        lessons: entry.lessons?.slice(0, 20),
        marks,
      }),
      signal: AbortSignal.timeout(WAIT_MS),
    });
    return r.ok;
  } catch {
    return false;
  }
};

// A long command (a render, a listen): the studio shows it busy from this line until the one end() sends, or until this
// process is gone. scripts/studio_tell.py job() is its Python twin
export const startJob = async (project, key, entry) => {
  await tell(project, { ...entry, job: { key, pid: process.pid } });
  return (last) => tell(project, { surface: entry.surface, ...last, job: { key, end: true } });
};
