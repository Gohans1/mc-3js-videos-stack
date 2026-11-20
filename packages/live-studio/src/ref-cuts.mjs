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
      hits: (data.sound?.hits ?? []).map((h) => h?.at).filter(Number.isFinite),
    };
  } catch {
    return null;
  }
};

const s = (t) => `${+t.toFixed(2)} s`;

// A remake cuts where its reference cuts. The camera's cut seconds are heard seconds; until is the last heard second the
// camera is keyed to, so the part of the reference not built yet is not reported
export const refCutsWarning = (project, cameraCuts, until) => {
  const study = latestStudy(project);
  if (!study) return "";
  const near = Math.max(0.05, 1.5 / study.fps);
  const close = (a) => (b) => Math.abs(a - b) <= near;
  const extra = cameraCuts.filter((t) => !study.cuts.some(close(t)));
  const missing = study.cuts.filter((t) => t <= until + near && !cameraCuts.some(close(t)));
  if (!extra.length && !missing.length) return "";
  const where = relative(project, study.file).replaceAll("\\", "/");
  return [
    `⚠ src/timeline/cam.json ${[
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
