import { equalJson } from "./merge-edits.mjs";

export const LINKAGE_DEFAULTS = {
  text: true,
  overlays: true,
  adjustment: true,
  audio: false,
  sfx: true,
  voice: true,
};
export const LINKAGE_KINDS = Object.keys(LINKAGE_DEFAULTS);
export const timingPlan = ({ speeds = [], freezes = [], cuts = [], gaps = [], main }) =>
  structuredClone({ speeds, freezes, cuts, gaps, ...(main && { main }) });

const canonicalPlan = (p = {}) => ({
  ...p,
  speeds: p.speeds ?? [],
  freezes: p.freezes ?? [],
  cuts: p.cuts ?? [],
  gaps: p.gaps ?? [],
  ...(p.main ? { main: p.main } : {}),
});
const equalPlan = (a, b) => equalJson(canonicalPlan(a), canonicalPlan(b));
// Pure speed plans (no freezes, cuts, gaps, or main-track clips) are strictly bijective and visibility-preserving,
// so consecutive transitions fold algebraically without altering compileLayerTiming output.
const isPureSpeedPlan = (p) =>
  !p?.freezes?.length && !p?.cuts?.length && !p?.gaps?.length && !p?.main;

const compactHistory = (history) => {
  const folded = [];
  for (const entry of history.changes) {
    if (equalPlan(entry.before, entry.after)) continue;
    const prev = folded.at(-1);
    if (
      prev &&
      isPureSpeedPlan(prev.before) &&
      isPureSpeedPlan(prev.after) &&
      isPureSpeedPlan(entry.before) &&
      isPureSpeedPlan(entry.after) &&
      equalPlan(prev.after, entry.before)
    ) {
      if (equalPlan(prev.before, entry.after)) folded.pop();
      else prev.after = structuredClone(entry.after);
      continue;
    }
    folded.push(entry);
  }
  while (folded.length > 0) {
    const first = folded[0];
    if (
      isPureSpeedPlan(history.base) &&
      isPureSpeedPlan(first.before) &&
      isPureSpeedPlan(first.after) &&
      equalPlan(history.base, first.before)
    ) {
      history.base = structuredClone(first.after);
      folded.shift();
      continue;
    }
    break;
  }
  history.changes = folded;
};

export const recordLinkage = (timing, before, after, enabled, settings) => {
  if (equalPlan(before, after)) return;
  timing.layerKinds ??= {};
  for (const kind of LINKAGE_KINDS) {
    const history = (timing.layerKinds[kind] ??= structuredClone(
      timing.layers ?? { base: before, changes: [] },
    ));
    if (enabled && settings[kind])
      history.changes.push({ before: structuredClone(before), after: structuredClone(after) });
    compactHistory(history);
  }
  if (
    !timing.layers &&
    Object.values(timing.layerKinds).every(
      (h) => h.changes.length === 0 && equalPlan(h.base, after),
    )
  ) {
    delete timing.layerKinds;
  }
};
