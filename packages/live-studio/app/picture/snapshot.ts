import { S } from "../core/state";
import { get, say, set } from "../core/store";
import { stamp } from "../core/time";
import { frameSize } from "./frame";
import { capturePreviewFrame } from "./render";
import type { PinnedAngle } from "./slice";

export const takeSnapshot = async (slot?: number) => {
  if (!S.render) return;
  const t = S.t;
  const c = document.createElement("canvas");
  [c.width, c.height] = frameSize(1280);
  let still: PinnedAngle | undefined;
  await capturePreviewFrame(t, slot !== undefined, (from, view) => {
    c.getContext("2d")!.drawImage(from, 0, 0, c.width, c.height);
    still = { url: c.toDataURL("image/jpeg", 0.9), t, view };
  });
  if (!still) return say("Camera moved during capture. Pin the angle again when it is still.");
  if (slot !== undefined) {
    const pin = still;
    set({ pinnedAngles: get().pinnedAngles.map((current, i) => (i === slot ? pin : current)) });
    return;
  }
  set({ still: { url: still.url, t }, comparing: false });
  say(`Snapshot taken at ${stamp(t)}. Make the change, then hold \\ to compare`);
};
export const compare = (on: boolean) => {
  if (get().still || !on) set({ comparing: on && !!get().still });
};
