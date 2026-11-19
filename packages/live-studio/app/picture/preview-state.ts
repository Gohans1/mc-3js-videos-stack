import { PHONE } from "../core/device";
import { S } from "../core/state";
import { get, set } from "../core/store";
import type { PreviewOptions } from "./preview-model";

export const changePreview = (patch: Partial<PreviewOptions>) => {
  set({ preview: { ...get().preview, ...patch } });
  S.dirty = true;
  S.finalAt = -1;
};

export const picturePoint = (e: Pick<MouseEvent, "clientX" | "clientY">, target: Element) => {
  const r = target.getBoundingClientRect();
  const x = r.width ? (e.clientX - r.left) / r.width : 0;
  const y = r.height ? (e.clientY - r.top) / r.height : 0;
  return [!PHONE && get().preview.mirror ? 1 - x : x, y] as const;
};
