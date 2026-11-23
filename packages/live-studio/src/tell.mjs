import { readFileSync } from "node:fs";
import { join } from "node:path";

export const studioPort = (project) => {
  try {
    return JSON.parse(readFileSync(join(project, "renders/live/studio.json"), "utf8")).port;
  } catch {
    return null;
  }
};

const WAIT_MS = 2000;
const cut = (s, n) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

const second = (s) => (s === undefined ? s : Math.max(0, s));

export const tell = async (project, entry) => {
  const port = studioPort(project);
  if (!port) return false;
  const marks = entry.marks?.slice(0, 20).map((m) => ({
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

export const startJob = async (project, key, entry) => {
  await tell(project, { ...entry, job: { key, pid: process.pid } });
  return (last) => tell(project, { surface: entry.surface, ...last, job: { key, end: true } });
};
