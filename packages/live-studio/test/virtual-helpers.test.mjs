import { describe, test } from "bun:test";
import assert from "node:assert/strict";

import {
  chunkRows,
  measureVirtualElement,
  observeVirtualRect,
  scrollVirtualElement,
  tableGapBetween,
  tableSpacers,
} from "../app/components/virtual-utils.ts";

describe("virtual list & table helpers", () => {
  test("chunkRows groups items by column count without dropping tail items", () => {
    assert.deepEqual(chunkRows([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.deepEqual(chunkRows([1, 2, 3], 0), [[1], [2], [3]]);
    assert.deepEqual(chunkRows([], 3), []);
  });

  test("tableSpacers computes top and bottom spacer heights from virtual items", () => {
    assert.deepEqual(tableSpacers([], 0), { top: 0, bottom: 0 });
    assert.deepEqual(
      tableSpacers(
        [
          { start: 80, end: 120 },
          { start: 120, end: 165 },
        ],
        400,
      ),
      { top: 80, bottom: 235 },
    );
  });

  test("tableGapBetween preserves exact height when a focused row is pinned above or below viewport", () => {
    assert.equal(tableGapBetween(undefined, { index: 0, start: 0 }), 0);
    assert.equal(tableGapBetween({ index: 4, end: 260 }, { index: 5, start: 260 }), 0);
    assert.equal(tableGapBetween({ index: 2, end: 156 }, { index: 20, start: 1040 }), 884);
  });

  test("observeVirtualRect handles null elements, RO-less fallback, and ResizeObserver disconnect", () => {
    const calls = [];
    assert.equal(
      observeVirtualRect({ scrollElement: null }, (r) => calls.push(r)),
      undefined,
    );

    const origRO = globalThis.ResizeObserver;
    const el = { clientWidth: 320, clientHeight: 240 };
    try {
      globalThis.ResizeObserver = undefined;
      const stopNoRo = observeVirtualRect({ scrollElement: el }, (r) => calls.push(r));
      assert.equal(stopNoRo, undefined);
      assert.deepEqual(calls, [{ width: 320, height: 240 }]);

      let disconnected = 0;
      let trigger = null;
      let observedOptions = null;
      globalThis.ResizeObserver = class {
        constructor(cb) {
          trigger = () => cb([], this);
        }
        observe(_target, opts) {
          observedOptions = opts;
        }
        unobserve() {}
        disconnect() {
          disconnected++;
        }
      };
      const stop = observeVirtualRect({ scrollElement: el }, (r) => calls.push(r));
      assert.equal(typeof stop, "function");
      assert.deepEqual(observedOptions, { box: "content-box" });
      el.clientWidth = 480;
      trigger?.();
      assert.deepEqual(calls[calls.length - 1], { width: 480, height: 240 });
      stop?.();
      assert.equal(disconnected, 1);
    } finally {
      globalThis.ResizeObserver = origRO;
    }
  });

  test("measureVirtualElement uses entry box, cache, RO deferral, and getBoundingClientRect fallback", () => {
    const el = {
      getBoundingClientRect: () => ({ width: 99.4, height: 42.6 }),
    };
    const makeInstance = (horizontal = false) => ({
      indexFromElement: () => 1,
      itemSizeCache: new Map(),
      measurementsCache: [{ size: 30 }, { size: 52 }],
      options: {
        horizontal,
        getItemKey: (i) => i,
        estimateSize: () => 28,
      },
    });

    const entry = {
      borderBoxSize: [{ inlineSize: 120.4, blockSize: 64.6 }],
    };
    assert.equal(measureVirtualElement(el, entry, makeInstance(false)), 65);
    assert.equal(measureVirtualElement(el, entry, makeInstance(true)), 120);

    const cachedInst = makeInstance(false);
    cachedInst.itemSizeCache.set(1, 77);
    assert.equal(measureVirtualElement(el, undefined, cachedInst), 77);

    const origRO = globalThis.ResizeObserver;
    const origHtml = globalThis.HTMLElement;
    try {
      globalThis.ResizeObserver = class {};
      assert.equal(measureVirtualElement(el, undefined, makeInstance(false)), 52);
      assert.equal(measureVirtualElement(el, { borderBoxSize: [] }, makeInstance(false)), 43);

      class FakeHTMLElement {
        constructor() {
          this.offsetWidth = 211;
          this.offsetHeight = 58;
        }
        getBoundingClientRect() {
          return { width: 1, height: 1 };
        }
      }
      globalThis.HTMLElement = FakeHTMLElement;
      const htmlEl = new FakeHTMLElement();
      assert.equal(measureVirtualElement(htmlEl, { borderBoxSize: [] }, makeInstance(false)), 58);
      assert.equal(measureVirtualElement(htmlEl, { borderBoxSize: [] }, makeInstance(true)), 211);

      globalThis.ResizeObserver = undefined;
      assert.equal(measureVirtualElement(el, undefined, makeInstance(false)), 43);
      assert.equal(measureVirtualElement(el, undefined, makeInstance(true)), 99);
    } finally {
      globalThis.ResizeObserver = origRO;
      globalThis.HTMLElement = origHtml;
    }
  });

  test("scrollVirtualElement skips initial zero-offset scrollTo and executes non-zero / repeat scrolls", () => {
    const scrolls = [];
    const el = {
      scrollTo(opts) {
        scrolls.push(opts);
      },
    };
    const inst = { scrollElement: el, scrollOffset: 0, options: { horizontal: false } };

    scrollVirtualElement(0, {}, inst);
    assert.deepEqual(scrolls, []);

    scrollVirtualElement(120, { adjustments: 15 }, inst);
    assert.deepEqual(scrolls, [{ top: 135, behavior: undefined }]);

    scrollVirtualElement(0, {}, inst);
    assert.deepEqual(scrolls, [
      { top: 135, behavior: undefined },
      { top: 0, behavior: undefined },
    ]);
  });
});
