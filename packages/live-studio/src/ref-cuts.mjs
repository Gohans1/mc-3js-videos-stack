import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

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
      whips: (data.motion?.whips ?? []).filter(
        (w) => Number.isFinite(w?.from) && Number.isFinite(w?.to),
      ),
    };
  } catch {
    return null;
  }
};

const sec = (t) => `${+t.toFixed(2)} s`;

export const whipAt = (study, t) => {
  const near = 1.5 / study.fps;
  return study.whips?.find((w) => t >= w.from - near && t <= w.to + near) ?? null;
};

const VIDEO = /\.(mp4|mov|mkv|webm|m4v)$/i;
const referenceVideos = (project) => {
  const dir = join(project, "references");
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => VIDEO.test(f) && !f.includes("-source."))
        .toSorted()
    : [];
};

export const referenceVideo = (project) => {
  const names = referenceVideos(project);
  const studied = latestStudy(project)?.file.split(/[\\/]/).at(-3);
  const name =
    names.find((f) => f.replace(/\.[^.]+$/, "") === studied) ??
    names.find((f) => f.startsWith("ref."));
  return name ? `references/${name}` : null;
};

export const unstudiedWarning = (project) => {
  if (latestStudy(project)) return "";
  const name = referenceVideos(project)[0];
  const video = name && (referenceVideo(project) ?? `references/${name}`);
  return video
    ? `⚠ ${video} has no study, so check can neither match its cuts nor count coverage: bun run reference study ${video}`
    : "";
};

const whipSaid = (w) => `${w.camera} ${+w.from.toFixed(2)}-${+w.to.toFixed(2)}`;

export const cutItems = (study, cuts, until, transitions = []) => {
  const near = Math.max(0.05, 1.5 / study.fps);
  const close = (a) => (b) => Math.abs(a - b) <= near;
  const items = [];
  for (const t of cuts.filter((c) => !study.cuts.some(close(c)) && !transitions.some(close(c)))) {
    const w = whipAt(study, t);
    items.push(
      w
        ? {
            from: t,
            to: t,
            kind: "cut in a whip",
            weight: 2,
            side: "ours",
            whip: whipSaid(w),
            say: `ours cuts inside the reference's whip (${whipSaid(w)}), which has no cut here: right for a whip transition, a jump if the swing should carry on`,
          }
        : {
            from: t,
            to: t,
            kind: "extra cut",
            weight: 4,
            say: "ours cuts where the reference does not: a jump in the middle of its move",
          },
    );
  }
  for (const t of study.cuts.filter((c) => c <= until + near && !cuts.some(close(c)))) {
    const w = whipAt(study, t);
    items.push(
      w
        ? {
            from: t,
            to: t,
            kind: "cut in a whip",
            weight: 2,
            side: "reference",
            whip: whipSaid(w),
            say: `the reference cuts inside its whip (${whipSaid(w)}) and ours does not: a whip transition, or only a fast move the study took for a cut`,
          }
        : {
            from: t,
            to: t,
            kind: "missing cut",
            weight: 3,
            say: "the reference cuts here and ours does not",
          },
    );
  }
  return items;
};

export const refCutsWarning = (project, camFile, cameraCuts, until, transitions = []) => {
  const study = latestStudy(project);
  if (!study) return "";
  const items = cutItems(study, cameraCuts, until, transitions);
  if (!items.length) return "";
  const of = (kind) => items.filter((x) => x.kind === kind);
  const [extra, missing, looks] = ["extra cut", "missing cut", "cut in a whip"].map(of);
  const [oursInWhip, refInWhip] = ["ours", "reference"].map((side) =>
    looks
      .filter((x) => x.side === side)
      .map((x) => `${sec(x.from)} (${x.whip})`)
      .join(", "),
  );
  const where = relative(project, study.file).replaceAll("\\", "/");
  return [
    `⚠ ${camFile} ${[
      extra.length &&
        `cuts at ${extra.map((x) => sec(x.from)).join(", ")}, where the reference does not cut (a jump in the middle of its move)`,
      missing.length &&
        `the reference cuts at ${missing.map((x) => sec(x.from)).join(", ")} and the camera does not`,
      oursInWhip &&
        `cuts inside the reference's whips at ${oursInWhip}, where it has no cut: right for a whip transition, a jump if the swing should carry on`,
      refInWhip &&
        `the reference cuts inside its own whips at ${refInWhip} and the camera does not: a whip transition, or only a fast move the study took for a cut`,
    ]
      .filter(Boolean)
      .join("; ")}; reference cuts from ${where}.`,
    `  a remake cuts only where its reference does: set "cut": true there and nowhere else, then bun run render stills --check motion:cam,<from s>,<to s> over each changed span. A cut the study made of a whip or flash: look at the reference frames there before matching it`,
  ].join("\n");
};

const digest = (file) => createHash("sha1").update(readFileSync(file)).digest("hex");
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
