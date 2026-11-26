import {
  Columns2,
  Crosshair,
  GripHorizontal,
  ImagePlus,
  PenLine,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  lazy,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { textareaVariants } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { EASE_OUT } from "../components/Motion";
import { PHONE } from "../core/device";
import { get, noteFocus, useStudio } from "../core/store";
import { rangeText, stamp } from "../core/time";
import { inOutAt } from "../timeline/inout";
import {
  type ComposeExitReason,
  composeExitReason,
  type ComposeExitSnapshot,
  composeExitSnapshot,
  composeOrigin,
  computeOriginVector,
  computeStageComposerPos,
  isDockedSheetCramped,
  isStageAnchoredCompose,
  resolveExitHeightRange,
  resolveHeightRange,
  shouldAnimateEnter,
} from "./compose-motion";
import { INK_KEYS, setInk, toolsOpen } from "./ink";
import { modKeyLabel, noteShotTitle, pinShortLabel } from "./note-card-meta";
import { AskCallout } from "./note-parts";
import { cancelNote, saveNote, setDraft } from "./notes";
import { PinDrawToolbar } from "./PinTools";
import { addRefs, REFS_MAX, removeRef } from "./refs";
import { type Compose as ComposeSpec, isComposeDirty, type StageAnchor } from "./slice";

const RefSketch = lazy(() => import("./RefSketch").then((m) => ({ default: m.RefSketch })));

interface ExitState extends ComposeExitSnapshot {
  compose: ComposeSpec;
  reason: ComposeExitReason;
}

export function Compose({
  inline = false,
  dock = false,
  stage = false,
  idleFooter = null,
  onCrampedOverlayChange,
  onIdle,
  draggableHeader = false,
  onDragHeaderPointerDown,
  onHeaderDoubleClick,
  className,
}: {
  inline?: boolean;
  dock?: boolean;
  stage?: boolean;
  idleFooter?: ReactNode;
  onCrampedOverlayChange?: (active: boolean) => void;
  onIdle?: () => void;
  draggableHeader?: boolean;
  onDragHeaderPointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onHeaderDoubleClick?: () => void;
  className?: string;
}) {
  const rawCompose = useStudio((s) => s.compose),
    noteSaving = useStudio((s) => s.noteSaving),
    draft = useStudio((s) => s.draft),
    drawn = useStudio((s) => s.inkSaid),
    refs = useStudio((s) => s.refs),
    notes = useStudio((s) => s.notes);
  const compose = stage
    ? isStageAnchoredCompose(rawCompose, PHONE)
      ? rawCompose
      : null
    : dock && isStageAnchoredCompose(rawCompose, PHONE)
      ? null
      : rawCompose;
  const animateCompose = PHONE || !dock || stage;
  const [openCompose, setOpenCompose] = useState<ComposeSpec | null>(compose);
  const [exitState, setExitState] = useState<ExitState | null>(null);
  if (compose) {
    if (openCompose !== compose) setOpenCompose(compose);
    if (exitState) setExitState(null);
  } else if (openCompose) {
    if (animateCompose) {
      const snap = composeExitSnapshot(openCompose) ?? { draft: "", drawn: "", refs: [] };
      setExitState({
        compose: openCompose,
        reason: composeExitReason(openCompose),
        ...snap,
      });
    }
    setOpenCompose(null);
  }

  const [openRef, setOpenRef] = useState<string | null>(null),
    picker = useRef<HTMLInputElement>(null);
  useStudio((s) => s.inOut);
  const text = useRef<HTMLTextAreaElement>(null),
    wrapRef = useRef<HTMLDivElement>(null),
    cardRef = useRef<HTMLDivElement>(null),
    idleRef = useRef<HTMLDivElement>(null),
    prevKey = useRef<string | null>(null),
    enteredKeyRef = useRef<string | null>(null),
    resumeHeightRef = useRef<number | null>(null),
    idleHeightRef = useRef(0),
    [panelHeight, setPanelHeight] = useState(0),
    hintId = useId();
  useLayoutEffect(
    () =>
      noteFocus.register({
        focus: () => {
          flushSync(() => {});
          const box = text.current;
          if (!box || box.disabled || box.getClientRects().length === 0 || box.closest("[inert]"))
            return false;
          box.focus({ preventScroll: true });
          return true;
        },
        blur: () => {
          const box = text.current;
          if (box && box.getClientRects().length > 0) box.blur();
        },
      }),
    [],
  );
  const exiting = exitState ? exitState.reason : false;
  const shownCompose = compose ?? exitState?.compose ?? null;
  const hasCompose = Boolean(shownCompose);
  const cramped = hasCompose && isDockedSheetCramped({ dock, inline, panelHeight });
  const scrollLocation = cramped && dock && !inline;
  const hasIdle = Boolean(idleFooter);
  const open = !!compose && !exiting;
  const composeKey =
    !shownCompose || exiting
      ? null
      : shownCompose.kind === "edit"
        ? `edit:${shownCompose.id}`
        : `create:${Math.round(shownCompose.t * 100)}`;

  useLayoutEffect(() => {
    if (scrollLocation && document.activeElement === text.current)
      text.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [scrollLocation, composeKey]);

  useLayoutEffect(() => {
    if (!shownCompose && idleRef.current) {
      idleHeightRef.current = idleRef.current.getBoundingClientRect().height;
    }
  }, [shownCompose, idleFooter]);

  useLayoutEffect(() => {
    if (!dock || inline || !hasCompose) return;
    const parent = wrapRef.current?.parentElement;
    if (!parent) return;
    const sync = () =>
      setPanelHeight((prev) => (prev === parent.clientHeight ? prev : parent.clientHeight));
    sync();
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(sync);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [dock, inline, hasCompose]);

  const crampedOverlay = open && cramped && !inline && dock;
  useLayoutEffect(() => {
    onCrampedOverlayChange?.(crampedOverlay);
    return () => onCrampedOverlayChange?.(false);
  }, [crampedOverlay, onCrampedOverlayChange]);

  useEffect(() => {
    if (!open) {
      noteFocus.clearPending();
      return;
    }
    if (!composeKey) return;
    const box = text.current;
    if (!box || box.getClientRects().length === 0) return;
    if (noteFocus.consumePending(() => !wrapRef.current?.contains(document.activeElement))) {
      box.focus({ preventScroll: true });
    }
  }, [open, composeKey]);

  useLayoutEffect(() => {
    const outer = wrapRef.current,
      card = cardRef.current,
      current = compose;
    if (!current || !composeKey || !outer || !card) {
      prevKey.current = null;
      enteredKeyRef.current = null;
      return;
    }
    const panelHeight = outer.parentElement?.clientHeight ?? 0;
    const nextCramped = isDockedSheetCramped({ dock, inline, panelHeight });
    if (nextCramped !== cramped) return;
    if (prevKey.current === composeKey && enteredKeyRef.current === composeKey) return;
    const wasKey = prevKey.current;
    prevKey.current = composeKey;
    enteredKeyRef.current = composeKey;
    const resumeHeight = resumeHeightRef.current;
    resumeHeightRef.current = null;
    if (!animateCompose || typeof card.animate !== "function") return;
    const origin = composeOrigin(current);
    const mode = shouldAnimateEnter({
      origin,
      reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
    if (!mode) return;
    const rect = card.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const fixed = stage || getComputedStyle(card).position === "fixed";
    let alive = true;
    const running: Animation[] = [];
    if (mode === "reduced") {
      running.push(
        card.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: EASE_OUT }),
      );
    } else {
      const fresh = wasKey === null && resumeHeight === null;
      const { pctX, pctY, tx, ty } = computeOriginVector({
        origin,
        rect,
        dock,
        fixed,
        exiting: false,
      });
      card.style.transformOrigin = `${pctX}% ${pctY}%`;
      const hRange = resolveHeightRange({
        fixed,
        fresh,
        resumeHeight,
        cardHeight: card.offsetHeight,
        baseHeight: hasIdle ? idleHeightRef.current : 0,
      });
      if (hRange) {
        outer.style.overflow = "hidden";
        running.push(
          outer.animate([{ height: `${hRange.from}px` }, { height: `${hRange.to}px` }], {
            duration: 210,
            easing: EASE_OUT,
          }),
        );
      }
      running.push(
        card.animate(
          [
            {
              opacity: fresh ? 0 : 0.6,
              transform: `translate(${tx}px, ${ty}px) scale(${fresh ? 0.94 : 0.97})`,
            },
            { opacity: 1, transform: "translate(0px, 0px) scale(1)" },
          ],
          { duration: fresh ? 210 : 170, easing: EASE_OUT },
        ),
      );
    }
    void Promise.all(running.map((a) => a.finished.catch(() => {}))).finally(() => {
      if (!alive) return;
      if (outer.isConnected) outer.style.overflow = "";
      if (card.isConnected) card.style.transformOrigin = "";
    });
    return () => {
      alive = false;
      for (const a of running) a.cancel();
      outer.style.overflow = "";
      card.style.transformOrigin = "";
    };
  }, [compose, composeKey, dock, inline, stage, hasIdle, cramped, animateCompose]);

  useLayoutEffect(() => {
    if (!exiting || !shownCompose) return;
    const outer = wrapRef.current,
      card = cardRef.current;
    if (!outer || !card || typeof card.animate !== "function") {
      setExitState(null);
      return;
    }
    const active = document.activeElement;
    if (outer.contains(active) && active instanceof HTMLElement) active.blur();
    const rect = card.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      setExitState(null);
      return;
    }
    let alive = true;
    let finished = false;
    const running: Animation[] = [];
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fixed = stage || getComputedStyle(card).position === "fixed";
    const dur = reduced ? 110 : 185;

    if (reduced) {
      running.push(
        card.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: dur,
          easing: EASE_OUT,
          fill: "forwards",
        }),
      );
    } else {
      const { pctX, pctY, tx, ty, sc } = computeOriginVector({
        origin: composeOrigin(shownCompose),
        rect,
        dock,
        fixed,
        exiting,
      });
      card.style.transformOrigin = `${pctX}% ${pctY}%`;
      running.push(
        card.animate(
          [
            { transform: "translate(0px, 0px) scale(1)", filter: "blur(0px)" },
            {
              transform: `translate(${tx}px, ${ty}px) scale(${sc})`,
              filter: "blur(1.5px)",
            },
          ],
          { duration: dur, easing: EASE_OUT, fill: "forwards" },
        ),
        card.animate(
          [
            { opacity: 1, offset: 0 },
            { opacity: 0.72, offset: 0.45 },
            { opacity: 0, offset: 1 },
          ],
          { duration: dur, easing: "linear", fill: "forwards" },
        ),
      );
      const exitH = resolveExitHeightRange({
        fixed,
        fromHeight: rect.height,
        baseHeight: hasIdle ? idleHeightRef.current || 60 : 0,
      });
      if (exitH) {
        outer.style.overflow = "hidden";
        running.push(
          outer.animate([{ height: `${exitH.from}px` }, { height: `${exitH.to}px` }], {
            duration: dur,
            easing: EASE_OUT,
            fill: "forwards",
          }),
        );
      }
    }

    // Hold fill:"forwards" end state until React unmounts exit node; cleanup tears animations down cleanly
    void Promise.all(running.map((a) => a.finished.catch(() => {}))).finally(() => {
      if (!alive) return;
      finished = true;
      setExitState(null);
    });

    return () => {
      alive = false;
      if (!finished && !fixed && outer.isConnected) {
        resumeHeightRef.current = outer.getBoundingClientRect().height;
      }
      for (const a of running) a.cancel();
      outer.style.overflow = "";
      card.style.transformOrigin = "";
    };
  }, [exiting, shownCompose, dock, stage, hasIdle]);

  useEffect(() => {
    if (!shownCompose && !compose) onIdle?.();
  }, [shownCompose, compose, onIdle]);

  const [clickedFor, setClickedFor] = useState<unknown>(null),
    pin = shownCompose?.pin;
  const drawKeys =
    !PHONE && shownCompose?.kind === "create" && !!pin && clickedFor !== shownCompose;
  // A phone keyboard doesn't report which key it pressed: its Enter only shows up as a line break arriving. Listened to on the
  // element itself: React's onBeforeInput is its own event, built from keypress and textInput, and never says insertLineBreak
  useEffect(() => {
    const box = text.current;
    if (!open || !box || !PHONE) return;
    const enter = (e: InputEvent) => {
      if (e.inputType === "insertLineBreak") {
        e.preventDefault();
        saveNote();
      }
    };
    box.addEventListener("beforeinput", enter);
    return () => box.removeEventListener("beforeinput", enter);
  }, [open]);
  if (!shownCompose)
    return idleFooter ? (
      <div ref={idleRef} className="flex-none">
        {idleFooter}
      </div>
    ) : null;
  const isEdit = shownCompose.kind === "edit",
    editNote = isEdit ? notes.find((x) => x.id === shownCompose.id) : undefined,
    editAsk = editNote?.asks?.at(-1),
    coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches,
    shownRefs = exitState ? exitState.refs : refs,
    shownDraft = exitState ? exitState.draft : draft,
    shownDrawn = exitState ? exitState.drawn : drawn,
    shownRef = shownRefs.find((r) => r.id === openRef) ?? null;
  const st = noteShotTitle(shownCompose.shot, shownCompose.shotName);
  const shotText = st.secondary ? `${st.primary} · ${st.secondary}` : st.primary;
  const pinLabel = shownCompose.pin ? pinShortLabel(shownCompose.pin.what) : null;
  const compareVideoName =
    shownCompose.kind === "create" && shownCompose.compareVideo?.path
      ? shownCompose.compareVideo.path.split("/").pop()
      : null;
  const where = isEdit
    ? `Editing note · ${shownCompose.time} · ${shotText}`
    : `${stamp(shownCompose.t)} · ${shotText}${compareVideoName ? ` · ${compareVideoName}` : ""}${shownCompose.pin ? ` · ${shownCompose.pin.what}` : ""}`;
  const locationHeader = stage ? (
    <div
      onPointerDown={draggableHeader ? onDragHeaderPointerDown : undefined}
      onDoubleClick={
        draggableHeader
          ? (e) => {
              if (e.target instanceof Element && e.target.closest("button")) return;
              onHeaderDoubleClick?.();
            }
          : undefined
      }
      title={draggableHeader ? "Drag to move · Double-click to reset" : undefined}
      className={cn(
        "group/drag flex flex-none items-center justify-between gap-2",
        draggableHeader && "cursor-grab touch-none select-none active:cursor-grabbing",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="bg-backdrop/65 text-primary-text inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 font-mono text-xs leading-none font-medium tabular-nums">
          {stamp(shownCompose.t)}
        </span>
        <span className="text-ui min-w-0 flex-1 truncate leading-tight" title={shotText}>
          <span className="text-foreground/90 font-medium">{st.primary}</span>
          {st.secondary && <span className="text-muted-foreground"> · {st.secondary}</span>}
        </span>
        {compareVideoName && (
          <span
            title={shownCompose.kind === "create" ? shownCompose.compareVideo?.path : undefined}
            className="border-hairline bg-surface-subtle text-label inline-flex max-w-28 min-w-0 shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs leading-none font-medium"
          >
            <Columns2 aria-hidden className="size-3 shrink-0" />
            <span className="truncate">{compareVideoName}</span>
          </span>
        )}
        {shownCompose.pin && (
          <span
            title={shownCompose.pin.what}
            className="border-primary/25 bg-primary/10 text-primary-text inline-flex max-w-32 min-w-0 shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs leading-none font-medium"
          >
            <Crosshair aria-hidden className="size-3 shrink-0" />
            <span className="truncate">{pinLabel || shownCompose.pin.what}</span>
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {draggableHeader && (
          <GripHorizontal
            aria-hidden
            className="text-muted-foreground/50 group-hover/drag:text-muted-foreground size-3.5 transition-colors motion-reduce:transition-none"
          />
        )}
        <Button
          type="button"
          variant="quiet"
          size="icon-sm"
          aria-label="Close note"
          title="Discard note (Esc)"
          onClick={cancelNote}
        >
          <X aria-hidden />
        </Button>
      </div>
    </div>
  ) : (
    <div
      onPointerDown={draggableHeader ? onDragHeaderPointerDown : undefined}
      onDoubleClick={draggableHeader ? onHeaderDoubleClick : undefined}
      title={draggableHeader ? "Drag to move · Double-click to reset" : undefined}
      className={cn(
        "text-foreground/90 sideways:mb-1 text-ui flex flex-none items-center justify-between gap-2 leading-normal font-medium wrap-anywhere tabular-nums",
        dock ? (cramped ? "mb-1" : "mb-1.5 [@media(max-height:679px)]:mb-1") : "mb-2",
        draggableHeader && "cursor-grab touch-none select-none active:cursor-grabbing",
      )}
    >
      <span className="min-w-0 truncate">{where}</span>
      {draggableHeader && (
        <GripHorizontal aria-hidden className="text-muted-foreground/70 size-3.5 shrink-0" />
      )}
    </div>
  );
  return (
    <div
      ref={wrapRef}
      data-stage-compose={stage ? (exiting ? "exiting" : shownCompose.kind) : undefined}
      aria-hidden={exiting ? true : undefined}
      inert={exiting ? true : undefined}
      className={cn(
        "font-md flex min-h-0 flex-col",
        stage
          ? "w-full max-w-full flex-initial"
          : cramped && !inline && dock
            ? "absolute inset-x-0 bottom-0 z-20 max-h-full"
            : inline
              ? "relative z-20 flex-initial"
              : "flex-initial",
        exiting && "pointer-events-none select-none",
        className,
      )}
    >
      <div
        ref={cardRef}
        onKeyDown={(e) => {
          if (
            e.key !== "Escape" ||
            e.defaultPrevented ||
            !open ||
            shownRef ||
            !(e.target instanceof Node) ||
            !e.currentTarget.contains(e.target)
          ) {
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          cancelNote();
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          void addRefs(e.dataTransfer.files);
        }}
        className={cn(
          "@container flex min-h-0 flex-1 flex-col overflow-hidden",
          stage
            ? "bg-popover/96 border-hairline-strong shadow-sheet gap-2.5 rounded-2xl border p-3 backdrop-blur-md"
            : inline && dock
              ? "bg-card safe-bottom border-hairline-subtle border-t px-3 pt-2"
              : inline
                ? "bg-card border-hairline-subtle border-b px-3 py-2"
                : cn(
                    "bg-popover/95 sideways:px-3 sideways:py-2 border-hairline-strong border-t shadow-2xl backdrop-blur-md",
                    dock
                      ? cn("px-3", cramped ? "py-1.5" : "py-2.5 [@media(max-height:679px)]:py-1.5")
                      : "p-3",
                  ),
          exiting === "save" && "ring-primary/70 ring-1 ring-inset",
        )}
      >
        {!scrollLocation && locationHeader}
        {stage && <PinDrawToolbar hasPin={shownCompose.kind === "create" && !!shownCompose.pin} />}
        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto overscroll-contain",
            stage && "-m-0.5 p-0.5",
          )}
        >
          {scrollLocation && locationHeader}
          {shownDrawn &&
            (stage ? (
              <Badge variant="ink" className="mb-2">
                <PenLine aria-hidden />
                <span className="tabular-nums">{shownDrawn}</span>
              </Badge>
            ) : (
              <div className="text-ui text-ink-text mb-1.5 tabular-nums">{shownDrawn}</div>
            ))}
          {!shownDrawn &&
            !isEdit &&
            inOutAt(shownCompose.t) &&
            (stage ? (
              <Badge variant="inOut" className="mb-2">
                About {rangeText(inOutAt(shownCompose.t)!)}, In to Out
              </Badge>
            ) : (
              <div className="text-ui text-in-out-text mb-1.5 tabular-nums">
                About {rangeText(inOutAt(shownCompose.t)!)}, the In to Out stretch
              </div>
            ))}
          {isEdit && editAsk && (
            <div className="mb-1.5 max-w-[65ch]">
              <AskCallout ask={editAsk} compact={cramped} />
            </div>
          )}
          {isEdit && (
            <>
              <Alert
                variant="warn"
                role={undefined}
                className={cn(
                  "max-w-[65ch]",
                  dock ? (cramped ? "hidden" : "mb-1.5 [@media(max-height:679px)]:hidden") : "mb-2",
                )}
              >
                <TriangleAlert aria-hidden />
                <AlertDescription size="ui">Saving replaces the note’s old text.</AlertDescription>
              </Alert>
              {dock && (
                <p
                  role="note"
                  className={cn(
                    "text-warn-text text-ui mb-1 max-w-[65ch] items-center gap-1 leading-normal text-pretty",
                    cramped ? "flex" : "hidden [@media(max-height:679px)]:flex",
                  )}
                >
                  <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
                  <span>Saving replaces the note’s old text.</span>
                </p>
              )}
            </>
          )}
          <textarea
            data-slot="textarea"
            disabled={noteSaving}
            ref={text}
            name="note"
            aria-label="Note"
            aria-describedby={hintId}
            placeholder={
              drawKeys
                ? "Type… or press 1–4 to draw"
                : isEdit || PHONE || coarse
                  ? "Type…"
                  : `Type… or paste a picture (${modKeyLabel()}V)`
            }
            enterKeyHint="done"
            autoComplete="off"
            value={shownDraft}
            readOnly={!!exiting}
            onFocus={(e) => {
              if (scrollLocation)
                e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
            }}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={(e) => {
              const files = [...e.clipboardData.files];
              if (!files.some((f) => f.type.startsWith("image/"))) return;
              e.preventDefault();
              void addRefs(files);
            }}
            onPointerDown={() => setClickedFor(shownCompose)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (
                drawKeys &&
                !shownDraft &&
                /^[1-4]$/.test(e.key) &&
                !e.ctrlKey &&
                !e.metaKey &&
                !e.altKey &&
                toolsOpen(get())
              ) {
                e.preventDefault();
                setInk(INK_KEYS[+e.key - 1]);
                return;
              }
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                saveNote();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelNote();
              }
            }}
            className={
              stage
                ? "border-hairline-strong bg-backdrop/75 text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:ring-primary/15 flex field-sizing-content max-h-[24vh] min-h-18 w-full max-w-[65ch] resize-none [scrollbar-width:thin] overscroll-contain rounded-lg border px-3 py-2 text-sm/relaxed transition-colors outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none pointer-coarse:text-base"
                : cn(
                    textareaVariants({ variant: "note" }),
                    "sideways:h-16 max-w-[65ch] resize-y",
                    dock
                      ? cramped
                        ? "h-12 max-h-[28vh] min-h-10"
                        : "upright:h-19 h-12 max-h-[28vh] min-h-10 [@media(min-height:700px)]:h-19 [@media(min-height:700px)]:min-h-16"
                      : "upright:h-19 h-28",
                  )
            }
          />
          {!isEdit && (
            <>
              {shownRefs.length > 0 && (
                <div className="sideways:mt-1.5 mt-2 flex [scrollbar-width:thin] gap-1.5 overflow-x-auto overscroll-x-contain">
                  {shownRefs.map((r, i) => (
                    <div
                      key={r.id}
                      className="border-border/80 bg-backdrop/70 flex flex-none items-stretch overflow-hidden rounded-md border"
                    >
                      <button
                        type="button"
                        onClick={() => setOpenRef(r.id)}
                        aria-label={`Open picture ${i + 1} to see it big or draw on it`}
                        className="focus-visible:ring-ring hover:bg-surface-subtle block cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset"
                      >
                        <img
                          src={r.url}
                          alt=""
                          decoding="async"
                          className="note-image-outline block h-12 w-auto max-w-32 object-cover"
                        />
                      </button>
                      <Button
                        variant="remove-chip"
                        size="icon-sm"
                        aria-label={`Remove picture ${i + 1}`}
                        className="h-auto w-6 self-stretch pointer-coarse:w-10"
                        onClick={() => removeRef(r.id)}
                      >
                        <X aria-hidden />
                      </Button>
                    </div>
                  ))}
                  {shownRefs.length < REFS_MAX && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-12 flex-none"
                      onClick={() => picker.current?.click()}
                    >
                      <ImagePlus data-icon="inline-start" aria-hidden />
                      Add
                    </Button>
                  )}
                </div>
              )}
              <input
                ref={picker}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  void addRefs(e.target.files ?? []);
                  e.target.value = "";
                }}
              />
            </>
          )}
          {shownRef && (
            <Suspense fallback={null}>
              <RefSketch
                r={shownRef}
                n={shownRefs.indexOf(shownRef) + 1}
                of={shownRefs.length}
                onClose={() => setOpenRef(null)}
              />
            </Suspense>
          )}
        </div>
        <div
          className={cn(
            "sideways:mt-1.5 flex max-w-[65ch] flex-none items-center",
            stage
              ? "flex-wrap justify-between gap-2"
              : cn("gap-1.5", dock && !inline && "flex-wrap", dock ? "mt-1.5" : "mt-2"),
          )}
        >
          {stage ? (
            <>
              <div className="flex items-center gap-1.5">
                {!isEdit && shownRefs.length === 0 && (
                  <Button
                    variant="subtle"
                    size="md"
                    aria-label="Add a picture"
                    title={`Attach picture (${modKeyLabel()}V or drop)`}
                    onClick={() => picker.current?.click()}
                  >
                    <ImagePlus data-icon="inline-start" aria-hidden />
                    <span className="hidden @xs:inline">Picture</span>
                  </Button>
                )}
              </div>
              <div className="ms-auto flex items-center gap-1.5">
                <Button variant="ghost" size="md" onClick={cancelNote}>
                  Cancel
                </Button>
                <Button
                  size="md"
                  className="min-w-24"
                  disabled={
                    noteSaving ||
                    !isComposeDirty(
                      shownCompose,
                      shownDraft,
                      Boolean(shownDrawn) || shownRefs.length > 0,
                    )
                  }
                  onClick={saveNote}
                >
                  {noteSaving ? "Saving…" : isEdit ? "Save" : "Add note"}
                </Button>
              </div>
            </>
          ) : (
            <>
              <Button
                size={PHONE ? "phone-cta" : "md"}
                className="upright:flex-1 sm:min-w-24"
                disabled={
                  noteSaving ||
                  !isComposeDirty(
                    shownCompose,
                    shownDraft,
                    Boolean(shownDrawn) || shownRefs.length > 0,
                  )
                }
                onClick={saveNote}
              >
                {noteSaving ? "Saving…" : isEdit ? "Save" : "Add note"}
              </Button>
              {!isEdit && shownRefs.length === 0 && (
                <Button
                  variant="subtle"
                  size={PHONE ? "phone-cta" : "md"}
                  aria-label="Add a picture"
                  onClick={() => picker.current?.click()}
                >
                  <ImagePlus data-icon="inline-start" aria-hidden />
                  <span className="hidden @xs:inline">Picture</span>
                </Button>
              )}
              <Button variant="quiet" size={PHONE ? "phone-cta" : "md"} onClick={cancelNote}>
                Cancel
              </Button>
            </>
          )}
        </div>
        <small
          id={hintId}
          className={cn(
            "text-muted-foreground flex max-w-[65ch] flex-none items-baseline justify-between gap-2 text-xs leading-normal pointer-coarse:hidden [@media(max-height:720px)]:hidden",
            stage ? "" : dock ? (cramped ? "hidden" : "mt-1.5") : "mt-2",
          )}
        >
          {stage ? (
            <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <span className="inline-flex items-center gap-1">
                <Kbd>Enter</Kbd>
                <span>{isEdit ? "save" : "add"}</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>Shift+Enter</Kbd>
                <span>new line</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>Esc</Kbd>
                <span>cancel</span>
              </span>
            </span>
          ) : dock ? (
            <>
              <span className="min-w-0">
                {isEdit ? "Enter saves" : "Enter adds"} · Shift+Enter new line · Esc cancels
              </span>
            </>
          ) : isEdit ? (
            "Enter saves · Shift+Enter new line · Esc cancels."
          ) : (
            "Enter adds · Shift+Enter new line · Esc cancels · paste or drop a picture to show what you mean."
          )}
        </small>
      </div>
    </div>
  );
}

