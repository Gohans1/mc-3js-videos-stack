export interface LiteHotkeyEventLike {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  target: unknown;
  preventDefault: () => void;
}

export interface LiteHotkeyDeps {
  togglePlay: () => void;
  step: (dtSec: number) => void;
  seekBy: (dtSec: number) => void;
  seekStart: () => void;
  seekEnd: () => void;
  toggleMute: () => void;
  openNewNote: () => void;
  toggleDraw: () => void;
  refresh: () => void;
  jumpNote: (dir: -1 | 1) => void;
  hasCompose: () => boolean;
  cancelCompose: () => void;
  hasInkTool: () => boolean;
  stopDraw: () => void;
  canUndoInk: () => boolean;
  undoInk: () => void;
}

interface TargetElementLike {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
}

const asElement = (target: unknown): TargetElementLike | null =>
  target && typeof target === "object" ? (target as TargetElementLike) : null;

const isEditableTarget = (target: unknown): boolean => {
  const el = asElement(target);
  if (!el) return false;
  const tag = el.tagName?.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return Boolean(el.closest?.('[contenteditable="true"], [contenteditable=""]'));
};

interface QueryNodeLike {
  closest?: (selector: string) => unknown;
  getAttribute?: (name: string) => string | null;
  checkVisibility?: () => boolean;
  getBoundingClientRect?: () => { width: number; height: number };
}

const OVERLAY_SELECTOR =
  '[role="dialog"]:not([data-slot="toast"]), [role="listbox"], [role="menu"]';

const isNodeVisibleOverlay = (node: QueryNodeLike): boolean => {
  if (node.getAttribute?.("aria-hidden") === "true") return false;
  if (node.closest?.('[hidden], [data-closed], [aria-hidden="true"]')) return false;
  const selectContent = node.closest?.('[data-slot="select-content"]') as QueryNodeLike | null;
  if (selectContent && selectContent.getAttribute?.("data-open") === null) return false;
  if (typeof node.checkVisibility === "function") {
    return node.checkVisibility();
  }
  if (typeof node.getBoundingClientRect === "function") {
    const r = node.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
  }
  if (
    typeof getComputedStyle === "function" &&
    typeof Element !== "undefined" &&
    node instanceof Element
  ) {
    const st = getComputedStyle(node);
    if (st.display === "none" || st.visibility === "hidden") return false;
  }
  return true;
};

const isDialogOrPopupOpen = (target: unknown): boolean => {
  const el = asElement(target);
  const ancestor = el?.closest?.(OVERLAY_SELECTOR) as QueryNodeLike | null | undefined;
  if (ancestor && isNodeVisibleOverlay(ancestor)) {
    return true;
  }
  if (typeof document !== "undefined" && typeof document.querySelectorAll === "function") {
    const nodes = document.querySelectorAll(OVERLAY_SELECTOR);
    for (const node of nodes) {
      if (isNodeVisibleOverlay(node as unknown as QueryNodeLike)) return true;
    }
  }
  return false;
};

const isInteractiveControl = (target: unknown): boolean => {
  const el = asElement(target);
  if (!el) return false;
  const tag = el.tagName?.toUpperCase();
  if (tag === "BUTTON" || tag === "A") return true;
  return Boolean(el.closest?.('button, a, [role="slider"]'));
};

const isSliderTarget = (target: unknown): boolean => {
  const el = asElement(target);
  return Boolean(el?.closest?.('[role="slider"]'));
};

const FRAME_STEP = 1 / 30;

export const handleLiteKeydown = (e: LiteHotkeyEventLike, deps: LiteHotkeyDeps): boolean => {
  if (e.defaultPrevented) return false;

  if (e.key === "Escape") {
    if (isDialogOrPopupOpen(e.target)) return false;
    if (deps.hasCompose()) {
      e.preventDefault();
      deps.cancelCompose();
      return true;
    }
    if (deps.hasInkTool()) {
      e.preventDefault();
      deps.stopDraw();
      return true;
    }
    return false;
  }

  if (isEditableTarget(e.target) || isDialogOrPopupOpen(e.target)) return false;

  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "z") {
    if (deps.canUndoInk()) {
      e.preventDefault();
      deps.undoInk();
      return true;
    }
    return false;
  }

  if (e.ctrlKey || e.metaKey || e.altKey) return false;

  const key = e.key;
  const lower = key.toLowerCase();

  if (key === " ") {
    if (isInteractiveControl(e.target)) return false;
    e.preventDefault();
    deps.togglePlay();
    return true;
  }
  if (lower === "k") {
    e.preventDefault();
    deps.togglePlay();
    return true;
  }
  if (key === "ArrowLeft") {
    if (isSliderTarget(e.target)) return false;
    e.preventDefault();
    if (e.shiftKey) deps.step(-1);
    else deps.seekBy(-3);
    return true;
  }
  if (key === "ArrowRight") {
    if (isSliderTarget(e.target)) return false;
    e.preventDefault();
    if (e.shiftKey) deps.step(1);
    else deps.seekBy(3);
    return true;
  }
  if (key === ",") {
    e.preventDefault();
    deps.step(-FRAME_STEP);
    return true;
  }
  if (key === ".") {
    e.preventDefault();
    deps.step(FRAME_STEP);
    return true;
  }
  if (lower === "j") {
    e.preventDefault();
    deps.seekBy(-2);
    return true;
  }
  if (lower === "l") {
    e.preventDefault();
    deps.seekBy(2);
    return true;
  }
  if (key === "Home") {
    if (isSliderTarget(e.target)) return false;
    e.preventDefault();
    deps.seekStart();
    return true;
  }
  if (key === "End") {
    if (isSliderTarget(e.target)) return false;
    e.preventDefault();
    deps.seekEnd();
    return true;
  }
  if (lower === "m") {
    e.preventDefault();
    deps.toggleMute();
    return true;
  }
  if (lower === "n") {
    e.preventDefault();
    deps.openNewNote();
    return true;
  }
  if (lower === "d") {
    e.preventDefault();
    deps.toggleDraw();
    return true;
  }
  if (lower === "r") {
    e.preventDefault();
    deps.refresh();
    return true;
  }
  if (key === "[") {
    e.preventDefault();
    deps.jumpNote(-1);
    return true;
  }
  if (key === "]") {
    e.preventDefault();
    deps.jumpNote(1);
    return true;
  }

  return false;
};

export const bindLiteHotkeys = (deps: LiteHotkeyDeps): (() => void) => {
  const onKeyDown = (e: KeyboardEvent) => {
    handleLiteKeydown(e, deps);
  };
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
};
