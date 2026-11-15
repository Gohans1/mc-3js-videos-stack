// Pure highlight state helpers for AI activity notifications (shared by activity.ts and tests).
export const LIT_MS = 12_000;

export type LitMap = Record<string, number>;

export const pruneLitMap = (lit: LitMap, now = Date.now()): LitMap => {
  let stale = false;
  for (const k in lit) {
    if (lit[k] <= now) {
      stale = true;
      break;
    }
  }
  if (!stale) return lit;
  const next: LitMap = {};
  for (const k in lit) {
    if (lit[k] > now) next[k] = lit[k];
  }
  return next;
};

export const mergeLitKeys = (lit: LitMap, keys: readonly string[], now = Date.now()): LitMap => {
  if (!keys.length) return lit;
  const next: LitMap = { ...pruneLitMap(lit, now) };
  const until = now + LIT_MS;
  for (const k of keys) next[k] = until;
  return next;
};

export const anyKeyLit = (lit: LitMap, keys: readonly string[], now = Date.now()): boolean => {
  for (const k of keys) {
    if ((lit[k] ?? 0) > now) return true;
  }
  return false;
};
