import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { evalSum, IDLE_FIELD_MODE, stepNumberField } from "../app/components/NumberField.tsx";
import {
  CLEAR_PICKS,
  hasAnySelection,
  pruneFreezeSelection,
  pruneShotSelection,
  transitionSelection,
} from "../app/core/selection.ts";
import { IDLE_INK_GESTURE, stepInk } from "../app/notes/ink-gesture.ts";
import { isComposeDirty, normalizeStoredCompose } from "../app/notes/slice.ts";
import { IDLE_VIEWPORT_GESTURE, stepViewport } from "../app/picture/gesture.ts";
import { freezesOf } from "../src/timing.mjs";

const DIRTY_SELECTION = {
  freezePick: 2,
  layerPicks: ["layer-a"],
  camKey: 1,
  camPicks: [1, 2],
  shotPick: 0,
  shotPicks: [0, 1],
  clips: [{ list: "sfx", i: 0 }],
  clip: { list: "sfx", i: 0 },
  keyPicks: [{ f: 0, path: ["torch", "keys"], i: 0 }],
  textPicks: [3],
  object: "torch",
  side: "notes",
};

const applyPick = (state, action) => ({ ...state, ...transitionSelection(action, state.side) });

describe("transitionSelection", () => {
  test("shot clears competing tracks and defaults side to cam", () => {
    assert.deepEqual(applyPick(DIRTY_SELECTION, { kind: "shot", index: 4 }), {
      ...CLEAR_PICKS,
      shotPick: 4,
      side: "cam",
    });
  });

  test("shot preserves speed, anim, and adjust inspector tabs or applies explicit side override", () => {
    for (const keptSide of ["speed", "anim", "adjust"]) {
      assert.deepEqual(
        applyPick({ ...DIRTY_SELECTION, side: keptSide }, { kind: "shot", index: 3 }),
        { ...CLEAR_PICKS, shotPick: 3, side: keptSide },
      );
    }
    assert.deepEqual(
      applyPick(
        { ...DIRTY_SELECTION, side: "adjust" },
        { kind: "shot", index: 2, side: "transition" },
      ),
      { ...CLEAR_PICKS, shotPick: 2, side: "transition" },
    );
  });

  test("adjustTarget clears stale picks and selects either a shot or a single adjustment layer", () => {
    assert.deepEqual(
      applyPick({ ...DIRTY_SELECTION, shotPick: null }, { kind: "adjustTarget", target: 2 }),
      { ...CLEAR_PICKS, shotPick: 2, side: "adjust" },
    );
    assert.deepEqual(
      applyPick(
        { ...DIRTY_SELECTION, layerPicks: ["l1", "l2"] },
        { kind: "adjustTarget", target: "l1" },
      ),
      { ...CLEAR_PICKS, layerPicks: ["l1"], side: "adjust" },
    );
  });

  test("hasAnySelection covers all 11 selection fields including shotPicks and clip", () => {
    assert.equal(hasAnySelection(CLEAR_PICKS), false);
    assert.equal(hasAnySelection({ ...CLEAR_PICKS, shotPicks: [1] }), true);
    assert.equal(hasAnySelection({ ...CLEAR_PICKS, clip: { list: "sfx", i: 0 } }), true);
  });

  test("none clears all picks and exits transition side back to cam", () => {
    assert.deepEqual(applyPick({ ...DIRTY_SELECTION, side: "transition" }, { kind: "none" }), {
      ...CLEAR_PICKS,
      side: "cam",
    });
    assert.deepEqual(applyPick({ ...DIRTY_SELECTION, side: "notes" }, { kind: "none" }), {
      ...CLEAR_PICKS,
      side: "notes",
    });
  });

  test("across sets singular clip and camKey for single-item box picks and exits transition", () => {
    const oneClip = { list: "sfx", i: 2 };
    const single = applyPick(
      { ...DIRTY_SELECTION, side: "transition" },
      {
        kind: "across",
        layers: [],
        text: [0],
        shots: [],
        cam: [3],
        keys: [],
        clips: [oneClip],
      },
    );
    assert.equal(single.side, "cam");
    assert.deepEqual(single.clips, [oneClip]);
    assert.deepEqual(single.clip, oneClip);
    assert.equal(single.camKey, 3);
    assert.deepEqual(single.camPicks, []);
  });

  test("across clears singular clip and camKey when multiple items are box-picked", () => {
    const oneClip = { list: "sfx", i: 2 };
    const multi = applyPick(DIRTY_SELECTION, {
      kind: "across",
      layers: [],
      text: [],
      shots: [1, 2],
      cam: [3, 4],
      keys: [],
      clips: [oneClip, { list: "beds", i: 0 }],
    });
    assert.equal(multi.clip, null);
    assert.equal(multi.camKey, null);
    assert.deepEqual(multi.camPicks, [3, 4]);
    assert.deepEqual(multi.shotPicks, [1, 2]);
  });

  test("clips preserves voiceChanger and audioSpeed for a single clip and resets to sound for multi-clip", () => {
    const c0 = { list: "sfx", i: 0 },
      c1 = { list: "sfx", i: 1 };
    for (const sub of ["voiceChanger", "audioSpeed"]) {
      assert.deepEqual(
        applyPick({ ...DIRTY_SELECTION, side: sub }, { kind: "clips", clips: [c0] }),
        { ...CLEAR_PICKS, clips: [c0], clip: c0, side: sub },
      );
      assert.deepEqual(
        applyPick({ ...DIRTY_SELECTION, side: sub }, { kind: "clips", clips: [c0, c1] }),
        { ...CLEAR_PICKS, clips: [c0, c1], clip: null, side: "sound" },
      );
    }
  });

  test("layers routes side to adjust and clears competing tracks", () => {
    assert.deepEqual(applyPick(DIRTY_SELECTION, { kind: "layers", ids: ["adj-1"] }), {
      ...CLEAR_PICKS,
      layerPicks: ["adj-1"],
      side: "adjust",
    });
  });

  test("text preserves textAnim sub-tab or routes to text", () => {
    assert.deepEqual(
      applyPick({ ...DIRTY_SELECTION, side: "textAnim" }, { kind: "text", indices: [2] }),
      { ...CLEAR_PICKS, textPicks: [2], side: "textAnim" },
    );
    assert.deepEqual(applyPick(DIRTY_SELECTION, { kind: "text", indices: [2] }), {
      ...CLEAR_PICKS,
      textPicks: [2],
      side: "text",
    });
  });

  test("keys routes placed object keys to objects tab and generic key rows to keys tab", () => {
    const keyRef = { f: 0, path: ["lamp", "keys"], i: 1 };
    assert.deepEqual(
      applyPick(DIRTY_SELECTION, { kind: "keys", refs: [keyRef], ownObject: "lamp" }),
      { ...CLEAR_PICKS, keyPicks: [keyRef], object: "lamp", side: "objects" },
    );
    assert.deepEqual(
      applyPick(DIRTY_SELECTION, { kind: "keys", refs: [keyRef], ownObject: null }),
      { ...CLEAR_PICKS, keyPicks: [keyRef], object: null, side: "keys" },
    );
  });

  test("object routes side to objects", () => {
    assert.deepEqual(applyPick(DIRTY_SELECTION, { kind: "object", name: "chest" }), {
      ...CLEAR_PICKS,
      object: "chest",
      side: "objects",
    });
  });

  test("freeze routes side to speed", () => {
    assert.deepEqual(applyPick(DIRTY_SELECTION, { kind: "freeze", index: 1 }), {
      ...CLEAR_PICKS,
      freezePick: 1,
      side: "speed",
    });
  });

  test("camKey clears cross-track picks and preserves speed or routes to cam", () => {
    assert.deepEqual(applyPick(DIRTY_SELECTION, { kind: "camKey", index: 2 }), {
      ...CLEAR_PICKS,
      camKey: 2,
      side: "cam",
    });
    assert.deepEqual(
      applyPick({ ...DIRTY_SELECTION, side: "speed" }, { kind: "camKey", index: 2 }),
      { ...CLEAR_PICKS, camKey: 2, side: "speed" },
    );
  });

  test("camKeys sets singular camKey for one key, populates camPicks for multiple keys, and clears when empty", () => {
    const withShots = applyPick(DIRTY_SELECTION, { kind: "camKeys", indices: [3], shots: [1] });
    assert.equal(withShots.camKey, 3);
    assert.deepEqual(withShots.camPicks, []);
    assert.deepEqual(withShots.shotPicks, [1]);

    const multi = applyPick(
      { ...DIRTY_SELECTION, side: "speed" },
      { kind: "camKeys", indices: [1, 4] },
    );
    assert.equal(multi.camKey, null);
    assert.deepEqual(multi.camPicks, [1, 4]);
    assert.equal(multi.side, "speed");

    const clearedCamKeys = applyPick(DIRTY_SELECTION, { kind: "camKeys", indices: [] });
    assert.equal(clearedCamKeys.camKey, null);
    assert.deepEqual(clearedCamKeys.camPicks, []);
    assert.deepEqual(clearedCamKeys.shotPicks, []);
  });

  test("clearShots clears shotPick, shotPicks, camKey, and camPicks and exits transition", () => {
    const clearedShots = applyPick(
      { ...DIRTY_SELECTION, side: "transition" },
      { kind: "clearShots" },
    );
    assert.equal(clearedShots.shotPick, null);
    assert.deepEqual(clearedShots.shotPicks, []);
    assert.equal(clearedShots.camKey, null);
    assert.deepEqual(clearedShots.camPicks, []);
    assert.equal(clearedShots.side, "cam");
  });

  test("empty selection actions never force side when outside transition", () => {
    const emptyActions = [
      { kind: "camKey", index: null },
      { kind: "camKeys", indices: [] },
      { kind: "shot", index: null },
      { kind: "clearShots" },
      { kind: "freeze", index: null },
      { kind: "layers", ids: [] },
      { kind: "clips", clips: [] },
      { kind: "keys", refs: [], ownObject: null },
      { kind: "text", indices: [] },
      { kind: "object", name: null },
    ];
    for (const act of emptyActions) {
      assert.equal(
        "side" in transitionSelection(act, "notes"),
        false,
        `empty ${act.kind} must not force side`,
      );
    }
  });

  test("pruneShotSelection drops out-of-bounds shotPick and shotPicks and exits transition on shot 0", () => {
    assert.deepEqual(
      pruneShotSelection({ shotPick: 26, shotPicks: [0, 25, 26], side: "transition" }, 26),
      { shotPick: null, shotPicks: [0, 25], side: "cam" },
    );
    assert.deepEqual(pruneShotSelection({ shotPick: 0, shotPicks: [], side: "transition" }, 5), {
      side: "cam",
    });
    assert.deepEqual(
      pruneShotSelection({ shotPick: 25, shotPicks: [0, 25], side: "speed" }, 26),
      {},
    );
  });

  test("pruneFreezeSelection clears out-of-bounds or blank freezes while keeping active main-track freezes", () => {
    assert.deepEqual(pruneFreezeSelection(0, []), { freezePick: null });
    assert.deepEqual(pruneFreezeSelection(0, [{ at: 2, duration: 3, blank: true }]), {
      freezePick: null,
    });
    const mainFreezes = freezesOf({
      main: [
        { id: "c1", kind: "clip", sourceFrom: 0, sourceTo: 2 },
        { id: "f1", kind: "freeze", frame: 2, duration: 3 },
      ],
    });
    assert.deepEqual(pruneFreezeSelection(0, mainFreezes), {});
  });
});