export function StageNoteComposer() {
  const rawCompose = useStudio((s) => s.compose);
  const inkDrawing = useStudio((s) => s.inkDrawing);
  const active = isStageAnchoredCompose(rawCompose, PHONE);
  const [renderChild, setRenderChild] = useState(active);
  if (active && !renderChild) setRenderChild(true);

  const hostRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<StageAnchor>({ x: 0.5, y: 0.85 });
  const [originKey, setOriginKey] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ dx: 0, dy: 0 });
  const [dims, setDims] = useState({
    viewSize: { width: 800, height: 500 },
    stageRect: { left: 0, top: 0, width: 800, height: 500 },
    cardSize: { width: 416, height: 220 },
  });

  const liveAnchor =
    active && rawCompose?.kind === "create"
      ? (rawCompose.anchor ??
        (rawCompose.pin ? { x: rawCompose.pin.x, y: rawCompose.pin.y } : { x: 0.5, y: 0.85 }))
      : null;

  if (
    liveAnchor &&
    Number.isFinite(liveAnchor.x) &&
    Number.isFinite(liveAnchor.y) &&
    (liveAnchor.x !== anchor.x || liveAnchor.y !== anchor.y)
  ) {
    setAnchor(liveAnchor);
  }

  const liveOriginKey =
    active && rawCompose?.kind === "create"
      ? `${Math.round(rawCompose.t * 100)}:${rawCompose.pin?.what ?? ""}:${Math.round((rawCompose.pin?.x ?? -1) * 1000)}:${Math.round((rawCompose.pin?.y ?? -1) * 1000)}`
      : null;

  if (liveOriginKey !== originKey) {
    setOriginKey(liveOriginKey);
    if (liveOriginKey !== null && (dragOffset.dx !== 0 || dragOffset.dy !== 0)) {
      setDragOffset({ dx: 0, dy: 0 });
    }
  }

  useLayoutEffect(() => {
    const host = hostRef.current;
    const viewEl = host?.parentElement;
    const stageEl = viewEl?.firstElementChild as HTMLElement | null;
    if (!viewEl) return;

    const sync = () => {
      const vr = viewEl.getBoundingClientRect();
      const sr = stageEl?.getBoundingClientRect();
      const box = boxRef.current;
      const viewSize = {
        width: Math.round(vr.width || host.clientWidth || 800),
        height: Math.round(vr.height || host.clientHeight || 500),
      };
      const stageRect =
        sr && sr.width > 0
          ? {
              left: Math.round(sr.left - vr.left),
              top: Math.round(sr.top - vr.top),
              width: Math.round(sr.width),
              height: Math.round(sr.height),
            }
          : { left: 0, top: 0, width: viewSize.width, height: viewSize.height };
      const cardSize = {
        width: box?.offsetWidth || 416,
        height: box?.offsetHeight || 220,
      };
      setDims((prev) => {
        if (
          prev.viewSize.width === viewSize.width &&
          prev.viewSize.height === viewSize.height &&
          prev.stageRect.left === stageRect.left &&
          prev.stageRect.top === stageRect.top &&
          prev.stageRect.width === stageRect.width &&
          prev.stageRect.height === stageRect.height &&
          prev.cardSize.width === cardSize.width &&
          prev.cardSize.height === cardSize.height
        ) {
          return prev;
        }
        return { viewSize, stageRect, cardSize };
      });
    };

    sync();
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(sync);
    ro.observe(viewEl);
    if (stageEl) ro.observe(stageEl);
    if (boxRef.current) ro.observe(boxRef.current);
    return () => ro.disconnect();
  }, [renderChild, originKey]);

  const placement = renderChild
    ? computeStageComposerPos({
        anchor: liveAnchor ?? anchor,
        stageRect: dims.stageRect,
        viewSize: dims.viewSize,
        cardSize: dims.cardSize,
        offset: dragOffset,
      })
    : null;

  const dragCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanupRef.current?.(), []);

  const onDragHeaderPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      if (e.target instanceof Element && e.target.closest("button, input, textarea")) return;
      e.preventDefault();
      e.stopPropagation();
      dragCleanupRef.current?.();
      const startX = e.clientX;
      const startY = e.clientY;
      const startDx = dragOffset.dx;
      const startDy = dragOffset.dy;
      const onMove = (ev: PointerEvent) => {
        setDragOffset({
          dx: Math.round(startDx + ev.clientX - startX),
          dy: Math.round(startDy + ev.clientY - startY),
        });
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        dragCleanupRef.current = null;
      };
      dragCleanupRef.current = onUp;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [dragOffset.dx, dragOffset.dy],
  );

  const onHeaderDoubleClick = useCallback(() => {
    setDragOffset({ dx: 0, dy: 0 });
  }, []);

  const onIdle = useCallback(() => {
    setRenderChild(false);
  }, []);

  return (
    <div ref={hostRef} className="pointer-events-none absolute inset-0 z-8 overflow-hidden">
      {renderChild && placement && (
        <div
          ref={boxRef}
          style={{ "--sx": `${placement.left}px`, "--sy": `${placement.top}px` } as CSSProperties}
          className={cn(
            "absolute top-(--sy) left-(--sx) flex max-h-[calc(100%-1rem)] w-[min(26rem,calc(100%-1rem))] flex-col transition-opacity duration-150",
            inkDrawing ? "pointer-events-none opacity-25" : "pointer-events-auto opacity-100",
          )}
        >
          <Compose
            stage
            draggableHeader
            onDragHeaderPointerDown={onDragHeaderPointerDown}
            onHeaderDoubleClick={onHeaderDoubleClick}
            onIdle={onIdle}
          />
        </div>
      )}
    </div>
  );
}
