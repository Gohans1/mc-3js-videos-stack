import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../../../scripts/sound/process.py", import.meta.url));
const pending = new Map();
const MAX_JOBS = 2;
const MAX_OUTPUT_BYTES = 384 * 1024 * 1024;
let activeJobs = 0;
const waitQueue = [];

const withSlot = async (fn) => {
  if (activeJobs >= MAX_JOBS) {
    await new Promise((resume) => waitQueue.push(resume));
  }
  activeJobs++;
  try {
    return await fn();
  } finally {
    activeJobs--;
    waitQueue.shift()?.();
  }
};

const sanitizeProcessError = (stderr, fallback) => {
  const line =
    String(stderr || "")
      .trim()
      .split("\n")
      .at(-1) || String(fallback || "Audio processing failed");
  return line
    .replace(
      /[A-Za-z]:[\\/][^\s"']+|\/(?:Users|home|tmp|var|etc|private|mnt)[\\/][^\s"']+/g,
      "<path>",
    )
    .slice(0, 240);
};

export const analyzeBeats = (source, settings, python) =>
  withSlot(
    () =>
      new Promise((done, fail) => {
        const beatScript = fileURLToPath(
          new URL("../../../scripts/sound/beats.py", import.meta.url),
        );
        const child = execFile(
          python,
          [beatScript, source],
          { windowsHide: true, timeout: 120_000, maxBuffer: 1024 * 1024 },
          (error, stdout, stderr) => {
            if (error) return fail(new Error(sanitizeProcessError(stderr, error.message)));
            try {
              done(JSON.parse(stdout));
            } catch (e) {
              fail(e);
            }
          },
        );
        child.stdin.on("error", () => {});
        child.stdin.end(JSON.stringify(settings));
      }),
  );

export const renderAudio = (source, settings, python) => {
  const key = JSON.stringify([source, settings]);
  if (pending.has(key)) return pending.get(key);
  const job = withSlot(async () => {
    const dir = await mkdtemp(join(tmpdir(), "studio-processed-")),
      out = join(dir, "clip.wav");
    try {
      await new Promise((done, fail) => {
        const child = execFile(
          python,
          [script, source, out],
          { windowsHide: true, timeout: 120_000, maxBuffer: 1024 * 1024 },
          (error, _, stderr) =>
            error ? fail(new Error(sanitizeProcessError(stderr, error.message))) : done(),
        );
        child.stdin.on("error", () => {});
        child.stdin.end(JSON.stringify(settings));
      });
      const st = await stat(out);
      if (st.size > MAX_OUTPUT_BYTES) {
        throw new Error("Processed audio exceeds maximum buffer size");
      }
      return await readFile(out);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }).finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
};
