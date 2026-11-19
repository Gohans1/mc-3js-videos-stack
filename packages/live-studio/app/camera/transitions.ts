import { extendedTransitions } from "film-stage/transition-extension";
import type { TransitionEase } from "film-stage/transitions";

import { effectLength, effectSpan, transitionAvailable } from "../../src/timing-effects.mjs";
import { timingClock } from "../../src/timing-state.mjs";
import { SHOTS_OUT } from "../core/filmMeta";
import { S } from "../core/state";
import { get, say, set } from "../core/store";
import { originalShot } from "../timeline/timing";
import { pickShot } from "./anim";
import { shotsDoc } from "./shots";
import { freshTransition, tidyTransition, type TransitionData } from "./transition-math";

export type Transition = TransitionData;
export const transitions = () => [
  ...new Map(
    [...extendedTransitions(), ...(S.render?.transitions ?? [])].map((fx) => [fx.id, fx]),
  ).values(),
];
const fxMeta = (id: string | undefined) =>
  id ? transitions().find((x) => x.id === id) : undefined;

const sourceRoom = (shot: number) => {
  if (shot <= 0 || !SHOTS_OUT[shot]) return 0;
  const [from, to] = originalShot(shot);
  return transitionAvailable(timingClock, from)
    ? Math.max(0, Math.min(from - originalShot(shot - 1)[0], to - from))
    : 0;
};
export const transitionOf = (shot: number) =>
  sourceRoom(shot) ? (shotsDoc.data?.[shot]?.transition as Transition | undefined) : undefined;
export const transitionSpan = (
  shot: number,
  length = Math.min(transitionOf(shot)?.len ?? 0.5, sourceRoom(shot)),
) => effectSpan(timingClock, originalShot(shot)[0], 0.5, 0.5, length);
export const transitionRoom = (shot: number) => {
  const room = sourceRoom(shot);
  if (!room) return 0;
  const [from, to] = transitionSpan(shot, room);
  return to - from;
};
export const transitionDuration = (shot: number) => {
  if (!sourceRoom(shot)) return 0;
  const [from, to] = transitionSpan(shot);
  return to - from;
};
const sourceLength = (shot: number, duration: number) =>
  effectLength(timingClock, originalShot(shot)[0], 0.5, 0.5, duration, sourceRoom(shot));
const valueOf = (shot: number, fx: string): Transition => {
  const cur = transitionOf(shot),
    meta = fxMeta(fx),
    defLen = meta?.len ?? 0.5;
  return freshTransition(
    cur,
    fx,
    sourceLength(shot, cur ? transitionDuration(shot) : defLen),
    meta,
  );
};
export const previewTransition = (shot: number, fx: string) =>
  shotsDoc.preview((rows) => {
    rows[shot].transition = valueOf(shot, fx);
  });
export const TRANSITION_DRAG = "application/x-studio-transition";
export function pickTransition(shot: number) {
  pickShot(shot, "transition");
}
export function setTransition(
  shot: number,
  fx: string | null,
  duration?: number,
  props?: { vars?: Record<string, string>; text?: Record<string, string> },
) {
  if (!transitionRoom(shot) || (fx && !transitions().some((x) => x.id === fx))) return;
  shotsDoc.edit((rows) => {
    if (fx)
      rows[shot].transition = {
        ...valueOf(shot, fx),
        ...(duration !== undefined && { len: sourceLength(shot, duration) }),
        ...(props && { props }),
      };
    else delete rows[shot].transition;
  });
  say(
    fx ? `Transition added at shot ${shot}. Ctrl+Z to undo` : "Transition removed. Ctrl+Z to undo",
  );
  if (fx) pickTransition(shot);
  else if (get().side === "transition") set({ side: "cam" });
}
export function applyTransitionToAll(shot: number) {
  const tr = transitionOf(shot);
  if (!tr) return;
  const duration = transitionDuration(shot);
  shotsDoc.edit((rows) =>
    rows.forEach((row, i) => {
      if (transitionRoom(i))
        row.transition = tidyTransition({ ...tr, len: sourceLength(i, duration) });
    }),
  );
  say("Transition applied to all cuts. Ctrl+Z to undo");
}
export function setTransitionDuration(shot: number, value: number, keep = true) {
  const change = (rows: NonNullable<typeof shotsDoc.data>) => {
    const tr = rows[shot].transition as Transition | undefined;
    if (tr)
      rows[shot].transition = tidyTransition({
        ...tr,
        len: sourceLength(shot, Math.max(1 / 30, value)),
      });
  };
  if (keep) shotsDoc.edit(change);
  else shotsDoc.preview(change);
}
export function setTransitionOption(
  shot: number,
  patch: {
    ease?: TransitionEase;
    feather?: number;
    flip?: boolean;
    props?: import("film-stage/openfilm-page").PageProps;
    params?: Transition["params"];
  },
  keep = true,
) {
  const change = (rows: NonNullable<typeof shotsDoc.data>) => {
    const tr = rows[shot].transition as Transition | undefined;
    if (tr) rows[shot].transition = tidyTransition({ ...tr, ...patch });
  };
  if (keep) shotsDoc.edit(change);
  else shotsDoc.preview(change);
}
export function resetTransition(shot: number) {
  shotsDoc.edit((rows) => {
    const tr = rows[shot].transition as Transition | undefined;
    if (!tr) return;
    const defLen = fxMeta(tr.fx)?.len ?? 0.5;
    rows[shot].transition = { fx: tr.fx, len: sourceLength(shot, defLen) };
  });
}
export function isTransitionDefault(shot: number) {
  const tr = transitionOf(shot);
  if (!tr) return true;
  const defLen = fxMeta(tr.fx)?.len ?? 0.5;
  return (
    Math.abs(tr.len - sourceLength(shot, defLen)) < 1e-3 &&
    !tr.ease &&
    tr.feather === undefined &&
    !tr.flip &&
    !tr.props &&
    !tr.params
  );
}
export function setTransitionEdge(shot: number, edge: number, output: number) {
  const center = originalShot(shot)[0];
  shotsDoc.preview((rows) => {
    const tr = rows[shot].transition as Transition | undefined;
    if (tr)
      tr.len = Math.min(
        sourceRoom(shot),
        Math.max(1e-4, 2 * edge * (timingClock.sourceAt(output) - center)),
      );
  });
}
