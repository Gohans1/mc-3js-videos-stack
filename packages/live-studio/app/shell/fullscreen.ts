import { useSyncExternalStore } from "react";

import { S } from "../core/state";
import { say } from "../core/store";

export const canFullscreen = () => document.fullscreenEnabled;
export const toggleFullscreen = () => {
  if (document.fullscreenElement) {
    document.exitFullscreen();
    return;
  }
  S.el?.view.requestFullscreen().catch(() => say("The browser didn't allow full screen"));
};
const listen = (f: () => void) => {
  document.addEventListener("fullscreenchange", f);
  return () => document.removeEventListener("fullscreenchange", f);
};
export const useFullscreen = () => useSyncExternalStore(listen, () => !!document.fullscreenElement);
