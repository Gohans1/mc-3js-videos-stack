import { S } from "../core/state";
import { get, say, set } from "../core/store";
// A still of the picture to compare against later, as After Effects' snapshot: take one before a change (Shift+\), hold \ (or
// the Compare button) after it to see the old picture over the new one. Kept for the session only
import { stamp } from "../core/time";
import { frameSize } from "./frame";
import { finalCanvas } from "./render";

export const takeSnapshot = () => {
  if (!S.render) return;
  const c = document.createElement("canvas");
  [c.width, c.height] = frameSize(1280); // the film's shape: 1280×720, or 720×1280 for a Short
  // The film's own draw, not render.ts's: the gizmo and the selection box are no part of the picture
  const from = finalCanvas() ?? (S.render(S.t), S.el.canvas);
  c.getContext("2d")!.drawImage(from, 0, 0, c.width, c.height);
  S.dirty = true;
  set({ still: { url: c.toDataURL("image/jpeg", 0.9), t: S.t }, comparing: false });
  say(`Snapshot taken at ${stamp(S.t)}. Make the change, then hold \\ to compare`);
};
export const compare = (on: boolean) => {
  if (get().still || !on) set({ comparing: on && !!get().still });
};
