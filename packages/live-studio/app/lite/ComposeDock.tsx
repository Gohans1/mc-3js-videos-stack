import {
  ArrowUpRight,
  ImagePlus,
  Pencil,
  Route,
  Square,
  TriangleAlert,
  Undo2,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { textareaVariants } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { stamp } from "../core/time.ts";
import { REFS_MAX } from "./capture.ts";
import { formatShortDate, isComposeDirty, noteShotTitle } from "./model.ts";
import { playback } from "./playback.ts";
import {
  lite,
  liteComposeOf,
  liteDraftOf,
  liteInkMarksOf,
  liteInkSaidOf,
  liteInkToolOf,
  liteNoteSavingOf,
  liteRefsOf,
  liteVideoPathOf,
  useLite,
} from "./store.ts";
import type { InkKind } from "./types.ts";

const DRAW_BTNS: [InkKind, string, ReactNode][] = [
  ["pen", "Pen", <Pencil key="p" aria-hidden className="size-3" />],
  ["arrow", "Arrow", <ArrowUpRight key="a" aria-hidden className="size-3" />],
  ["box", "Box", <Square key="b" aria-hidden className="size-3" />],
  ["path", "Path", <Route key="r" aria-hidden className="size-3" />],
];

export function ComposeDock() {
  const compose = useLite(liteComposeOf);
  const draft = useLite(liteDraftOf);
  const noteSaving = useLite(liteNoteSavingOf);
  const refs = useLite(liteRefsOf);
  const notes = useLite((s) => s.notes);
  const inkTool = useLite(liteInkToolOf);
  const inkMarks = useLite(liteInkMarksOf);
  const inkSaid = useLite(liteInkSaidOf);
  const activeVideoPath = useLite(liteVideoPathOf);

  const textRef = useRef<HTMLTextAreaElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const allowLineBreakRef = useRef(false);
  const [draggingFiles, setDraggingFiles] = useState(false);

  const open = compose !== null;
  const isEdit = compose?.kind === "edit";

  const handleSave = () => {
    void lite.saveCompose({ videoEl: playback.element }).then((resume) => {
      if (resume) playback.play();
    });
  };

  const handleCancel = () => {
    const resume = lite.cancelCompose();
    if (resume) playback.play();
  };

  useEffect(() => {
    if (!open) return;
    const box = textRef.current;
    if (!box) return;
    const onBeforeInput = (e: InputEvent) => {
      if (e.inputType === "insertLineBreak") {
        if (allowLineBreakRef.current) {
          allowLineBreakRef.current = false;
          return;
        }
        e.preventDefault();
        handleSave();
      }
    };
    box.addEventListener("beforeinput", onBeforeInput);
    return () => box.removeEventListener("beforeinput", onBeforeInput);
  }, [open]);

  const composeKey = !compose
    ? null
    : compose.kind === "edit"
      ? `edit:${compose.id}`
      : `create:${Math.round(compose.t * 100)}:${compose.pin?.x ?? -1}:${compose.pin?.y ?? -1}`;

  const shouldAutoFocus =
    compose !== null &&
    !(compose.kind === "create" && (compose.autoFocus === false || inkTool !== null));

  useEffect(() => {
    if (!composeKey || !shouldAutoFocus) return;
    const raf = requestAnimationFrame(() => {
      textRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [composeKey, shouldAutoFocus]);

  if (!compose) {
    return (
      <div className="safe-bottom-compact flex-none px-2.5 pt-1">
        <Button
          type="button"
          size="phone-cta"
          className="w-full"
          disabled={!activeVideoPath}
          onClick={() => {
            const wasPlaying = playback.isPlaying;
            if (wasPlaying) playback.pause();
            lite.openCreateNote(null, playback.t, wasPlaying);
          }}
        >
          <Pencil data-icon="inline-start" aria-hidden />
          Note
        </Button>
      </div>
    );
  }

  const editNote = isEdit ? notes.find((n) => n.id === compose.id) : undefined;
  const editAsk = editNote?.asks?.at(-1);
  const st = noteShotTitle(compose.shot, compose.shotName);
  const shotText = st.secondary ? `${st.primary} · ${st.secondary}` : st.primary;
  const compareVideoName =
    compose.kind === "create" && compose.compareVideo?.path
      ? compose.compareVideo.path.split("/").pop()
      : null;
  const where = isEdit
    ? `Editing note · ${compose.time} · ${shotText}`
    : `${stamp(compose.t)} · ${shotText}${compareVideoName ? ` · ${compareVideoName}` : ""}${
        compose.pin ? ` · ${compose.pin.what}` : ""
      }`;

  const canSave =
    !noteSaving && isComposeDirty(compose, draft, inkMarks.length > 0 || refs.length > 0);

  return (
    <div
      data-lite-compose={compose.kind}
      className="font-md relative z-20 flex min-h-0 max-h-full flex-initial flex-col"
    >
      <div
        onKeyDown={(e) => {
          if (e.key !== "Escape" || e.defaultPrevented) return;
          e.preventDefault();
          e.stopPropagation();
          handleCancel();
        }}
        onDragOver={(e) => {
          if (isEdit || noteSaving) return;
          if (e.dataTransfer?.types?.includes("Files")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            if (!draggingFiles) setDraggingFiles(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setDraggingFiles(false);
          }
        }}
        onDrop={(e) => {
          setDraggingFiles(false);
          if (isEdit || noteSaving) return;
          const files = [...(e.dataTransfer?.files ?? [])].filter((f) =>
            f.type.startsWith("image/"),
          );
          if (files.length) {
            e.preventDefault();
            void lite.addRefs(files);
          }
        }}
        className={cn(
          "bg-card safe-bottom border-hairline-subtle flex min-h-0 flex-1 flex-col overflow-hidden border-t px-3 pt-2",
          draggingFiles && "ring-primary/65 ring-1 ring-inset",
        )}
      >
        <div className="text-foreground/90 text-ui mb-1.5 flex flex-none items-center justify-between gap-2 leading-normal font-medium tabular-nums">
          <span className="min-w-0 truncate">{where}</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {!isEdit && (
            <div className="mb-1.5 flex flex-wrap items-center gap-1">
              {DRAW_BTNS.map(([id, label, icon]) => (
                <Button
                  key={id}
                  type="button"
                  variant={inkTool === id ? "lit" : "subtle"}
                  size="phone-xs"
                  aria-pressed={inkTool === id}
                  disabled={noteSaving}
                  onClick={() => lite.setInkTool(inkTool === id ? null : id)}
                >
                  {icon}
                  {label}
                </Button>
              ))}
              {inkMarks.length > 0 && (
                <>
                  <Button
                    type="button"
                    variant="subtle"
                    size="phone-icon"
                    aria-label="Undo last stroke"
                    disabled={noteSaving}
                    onClick={() => lite.undoInk()}
                  >
                    <Undo2 aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="subtle"
                    size="phone-xs"
                    disabled={noteSaving}
                    onClick={() => lite.clearInk()}
                  >
                    Clear
                  </Button>
                </>
              )}
            </div>
          )}

          {inkSaid && <div className="text-ui text-ink-text mb-1 tabular-nums">{inkSaid}</div>}

          {isEdit && editAsk && (
            <p className="text-ui mb-1.5 leading-normal wrap-anywhere">
              <span className="text-primary-text font-medium">Needs work: </span>
              <span className="text-foreground/90">{editAsk.text || "(no words)"}</span>
              {editAsk.at && (
                <span className="text-muted-foreground ms-1 font-mono text-xs tabular-nums">
                  {formatShortDate(editAsk.at)}
                </span>
              )}
            </p>
          )}

          {isEdit && (
            <p role="note" className="text-warn-text text-ui mb-1.5 flex items-center gap-1 leading-normal">
              <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
              <span>Saving replaces the note’s old text.</span>
            </p>
          )}

          <textarea
            ref={textRef}
            data-slot="textarea"
            name="note"
            aria-label="Note"
            disabled={noteSaving}
            placeholder="Type…"
            enterKeyHint="done"
            autoComplete="off"
            value={draft}
            onChange={(e) => lite.setDraft(e.target.value)}
            onPaste={(e) => {
              if (isEdit || noteSaving) return;
              const files = [...(e.clipboardData?.files ?? [])].filter((f) =>
                f.type.startsWith("image/"),
              );
              if (files.length) {
                e.preventDefault();
                void lite.addRefs(files);
              }
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key !== "Shift") allowLineBreakRef.current = false;
              if (e.key === "Enter" && e.shiftKey) {
                allowLineBreakRef.current = true;
                return;
              }
              if (
                e.key === "Enter" &&
                (e.ctrlKey || e.metaKey || (!e.shiftKey && !e.nativeEvent.isComposing))
              ) {
                e.preventDefault();
                handleSave();
              } else if (e.key === "Escape") {
                e.preventDefault();
                handleCancel();
              }
            }}
            className={cn(
              textareaVariants({ variant: "note" }),
              "h-14 max-h-[26vh] min-h-10 max-w-[65ch] resize-y [@media(max-height:520px)]:h-10",
            )}
          />

          {!isEdit && (
            <>
              {refs.length > 0 && (
                <div className="mt-1.5 flex gap-1.5 overflow-x-auto overscroll-x-contain">
                  {refs.map((r, i) => (
                    <div
                      key={r.id}
                      className="border-border/80 bg-backdrop/70 flex flex-none items-stretch overflow-hidden rounded-md border"
                    >
                      <img
                        src={r.url}
                        alt={`Attachment ${i + 1}`}
                        decoding="async"
                        className="note-image-outline block h-11 w-auto max-w-28 object-cover"
                      />
                      <Button
                        type="button"
                        variant="remove-chip"
                        size="icon-sm"
                        aria-label={`Remove picture ${i + 1}`}
                        disabled={noteSaving}
                        className="h-auto w-7 self-stretch"
                        onClick={() => lite.removeRef(r.id)}
                      >
                        <X aria-hidden />
                      </Button>
                    </div>
                  ))}
                  {refs.length < REFS_MAX && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={noteSaving}
                      className="h-11 flex-none"
                      onClick={() => pickerRef.current?.click()}
                    >
                      <ImagePlus data-icon="inline-start" aria-hidden />
                      Add
                    </Button>
                  )}
                </div>
              )}
              <input
                ref={pickerRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  void lite.addRefs(e.target.files ?? []);
                  e.target.value = "";
                }}
              />
            </>
          )}
        </div>

        <div className="mt-1.5 flex max-w-[65ch] flex-none items-center gap-1.5">
          <Button
            type="button"
            size="phone-cta"
            className="flex-1"
            disabled={!canSave}
            onClick={handleSave}
          >
            {noteSaving ? "Saving…" : isEdit ? "Save" : "Add note"}
          </Button>
          {!isEdit && refs.length === 0 && (
            <Button
              type="button"
              variant="subtle"
              size="phone-cta"
              aria-label="Add a picture"
              disabled={noteSaving}
              onClick={() => pickerRef.current?.click()}
            >
              <ImagePlus data-icon="inline-start" aria-hidden />
              <span className="hidden min-[360px]:inline">Picture</span>
            </Button>
          )}
          <Button
            type="button"
            variant="quiet"
            size="phone-cta"
            disabled={noteSaving}
            onClick={handleCancel}
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
