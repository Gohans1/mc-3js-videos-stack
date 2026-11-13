import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
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

// small: Opus 96k in WebM (as film.mjs smallSfx), for a page away from this machine; a minute of float WAV is ~46 MB, of this ~0.7.
// kept: a folder where results stay, by source file (its size and time), settings, the processing script's own time and the
// encode: a 54 s narration lane took 12 s to process on every page load. The newest stay, up to KEEP_BYTES in all
const KEEP_BYTES = 1024 ** 3;
const OPUS = ["-c:a", "libopus", "-b:a", "96k"];
const keptPath = async (kept, source, settings, small) => {
  const [src, dsp] = await Promise.all([stat(source), stat(script)]);
  const id = createHash("sha1")
    .update(
      JSON.stringify([source, src.size, src.mtimeMs, dsp.mtimeMs, settings, small ? OPUS : "f32"]),
    )
    .digest("hex");
  return join(kept, `${id}.${small ? "webm" : "wav"}`);
};
const prune = async (kept) => {
  const files = await Promise.all(
    (await readdir(kept))
      .filter((n) => /\.(webm|wav)(\.new)?$/.test(n)) // a .new a crash left behind goes too
      .map(async (n) => {
        const { size, mtimeMs } = await stat(join(kept, n));
        return { n, size, mtimeMs };
      }),
  );
  let total = 0;
  for (const f of files.toSorted((a, b) => b.mtimeMs - a.mtimeMs))
    if ((total += f.size) > KEEP_BYTES) await rm(join(kept, f.n), { force: true });
};
export const renderAudio = (source, settings, python, { small = false, kept = null } = {}) => {
  const key = JSON.stringify([source, settings, small]);
  if (pending.has(key)) return pending.get(key);
  const job = withSlot(async () => {
    const keep = kept ? await keptPath(kept, source, settings, small) : null;
    if (keep && existsSync(keep))
      try {
        return await readFile(keep);
      } catch {} // pruned between the two calls: processed again below
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
      const opus = join(dir, "clip.webm");
      if (small)
        await new Promise((done, fail) =>
          execFile(
            "ffmpeg",
            ["-v", "error", "-y", "-i", out, ...OPUS, opus],
            { windowsHide: true, timeout: 120_000 },
            (error, _, stderr) =>
              error ? fail(new Error(sanitizeProcessError(stderr, error.message))) : done(),
          ),
        );
      const bytes = await readFile(small ? opus : out);
      if (keep) {
        await mkdir(kept, { recursive: true });
        await writeFile(`${keep}.new`, bytes);
        await rename(`${keep}.new`, keep);
        // the other job's .new can vanish between readdir and stat: tidying never fails a sound already made
        await prune(kept).catch(() => {});
      }
      return bytes;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }).finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
};
