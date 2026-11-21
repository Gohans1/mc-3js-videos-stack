// What a render spends drawing, per stretch between the render's cuts (heard seconds), in ms a camera sample so a whip's
// extra shutter samples weigh no more. Each stretch is judged by its median frame (a set's first frame compiles its
// shaders, a cold run starts slow) and only with FRAMES frames or more: one at over twice the median of the others is a
// set to profile before the studio stutters on it
const FRAMES = 10;

const median = (values) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];

export const renderCost = (cuts, duration) => {
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
      const typical = median(judged.map((s) => s.ms));
      if (judged.length === 1) return `cost: ${Math.round(typical)} ms a sample`;
      const heavy = judged.filter((s) => s.ms > 2 * typical);
      const named = heavy.map(
        (s) =>
          `${s.from.toFixed(2)}-${Math.min(s.to, duration).toFixed(2)} s draws ${Math.round(s.ms)} ms (x${(s.ms / typical).toFixed(1)})`,
      );
      return `cost: ${Math.round(typical)} ms a sample, the median of ${judged.length} stretches between cuts; ${
        named.length ? `${named.join(", ")}: profile what it shows there` : "none past twice that"
      }`;
    },
  };
};
