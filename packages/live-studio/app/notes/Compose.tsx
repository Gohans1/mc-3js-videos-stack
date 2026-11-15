// The note being written. Every keystroke is kept on the device (notes/notes.ts setDraft), so a reload never loses it.
// On an upright phone it sits right under the picture, so the keyboard can't cover it and a tap still lands on the picture;
// in PhoneApp (inline) it is the top of the notes column, which the keyboard shrinks (device.ts resizes-content) instead of covering
import { ImagePlus, TriangleAlert, X } from "lucide-react";
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
  isDockedSheetCramped,
  resolveExitHeightRange,
  resolveHeightRange,
  shouldAnimateEnter,
} from "./compose-motion";
import { INK_KEYS, setInk, toolsOpen } from "./ink";
import { modKeyLabel, noteShotTitle } from "./note-card-meta";
import { cancelNote, saveNote, setDraft } from "./notes";
import { addRefs, REFS_MAX, removeRef } from "./refs";
import { RefSketch } from "./RefSketch";
import { type Compose as ComposeSpec, isComposeDirty } from "./slice";

interface ExitState extends ComposeExitSnapshot {
  compose: ComposeSpec;
  reason: ComposeExitReason;
}

export function Compose({
  inline = false,
  dock = false,
  idleFooter = null,
  onCrampedOverlayChange,
}: {
  inline?: boolean;
  dock?: boolean;
  idleFooter?: ReactNode;
  onCrampedOverlayChange?: (active: boolean) => void;
}) {
  const compose = useStudio((s) => s.compose),
    draft = useStudio((s) => s.draft),
    drawn = useStudio((s) => s.inkSaid),
    refs = useStudio((s) => s.refs);
  const [openCompose, setOpenCompose] = useState<ComposeSpec | null>(compose);
  const [exitState, setExitState] = useState<ExitState | null>(null);
  if (compose) {
    if (openCompose !== compose) setOpenCompose(compose);
    if (exitState) setExitState(null);
  } else if (openCompose) {
    const snap = composeExitSnapshot(openCompose) ?? { draft: "", drawn: "", refs: [] };
    setExitState({
      compose: openCompose,
      reason: composeExitReason(openCompose),
      ...snap,
    });
    setOpenCompose(null);
  }

  const [openRef, setOpenRef] = useState<string | null>(null),
    picker = useRef<HTMLInputElement>(null);
  useStudio((s) => s.inOut); // inOutAt below reads it
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
  // Every visible mounted Compose registers directly so focus works synchronously for mobile keyboards and cleans up non-LIFO unmounts
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
  const hasIdle = Boolean(idleFooter);
  const open = !!compose && !exiting;
  const composeKey =
    !shownCompose || exiting
      ? null
      : shownCompose.kind === "edit"
        ? `edit:${shownCompose.id}`
        : `create:${Math.round(shownCompose.t * 100)}`;

  useLayoutEffect(() => {
    if (!shownCompose && idleRef.current) {
      idleHeightRef.current = idleRef.current.getBoundingClientRect().height;
    }
  }, [shownCompose, idleFooter]);

  // Float docked desktop compose over short panels instead of crushing the editor inside tight NoteList headers
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

  // Consume only an explicit ui.focusNote() request that ran before Compose mounted; focus=false opens stay unfocused
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

  // Origin-aware entrance: when triggered by a pointer click (card, Note button, pin or stroke), emerge from that trigger's
  // direction while smoothly opening vertical space from 0 (or interrupted height); keyboard shortcuts (M) stay instant
  useLayoutEffect(() => {
    const outer = wrapRef.current,
      card = cardRef.current,
      current = get().compose;
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
    if (typeof card.animate !== "function") return;
    const origin = composeOrigin(current);
    const mode = shouldAnimateEnter({
      origin,
      reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
    if (!mode) return;
    const rect = card.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const fixed = getComputedStyle(card).position === "fixed";
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
  }, [composeKey, dock, inline, hasIdle, cramped]);

  // Asymmetric exit (/emil-design-eng: faster than enter, interruptible, masks swap cleanly & collapses height so list glides up)
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
    const fixed = getComputedStyle(card).position === "fixed";
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
  }, [exiting, shownCompose, dock, hasIdle]);

  // A pin just placed gives the box the keys and shows the drawing tools: until a word is typed or the box is clicked, 1 to 4
  // pick a tool here as they do anywhere else. Click the box first to start a note with a digit
  const [clickedFor, setClickedFor] = useState<unknown>(null),
    pin = shownCompose?.pin;
  const drawKeys =
    !PHONE && shownCompose?.kind === "create" && !!pin && clickedFor !== shownCompose; // a phone has no drawing tools
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
    coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches,
    shownRefs = exitState ? exitState.refs : refs,
    shownDraft = exitState ? exitState.draft : draft,
    shownDrawn = exitState ? exitState.drawn : drawn,
    shownRef = shownRefs.find((r) => r.id === openRef) ?? null;
  const st = noteShotTitle(shownCompose.shot, shownCompose.shotName);
  const shotText = st.secondary ? `${st.primary} · ${st.secondary}` : st.primary;
  const where = isEdit
    ? `Editing note · ${shownCompose.time} · ${shotText}`
    : `${stamp(shownCompose.t)} · ${shotText}${shownCompose.pin ? ` · ${shownCompose.pin.what}` : ""}`;
  return (
    <div
      ref={wrapRef}
      aria-hidden={exiting ? true : undefined}
      inert={exiting ? true : undefined}
      className={cn(
        "font-md flex min-h-0 flex-col",
        !inline && "upright:contents",
        cramped && !inline && dock
          ? "upright:static absolute inset-x-0 bottom-0 z-20 max-h-full"
          : inline
            ? "relative z-20 flex-initial"
            : "flex-initial",
        exiting && "pointer-events-none select-none",
      )}
    >
      <div
        ref={cardRef}
        // a file dropped anywhere on the box is taken here, never opened by the browser in place of the studio
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
          inline && dock
            ? "bg-card safe-bottom border-hairline-subtle border-t px-3 pt-2"
            : inline
              ? "bg-card border-hairline-subtle border-b px-3 py-2"
              : dock
                ? cn(
                    "bg-popover/95 upright:fixed upright:inset-x-0 upright:top-[min(56.25vw,62vh)] upright:max-h-[calc(100dvh-min(56.25vw,62vh))] upright:z-5 upright:shadow-sheet sideways:px-3 sideways:py-2 border-hairline-strong border-t px-3 shadow-2xl backdrop-blur-md",
                    cramped ? "py-1.5" : "py-2.5 [@media(max-height:679px)]:py-1.5",
                  )
                : "bg-popover/95 upright:fixed upright:inset-x-0 upright:top-[min(56.25vw,62vh)] upright:max-h-[calc(100dvh-min(56.25vw,62vh))] upright:z-5 upright:shadow-sheet sideways:px-3 sideways:py-2 border-hairline-strong border-t p-3 shadow-2xl backdrop-blur-md",
          exiting === "save" && "ring-primary/70 ring-1 ring-inset",
        )}
      >
        <div
          className={cn(
            "text-foreground/90 sideways:mb-1 text-ui flex-none leading-snug font-medium wrap-anywhere tabular-nums",
            dock ? (cramped ? "mb-1" : "mb-1.5 [@media(max-height:679px)]:mb-1") : "mb-2",
          )}
        >
          {where}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {shownDrawn && (
            <div className="text-ui text-ink-text mb-1.5 tabular-nums">{shownDrawn}</div>
          )}
          {!shownDrawn && !isEdit && inOutAt(shownCompose.t) && (
            <div className="text-ui text-in-out-text mb-1.5 tabular-nums">
              About {rangeText(inOutAt(shownCompose.t)!)}, the In to Out stretch
            </div>
          )}
          {isEdit && (
            <>
              <Alert
                variant="warn"
                role={undefined}
                className={
                  dock ? (cramped ? "hidden" : "mb-1.5 [@media(max-height:679px)]:hidden") : "mb-2"
                }
              >
                <TriangleAlert aria-hidden />
                <AlertDescription size="ui">Saving replaces the note's old text.</AlertDescription>
              </Alert>
              {dock && (
                <p
                  role="note"
                  className={cn(
                    "text-warn-text text-ui mb-1 items-center gap-1 leading-snug text-pretty",
                    cramped ? "flex" : "hidden [@media(max-height:679px)]:flex",
                  )}
                >
                  <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
                  <span>Saving replaces the note's old text.</span>
                </p>
              )}
            </>
          )}
          <Textarea
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
            variant="note"
            className={cn(
              "upright:h-19 sideways:h-16 resize-y",
              dock
                ? cramped
                  ? "h-12 max-h-[28vh] min-h-10"
                  : "h-12 max-h-[28vh] min-h-10 [@media(min-height:700px)]:h-19 [@media(min-height:700px)]:min-h-16"
                : "h-28",
            )}
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
                          className="block h-12 w-auto max-w-32 object-cover"
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
          <RefSketch
            r={shownRef}
            n={shownRefs.indexOf(shownRef!) + 1}
            of={shownRefs.length}
            onClose={() => setOpenRef(null)}
          />
        </div>
        <div
          className={cn(
            "sideways:mt-1.5 flex flex-none items-center gap-1.5",
            dock ? "mt-1.5" : "mt-2",
          )}
        >
          <Button
            size={PHONE ? "xl" : "md"}
            className="flex-1"
            disabled={
              !isComposeDirty(shownCompose, shownDraft, Boolean(shownDrawn) || shownRefs.length > 0)
            }
            onClick={saveNote}
          >
            {isEdit ? "Save" : "Add note"}
          </Button>
          {!isEdit && shownRefs.length === 0 && (
            <Button
              variant="subtle"
              size={PHONE ? "xl" : "md"}
              aria-label="Add a picture"
              onClick={() => picker.current?.click()}
            >
              <ImagePlus data-icon="inline-start" aria-hidden />
              <span className="hidden @xs:inline">Picture</span>
            </Button>
          )}
          <Button variant="quiet" size={PHONE ? "xl" : "md"} onClick={cancelNote}>
            Cancel
          </Button>
        </div>
        <small
          id={hintId}
          className={cn(
            "text-label/85 flex flex-none items-baseline justify-between gap-2 text-xs pointer-coarse:hidden [@media(max-height:720px)]:hidden",
            dock ? (cramped ? "hidden" : "mt-1.5") : "mt-2",
          )}
        >
          {dock ? (
            <>
              <span className="min-w-0">
                {isEdit ? "Enter saves" : "Enter adds"} · Shift+Enter new line · Esc cancels
              </span>
              {Boolean(shownDraft.trim() || shownDrawn || shownRefs.length > 0) && (
                <span className="text-ok-text shrink-0 font-medium">Draft saved</span>
              )}
            </>
          ) : isEdit ? (
            "Enter saves · Shift+Enter new line · Esc cancels. Your draft survives a reload."
          ) : (
            "Enter adds · Shift+Enter new line · Esc cancels · paste or drop a picture to show what you mean. Your draft survives a reload."
          )}
        </small>
      </div>
    </div>
  );
}