describe("stepNumberField and evalSum", () => {
  test("click moved less than 3px requests focus without clearing draft", () => {
    let m = stepNumberField(IDLE_FIELD_MODE, {
      type: "pointerDown",
      id: 1,
      x: 100,
      base: 10,
      from: 10,
    }).mode;
    m = stepNumberField(m, {
      type: "pointerMove",
      id: 1,
      x: 102,
      step: 1,
      digits: 2,
      fine: false,
    }).mode;
    const up = stepNumberField(m, { type: "pointerUp", id: 1 });
    assert.equal(up.mode.kind, "idle");
    assert.deepEqual(up.release, { kind: "focus" });
    assert.equal(up.clearDraft, false);
  });

  test("ignores pointerDown when disabled is true", () => {
    const down = stepNumberField(IDLE_FIELD_MODE, {
      type: "pointerDown",
      id: 1,
      x: 100,
      base: 0.5,
      from: 0.5,
      disabled: true,
    });
    assert.deepEqual(down.mode, IDLE_FIELD_MODE);
    assert.deepEqual(down.release, { kind: "none" });
  });

  test("scrubbing to a new value commits once on release and supports fine Shift precision", () => {
    const m = stepNumberField(IDLE_FIELD_MODE, {
      type: "pointerDown",
      id: 1,
      x: 100,
      base: 10,
      from: 10,
    }).mode;
    const fineMove = stepNumberField(m, {
      type: "pointerMove",
      id: 1,
      x: 109,
      step: 0.5,
      digits: 2,
      fine: true,
    });
    assert.equal(fineMove.liveValue, 10.15);
    const coarseMove = stepNumberField(fineMove.mode, {
      type: "pointerMove",
      id: 1,
      x: 109,
      step: 0.5,
      digits: 2,
      fine: false,
    });
    assert.equal(coarseMove.mode.kind, "scrubbing");
    assert.equal(coarseMove.liveValue, 11.5);
    const up = stepNumberField(coarseMove.mode, { type: "pointerUp", id: 1 });
    assert.deepEqual(up.release, { kind: "commit", value: 11.5 });
    assert.equal(up.clearDraft, true);
  });

  test("scrubbing back to original value emits cancel release instead of redundant commit", () => {
    let m = stepNumberField(IDLE_FIELD_MODE, {
      type: "pointerDown",
      id: 1,
      x: 100,
      base: 10,
      from: 10,
    }).mode;
    m = stepNumberField(m, {
      type: "pointerMove",
      id: 1,
      x: 109,
      step: 0.5,
      digits: 2,
      fine: false,
    }).mode;
    const back = stepNumberField(m, {
      type: "pointerMove",
      id: 1,
      x: 100,
      step: 0.5,
      digits: 2,
      fine: false,
    });
    assert.deepEqual(stepNumberField(back.mode, { type: "pointerUp", id: 1 }).release, {
      kind: "cancel",
    });
  });

  test("pointerCancel or unmount mid-scrub aborts to idle with cancel release", () => {
    let m = stepNumberField(IDLE_FIELD_MODE, {
      type: "pointerDown",
      id: 1,
      x: 100,
      base: 10,
      from: 10,
    }).mode;
    m = stepNumberField(m, {
      type: "pointerMove",
      id: 1,
      x: 109,
      step: 0.5,
      digits: 2,
      fine: false,
    }).mode;
    const aborted = stepNumberField(m, { type: "pointerCancel", id: 1 });
    assert.equal(aborted.mode.kind, "idle");
    assert.deepEqual(aborted.release, { kind: "cancel" });
    assert.equal(aborted.clearDraft, true);

    const unmounted = stepNumberField(m, { type: "pointerCancel" });
    assert.deepEqual(unmounted.release, { kind: "cancel" });
  });

  test("escape during active scrub cancels in place and restores preview without entering editing mode", () => {
    const pressing = stepNumberField(IDLE_FIELD_MODE, {
      type: "pointerDown",
      id: 1,
      x: 100,
      base: 10,
      from: 10,
    }).mode;
    const escPress = stepNumberField(pressing, { type: "escape" });
    assert.deepEqual(escPress.mode, IDLE_FIELD_MODE);
    assert.deepEqual(escPress.release, { kind: "none" });

    const scrubbing = stepNumberField(pressing, {
      type: "pointerMove",
      id: 1,
      x: 109,
      step: 1,
      digits: 0,
      fine: false,
    }).mode;
    const escScrub = stepNumberField(scrubbing, { type: "escape" });
    assert.deepEqual(escScrub.mode, IDLE_FIELD_MODE);
    assert.deepEqual(escScrub.release, { kind: "cancel" });
    assert.equal(escScrub.clearDraft, true);
  });

  test("ignores secondary chorded pointer events with mismatched pointerId during pressing or scrubbing", () => {
    let m = stepNumberField(IDLE_FIELD_MODE, {
      type: "pointerDown",
      id: 1,
      x: 100,
      base: 10,
      from: 10,
    }).mode;
    m = stepNumberField(m, {
      type: "pointerMove",
      id: 1,
      x: 109,
      step: 1,
      digits: 0,
      fine: false,
    }).mode;
    assert.equal(
      stepNumberField(m, { type: "pointerMove", id: 2, x: 200, step: 1, digits: 0, fine: false })
        .liveValue,
      null,
    );
    assert.deepEqual(stepNumberField(m, { type: "pointerUp", id: 2 }).release, { kind: "none" });
    assert.equal(stepNumberField(m, { type: "pointerCancel", id: 2 }).mode.kind, "scrubbing");
  });

  test("pointer events inside an already-focused editing field preserve typed draft", () => {
    const editing = stepNumberField(stepNumberField(IDLE_FIELD_MODE, { type: "focus" }).mode, {
      type: "change",
    }).mode;
    assert.deepEqual(editing, { kind: "editing", dirty: true });
    for (const ev of [
      { type: "pointerDown", id: 1, x: 40, base: 10, from: 10 },
      { type: "pointerMove", id: 1, x: 50, step: 1, digits: 2, fine: false },
      { type: "pointerUp", id: 1 },
      { type: "pointerCancel", id: 1 },
    ]) {
      const res = stepNumberField(editing, ev);
      assert.deepEqual(res.mode, { kind: "editing", dirty: true });
      assert.deepEqual(res.release, { kind: "none" });
      assert.equal(res.clearDraft, false);
    }
  });

  test("scrubbing clamps to min/max bounds and emits cancel when pinned at a bound", () => {
    const m = stepNumberField(IDLE_FIELD_MODE, {
      type: "pointerDown",
      id: 1,
      x: 100,
      base: 5,
      from: 5,
    }).mode;
    const toZero = stepNumberField(m, {
      type: "pointerMove",
      id: 1,
      x: 40,
      step: 1,
      digits: 0,
      fine: false,
      min: 0,
      max: 10,
    });
    assert.equal(toZero.liveValue, 0);
    assert.deepEqual(stepNumberField(toZero.mode, { type: "pointerUp", id: 1 }).release, {
      kind: "commit",
      value: 0,
    });

    const pinned = stepNumberField(IDLE_FIELD_MODE, {
      type: "pointerDown",
      id: 1,
      x: 100,
      base: 0,
      from: 0,
    }).mode;
    const stillZero = stepNumberField(pinned, {
      type: "pointerMove",
      id: 1,
      x: 40,
      step: 1,
      digits: 0,
      fine: false,
      min: 0,
      max: 10,
    });
    assert.equal(stillZero.liveValue, 0);
    assert.deepEqual(stepNumberField(stillZero.mode, { type: "pointerUp", id: 1 }).release, {
      kind: "cancel",
    });
  });

  test("untouched focus->blur does not save rounded display value, while focus->change->blur saves", () => {
    const focused = stepNumberField(IDLE_FIELD_MODE, { type: "focus" }).mode;
    const untouchedBlur = stepNumberField(focused, { type: "blur" });
    assert.equal(untouchedBlur.shouldSave, false);
    assert.equal(untouchedBlur.clearDraft, true);

    const edited = stepNumberField(focused, { type: "change" }).mode;
    const editedBlur = stepNumberField(edited, { type: "blur" });
    assert.equal(editedBlur.shouldSave, true);
    assert.equal(editedBlur.clearDraft, true);
  });

  test("arrow step clears draft and resets dirty flag so subsequent blur does not save a second time", () => {
    let m = stepNumberField(IDLE_FIELD_MODE, { type: "focus" }).mode;
    m = stepNumberField(m, { type: "change" }).mode;
    const stepped = stepNumberField(m, { type: "arrow" });
    assert.deepEqual(stepped.mode, { kind: "editing", dirty: false });
    assert.equal(stepped.clearDraft, true);
    assert.equal(stepNumberField(stepped.mode, { type: "blur" }).shouldSave, false);
  });

  test("escape cancels edited draft and suppresses subsequent blur save", () => {
    let m = stepNumberField(IDLE_FIELD_MODE, { type: "focus" }).mode;
    m = stepNumberField(m, { type: "change" }).mode;
    const esc = stepNumberField(m, { type: "escape" });
    assert.equal(esc.mode.kind, "cancelling");
    assert.equal(esc.clearDraft, true);
    assert.equal(stepNumberField(esc.mode, { type: "blur" }).shouldSave, false);
  });

  test("evalSum evaluates valid arithmetic and comma-decimal expressions", () => {
    assert.equal(evalSum("12 + 3 * 2"), 18);
    assert.equal(evalSum("1,5 + 0,25"), 1.75);
  });

  test("evalSum rejects empty, non-finite, or non-arithmetic input", () => {
    assert.equal(evalSum(""), null);
    assert.equal(evalSum("1/0"), null);
    assert.equal(evalSum("alert(1)"), null);
  });
});

