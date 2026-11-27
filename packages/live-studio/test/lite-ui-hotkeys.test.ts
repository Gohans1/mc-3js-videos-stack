import { describe, expect, it } from "bun:test";

import { handleLiteKeydown, type LiteHotkeyDeps } from "../app/lite/hotkeys.ts";

const makeDeps = (overrides: Partial<LiteHotkeyDeps> = {}) => {
  const calls: string[] = [];
  const deps: LiteHotkeyDeps = {
    togglePlay: () => calls.push("togglePlay"),
    step: (dt) => calls.push(`step:${dt.toFixed(4)}`),
    seekBy: (dt) => calls.push(`seekBy:${dt}`),
    seekStart: () => calls.push("seekStart"),
    seekEnd: () => calls.push("seekEnd"),
    toggleMute: () => calls.push("toggleMute"),
    openNewNote: () => calls.push("openNewNote"),
    toggleDraw: () => calls.push("toggleDraw"),
    refresh: () => calls.push("refresh"),
    jumpNote: (dir) => calls.push(`jumpNote:${dir}`),
    hasCompose: () => false,
    cancelCompose: () => calls.push("cancelCompose"),
    hasInkTool: () => false,
    stopDraw: () => calls.push("stopDraw"),
    canUndoInk: () => false,
    undoInk: () => calls.push("undoInk"),
    ...overrides,
  };
  return { deps, calls };
};

const makeEvent = (
  key: string,
  opts: {
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    target?: unknown;
  } = {},
) => {
  let prevented = false;
  return {
    key,
    shiftKey: opts.shiftKey ?? false,
    ctrlKey: opts.ctrlKey ?? false,
    metaKey: opts.metaKey ?? false,
    altKey: opts.altKey ?? false,
    defaultPrevented: false,
    target: opts.target ?? null,
    preventDefault() {
      prevented = true;
    },
    get prevented() {
      return prevented;
    },
  };
};

