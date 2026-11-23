const FRAMES = 10,
  FRAME_MS = 33;

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
          ? `${named.join(", ")}: bun run render stills --at ${heavy[0].from.toFixed(2)} --list shows what is in view there`
          : `none past twice that and ${FRAME_MS} ms`
      }`;
    },
  };
};
