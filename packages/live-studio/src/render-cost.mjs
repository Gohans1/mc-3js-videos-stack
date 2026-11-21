// What a render clip spends drawing, per stretch between the render's cuts (heard seconds), in ms a camera sample so a
// whip's extra shutter samples weigh no more: a stretch at over twice the median is a set to profile before the studio
// stutters on it
export const renderCost = (cuts, duration) => {
  const edges = [0, ...cuts, duration];
  const spent = edges.slice(1).map(() => ({ ms: 0, samples: 0 }));
  return {
    add(t, ms, samples) {
      const i = cuts.filter((c) => c <= t + 1e-9).length;
      spent[i].ms += ms;
      spent[i].samples += samples;
    },
    line() {
      const drawn = spent
        .map((s, i) => ({ from: edges[i], to: edges[i + 1], each: s.ms / s.samples }))
        .filter((s) => Number.isFinite(s.each));
      if (!drawn.length) return "";
      const median = drawn.map((s) => s.each).toSorted((a, b) => a - b)[
        Math.floor(drawn.length / 2)
      ];
      const heavy = drawn.filter((s) => s.each > 2 * median);
      return `cost: ${Math.round(median)} ms a sample, the median of ${drawn.length} stretch${drawn.length > 1 ? "es" : ""} between cuts; ${
        heavy.length
          ? `${heavy
              .map(
                (s) =>
                  `${s.from.toFixed(2)}-${s.to.toFixed(2)} s draws ${Math.round(s.each)} ms (x${(s.each / median).toFixed(1)})`,
              )
              .join(", ")}: profile what it shows there`
          : "none past twice that"
      }`;
    },
  };
};
