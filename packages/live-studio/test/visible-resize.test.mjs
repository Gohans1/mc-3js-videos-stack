import { describe, expect, test } from "bun:test";

import * as visible from "../app/timeline/visible.ts";

describe("timeline visibility cache and ResizeObserver ordering", () => {
  test("onShownResize updates shown before firing callbacks and invalidateShown clears hidden cache", () => {
    const prevRO = globalThis.ResizeObserver;
    const observers = [];
    globalThis.ResizeObserver = class FakeResizeObserver {
      constructor(cb) {
        this.observed = new Set();
        this.cb = cb;
        observers.push(this);
      }
      observe(el) {
        this.observed.add(el);
      }
      unobserve(el) {
        this.observed.delete(el);
      }
      disconnect() {
        this.observed.clear();
      }
    };

    try {
      let shownRects = 0;
      const el = {
        isConnected: true,
        getClientRects: () => (shownRects ? [{ width: 200, height: 28 }] : []),
      };

      expect(visible.isElementShown(el)).toBe(false);

      shownRects = 1;
      expect(visible.isElementShown(el)).toBe(false);

      expect(typeof visible.invalidateShown).toBe("function");
      expect(typeof visible.onShownResize).toBe("function");

      visible.invalidateShown();
      expect(visible.isElementShown(el)).toBe(true);

      shownRects = 0;
      visible.invalidateShown(el);
      expect(visible.isElementShown(el)).toBe(false);

      const seenInsideCallback = [];
      const stop = visible.onShownResize(el, () => {
        seenInsideCallback.push(visible.isElementShown(el));
      });

      shownRects = 1;
      for (const ro of observers) {
        if (ro.observed.has(el)) {
          ro.cb([{ target: el, contentRect: { width: 200, height: 28 } }]);
        }
      }
      expect(seenInsideCallback).toEqual([true]);

      stop();
      for (const ro of observers) {
        if (ro.observed.has(el)) {
          ro.cb([{ target: el, contentRect: { width: 240, height: 28 } }]);
        }
      }
      expect(seenInsideCallback).toEqual([true]);
    } finally {
      globalThis.ResizeObserver = prevRO;
    }
  });
});
