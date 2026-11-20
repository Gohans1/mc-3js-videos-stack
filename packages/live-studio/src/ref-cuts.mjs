import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// bun run reference study writes renders/reference/<video>/run-*/study.json; the newest is the reference being matched
export const latestStudy = (project) => {
  const root = join(project, "renders/reference");
  if (!existsSync(root)) return null;
  let best = null;
  for (const video of readdirSync(root)) {
    const dir = join(root, video);
    if (!statSync(dir).isDirectory()) continue;
    for (const run of readdirSync(dir)) {
      const file = join(dir, run, "study.json");
      const at = statSync(file, { throwIfNoEntry: false })?.mtimeMs;
      if (at !== undefined && (!best || at > best.at)) best = { file, at };
    }
  }
  if (!best) return null;
  try {
    const data = JSON.parse(readFileSync(best.file, "utf8"));
    const cuts = data?.picture?.cuts;
    if (!Array.isArray(cuts)) return null;
    return {
      file: best.file,
      fps: Number(data.fps) || 30,
      cuts: cuts.map((c) => c?.at).filter(Number.isFinite),
      seconds: Number(data.duration) || null,
      hits: (data.sound?.hits ?? []).filter((h) => Number.isFinite(h?.at)),
    };
  } catch {
    return null;
  }
};

const s = (t) => `${+t.toFixed(2)} s`;

const VIDEO = /\.(mp4|mov|mkv|webm|m4v)$/i;
// The cut check and the coverage read the newest study: a film holding a reference video but no study gets neither
export const unstudiedWarning = (project) => {
  if (latestStudy(project)) return "";
  const dir = join(project, "references");
  const video = existsSync(dir)
    ? readdirSync(dir).filter((f) => VIDEO.test(f) && !f.includes("-source."))[0]
    : null;
  return video
    ? `⚠ references/${video} has no study, so check can neither match its cuts nor count coverage: bun run reference study references/${video}`
    : "";
};

// A remake cuts where its reference cuts. The camera's cut seconds are heard seconds; until is the last heard second the
// camera is keyed to, so the part of the reference not built yet is not reported. camFile: the film's camTimeline
export const refCutsWarning = (project, camFile, cameraCuts, until) => {
  const study = latestStudy(project);
  if (!study) return "";
  const near = Math.max(0.05, 1.5 / study.fps);
  const close = (a) => (b) => Math.abs(a - b) <= near;
  const extra = cameraCuts.filter((t) => !study.cuts.some(close(t)));
  const missing = study.cuts.filter((t) => t <= until + near && !cameraCuts.some(close(t)));
  if (!extra.length && !missing.length) return "";
  const where = relative(project, study.file).replaceAll("\\", "/");
  return [
    `⚠ ${camFile} ${[
      extra.length &&
        `cuts at ${extra.map(s).join(", ")}, where the reference does not cut (a jump in the middle of its move)`,
      missing.length &&
        `${extra.length ? "and " : ""}the reference cuts at ${missing.map(s).join(", ")} and the camera does not`,
    ]
      .filter(Boolean)
      .join("; ")}; reference cuts from ${where}.`,
    `  a remake cuts only where its reference does: set "cut": true there and nowhere else, then CHECK=motion:cam,<from s>,<to s> bun run render stills over each changed span. A cut the study made of a whip or flash: look at the reference frames there before matching it`,
  ].join("\n");
};

const digest = (file) => createHash("sha1").update(readFileSync(file)).digest("hex");
// A sound row playing the reference's own audio (its voice stem copied into sound/) must say guide: true, or the mix
// ships someone else's recording: returns that references/ file, matched by size and then by bytes
export const referenceCopy = (project, file) => {
  const dir = join(project, "references");
  const size = statSync(file, { throwIfNoEntry: false })?.size;
  if (!size || !existsSync(dir)) return null;
  let own = null;
  for (const name of readdirSync(dir)) {
    const st = statSync(join(dir, name), { throwIfNoEntry: false });
    if (!st?.isFile() || st.size !== size) continue;
    own ??= digest(file);
    if (digest(join(dir, name)) === own) return `references/${name}`;
  }
  return null;
};
