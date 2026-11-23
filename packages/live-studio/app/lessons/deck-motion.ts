import { EASE_OUT, prefersReduced } from "../components/Motion";
import { classifyLessonTrailTransition, type LessonTrail } from "./tree";

const ENTER_MS = 125;
const EXIT_MS = 150;
const FOLDER_TRAVEL = 8;

interface PanelSnapshot {
  key: string;
  rect: DOMRect;
  node: HTMLElement;
  copy?: HTMLElement;
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
  exitFrame: (key: string) => { opacity: string; left: number } | undefined;
}

export interface ClipRectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

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

const capturePanel = (node: HTMLElement, key: string, copy: boolean): PanelSnapshot => {
  const style = getComputedStyle(node);
  return {
    key,
    node,
    copy: copy ? (node.cloneNode(true) as HTMLElement) : undefined,
    rect: node.getBoundingClientRect(),
    background: style.backgroundColor,
    opacity: style.opacity,
    scrollTops: scrollers(node).map((el) => el.scrollTop),
  };
};

const cloneGhost = (panel: PanelSnapshot, deckRect: DOMRect, z: number): HTMLElement => {
  const { key, node, copy, rect, background, opacity } = panel;
  const ghost = copy ?? (node.cloneNode(true) as HTMLElement);
  for (const drop of ghost.querySelectorAll("textarea, [role='dialog']")) drop.remove();
  if (node.hasAttribute("data-lesson-content")) {
    for (const control of ghost.querySelectorAll<HTMLElement>("button, [role='radio']")) {
      control.style.visibility = "hidden";
    }
  }
  ghost.removeAttribute("id");
  ghost.removeAttribute("data-lessons-col");
  ghost.removeAttribute("data-lesson-content");
  ghost.dataset.lessonMotionKey = key;
  for (const el of ghost.querySelectorAll("[id], [data-lesson-row], [data-lesson-back]")) {
    el.removeAttribute("id");
    el.removeAttribute("data-lesson-row");
    el.removeAttribute("data-lesson-back");
  }
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

export function captureDeckSnapshot(deck: HTMLElement | null): DeckSnapshot | null {
  if (!deck) return null;
  const cols = [...deck.querySelectorAll<HTMLElement>("[data-lessons-col]")].map((el, i) =>
    capturePanel(el, el.dataset.lessonsCol ?? String(i), true),
  );
  const contentEl = deck.querySelector<HTMLElement>("[data-lesson-content]");
  const content = contentEl
    ? capturePanel(contentEl, contentEl.dataset.lessonContent ?? "", false)
    : null;
  return { deckRect: deck.getBoundingClientRect(), cols, content };
}

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
  resume?: { key: string; opacity: string; left: number };
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
  const previousCols = new Map(snapshot?.cols.map((col) => [col.key, col]));
  const currentCols = new Map(
    liveCols.map((col) => [col.dataset.lessonsCol ?? "", col.getBoundingClientRect()]),
  );
  const cropped =
    previousCols.size !== prevTrail.columns.length || currentCols.size !== nextTrail.columns.length;
  const folderNavigation = !prevTrail.contentKey && !nextTrail.contentKey;
  const replacesLayout = cropped || transition.closingContent || folderNavigation;
  const replaced = new Set<string>();
  if (!reduced && replacesLayout) {
    for (const [key, current] of currentCols) {
      const old = previousCols.get(key)?.rect;
      if (
        old &&
        (Math.abs(old.left - current.left) > 32 || Math.abs(old.width - current.width) > 2)
      )
        replaced.add(key);
    }
  }

  if (!reduced && snapshot?.deckRect.width) {
    const outgoing = snapshot.cols.filter(({ key }) => !currentCols.has(key) || replaced.has(key));
    if (transition.closingContent && snapshot.content) outgoing.push(snapshot.content);

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
        const leavesFolder = folderNavigation && !currentCols.has(item.key);
        const anim = ghost.animate(
          leavesFolder
            ? [
                { opacity: item.opacity, transform: "none" },
                { opacity: 0, transform: `translateX(${FOLDER_TRAVEL}px)` },
              ]
            : [{ opacity: item.opacity }, { opacity: 0 }],
          {
            duration: replacesLayout ? ENTER_MS : EXIT_MS,
            delay: replacesLayout ? 0 : Math.min(idx * 22, 60),
            easing: EASE_OUT,
            fill: "forwards",
          },
        );
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

  const entering = liveCols.filter((col) => {
    const key = col.dataset.lessonsCol ?? "";
    const before = previousCols.get(key)?.rect;
    if (!before || replaced.has(key)) return true;
    if (!reduced) {
      const dx = before.left - (currentCols.get(key)?.left ?? before.left);
      if (Math.abs(dx) > 2 && typeof col.animate === "function") {
        cancelAnims(col);
        animations.push(
          col.animate(
            [{ transform: `translate3d(${dx}px, 0, 0)` }, { transform: "translate3d(0, 0, 0)" }],
            { duration: ENTER_MS, easing: EASE_OUT },
          ),
        );
      }
    }
    return false;
  });
  if (transition.kind === "open-right" && liveContent) entering.push(liveContent);
  for (const el of entering) {
    cancelAnims(el);
    if (typeof el.animate !== "function") continue;
    const key = el.dataset.lessonContent ?? el.dataset.lessonsCol;
    const resumed = resume?.key === key ? resume : undefined;
    const retained =
      interrupted && key !== undefined && replaced.has(key) ? previousCols.get(key) : undefined;
    const opacity = resumed?.opacity ?? retained?.opacity ?? (reduced ? 0.9 : 0.82);
    const entersFolder =
      !reduced && folderNavigation && key !== undefined && !previousCols.has(key);
    const travel =
      entersFolder && resumed
        ? Math.min(FOLDER_TRAVEL, Math.max(0, resumed.left - el.getBoundingClientRect().left))
        : FOLDER_TRAVEL;
    animations.push(
      el.animate(
        entersFolder
          ? [
              { opacity, transform: `translateX(${travel}px)` },
              { opacity: 1, transform: "none" },
            ]
          : [{ opacity }, { opacity: 1 }],
        { duration: reduced ? 80 : ENTER_MS, easing: EASE_OUT },
      ),
    );
  }

  return {
    exitFrame: (key) => {
      const ghost = exiting.get(key);
      return ghost?.isConnected
        ? { opacity: getComputedStyle(ghost).opacity, left: ghost.getBoundingClientRect().left }
        : undefined;
    },
    isRunning: () =>
      animations.some((animation) => animation.pending || animation.playState === "running"),
    cancel: () => {
      for (const animation of animations) animation.cancel();
      for (const remove of cleanup) remove();
    },
  };
}