describe("normalizeStoredCompose and isComposeDirty", () => {
  test("migrates legacy create and edit drafts", () => {
    const create = normalizeStoredCompose({
      open: true,
      t: 3.5,
      shot: 1,
      shotName: "Intro",
      pin: { x: 0.2, y: 0.4, what: "Steve" },
      resume: true,
    });
    assert.equal(create?.kind, "create");
    assert.deepEqual(create?.pin, { x: 0.2, y: 0.4, what: "Steve" });

    const edit = normalizeStoredCompose({
      editing: "n-7",
      time: "00:03.500",
      original: "Old",
      t: 3.5,
      shot: 1,
      shotName: "Intro",
    });
    assert.equal(edit?.kind, "edit");
    if (edit?.kind === "edit") assert.equal(edit.id, "n-7");
  });

  test("rejects null, NaN/Infinity timestamps, and empty edit ids", () => {
    assert.equal(normalizeStoredCompose(null), null);
    assert.equal(normalizeStoredCompose({ kind: "create", t: Number.NaN, shot: 0 }), null);
    assert.equal(
      normalizeStoredCompose({ kind: "create", t: 1, shot: Number.POSITIVE_INFINITY }),
      null,
    );
    assert.equal(normalizeStoredCompose({ kind: "edit", id: "", t: 1, shot: 0 }), null);
  });

  test("strips malformed pin shapes while keeping valid draft metadata", () => {
    const badPin = normalizeStoredCompose({
      kind: "create",
      t: 2,
      shot: 0,
      pin: { x: "bad", y: 0.5, what: 123 },
    });
    assert.equal(badPin?.kind, "create");
    assert.equal(badPin?.pin, null);

    const validCompare = normalizeStoredCompose({
      kind: "create",
      t: 3.2,
      shot: 1,
      compareVideo: {
        path: "renders/reference/v2_sbs.mp4",
        category: "compare",
        layout: "hstack",
        startSec: 10,
      },
    });
    assert.deepEqual(validCompare?.kind === "create" ? validCompare.compareVideo : null, {
      path: "renders/reference/v2_sbs.mp4",
      category: "compare",
      layout: "hstack",
      startSec: 10,
    });

    const badCompare = normalizeStoredCompose({
      kind: "create",
      t: 3.2,
      shot: 1,
      compareVideo: {
        path: "",
        category: "bogus",
        layout: "hstack",
      },
    });
    assert.equal(badCompare?.kind === "create" ? badCompare.compareVideo : "err", undefined);
  });

  test("isComposeDirty ignores untouched edit notes while flagging edited text or ink-only create notes", () => {
    const create = { kind: "create", t: 1, shot: 0, shotName: "", pin: null, resume: false };
    assert.equal(isComposeDirty(create, "   ", false), false);
    assert.equal(isComposeDirty(create, "", true), true);
    assert.equal(isComposeDirty(create, "fix lighting", false), true);

    const edit = {
      kind: "edit",
      id: "n1",
      time: "00:01.000",
      original: "same text",
      t: 1,
      shot: 0,
      shotName: "",
      pin: null,
      resume: false,
    };
    assert.equal(isComposeDirty(edit, "same text", false), false);
    assert.equal(isComposeDirty(edit, "  same text  ", false), false);
    assert.equal(isComposeDirty(edit, "", false), false);
    assert.equal(isComposeDirty(edit, "updated text", false), true);
  });
});

