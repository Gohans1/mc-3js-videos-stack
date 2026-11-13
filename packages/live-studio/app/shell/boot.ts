// The page's one start, shared by the desk layout (App.tsx) and the phone's (PhoneApp.tsx): the film is built into the
// elements the layout bound, and the page-wide listeners go on once
import { type RefObject, useEffect } from "react";

import type { Elements } from "../core/state";
import { set, showError } from "../core/store";
import { start } from "../start";

let started = false;

// A button keeps focus after a mouse click, and Space would then press it instead of playing. From the keyboard focus stays,
// so Space presses the control as usual. A popup trigger keeps focus while its popup is open: the popup needs it
const dropClickFocus = (e: MouseEvent) => {
  if (!e.detail) return;
  // Judged once the browser is done with the click: a label passes it on to its switch, which takes focus only then. By that
  // time React has drawn the result too, so a trigger whose popup this click closed shows aria-expanded="false"
  setTimeout(() => {
    const at = document.activeElement;
    if (
      at instanceof HTMLElement &&
      at.matches("button, summary, [role=tab], [role=switch], [role=checkbox], [role=radio]") &&
      !at.matches("[aria-haspopup][aria-expanded=true]")
    )
      at.blur();
  });
};

export const useBoot = (el: RefObject<Elements>) =>
  useEffect(() => {
    if (started) return;
    started = true;
    start(el.current).catch((e: Error) => {
      showError(e);
      set({ loading: "" });
    });
    addEventListener("click", dropClickFocus);
    // A slider keeps focus after a drag too, and its arrows would then move it instead of stepping the film
    addEventListener("pointerup", () => {
      const at = document.activeElement;
      if (at instanceof HTMLInputElement && at.type === "range") at.blur();
    });
    // Chrome reports a ResizeObserver that skipped a frame as an error; it isn't one
    addEventListener("error", (e) => {
      if (!e.message.startsWith("ResizeObserver loop")) showError(e.error ?? e.message);
    });
    addEventListener("unhandledrejection", (e) => showError(e.reason));
  }, [el]);
