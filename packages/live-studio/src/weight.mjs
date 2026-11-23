export const BUDGET = 10e6;
const NAMED = 1e6;

const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;

export const weighFirstVisit = (files) => {
  const sizes = new Map();
  for (const { path, bytes } of files) sizes.set(path, Math.max(sizes.get(path) ?? 0, bytes));
  const total = [...sizes.values()].reduce((a, b) => a + b, 0);
  if (total <= BUDGET) return null;
  const big = [...sizes]
    .filter(([, b]) => b >= NAMED)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  return {
    names: big.map(([p]) => p).join(" "),
    text:
      `a first visit from a phone or over Tailscale downloads ${mb(total)}, over the ${mb(BUDGET)} budget. ` +
      `Biggest: ${big.map(([p, b]) => `${p} ${mb(b)}`).join(", ")}. Load only what the page needs from them`,
  };
};
