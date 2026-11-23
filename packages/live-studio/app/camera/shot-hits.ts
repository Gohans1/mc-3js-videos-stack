export type ShotHit = { t: number; [k: string]: unknown };

const asHitList = (v: unknown): ShotHit[] =>
  Array.isArray(v)
    ? v.filter((h): h is ShotHit =>
        Boolean(h && typeof h === "object" && typeof (h as { t?: unknown }).t === "number"),
      )
    : [];

export function splitShotHits(
  hits: unknown,
  splitSource: number,
): { before: ShotHit[] | undefined; after: ShotHit[] | undefined } {
  const list = asHitList(hits);
  if (!list.length) return { before: undefined, after: undefined };
  const before = list.filter((h) => h.t < splitSource);
  const after = list.filter((h) => h.t >= splitSource);
  return {
    before: before.length ? structuredClone(before) : undefined,
    after: after.length ? structuredClone(after) : undefined,
  };
}

export function mergeShotHits(prev: unknown, next: unknown): ShotHit[] | undefined {
  const nextList = asHitList(next);
  if (!nextList.length) {
    const prevList = asHitList(prev);
    return prevList.length ? prevList : undefined;
  }
  const merged = [...structuredClone(asHitList(prev)), ...structuredClone(nextList)].sort(
    (a, b) => a.t - b.t,
  );
  return merged.length ? merged : undefined;
}

export function repartitionAdjacentHits(
  prevHits: unknown,
  nextHits: unknown,
  cutSource: number,
): { prev: ShotHit[] | undefined; next: ShotHit[] | undefined } {
  const combined = mergeShotHits(prevHits, nextHits);
  if (!combined) return { prev: undefined, next: undefined };
  const { before, after } = splitShotHits(combined, cutSource);
  return { prev: before, next: after };
}
