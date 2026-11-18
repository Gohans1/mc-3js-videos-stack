// GPU-composited WAAPI fold-out / fold-in animations for Lessons Miller columns (emil-design-eng + md-phone).
import { prefersReduced } from "../components/Motion";
import { classifyLessonTrailTransition, type LessonTrail } from "./tree";

const ENTER_EASE = "cubic-bezier(0.23, 1, 0.32, 1)";
const ENTER_MS = 125;
const EXIT_MS = 175;

interface PanelSnapshot {
  key: string;
  rect: DOMRect;
  node: HTMLElement;
  background: string;
  opacity: string;
  scrollTops: number[];
}

export interface DeckSnapshot {
  deckRect: DOMRect;
  cols: PanelSnapshot[];
  content: PanelSnapshot | null;
}

export interface DeckMotion {
  cancel: () => void;
  isRunning: () => boolean;
  exitOpacity: (key: string) => string | undefined;
}

export interface ClipRectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/** Intersects snapshot and live deck bounds so exiting fold-in panels stay clipped strictly inside the Lessons pane and never bleed over the Stage. */
export function computeDeckClipBounds(
  snapshotRect: ClipRectLike,
  liveRect: ClipRectLike,
): ClipRectLike {
  const hasLiveRect = liveRect.width > 0 && liveRect.height > 0;
  if (!hasLiveRect) return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  const left = Math.max(snapshotRect.left, liveRect.left);
  const right = Math.min(snapshotRect.right, liveRect.right);
  const top = Math.max(snapshotRect.top, liveRect.top);
  const bottom = Math.min(snapshotRect.bottom, liveRect.bottom);
  if (right <= left || bottom <= top) {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

/** Filters outgoing panels to only those overlapping the visible clipped overlay rect. */
export function selectVisibleOutgoing<T extends { rect: ClipRectLike }>(
  outgoing: readonly T[],
  clip: ClipRectLike,
): T[] {
  if (clip.width <= 0 || clip.height <= 0) return [];
  return outgoing.filter(
    (item) => item.rect.width > 0 && item.rect.right > clip.left && item.rect.left < clip.right,
  );
}

const scrollers = (node: HTMLElement) => [
  ...node.querySelectorAll<HTMLElement>("[data-arrow-scroll], .scroll-fade"),
];

const capturePanel = (node: HTMLElement, key: string): PanelSnapshot => {
  const style = getComputedStyle(node);
  return {
    key,
    node,
    rect: node.getBoundingClientRect(),
    background: style.backgroundColor,
    opacity: style.opacity,
    scrollTops: scrollers(node).map((el) => el.scrollTop),
  };
};

const cloneGhost = (panel: PanelSnapshot, deckRect: DOMRect, z: number): HTMLElement => {
  const { node, rect, background, opacity } = panel;
  const ghost = node.cloneNode(true) as HTMLElement;
  for (const drop of ghost.querySelectorAll("textarea, [role='dialog']")) drop.remove();
  ghost.style.position = "absolute";
  ghost.style.left = `${rect.left - deckRect.left}px`;
  ghost.style.top = `${rect.top - deckRect.top}px`;
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.style.margin = "0";
  ghost.style.flex = "none";
  ghost.style.zIndex = String(z);
  ghost.style.backgroundColor = background;
  ghost.style.opacity = opacity;
  ghost.style.pointerEvents = "none";
  return ghost;
};

/** Captures live bounding boxes and clones outgoing column snapshots synchronously before folding state changes. */
export function captureDeckSnapshot(deck: HTMLElement | null): DeckSnapshot | null {
  if (!deck) return null;
  const cols = [...deck.querySelectorAll<HTMLElement>("[data-lessons-col]")].map((el, i) =>
    capturePanel(el, el.dataset.lessonsCol ?? String(i)),
  );
  const contentEl = deck.querySelector<HTMLElement>("[data-lesson-content]");
  const content = contentEl ? capturePanel(contentEl, contentEl.dataset.lessonContent ?? "") : null;
  return { deckRect: deck.getBoundingClientRect(), cols, content };
}

/** Runs clipped fold-in ghosts and interruptible fold-out / FLIP transitions on the Lessons deck. */
export function animateDeckTransition({
  deck,
  overlayHost,
  snapshot,
  prevTrail,
  nextTrail,
  animate,
  interrupted = false,
  resume,
}: {
  deck: HTMLElement | null;
  overlayHost?: HTMLElement | null;
  snapshot: DeckSnapshot | null;
  prevTrail: LessonTrail;
  nextTrail: LessonTrail;
  animate: boolean;
  interrupted?: boolean;
  resume?: { key: string; opacity: string };
}): DeckMotion | null {
  if (!deck || !animate) return null;
  const reduced = prefersReduced();
  const transition = classifyLessonTrailTransition(prevTrail, nextTrail);
  if (
    transition.kind === "none" ||
    (reduced && transition.kind !== "open-right") ||
    (interrupted && !resume && transition.kind === "open-right")
  )
    return null;

  const animations: Animation[] = [];
  const exiting = new Map<string, HTMLElement>();
  const cleanup: (() => void)[] = [];
  const cancelAnims = (el: Element | null | undefined) => {
    if (!el || typeof el.getAnimations !== "function") return;
    for (const a of el.getAnimations()) a.cancel();
  };

  const liveCols = [...deck.querySelectorAll<HTMLElement>("[data-lessons-col]")];
  const liveContent = deck.querySelector<HTMLElement>("[data-lesson-content]");

  // Unmount fold-out ghosts clipped inside the Lessons pane whenever columns or sheets are replaced or closed
  const hasOutgoingCols = Boolean(snapshot && snapshot.cols.length > transition.keepColumnCount);
  const hasOutgoingContent = Boolean(snapshot?.content && transition.closingContent);
  if (
    !reduced &&
    snapshot &&
    (hasOutgoingCols || hasOutgoingContent) &&
    snapshot.deckRect.width > 0
  ) {
    const outgoing: PanelSnapshot[] = [];
    for (let i = transition.keepColumnCount; i < snapshot.cols.length; i++) {
      outgoing.push(snapshot.cols[i]!);
    }
    if (hasOutgoingContent && snapshot.content) outgoing.push(snapshot.content);

    const clip = computeDeckClipBounds(snapshot.deckRect, deck.getBoundingClientRect());
    const clipRect = clip as DOMRect;
    const visibleOut = selectVisibleOutgoing(outgoing, clip);
    if (visibleOut.length > 0 && overlayHost) {
      const host = overlayHost.getBoundingClientRect();
      const overlay = document.createElement("div");
      overlay.inert = true;
      overlay.setAttribute("aria-hidden", "true");
      overlay.style.position = "absolute";
      overlay.style.left = `${clip.left - host.left}px`;
      overlay.style.top = `${clip.top - host.top}px`;
      overlay.style.width = `${clip.width}px`;
      overlay.style.height = `${clip.height}px`;
      overlay.style.overflow = "hidden";
      overlay.style.pointerEvents = "none";
      overlay.style.zIndex = "45";
      overlayHost.append(overlay);

      let remaining = visibleOut.length;
      const removeOverlay = () => overlay.remove();
      visibleOut.forEach((item, idx) => {
        const ghost = cloneGhost(item, clipRect, idx + 1);
        exiting.set(item.key, ghost);
        overlay.append(ghost);
        scrollers(ghost).forEach((el, i) => {
          el.scrollTop = item.scrollTops[i] ?? 0;
        });
        const anim = ghost.animate([{ opacity: item.opacity }, { opacity: 0 }], {
          duration: EXIT_MS,
          delay: Math.min(idx * 22, 60),
          easing: "ease-out",
          fill: "forwards",
        });
        animations.push(anim);
        const done = () => {
          ghost.remove();
          if (--remaining <= 0) removeOverlay();
        };
        anim.finished.then(done, done);
      });
      const fallback = setTimeout(removeOverlay, EXIT_MS + 120);
      cleanup.push(() => {
        clearTimeout(fallback);
        removeOverlay();
      });
    }
  }

  // Smooth horizontal FLIP for kept columns that repositioned when opening or folding back
  if (
    !reduced &&
    snapshot &&
    snapshot.cols.length === prevTrail.columns.length &&
    liveCols.length === nextTrail.columns.length
  ) {
    const oldByKey = new Map(snapshot.cols.map((c) => [c.key, c.rect.left]));
    const checkCount = Math.min(transition.keepColumnCount, liveCols.length);
    for (let i = 0; i < checkCount; i++) {
      const col = liveCols[i]!;
      const oldLeft = oldByKey.get(col.dataset.lessonsCol ?? "");
      if (oldLeft === undefined) continue;
      const dx = oldLeft - col.getBoundingClientRect().left;
      if (Math.abs(dx) <= 2) continue;
      cancelAnims(col);
      if (typeof col.animate === "function") {
        const anim = col.animate(
          [{ transform: `translate3d(${dx}px, 0, 0)` }, { transform: "translate3d(0, 0, 0)" }],
          { duration: ENTER_MS, easing: ENTER_EASE },
        );
        animations.push(anim);
      }
    }
  }

  // Enter motion for newly revealed columns or newly opened / switched lesson sheet
  if (transition.kind === "open-right") {
    const entering: HTMLElement[] = liveCols.slice(transition.keepColumnCount);
    if (liveContent) entering.push(liveContent);
    for (const el of entering) {
      cancelAnims(el);
      if (typeof el.animate !== "function") continue;
      const key = el.dataset.lessonContent ?? el.dataset.lessonsCol;
      const opacity = resume && resume.key === key ? resume.opacity : reduced ? 0.9 : 0.82;
      animations.push(
        el.animate([{ opacity }, { opacity: 1 }], {
          duration: reduced ? 80 : ENTER_MS,
          easing: ENTER_EASE,
        }),
      );
    }
  }

  return {
    exitOpacity: (key) => {
      const ghost = exiting.get(key);
      return ghost?.isConnected ? getComputedStyle(ghost).opacity : undefined;
    },
    isRunning: () =>
      animations.some((animation) => animation.pending || animation.playState === "running"),
    cancel: () => {
      for (const animation of animations) animation.cancel();
      for (const remove of cleanup) remove();
    },
  };
}
