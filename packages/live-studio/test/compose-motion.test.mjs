import { describe, test } from "bun:test";
import assert from "node:assert/strict";

import {
  composeExitReason,
  composeExitSnapshot,
  composeOrigin,
  computeOriginVector,
  createNoteFocusRegistry,
  isDockedSheetCramped,
  pointOrigin,
  recordComposeExit,
  resolveExitHeightRange,
  resolveHeightRange,
  setComposeOrigin,
  shouldAnimateEnter,
} from "../app/notes/compose-motion.ts";

const makeCreate = (t = 12) => ({
  kind: "create",
  t,
  shot: 2,
  shotName: "shot two",
  pin: null,
  resume: false,
  wasPlaying: false,
});

const makeEdit = (id = "n1", original = "before") => ({
  kind: "edit",
  id,
  time: "00:12.000",
  original,
  t: 12,
  shot: 2,
  shotName: "shot two",
  pin: null,
  resume: false,
});

describe("compose-motion state & origin helpers", () => {
  test("tracks origin and frozen exit snapshot/reason per compose token", () => {
    const c = makeCreate(5);
    const orig = pointOrigin(120, 480);
    setComposeOrigin(c, orig);
    assert.deepEqual(composeOrigin(c), orig);
    assert.equal(composeExitReason(c), "cancel");
    assert.equal(composeExitSnapshot(c), undefined);

    const refs = [{ id: "r1", url: "blob:1" }];
    recordComposeExit(c, "save", {
      draft: "fix hand clip",
      drawn: "3 strokes on frame",
      refs,
    });
    assert.equal(composeExitReason(c), "save");
    assert.deepEqual(composeExitSnapshot(c), {
      draft: "fix hand clip",
      drawn: "3 strokes on frame",
      refs,
    });
  });

  test("keyboard shortcut (!origin) skips entrance animation so M stays instant", () => {
    assert.equal(shouldAnimateEnter({ origin: undefined, reduced: false }), false);
    assert.equal(shouldAnimateEnter({ origin: undefined, reduced: true }), false);
    assert.equal(shouldAnimateEnter({ origin: pointOrigin(10, 20), reduced: true }), "reduced");
    assert.equal(shouldAnimateEnter({ origin: pointOrigin(10, 20), reduced: false }), "spring");
  });

  test("resolves fresh dock height from 0 -> cardHeight and interrupted exit height -> cardHeight", () => {
    assert.deepEqual(
      resolveHeightRange({ fixed: false, fresh: true, resumeHeight: null, cardHeight: 240 }),
      { from: 0, to: 240 },
    );
    assert.deepEqual(
      resolveHeightRange({ fixed: false, fresh: false, resumeHeight: 118.5, cardHeight: 240 }),
      { from: 118.5, to: 240 },
    );
    assert.equal(
      resolveHeightRange({ fixed: false, fresh: false, resumeHeight: null, cardHeight: 240 }),
      null,
    );
    assert.equal(
      resolveHeightRange({ fixed: true, fresh: true, resumeHeight: null, cardHeight: 240 }),
      null,
    );
    assert.deepEqual(
      resolveHeightRange({
        fixed: false,
        fresh: true,
        resumeHeight: null,
        cardHeight: 191,
        baseHeight: 72,
      }),
      { from: 72, to: 191 },
    );
    assert.deepEqual(
      resolveHeightRange({
        fixed: false,
        fresh: false,
        resumeHeight: 120,
        cardHeight: 191,
        baseHeight: 72,
      }),
      { from: 120, to: 191 },
    );
  });

  test("resolves dock exit height range toward resting idleFooter baseHeight without collapsing to 0", () => {
    assert.deepEqual(resolveExitHeightRange({ fixed: false, fromHeight: 191, baseHeight: 72 }), {
      from: 191,
      to: 72,
    });
    assert.deepEqual(resolveExitHeightRange({ fixed: false, fromHeight: 240, baseHeight: 0 }), {
      from: 240,
      to: 0,
    });
    assert.equal(resolveExitHeightRange({ fixed: true, fromHeight: 191, baseHeight: 72 }), null);
  });

  test("computes origin-aware motion vector for docked and fixed layouts without hardcoded upright ty", () => {
    const cardRect = { left: 100, top: 600, width: 400, height: 220 };
    const topPin = pointOrigin(120, 140);
    const enterFixed = computeOriginVector({
      origin: topPin,
      rect: cardRect,
      dock: true,
      fixed: true,
      exiting: false,
    });
    assert.equal(enterFixed.pctX, 5);
    assert.equal(enterFixed.pctY, 0);
    assert.equal(enterFixed.tx, -25.2);
    assert.equal(enterFixed.ty, -18);

    const exitFixed = computeOriginVector({
      origin: topPin,
      rect: cardRect,
      dock: true,
      fixed: true,
      exiting: "cancel",
    });
    assert.equal(exitFixed.ty, -22);
    assert.equal(exitFixed.sc, 0.95);

    const fallbackExit = computeOriginVector({
      origin: undefined,
      rect: cardRect,
      dock: true,
      fixed: false,
      exiting: "save",
    });
    assert.equal(fallbackExit.pctX, 50);
    assert.equal(fallbackExit.pctY, 20);
    assert.equal(fallbackExit.ty, -10);
    assert.equal(fallbackExit.sc, 0.96);
  });

  test("distinct compose instances isolate edit vs create state", () => {
    const e = makeEdit();
    recordComposeExit(e, "cancel", { draft: "before", drawn: "", refs: [] });
    assert.equal(composeExitReason(e), "cancel");
    assert.equal(composeOrigin(e), undefined);
  });

  test("floats docked desktop compose as bottom sheet whenever host panel height is cramped (< 430)", () => {
    assert.equal(isDockedSheetCramped({ dock: true, inline: false, panelHeight: 243 }), true);
    assert.equal(isDockedSheetCramped({ dock: true, inline: false, panelHeight: 389 }), true);
    assert.equal(isDockedSheetCramped({ dock: true, inline: false, panelHeight: 0 }), false);
    assert.equal(isDockedSheetCramped({ dock: true, inline: false, panelHeight: 430 }), false);
    assert.equal(isDockedSheetCramped({ dock: true, inline: true, panelHeight: 243 }), false);
    assert.equal(isDockedSheetCramped({ dock: false, inline: false, panelHeight: 243 }), false);
  });

  test("focus registry defers pending focus until mounted target returns true and consumes once", () => {
    const reg = createNoteFocusRegistry();

    assert.equal(reg.focus(), false);
    assert.equal(reg.isPending(), true);
    assert.equal(
      reg.consumePending(() => false),
      false,
    );
    assert.equal(reg.isPending(), true);
    assert.equal(
      reg.consumePending(() => true),
      true,
    );
    assert.equal(reg.isPending(), false);
    assert.equal(
      reg.consumePending(() => true),
      false,
    );
  });

  test("focus registry handles non-LIFO unregister cleanly", () => {
    const reg = createNoteFocusRegistry();
    let callsA = 0;
    let callsB = 0;
    const unregA = reg.register({
      focus: () => {
        callsA += 1;
        return false;
      },
      blur: () => {},
    });
    const unregB = reg.register({
      focus: () => {
        callsB += 1;
        return true;
      },
      blur: () => {},
    });
    unregA();
    assert.equal(reg.focus(), true);
    assert.equal(callsA, 0);
    assert.equal(callsB, 1);
    assert.equal(reg.isPending(), false);
    unregB();
  });

  test("focus registry flushes via callback and clears pending on clearPending and blur", () => {
    const reg = createNoteFocusRegistry();
    let blurs = 0;
    const unreg = reg.register({
      focus: () => true,
      blur: () => {
        blurs += 1;
      },
    });
    assert.equal(
      reg.focus(() => {}),
      true,
    );
    unreg();

    assert.equal(reg.focus(), false);
    assert.equal(reg.isPending(), true);
    reg.clearPending();
    assert.equal(reg.isPending(), false);

    reg.register({
      focus: () => false,
      blur: () => {
        blurs += 1;
      },
    });
    assert.equal(reg.focus(), false);
    reg.blur();
    assert.equal(blurs, 1);
    assert.equal(reg.isPending(), false);
  });

  test("computeOriginVector positions enter and save exit relative to origin and clamps offsets", () => {
    const cardRect = { left: 100, top: 600, width: 400, height: 220 };
    const topPin = pointOrigin(120, 140);
    const enterFloating = computeOriginVector({
      origin: topPin,
      rect: cardRect,
      dock: false,
      fixed: false,
      exiting: false,
    });
    assert.equal(enterFloating.sc, 0.94);

    const exitSaveOrigin = computeOriginVector({
      origin: topPin,
      rect: cardRect,
      dock: true,
      fixed: true,
      exiting: "save",
    });
    assert.equal(exitSaveOrigin.sc, 0.96);
    assert.equal(exitSaveOrigin.ty, -22);

    const clampMax = computeOriginVector({
      origin: pointOrigin(1000, 1200),
      rect: cardRect,
      dock: true,
      fixed: true,
      exiting: false,
    });
    assert.equal(clampMax.pctX, 100);
    assert.equal(clampMax.pctY, 100);
    assert.equal(clampMax.tx, 28);
    assert.equal(clampMax.ty, 22);
  });

  test("computeOriginVector handles zero-sized rect and no-origin fallback vectors", () => {
    const cardRect = { left: 100, top: 600, width: 400, height: 220 };
    const zeroBox = computeOriginVector({
      origin: pointOrigin(50, 50),
      rect: { left: 0, top: 0, width: 0, height: 0 },
      dock: false,
      fixed: false,
      exiting: false,
    });
    assert.equal(zeroBox.pctX, 100);
    assert.equal(zeroBox.pctY, 100);

    const noOriginCancelFloating = computeOriginVector({
      origin: undefined,
      rect: cardRect,
      dock: false,
      fixed: false,
      exiting: "cancel",
    });
    assert.equal(noOriginCancelFloating.pctY, 25);
    assert.equal(noOriginCancelFloating.ty, -6);
    assert.equal(noOriginCancelFloating.sc, 0.95);

    const noOriginFixedDock = computeOriginVector({
      origin: undefined,
      rect: cardRect,
      dock: true,
      fixed: true,
      exiting: false,
    });
    assert.equal(noOriginFixedDock.pctY, 100);
    assert.equal(noOriginFixedDock.ty, 14);
    assert.equal(noOriginFixedDock.sc, 0.94);
  });
});