describe("stepViewport", () => {
  test("touch tap without drag arms pending_click across implicit lostpointercapture", () => {
    const down = stepViewport(IDLE_VIEWPORT_GESTURE, {
      type: "press",
      id: 1,
      pointerType: "touch",
      button: 0,
      x: 200,
      y: 150,
      free: true,
      shiftKey: false,
    });
    assert.equal(down.gesture.kind, "tap_press");

    const up = stepViewport(down.gesture, { type: "windowUp", id: 1, x: 201, y: 150, buttons: 0 });
    assert.deepEqual(up.gesture, { kind: "pending_click", x: 200, y: 150 });
    assert.deepEqual(up.armClickAt, [200, 150]);

    const lostCapture = stepViewport(up.gesture, { type: "cancel", id: 1 });
    assert.deepEqual(lostCapture.gesture, { kind: "pending_click", x: 200, y: 150 });
  });

  test("left press without drag resolves to idle while left-drag enters cam_drag look/orbit", () => {
    const leftDown = stepViewport(IDLE_VIEWPORT_GESTURE, {
      type: "press",
      id: 2,
      pointerType: "mouse",
      button: 0,
      x: 100,
      y: 100,
      free: false,
      shiftKey: false,
    });
    assert.equal(leftDown.gesture.kind, "left_press");

    const quickUp = stepViewport(leftDown.gesture, {
      type: "windowUp",
      id: 2,
      x: 100,
      y: 100,
      buttons: 0,
    });
    assert.deepEqual(quickUp.gesture, IDLE_VIEWPORT_GESTURE);
    assert.equal(quickUp.armClickAt, null);

    const dragged = stepViewport(leftDown.gesture, {
      type: "move",
      id: 2,
      x: 140,
      y: 100,
      canWake: true,
    });
    assert.equal(dragged.capture, true);
    assert.equal(dragged.gesture.kind, "cam_drag");
    if (dragged.gesture.kind === "cam_drag") {
      assert.equal(dragged.gesture.mode, "look");
      assert.equal(dragged.gesture.moved, true);
    }
  });

  test("uses Shift+left-drag for orbit and middle-drag for slide in Free Camera", () => {
    const orbitDown = stepViewport(IDLE_VIEWPORT_GESTURE, {
      type: "press",
      id: 3,
      pointerType: "mouse",
      button: 0,
      x: 100,
      y: 100,
      free: true,
      shiftKey: true,
    });
    const orbitMove = stepViewport(orbitDown.gesture, {
      type: "move",
      id: 3,
      x: 112,
      y: 100,
      canWake: true,
    });
    assert.equal(orbitMove.gesture.kind, "cam_drag");
    if (orbitMove.gesture.kind === "cam_drag") assert.equal(orbitMove.gesture.mode, "orbit");

    const slide = stepViewport(IDLE_VIEWPORT_GESTURE, {
      type: "press",
      id: 4,
      pointerType: "mouse",
      button: 1,
      x: 100,
      y: 100,
      free: true,
      shiftKey: false,
    });
    assert.equal(slide.gesture.kind, "cam_drag");
    if (slide.gesture.kind === "cam_drag") assert.equal(slide.gesture.mode, "slide");
  });

  test("right-drag beyond 4px transitions right_press into sketching both by default and in Free Camera without waking or moving camera", () => {
    for (const free of [false, true]) {
      const rawEvent = { pointerId: 7 };
      const right = stepViewport(IDLE_VIEWPORT_GESTURE, {
        type: "press",
        id: 7,
        pointerType: "mouse",
        button: 2,
        x: 50,
        y: 50,
        free,
        shiftKey: free,
        raw: rawEvent,
      }).gesture;
      assert.equal(right.kind, "right_press");
      const sketchStep = stepViewport(right, { type: "move", id: 7, x: 60, y: 50, canWake: true });
      assert.deepEqual(sketchStep.gesture, { kind: "sketching", id: 7 });
      assert.equal(sketchStep.startSketchFrom, rawEvent);
      assert.equal(sketchStep.capture, true);
    }
  });

  test("left-drag with drawOnLeft transitions left_press into left-button sketching and respects left button mask", () => {
    const rawEvent = { pointerId: 9 };
    const left = stepViewport(IDLE_VIEWPORT_GESTURE, {
      type: "press",
      id: 9,
      pointerType: "mouse",
      button: 0,
      x: 50,
      y: 50,
      free: false,
      shiftKey: false,
      drawOnLeft: true,
      raw: rawEvent,
    }).gesture;
    assert.equal(left.kind, "left_press");
    const sketchStep = stepViewport(left, { type: "move", id: 9, x: 64, y: 50, canWake: false });
    assert.deepEqual(sketchStep.gesture, { kind: "sketching", id: 9, button: 0 });
    assert.equal(sketchStep.startSketchFrom, rawEvent);
    assert.equal(sketchStep.capture, true);
    assert.deepEqual(
      stepViewport(sketchStep.gesture, { type: "windowUp", id: 9, x: 64, y: 50, buttons: 1 }),
      { gesture: sketchStep.gesture, dropSketch: false, armClickAt: null },
    );
    assert.deepEqual(
      stepViewport(sketchStep.gesture, { type: "windowUp", id: 9, x: 64, y: 50, buttons: 0 }),
      { gesture: IDLE_VIEWPORT_GESTURE, dropSketch: true, armClickAt: null },
    );
  });

  test("recovers to idle on off-canvas pointercancel or blur and drops active sketch", () => {
    const tap = stepViewport(IDLE_VIEWPORT_GESTURE, {
      type: "press",
      id: 201,
      pointerType: "touch",
      button: 0,
      x: 50,
      y: 60,
      free: false,
      shiftKey: false,
    }).gesture;
    assert.deepEqual(stepViewport(tap, { type: "cancel", id: 201 }), {
      gesture: IDLE_VIEWPORT_GESTURE,
      dropSketch: false,
    });
    assert.deepEqual(stepViewport(tap, { type: "blur" }), {
      gesture: IDLE_VIEWPORT_GESTURE,
      dropSketch: false,
    });

    const sketching = { kind: "sketching", id: 1 };
    assert.deepEqual(stepViewport(sketching, { type: "blur" }), {
      gesture: IDLE_VIEWPORT_GESTURE,
      dropSketch: true,
    });
    assert.deepEqual(stepViewport(sketching, { type: "cancel", id: 1 }), {
      gesture: IDLE_VIEWPORT_GESTURE,
      dropSketch: true,
    });
    assert.deepEqual(stepViewport(sketching, { type: "cancel", id: 99 }), {
      gesture: sketching,
      dropSketch: false,
    });
  });

  test("updates cam_drag x and y purely on left-drag move without mutating previous gesture", () => {
    const down = stepViewport(IDLE_VIEWPORT_GESTURE, {
      type: "press",
      id: 1,
      pointerType: "mouse",
      button: 0,
      x: 100,
      y: 100,
      free: true,
      shiftKey: false,
    }).gesture;
    const dragged = stepViewport(down, {
      type: "move",
      id: 1,
      x: 140,
      y: 120,
      canWake: true,
    }).gesture;
    assert.equal(down.kind, "left_press");
    assert.equal(dragged.kind, "cam_drag");
    if (dragged.kind === "cam_drag") {
      assert.equal(dragged.x, 140);
      assert.equal(dragged.y, 120);
      assert.equal(dragged.startX, 100);
      assert.equal(dragged.startY, 100);
      assert.equal(dragged.moved, true);
    }
  });

  test("supersedes stale mouse presses when a new press arrives", () => {
    const staleLeft = stepViewport(IDLE_VIEWPORT_GESTURE, {
      type: "press",
      id: 1,
      pointerType: "mouse",
      button: 0,
      x: 10,
      y: 20,
      free: false,
      shiftKey: false,
    }).gesture;
    const freshLeft = stepViewport(staleLeft, {
      type: "press",
      id: 1,
      pointerType: "mouse",
      button: 0,
      x: 300,
      y: 400,
      free: false,
      shiftKey: true,
    }).gesture;
    assert.equal(freshLeft.kind, "left_press");
    if (freshLeft.kind === "left_press") assert.equal(freshLeft.x, 300);
  });

  test("ignores chorded button releases while right button stays held during sketching", () => {
    const sketching = { kind: "sketching", id: 1 };
    assert.deepEqual(
      stepViewport(sketching, { type: "windowUp", id: 1, x: 120, y: 120, buttons: 2 }),
      { gesture: sketching, dropSketch: false, armClickAt: null },
    );
    assert.deepEqual(
      stepViewport(sketching, { type: "windowUp", id: 1, x: 120, y: 120, buttons: 1 }),
      { gesture: IDLE_VIEWPORT_GESTURE, dropSketch: true, armClickAt: null },
    );
    assert.deepEqual(
      stepViewport(sketching, { type: "windowUp", id: 1, x: 120, y: 120, buttons: 0 }),
      { gesture: IDLE_VIEWPORT_GESTURE, dropSketch: true, armClickAt: null },
    );
    const camLook = {
      kind: "cam_drag",
      id: 1,
      startX: 10,
      startY: 20,
      x: 30,
      y: 25,
      mode: "look",
      tap: false,
      moved: true,
    };
    assert.deepEqual(stepViewport(camLook, { type: "windowUp", id: 1, x: 30, y: 25, buttons: 1 }), {
      gesture: camLook,
      dropSketch: false,
      armClickAt: null,
    });
    assert.deepEqual(stepViewport(camLook, { type: "windowUp", id: 1, x: 30, y: 25, buttons: 0 }), {
      gesture: IDLE_VIEWPORT_GESTURE,
      dropSketch: false,
      armClickAt: null,
    });
  });

  test("middle-button pan enters pan gesture, ignores chorded releases while held, and ends on release or blur", () => {
    const started = stepViewport(IDLE_VIEWPORT_GESTURE, {
      type: "press",
      id: 7,
      pointerType: "mouse",
      button: 1,
      x: 100,
      y: 200,
      free: false,
      shiftKey: false,
      pan: { panX: 12, panY: -8 },
    });
    assert.deepEqual(started, {
      gesture: { kind: "pan", id: 7, startX: 100, startY: 200, fromX: 12, fromY: -8 },
      dropSketch: false,
      capture: true,
    });
    assert.deepEqual(
      stepViewport(started.gesture, { type: "windowUp", id: 7, x: 140, y: 210, buttons: 4 }),
      { gesture: started.gesture, dropSketch: false, armClickAt: null },
    );
    assert.deepEqual(
      stepViewport(started.gesture, { type: "windowUp", id: 7, x: 140, y: 210, buttons: 0 }),
      { gesture: IDLE_VIEWPORT_GESTURE, dropSketch: false, armClickAt: null },
    );
    assert.deepEqual(stepViewport(started.gesture, { type: "blur" }), {
      gesture: IDLE_VIEWPORT_GESTURE,
      dropSketch: false,
    });
  });
});

