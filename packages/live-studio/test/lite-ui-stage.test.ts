import { describe, expect, it } from "bun:test";

import { createStagePointerHandler } from "../app/lite/stage-pointer.ts";
import type { InkKind, Mark, Pin } from "../app/lite/types.ts";

const makeRect = () => ({ left: 0, top: 0, width: 400, height: 200 });

describe("createStagePointerHandler", () => {
  it("completes drag-to-draw from closed compose without dropping mid-gesture or stranding liveMark", () => {
    let composeOpen = false;
    let paused = false;
    let playing = true;
    let liveMark: Mark | null = null;
    const committed: Mark[] = [];
    let overlayDraws = 0;

    const handler = createStagePointerHandler({
      getRect: makeRect,
      getContext: () => ({ category: "compare", layout: "hstack", noteSaving: false, isEditing: false }),
      getInkTool: () => null,
      getPlaybackTime: () => 2.5,
      isPlaying: () => playing,
      pause: () => {
        paused = true;
        playing = false;
      },
      ensureComposeForDraw: () => {
        composeOpen = true;
      },
      openPin: () => {},
      getMarks: () => committed,
      setMarks: (next) => {
        committed.length = 0;
        committed.push(...next);
      },
      setLiveMark: (m) => {
        liveMark = m;
      },
      getLiveMark: () => liveMark,
      renderOverlays: () => {
        overlayDraws++;
      },
    });

    handler.onDown({ pointerId: 1, button: 0, pointerType: "touch", clientX: 60, clientY: 60, buttons: 1 });
    handler.onMove({ pointerId: 1, clientX: 120, clientY: 60 });
    expect(composeOpen).toBe(true);
    expect(paused).toBe(true);
    expect(liveMark).not.toBeNull();

    handler.onMove({ pointerId: 1, clientX: 180, clientY: 60 });
    handler.onUp({ pointerId: 1, clientX: 180, clientY: 60, buttons: 0 });

    expect(liveMark).toBeNull();
    expect(committed).toHaveLength(1);
    expect(committed[0]?.kind).toBe("arrow");
    expect(committed[0]?.hits?.[0]?.what).toBe("REF · left");
    expect(overlayDraws).toBeGreaterThan(0);
  });

  it("clears liveMark on cancel and reset with zero phantom strokes", () => {
    let liveMark: Mark | null = null;
    const committed: Mark[] = [];

    const handler = createStagePointerHandler({
      getRect: makeRect,
      getContext: () => ({ category: "compare", layout: "hstack", noteSaving: false, isEditing: false }),
      getInkTool: () => "pen" as InkKind,
      getPlaybackTime: () => 1.0,
      isPlaying: () => false,
      pause: () => {},
      ensureComposeForDraw: () => {},
      openPin: () => {},
      getMarks: () => committed,
      setMarks: (next) => {
        committed.length = 0;
        committed.push(...next);
      },
      setLiveMark: (m) => {
        liveMark = m;
      },
      getLiveMark: () => liveMark,
      renderOverlays: () => {},
    });

    handler.onDown({ pointerId: 2, button: 0, pointerType: "touch", clientX: 50, clientY: 50, buttons: 1 });
    handler.onMove({ pointerId: 2, clientX: 150, clientY: 80 });
    expect(liveMark).not.toBeNull();

    handler.onCancel({ pointerId: 2 });
    expect(liveMark).toBeNull();
    expect(committed).toHaveLength(0);

    handler.onDown({ pointerId: 3, button: 0, pointerType: "touch", clientX: 50, clientY: 50, buttons: 1 });
    handler.onMove({ pointerId: 3, clientX: 140, clientY: 90 });
    expect(liveMark).not.toBeNull();

    handler.reset();
    expect(liveMark).toBeNull();
    expect(committed).toHaveLength(0);
  });

  it("drops pin with compare hit label and pauses playback on short tap", () => {
    let pinned: { pin: Pin; t: number; wasPlaying: boolean } | null = null;
    let playing = true;

    const handler = createStagePointerHandler({
      getRect: makeRect,
      getContext: () => ({ category: "compare", layout: "hstack", noteSaving: false, isEditing: false }),
      getInkTool: () => null,
      getPlaybackTime: () => 4.2,
      isPlaying: () => playing,
      pause: () => {
        playing = false;
      },
      ensureComposeForDraw: () => {},
      openPin: (pin, t, wasPlaying) => {
        pinned = { pin, t, wasPlaying };
      },
      getMarks: () => [],
      setMarks: () => {},
      setLiveMark: () => {},
      getLiveMark: () => null,
      renderOverlays: () => {},
    });

    handler.onDown({ pointerId: 5, button: 0, pointerType: "touch", clientX: 300, clientY: 100, buttons: 1 });
    handler.onUp({ pointerId: 5, clientX: 302, clientY: 101, buttons: 0 });

    expect(playing).toBe(false);
    expect(pinned).toEqual({
      pin: { x: 0.755, y: 0.505, what: "OURS · right" },
      t: 4.2,
      wasPlaying: true,
    });
  });
});
