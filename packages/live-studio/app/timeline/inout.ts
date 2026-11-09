// CapCut's In and Out points (I, O; in either order): a stretch of the film marked on the ruler, the rest dimmed. CapCut
// exports only that stretch; the studio has no export, so here a note written inside it is about the whole stretch (its range,
// as a note drawn across seconds has), which the AI reads instead of one moment, and played from inside it the film loops it
// (playback/transport.ts). Shift+X marks the picked sound clips, the
// picked shot or the shot at the playhead (CapCut's Select by clip); Alt+X clears it. Kept for the tab, as the playhead is
import { layerItems } from "../camera/layers";
import { DURATION, SHOTS_OUT as SHOTS } from "film/scene";
import { shotEnd, shotIndex } from "../core/film";
import { S } from "../core/state";
import { stored } from "../core/storage";
import { r3, rangeText } from "../core/time";
import { get, say, set } from "../core/store";
import { span } from "../sound/sound";

export type InOut = [number, number];
const KEY = "inOut";

const keep = (raw: InOut | null) => {
  const r = raw && (raw.map(r3) as InOut);
  set({ inOut: r });
  if (r) stored.set(KEY, JSON.stringify(r), sessionStorage); else stored.remove(KEY, sessionStorage);
  S.dirty = true;
  if (r) say(`In to Out: ${rangeText(r)}. A note written inside it is about all of it. Alt+X clears it`);
};
// The stretch this tab had marked, back after a reload
export const restoreInOut = () => {
  let r: unknown = null;
  try { r = JSON.parse(stored.get(KEY, sessionStorage) ?? "null"); } catch {}
  if (Array.isArray(r) && r.length === 2 && r.every(Number.isFinite) && r[0] < r[1] && r[1] <= DURATION) set({ inOut: r as InOut });
};

// A point past the other one starts the stretch again from that end of the film
export const setIn = () => { const t = S.t, b = get().inOut?.[1] ?? DURATION; keep([t, t < b ? b : DURATION]); };
export const setOut = () => { const t = S.t, a = get().inOut?.[0] ?? 0; if (t <= 0) return; keep([t > a ? a : 0, t]); };
export const clearInOut = () => { if (!get().inOut) return; keep(null); say("In and Out cleared"); };
export const inOutByClip = () => {
  const { clips, shotPick, layerPicks } = get();
  const spans = [...clips.map(span), ...layerItems().filter((it) => layerPicks.includes(it.id)).map((it) => [it.from, it.to])], i = shotPick ?? shotIndex(S.t);
  keep(spans.length ? [Math.min(...spans.map((s) => s[0])), Math.min(DURATION, Math.max(...spans.map((s) => s[1])))] : [SHOTS[i].t, shotEnd(i)]);
};
// The stretch a note written at second t is about, if t is inside it
export const inOutAt = (t: number) => { const r = get().inOut; return r && t >= r[0] - 1e-6 && t <= r[1] + 1e-6 ? r : undefined; };
