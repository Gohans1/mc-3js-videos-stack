// What a render spends drawing, per stretch between the render's cuts (heard seconds), in ms a camera sample so a whip's
// extra shutter samples weigh no more. Each stretch is judged by its median frame (a set's first frame compiles its
// shaders, a cold run starts slow) and only with FRAMES frames or more: one at over twice the median of the others, and
// past a 30 fps frame's FRAME_MS, is a set to look into before the studio stutters on it
const FRAMES = 10,
  FRAME_MS = 33;

// the lower middle: of two stretches, the lighter is the typical one
const median = (values) => values.toSorted((a, b) => a - b)[Math.floor((values.length - 1) / 2)];

export const renderCost = (cuts) => {
  const stretches = [0, ...cuts].map(() => ({ each: [], from: Infinity, to: -Infinity }));
  return {
    add(t, ms, samples) {
      const s = stretches[cuts.filter((c) => c <= t + 1e-9).length];
      s.each.push(ms / samples);
      s.from = Math.min(s.from, t);
      s.to = Math.max(s.to, t);
    },
    line() {
      const judged = stretches
        .filter((s) => s.each.length >= FRAMES)
        .map((s) => ({ ...s, ms: median(s.each) }));
      if (!judged.length) {
        const all = stretches.flatMap((s) => s.each);
        return all.length ? `cost: ${Math.round(median(all))} ms a sample` : "";
      }
      if (judged.length === 1) return `cost: ${Math.round(judged[0].ms)} ms a sample`;
      const heavy = judged.flatMap((s) => {
        const others = median(judged.filter((o) => o !== s).map((o) => o.ms));
        return s.ms > 2 * others && s.ms > FRAME_MS ? [{ ...s, x: s.ms / others }] : [];
      });
      const typical = median(
        judged.filter((s) => !heavy.some((h) => h.from === s.from)).map((s) => s.ms),
      );
      const named = heavy.map(
        (s) =>
          `${s.from.toFixed(2)}-${s.to.toFixed(2)} s draws ${Math.round(s.ms)} ms (x${s.x.toFixed(1)})`,
      );
      const unnamed = judged.length - heavy.length;
      return `cost: ${Math.round(typical)} ms a sample, the median of ${
        heavy.length
          ? `${unnamed} of ${judged.length} stretches between cuts, the ones not named here`
          : `${judged.length} stretches between cuts`
      }; ${
        named.length
          ? `${named.join(", ")}: AT=${heavy[0].from.toFixed(2)} LIST=1 bun run render stills shows what is in view there`
          : `none past twice that and ${FRAME_MS} ms`
      }`;
    },
  };
};
