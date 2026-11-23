import { layerItems } from "../camera/layers";
import { shotEnd, shotIndex } from "../core/film";
import { DURATION, SHOTS_OUT as SHOTS } from "../core/filmMeta";
import { S } from "../core/state";
import { stored } from "../core/storage";
import { get, say, set } from "../core/store";
import { r3, rangeText } from "../core/time";
import { span } from "../sound/sound";

export type InOut = [number, number];
const KEY = "inOut";

const keep = (raw: InOut | null) => {
  const r = raw && (raw.map(r3) as InOut);
  set({ inOut: r });
  if (r) stored.set(KEY, JSON.stringify(r), sessionStorage);
  else stored.remove(KEY, sessionStorage);
  S.dirty = true;
  if (r)
    say(`In to Out: ${rangeText(r)}. A note written inside it is about all of it. Alt+X clears it`);
};
export const restoreInOut = () => {
  let r: unknown = null;
  try {
    r = JSON.parse(stored.get(KEY, sessionStorage) ?? "null");
  } catch {}
  if (
    Array.isArray(r) &&
    r.length === 2 &&
    r.every(Number.isFinite) &&
    r[0] < r[1] &&
    r[1] <= DURATION
  )
    set({ inOut: r as InOut });
};

export const setIn = () => {
  const t = S.t,
    b = get().inOut?.[1] ?? DURATION;
  keep([t, t < b ? b : DURATION]);
};
export const setOut = () => {
  const t = S.t,
    a = get().inOut?.[0] ?? 0;
  if (t <= 0) return;
  keep([t > a ? a : 0, t]);
};
export const clearInOut = () => {
  if (!get().inOut) return;
  keep(null);
  say("In and Out cleared");
};
export const inOutByClip = () => {
  const { clips, shotPick, layerPicks } = get();
  const spans = [
      ...clips.map(span),
      ...layerItems()
        .filter((it) => layerPicks.includes(it.id))
        .map((it) => [it.from, it.to]),
    ],
    i = shotPick ?? shotIndex(S.t);
  keep(
    spans.length
      ? [
          Math.min(...spans.map((s) => s[0])),
          Math.min(DURATION, Math.max(...spans.map((s) => s[1]))),
        ]
      : [SHOTS[i].t, shotEnd(i)],
  );
};
export const inOutAt = (t: number) => {
  const r = get().inOut;
  return r && t >= r[0] - 1e-6 && t <= r[1] + 1e-6 ? r : undefined;
};
