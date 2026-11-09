import { DURATION, SHOTS_OUT } from "film/scene";
import { S } from "../core/state";
import { say, set } from "../core/store";
import { pickShot } from "./anim";
import { shotsDoc } from "./shots";

export interface Transition { fx: string; len: number }
export const transitions = () => S.render?.transitions ?? [];
export const transitionOf = (shot: number) => shotsDoc.data?.[shot]?.transition as Transition | undefined;
export const transitionRoom = (shot: number) => shot > 0 && SHOTS_OUT[shot]
  ? Math.max(0, Math.min(SHOTS_OUT[shot].t - SHOTS_OUT[shot - 1].t, (SHOTS_OUT[shot + 1]?.t ?? DURATION) - SHOTS_OUT[shot].t)) : 0;
export const transitionDuration = (shot: number) => Math.min(transitionOf(shot)?.len ?? 0.5, transitionRoom(shot));
export const TRANSITION_DRAG = "application/x-studio-transition";
export function pickTransition(shot: number) {
  pickShot(shot);
  set({ side: "transition" });
}
export function setTransition(shot: number, fx: string | null) {
  if (!transitionRoom(shot) || (fx && !transitions().some((x) => x.id === fx))) return;
  shotsDoc.edit((rows) => {
    if (fx) rows[shot].transition = { fx, len: transitionDuration(shot) };
    else delete rows[shot].transition;
  });
  say(fx ? `Transition added at shot ${shot}. Ctrl+Z to undo` : "Transition removed. Ctrl+Z to undo");
  if (fx) pickTransition(shot); else set({ side: "cam" });
}
export function applyTransitionToAll(shot: number) {
  const tr = transitionOf(shot);
  if (!tr) return;
  shotsDoc.edit((rows) => rows.forEach((row, i) => {
    if (transitionRoom(i)) row.transition = { ...tr, len: Math.min(tr.len, transitionRoom(i)) };
  }));
  say("Transition applied to all cuts. Ctrl+Z to undo");
}
export function setTransitionDuration(shot: number, value: number, keep = true) {
  const change = (rows: NonNullable<typeof shotsDoc.data>) => {
    const tr = rows[shot].transition as Transition | undefined;
    if (tr) tr.len = Math.min(transitionRoom(shot), Math.max(1 / 30, value));
  };
  if (keep) shotsDoc.edit(change); else shotsDoc.preview(change);
}