describe("handleLiteKeydown", () => {
  it("handles playback, frame stepping, seek, mute, note, draw, refresh, and note jump shortcuts", () => {
    const { deps, calls } = makeDeps();

    expect(handleLiteKeydown(makeEvent(" "), deps)).toBe(true);
    expect(handleLiteKeydown(makeEvent("k"), deps)).toBe(true);
    expect(handleLiteKeydown(makeEvent("ArrowLeft"), deps)).toBe(true);
    expect(handleLiteKeydown(makeEvent("ArrowRight"), deps)).toBe(true);
    expect(handleLiteKeydown(makeEvent(","), deps)).toBe(true);
    expect(handleLiteKeydown(makeEvent("."), deps)).toBe(true);
    expect(handleLiteKeydown(makeEvent("ArrowLeft", { shiftKey: true }), deps)).toBe(true);
    expect(handleLiteKeydown(makeEvent("ArrowRight", { shiftKey: true }), deps)).toBe(true);
    expect(handleLiteKeydown(makeEvent("j"), deps)).toBe(true);
    expect(handleLiteKeydown(makeEvent("l"), deps)).toBe(true);
    expect(handleLiteKeydown(makeEvent("Home"), deps)).toBe(true);
    expect(handleLiteKeydown(makeEvent("End"), deps)).toBe(true);
    expect(handleLiteKeydown(makeEvent("m"), deps)).toBe(true);
    expect(handleLiteKeydown(makeEvent("n"), deps)).toBe(true);
    expect(handleLiteKeydown(makeEvent("d"), deps)).toBe(true);
    expect(handleLiteKeydown(makeEvent("r"), deps)).toBe(true);
    expect(handleLiteKeydown(makeEvent("["), deps)).toBe(true);
    expect(handleLiteKeydown(makeEvent("]"), deps)).toBe(true);

    expect(calls).toEqual([
      "togglePlay",
      "togglePlay",
      "seekBy:-3",
      "seekBy:3",
      "step:-0.0333",
      "step:0.0333",
      "step:-1.0000",
      "step:1.0000",
      "seekBy:-2",
      "seekBy:2",
      "seekStart",
      "seekEnd",
      "toggleMute",
      "openNewNote",
      "toggleDraw",
      "refresh",
      "jumpNote:-1",
      "jumpNote:1",
    ]);
  });

  it("ignores browser-modifier combos like Ctrl+R / Cmd+R and skips editable/dialog targets", () => {
    const { deps, calls } = makeDeps();

    expect(handleLiteKeydown(makeEvent("r", { ctrlKey: true }), deps)).toBe(false);
    expect(handleLiteKeydown(makeEvent("r", { metaKey: true }), deps)).toBe(false);
    expect(handleLiteKeydown(makeEvent("n", { altKey: true }), deps)).toBe(false);

    const textarea = { tagName: "TEXTAREA", isContentEditable: false, closest: () => null };
    const input = { tagName: "INPUT", isContentEditable: false, closest: () => null };
    const dialogChild = {
      tagName: "DIV",
      isContentEditable: false,
      closest: (sel: string) => (sel.includes("dialog") ? {} : null),
    };
    const button = { tagName: "BUTTON", isContentEditable: false, closest: () => null };
    const slider = {
      tagName: "DIV",
      isContentEditable: false,
      closest: (sel: string) => (sel.includes("slider") ? {} : null),
    };

    expect(handleLiteKeydown(makeEvent(" ", { target: textarea }), deps)).toBe(false);
    expect(handleLiteKeydown(makeEvent("d", { target: input }), deps)).toBe(false);
    expect(handleLiteKeydown(makeEvent("m", { target: dialogChild }), deps)).toBe(false);
    expect(handleLiteKeydown(makeEvent(" ", { target: button }), deps)).toBe(false);
    expect(handleLiteKeydown(makeEvent("ArrowRight", { target: slider }), deps)).toBe(false);
    expect(calls).toEqual([]);
  });

  it("handles Escape to cancel compose or stop drawing, and Ctrl/Cmd+Z to undo ink outside inputs", () => {
    const composeCase = makeDeps({ hasCompose: () => true });
    const textarea = { tagName: "TEXTAREA", isContentEditable: false, closest: () => null };
    expect(handleLiteKeydown(makeEvent("Escape", { target: textarea }), composeCase.deps)).toBe(true);
    expect(composeCase.calls).toEqual(["cancelCompose"]);

    const drawCase = makeDeps({ hasInkTool: () => true });
    expect(handleLiteKeydown(makeEvent("Escape"), drawCase.deps)).toBe(true);
    expect(drawCase.calls).toEqual(["stopDraw"]);

    const undoCase = makeDeps({ canUndoInk: () => true });
    expect(handleLiteKeydown(makeEvent("z", { ctrlKey: true }), undoCase.deps)).toBe(true);
    expect(handleLiteKeydown(makeEvent("z", { metaKey: true }), undoCase.deps)).toBe(true);
    expect(handleLiteKeydown(makeEvent("z", { ctrlKey: true, target: textarea }), undoCase.deps)).toBe(
      false,
    );
    expect(undoCase.calls).toEqual(["undoInk", "undoInk"]);
  });

  it("allows hotkeys when only a Base UI toast or closed/hidden listbox is mounted, while blocking open modals and open listboxes", () => {
    const prevDoc = globalThis.document;
    try {
      let queryUsed = "";
      const makeDoc = (nodes: unknown[]) => ({
        querySelector(sel: string) {
          queryUsed = sel;
          return nodes[0] ?? null;
        },
        querySelectorAll(sel: string) {
          queryUsed = sel;
          return nodes;
        },
      });

      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: {
          querySelector(sel: string) {
            queryUsed = sel;
            return sel.includes(':not([data-slot="toast"])') ? null : { getAttribute: () => "toast" };
          },
          querySelectorAll(sel: string) {
            queryUsed = sel;
            return sel.includes(':not([data-slot="toast"])') ? [] : [{ getAttribute: () => "toast" }];
          },
        },
      });

      const { deps, calls } = makeDeps();
      expect(handleLiteKeydown(makeEvent("r"), deps)).toBe(true);
      expect(handleLiteKeydown(makeEvent("]"), deps)).toBe(true);
      expect(queryUsed).toContain(':not([data-slot="toast"])');
      expect(calls).toEqual(["refresh", "jumpNote:1"]);

      const closedListbox = {
        getAttribute: () => null,
        closest: (sel: string) => (sel.includes("[hidden]") ? {} : null),
        checkVisibility: () => false,
      };
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: makeDoc([closedListbox]),
      });
      expect(handleLiteKeydown(makeEvent("r"), deps)).toBe(true);
      expect(calls).toEqual(["refresh", "jumpNote:1", "refresh"]);

      const openListbox = {
        getAttribute: () => null,
        closest: (sel: string) =>
          sel.includes("select-content") ? { getAttribute: (k: string) => (k === "data-open" ? "" : null) } : null,
        checkVisibility: () => true,
      };
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: makeDoc([openListbox]),
      });
      expect(handleLiteKeydown(makeEvent("r"), deps)).toBe(false);

      const openDialog = {
        getAttribute: () => null,
        closest: () => null,
        checkVisibility: () => true,
      };
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: makeDoc([openDialog]),
      });
      expect(handleLiteKeydown(makeEvent("r"), deps)).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "document", { configurable: true, value: prevDoc });
    }
  });
});
