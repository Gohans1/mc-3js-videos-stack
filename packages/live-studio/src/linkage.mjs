export const LINKAGE_DEFAULTS = {
  text: true,
  adjustment: true,
  audio: false,
  sfx: true,
  voice: true,
};
export const LINKAGE_KINDS = Object.keys(LINKAGE_DEFAULTS);
export const timingPlan = ({ speeds = [], freezes = [], cuts = [], gaps = [], main }) =>
  structuredClone({ speeds, freezes, cuts, gaps, ...(main && { main }) });

export const recordLinkage = (timing, before, after, enabled, settings) => {
  timing.layerKinds ??= {};
  for (const kind of LINKAGE_KINDS) {
    const history = (timing.layerKinds[kind] ??= structuredClone(
      timing.layers ?? { base: before, changes: [] },
    ));
    if (enabled && settings[kind])
      history.changes.push({ before: structuredClone(before), after: structuredClone(after) });
  }
};
