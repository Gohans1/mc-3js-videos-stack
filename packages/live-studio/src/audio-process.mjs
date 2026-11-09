import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../../../scripts/sound/process.py", import.meta.url));
const pending = new Map();
export const analyzeBeats = (source, settings, python) => new Promise((done, fail) => {
  const script = fileURLToPath(new URL("../../../scripts/sound/beats.py", import.meta.url));
  const child = execFile(python, [script, source], { windowsHide: true, timeout: 250000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) return fail(new Error(stderr.trim().split("\n").at(-1) || error.message));
    try { done(JSON.parse(stdout)); } catch (e) { fail(e); }
  });
  child.stdin.on("error", () => {});
  child.stdin.end(JSON.stringify(settings));
});

export const renderAudio = (source, settings, python) => {
  const key = JSON.stringify([source, settings]);
  if (pending.has(key)) return pending.get(key);
  const job = (async () => {
    const dir = await mkdtemp(join(tmpdir(), "studio-processed-")), out = join(dir, "clip.wav");
    try {
      await new Promise((done, fail) => {
        const child = execFile(python, [script, source, out], { windowsHide: true, timeout: 250000, maxBuffer: 1024 * 1024 }, (error, _, stderr) => error ? fail(new Error(stderr.trim().split("\n").at(-1) || error.message)) : done());
        child.stdin.on("error", () => {});
        child.stdin.end(JSON.stringify(settings));
      });
      return await readFile(out);
    } finally { await rm(dir, { recursive: true, force: true }); }
  })().finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
};
