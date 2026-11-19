// Pure origin-aware WAAPI calculations and exit snapshot registry for Compose.
import type { Compose, RefPic, StageAnchor } from "./slice";

export interface ComposeOrigin {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type ComposeExitReason = "save" | "cancel";

export interface ComposeExitSnapshot {
  draft: string;
  drawn: string;
  refs: readonly RefPic[];
}

export interface ComposeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const origins = new WeakMap<object, ComposeOrigin>();
const exitReasons = new WeakMap<object, ComposeExitReason>();
const exitSnapshots = new WeakMap<object, ComposeExitSnapshot>();

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const originOf = (el: Element): ComposeOrigin => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};

export const pointOrigin = (x: number, y: number): ComposeOrigin => ({
  left: x,
  top: y,
  width: 0,
  height: 0,
});

export const setComposeOrigin = (compose: object, origin: ComposeOrigin) => {
  origins.set(compose, origin);
};

export const composeOrigin = (compose: object) => origins.get(compose);

export const recordComposeExit = (
  compose: object,
  reason: ComposeExitReason,
  snapshot: ComposeExitSnapshot,
) => {
  exitReasons.set(compose, reason);
  exitSnapshots.set(compose, snapshot);
};

export const composeExitReason = (compose: object): ComposeExitReason =>
  exitReasons.get(compose) ?? "cancel";

export const composeExitSnapshot = (compose: object) => exitSnapshots.get(compose);

export function shouldAnimateEnter({
  origin,
  reduced,
}: {
  origin: ComposeOrigin | undefined;
  reduced: boolean;
}): false | "reduced" | "spring" {
  // Keyboard-initiated opens (e.g. M) and draft restores stay instant (/emil-design-eng).
  if (!origin) return false;
  return reduced ? "reduced" : "spring";
}

export function resolveHeightRange({
  fixed,
  fresh,
  resumeHeight,
  cardHeight,
  baseHeight = 0,
}: {
  fixed: boolean;
  fresh: boolean;
  resumeHeight: number | null;
  cardHeight: number;
  baseHeight?: number;
}): { from: number; to: number } | null {
  if (fixed || (!fresh && resumeHeight === null)) return null;
  return { from: resumeHeight ?? baseHeight, to: cardHeight };
}

export function resolveExitHeightRange({
  fixed,
  fromHeight,
  baseHeight = 0,
}: {
  fixed: boolean;
  fromHeight: number;
  baseHeight?: number;
}): { from: number; to: number } | null {
  return fixed ? null : { from: fromHeight, to: baseHeight };
}

export function computeOriginVector({
  origin,
  rect,
  dock,
  fixed,
  exiting,
}: {
  origin: ComposeOrigin | undefined;
  rect: ComposeRect;
  dock: boolean;
  fixed: boolean;
  exiting: false | ComposeExitReason;
}): { pctX: number; pctY: number; tx: number; ty: number; sc: number } {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const sc = exiting ? (exiting === "save" ? 0.96 : 0.95) : 0.94;
  if (origin) {
    const ox = origin.left + origin.width / 2;
    const oy = origin.top + origin.height / 2;
    const pctX = clamp(((ox - rect.left) / Math.max(rect.width, 1)) * 100, 0, 100);
    const pctY = clamp(((oy - rect.top) / Math.max(rect.height, 1)) * 100, 0, 100);
    const tx = clamp((ox - cx) * 0.14, -28, 28);
    const ty = clamp((oy - cy) * 0.14, exiting ? -22 : -18, 22);
    return {
      pctX: Number(pctX.toFixed(1)),
      pctY: Number(pctY.toFixed(1)),
      tx: Number(tx.toFixed(1)),
      ty: Number(ty.toFixed(1)),
      sc,
    };
  }
  const pctY = dock ? (exiting === "save" ? 20 : 100) : exiting === "save" ? 100 : 25;
  const ty = fixed ? 14 : dock ? (exiting === "save" ? -10 : 12) : exiting === "save" ? 10 : -6;
  return { pctX: 50, pctY, tx: 0, ty, sc };
}

export const DOCK_CRAMPED_HEIGHT = 430;

/** Floats docked non-inline compose over NoteList chrome when the host panel is too short to show both filters and an editor. */
export function isDockedSheetCramped({
  dock,
  inline,
  panelHeight,
}: {
  dock: boolean;
  inline: boolean;
  panelHeight: number;
}): boolean {
  return dock && !inline && panelHeight > 0 && panelHeight < DOCK_CRAMPED_HEIGHT;
}

