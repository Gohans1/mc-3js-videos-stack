import { relative } from "node:path";

import { latestStudy } from "./ref-cuts.mjs";

const STRONG = 0.5;
const EARLY = 0.5;
const LATE = 0.1;

export const refCoverage = (project, { cameraUntil, cameraCuts, sfx, text }) => {
  const study = latestStudy(project);
  if (!study?.seconds) return null;
  const seconds = study.seconds;
  const cutNear = Math.max(0.05, 1.5 / study.fps);
  const within = (list, near) => (t) => list.some((x) => Math.abs(x - t) <= near);
  const spans = text
    .map(([a, b]) => [Math.max(0, a), Math.min(seconds, b)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let shown = 0,
    reach = 0;
  for (const [a, b] of spans) {
    shown += Math.max(0, b - Math.max(a, reach));
    reach = Math.max(reach, b);
  }
  const share = (x) => +(x / seconds).toFixed(2);
  const accents = study.hits.filter((h) => !(h.strength < STRONG)).map((h) => h.at);
  const picture = Math.min(seconds, Math.max(0, cameraUntil));
  return {
    study: relative(project, study.file).replaceAll("\\", "/"),
    seconds,
    picture: { seconds: +picture.toFixed(2), share: share(picture) },
    cuts: { matched: study.cuts.filter(within(cameraCuts, cutNear)).length, of: study.cuts.length },
    sounds: {
      matched: accents.filter((h) => sfx.some((x) => x >= h - EARLY && x <= h + LATE)).length,
      of: accents.length,
    },
    text: { seconds: +shown.toFixed(2), share: share(shown) },
  };
};

const pct = (x) => `${Math.round(x * 100)}%`;
export const formatCoverage = (c) =>
  `coverage of the reference (${c.study}, ${c.seconds} s): picture keyed ${c.picture.seconds} s (${pct(c.picture.share)}), cuts ${c.cuts.matched} of ${c.cuts.of}, strong sound hits with an sfx ${c.sounds.matched} of ${c.sounds.of} (${pct(c.sounds.of ? c.sounds.matched / c.sounds.of : 0)}), on-screen text ${c.text.seconds} s (${pct(c.text.share)})`;
