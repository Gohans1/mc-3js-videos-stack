import { type RefObject, useLayoutEffect } from "react";

import { afterPaint } from "../core/afterPaint";
import { type Elements, S } from "../core/state";
import { set, showError } from "../core/store";
import { warmBootRequests } from "../core/warmup";

let started = false;

const dropClickFocus = (e: MouseEvent) => {
  if (!e.detail) return;
  setTimeout(() => {
    const at = document.activeElement;
    if (
      at instanceof HTMLElement &&
      !at.closest("[data-cli-panel], [data-cli-dialog], [data-keep-click-focus]") &&
      at.matches("button, summary, [role=tab], [role=switch], [role=checkbox], [role=radio]") &&
      !at.closest('[role="dialog"], [role="alertdialog"]') &&
      !at.matches("[aria-haspopup][aria-expanded=true]")
    )
      at.blur();
  });
};

export const useBoot = (el: RefObject<Elements>) =>
  useLayoutEffect(() => {
    if (started) return;
    started = true;
    S.el = el.current;
    warmBootRequests();
    afterPaint()
      .then(() => import("../start"))
      .then(({ start }) => start(el.current))
      .catch((e: Error) => {
        showError(e);
        set({ loading: "" });
      });
    addEventListener("click", dropClickFocus);
    addEventListener("pointerup", () => {
      const at = document.activeElement;
      if (
        at instanceof HTMLInputElement &&
        at.type === "range" &&
        !at.closest('[role="dialog"], [role="alertdialog"]')
      )
        at.blur();
    });
    // Chrome reports a ResizeObserver that skipped a frame as an error; it isn't one
    addEventListener("error", (e) => {
      if (!e.message.startsWith("ResizeObserver loop")) showError(e.error ?? e.message);
    });
    addEventListener("unhandledrejection", (e) => showError(e.reason));
  }, [el]);
