import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { showUndo, toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import { deleteLesson, type LessonScope, parseLessonKey } from "./lessons";

export const SCOPE_LABEL: Record<LessonScope, string> = { film: "This film", all: "Every film" };
export const SCOPE_SHORT: Record<LessonScope, string> = { film: "Film", all: "Global" };

// md-phone's heading colours, one per level (index.css --color-md-h*)
export const HEAD = [
  "",
  "text-md-h1",
  "text-md-h2",
  "text-md-h3",
  "text-md-h4",
  "text-md-h5",
  "text-md-h6",
];

export const TEXT = "font-md text-base/[1.6] whitespace-pre-wrap wrap-anywhere [tab-size:4] p-3";

/** Wires outside-pointer, outside-focus, Escape, and idle timeout dismissal while keeping mouse blur (dropClickFocus) safe. */
export function attachArmedDeleteDismiss(
  wrap: Pick<HTMLElement, "contains"> | null,
  disarm: () => void,
  doc: Pick<Document, "addEventListener" | "removeEventListener"> = document,
  timeoutMs = 3500,
): () => void {
  const t = setTimeout(disarm, timeoutMs);
  const outside = (target: EventTarget | null) =>
    !wrap || !target || !wrap.contains(target as Node);
  const onPointerDown = (e: Event) => {
    if (outside(e.target)) disarm();
  };
  const onFocusIn = (e: Event) => {
    if (outside(e.target)) disarm();
  };
  const onKeyDown = (e: Event) => {
    const ke = e as KeyboardEvent;
    if (ke.key !== "Escape") return;
    ke.preventDefault();
    ke.stopPropagation();
    disarm();
  };
  doc.addEventListener("pointerdown", onPointerDown, true);
  doc.addEventListener("focusin", onFocusIn);
  doc.addEventListener("keydown", onKeyDown, true);
  return () => {
    clearTimeout(t);
    doc.removeEventListener("pointerdown", onPointerDown, true);
    doc.removeEventListener("focusin", onFocusIn);
    doc.removeEventListener("keydown", onKeyDown, true);
  };
}

/** Two-click armed delete control shared between Miller column rows and file headers. */
export function ConfirmDeleteButton({
  label,
  header = false,
  revealOnRowHover = false,
  onConfirm,
}: {
  label: string;
  header?: boolean;
  revealOnRowHover?: boolean;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!armed) return;
    return attachArmedDeleteDismiss(wrapRef.current, () => setArmed(false));
  }, [armed]);

  return (
    <div
      ref={wrapRef}
      onMouseLeave={() => setArmed(false)}
      className={cn(
        "flex-none transition-opacity",
        revealOnRowHover &&
          (armed
            ? "me-0.5 w-auto opacity-100"
            : "w-0 overflow-hidden opacity-0 group-focus-within/row:me-0.5 group-focus-within/row:w-auto group-focus-within/row:opacity-100 group-hover/row:me-0.5 group-hover/row:w-auto group-hover/row:opacity-100 focus-within:me-0.5 focus-within:w-auto focus-within:opacity-100 pointer-coarse:me-0.5 pointer-coarse:w-auto pointer-coarse:opacity-100"),
      )}
    >
      <Button
        type="button"
        variant={armed ? "destructive" : "remove"}
        size={armed ? (header ? "lg" : "sm") : header ? "icon-lg" : "icon-sm"}
        title={armed ? `Confirm delete ${label}` : `Delete ${label}`}
        aria-label={armed ? `Confirm delete ${label}` : `Delete ${label}`}
        onClick={() => {
          if (armed) {
            setArmed(false);
            onConfirm();
          } else {
            setArmed(true);
          }
        }}
      >
        {armed ? "Delete?" : <Trash2 aria-hidden />}
      </Button>
    </div>
  );
}

/** Deletes a lesson file and offers a toast Undo action (respecting 409 AI conflict detection). */
export async function removeLessonWithUndo(key: string, onBeforeRemove?: () => void) {
  const { scope, path } = parseLessonKey(key);
  const res = await deleteLesson(key, onBeforeRemove);
  if (!res.removed) {
    toast.add({
      title: res.conflict ? "Kept lesson with AI changes" : "Could not delete lesson",
      description: res.conflict ? "Adopted the AI's newer version instead of deleting." : res.error,
      type: res.conflict ? "info" : "error",
    });
    return;
  }
  showUndo(`Deleted ${path} (${SCOPE_LABEL[scope]})`, () => {
    void res.restore().then((ok) => {
      if (!ok) {
        toast.add({
          title: "Could not restore lesson",
          description: "The AI already wrote a new file or the studio didn't answer.",
          type: "error",
        });
      }
    });
  });
}