export interface NoteFocusTarget {
  focus: () => boolean;
  blur: () => void;
}

export const isStageAnchoredCompose = (
  compose: Compose | null | undefined,
  isPhone: boolean,
): boolean =>
  Boolean(!isPhone && compose?.kind === "create" && (compose.pin !== null || !!compose.anchor));

export interface StageComposerBoxInput {
  anchor: StageAnchor;
  stageRect: { left: number; top: number; width: number; height: number };
  viewSize: { width: number; height: number };
  cardSize: { width: number; height: number };
  pad?: number;
  pinGap?: number;
  offset?: { dx: number; dy: number };
}

export interface StageComposerPlacement {
  left: number;
  top: number;
  originX: number;
  originY: number;
}

/** Places a desktop Stage composer right beside its pin/stroke anchor while clamping strictly inside the player bounds. */
export function computeStageComposerPos({
  anchor,
  stageRect,
  viewSize,
  cardSize,
  pad = 8,
  pinGap = 24,
  offset,
}: StageComposerBoxInput): StageComposerPlacement {
  const viewW = Math.max(1, viewSize.width || stageRect.width);
  const viewH = Math.max(1, viewSize.height || stageRect.height);
  const cardW = Math.min(cardSize.width || 312, Math.max(180, viewW - pad * 2));
  const cardH = Math.min(cardSize.height || 180, Math.max(110, viewH - pad * 2));
  const px = stageRect.left + anchor.x * stageRect.width;
  const py = stageRect.top + anchor.y * stageRect.height;

  const rightGutter = viewW - (stageRect.left + stageRect.width);
  const leftGutter = stageRect.left;
  const maxLeft = Math.max(pad, viewW - cardW - pad);
  const maxTop = Math.max(pad, viewH - cardH - pad);

  let left: number;
  let horizontalStacked = false;

  if (anchor.x >= 0.45 && rightGutter >= cardW + pad + 12) {
    left = stageRect.left + stageRect.width + 12;
  } else if (anchor.x < 0.45 && leftGutter >= cardW + pad + 12) {
    left = stageRect.left - cardW - 12;
  } else if (leftGutter >= cardW + pad + 12 && anchor.x <= 0.65) {
    left = stageRect.left - cardW - 12;
  } else {
    const rightRoom = viewW - pad - (px + pinGap);
    const leftRoom = px - pinGap - pad;
    if (rightRoom >= cardW && (anchor.x <= 0.58 || leftRoom < cardW)) {
      left = px + pinGap;
    } else if (leftRoom >= cardW) {
      left = px - pinGap - cardW;
    } else {
      left = clamp(px - cardW / 2, pad, maxLeft);
      horizontalStacked = true;
    }
  }

  let top: number;
  if (!horizontalStacked) {
    top = clamp(py - 28, pad, maxTop);
  } else {
    const below = py + 44;
    const above = py - 44 - cardH;
    if (below <= maxTop) top = below;
    else if (above >= pad) top = above;
    else top = clamp(py - cardH / 2, pad, maxTop);
  }

  if (offset) {
    left = clamp(left + offset.dx, pad, maxLeft);
    top = clamp(top + offset.dy, pad, maxTop);
  }

  const originX = Number(clamp(((px - left) / Math.max(cardW, 1)) * 100, 0, 100).toFixed(1));
  const originY = Number(clamp(((py - top) / Math.max(cardH, 1)) * 100, 0, 100).toFixed(1));
  return { left: Math.round(left), top: Math.round(top), originX, originY };
}

/** Coordinates synchronous mobile keyboard focus across mounted Compose surfaces and defers only explicit focus requests until mount without leaking to focus=false opens. */
export function createNoteFocusRegistry() {
  const targets = new Set<NoteFocusTarget>();
  let pending = false;

  const register = (target: NoteFocusTarget) => {
    targets.add(target);
    return () => {
      targets.delete(target);
    };
  };

  const focus = (flush?: () => void) => {
    pending = true;
    flush?.();
    for (const t of targets) {
      if (t.focus()) {
        pending = false;
        return true;
      }
    }
    return false;
  };

  const blur = () => {
    pending = false;
    for (const t of targets) t.blur();
  };

  const consumePending = (canFocus: () => boolean) => {
    if (!pending || !canFocus()) return false;
    pending = false;
    return true;
  };

  const clearPending = () => {
    pending = false;
  };

  return {
    register,
    focus,
    blur,
    consumePending,
    clearPending,
    isPending: () => pending,
  };
}
