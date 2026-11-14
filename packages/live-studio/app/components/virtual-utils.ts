export function chunkRows<T>(items: readonly T[], cols: number): T[][] {
  if (!items.length) return [];
  const step = Math.max(1, Math.floor(cols));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += step) out.push(items.slice(i, i + step));
  return out;
}

export function tableSpacers(
  items: readonly { start: number; end: number }[],
  totalSize: number,
): { top: number; bottom: number } {
  if (!items.length) return { top: 0, bottom: 0 };
  const top = Math.max(0, items[0]!.start);
  const lastEnd = items[items.length - 1]!.end;
  const bottom = Math.max(0, totalSize - lastEnd);
  return { top, bottom };
}