describe("stepInk", () => {
  test("ignores presses when tool is null or non-draw mouse buttons are pressed", () => {
    assert.deepEqual(
      stepInk(IDLE_INK_GESTURE, { type: "down", id: 1, button: 2, tool: null, x: 10, y: 10 }),
      { gesture: IDLE_INK_GESTURE, effect: "none" },
    );
    assert.deepEqual(
      stepInk(IDLE_INK_GESTURE, { type: "down", id: 1, button: 0, tool: "pen", x: 10, y: 10 }),
      { gesture: IDLE_INK_GESTURE, effect: "none" },
    );
    assert.deepEqual(
      stepInk(IDLE_INK_GESTURE, { type: "down", id: 1, button: 1, tool: "pen", x: 10, y: 10 }),
      { gesture: IDLE_INK_GESTURE, effect: "none" },
    );
  });

  test("draws and ends a right-button pen stroke while ignoring chorded secondary releases", () => {
    const down = stepInk(IDLE_INK_GESTURE, {
      type: "down",
      id: 1,
      button: 2,
      pointerType: "mouse",
      tool: "pen",
      x: 10,
      y: 10,
    });
    assert.deepEqual(down, {
      gesture: { kind: "drawing", id: 1, mask: 2 },
      effect: "start_stroke",
    });
    assert.deepEqual(stepInk(down.gesture, { type: "move", id: 1, x: 18, y: 14 }), {
      gesture: down.gesture,
      effect: "move_stroke",
    });
    assert.deepEqual(stepInk(down.gesture, { type: "up", id: 1, buttons: 2, tool: "pen" }), {
      gesture: down.gesture,
      effect: "none",
    });
    assert.deepEqual(stepInk(down.gesture, { type: "up", id: 1, buttons: 0, tool: "pen" }), {
      gesture: IDLE_INK_GESTURE,
      effect: "end_stroke",
    });
  });

  test("supports touch left-button stroke when drawing on mobile", () => {
    const down = stepInk(IDLE_INK_GESTURE, {
      type: "down",
      id: 4,
      button: 0,
      pointerType: "touch",
      tool: "pen",
      x: 10,
      y: 10,
    });
    assert.deepEqual(down, {
      gesture: { kind: "drawing", id: 4, mask: 1 },
      effect: "start_stroke",
    });
    assert.deepEqual(stepInk(down.gesture, { type: "up", id: 4, buttons: 0, tool: "pen" }), {
      gesture: IDLE_INK_GESTURE,
      effect: "end_stroke",
    });
  });

  test("commits path_press on right-button release only when path tool is still active", () => {
    const down = stepInk(IDLE_INK_GESTURE, {
      type: "down",
      id: 2,
      button: 2,
      pointerType: "mouse",
      tool: "path",
      x: 10,
      y: 10,
    });
    assert.deepEqual(down, {
      gesture: { kind: "path_press", id: 2, mask: 2 },
      effect: "start_path",
    });
    assert.deepEqual(stepInk(down.gesture, { type: "up", id: 2, buttons: 0, tool: "path" }), {
      gesture: IDLE_INK_GESTURE,
      effect: "commit_path",
    });
    assert.deepEqual(stepInk(down.gesture, { type: "up", id: 2, buttons: 0, tool: null }), {
      gesture: IDLE_INK_GESTURE,
      effect: "none",
    });
  });

  test("ignores mismatched pointerIds and drops active strokes on cancel, blur, or reset", () => {
    const drawing = { kind: "drawing", id: 5, mask: 2 };
    assert.deepEqual(stepInk(drawing, { type: "cancel", id: 9 }), {
      gesture: drawing,
      effect: "none",
    });
    assert.deepEqual(stepInk(drawing, { type: "cancel", id: 5 }), {
      gesture: IDLE_INK_GESTURE,
      effect: "drop",
    });
    assert.deepEqual(stepInk(drawing, { type: "blur" }), {
      gesture: IDLE_INK_GESTURE,
      effect: "drop",
    });
    assert.deepEqual(stepInk(drawing, { type: "reset" }), {
      gesture: IDLE_INK_GESTURE,
      effect: "drop",
    });
  });

  test("accepts mouse left-button for explicit box and path tools when drawOnLeft is enabled", () => {
    const rejected = stepInk(IDLE_INK_GESTURE, {
      type: "down",
      id: 10,
      button: 0,
      pointerType: "mouse",
      tool: "box",
      x: 10,
      y: 10,
    });
    assert.deepEqual(rejected, { gesture: IDLE_INK_GESTURE, effect: "none" });

    const boxDown = stepInk(IDLE_INK_GESTURE, {
      type: "down",
      id: 11,
      button: 0,
      pointerType: "mouse",
      drawOnLeft: true,
      tool: "box",
      x: 10,
      y: 10,
    });
    assert.deepEqual(boxDown, {
      gesture: { kind: "drawing", id: 11, mask: 1 },
      effect: "start_stroke",
    });
    assert.deepEqual(stepInk(boxDown.gesture, { type: "up", id: 11, buttons: 1, tool: "box" }), {
      gesture: boxDown.gesture,
      effect: "none",
    });
    assert.deepEqual(stepInk(boxDown.gesture, { type: "up", id: 11, buttons: 0, tool: "box" }), {
      gesture: IDLE_INK_GESTURE,
      effect: "end_stroke",
    });

    const pathDown = stepInk(IDLE_INK_GESTURE, {
      type: "down",
      id: 12,
      button: 0,
      pointerType: "mouse",
      drawOnLeft: true,
      tool: "path",
      x: 20,
      y: 30,
    });
    assert.deepEqual(pathDown, {
      gesture: { kind: "path_press", id: 12, mask: 1 },
      effect: "start_path",
    });
    assert.deepEqual(stepInk(pathDown.gesture, { type: "up", id: 12, buttons: 0, tool: "path" }), {
      gesture: IDLE_INK_GESTURE,
      effect: "commit_path",
    });
  });
});
