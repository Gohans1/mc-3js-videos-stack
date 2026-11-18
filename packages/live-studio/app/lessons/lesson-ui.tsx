import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { showUndo, toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import {
  deleteLesson,
  type LessonScope,
  parseLessonKey,
  type RecoverableLessonDraft,
} from "./lessons";

export function downloadLessonDrafts(drafts: readonly RecoverableLessonDraft[]) {
  const single = drafts.length === 1 ? drafts[0] : undefined;
  const text =
    single?.text ?? drafts.map((draft) => `# ${draft.path}\n\n${draft.text}`).join("\n\n---\n\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = single?.path.split("/").at(-1) ?? "lesson-drafts.md";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const SCOPE_LABEL: Record<LessonScope, string> = { film: "This film", all: "Every film" };

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
        "flex-none transition-opacity duration-150 motion-reduce:transition-none",
        revealOnRowHover &&
          (armed
            ? "me-0.5 w-auto opacity-100"
            : "me-0.5 opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 pointer-coarse:opacity-100"),
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
      description: res.conflict
        ? "The latest version is open. Review it before deleting again."
        : "Check the Studio connection and try deleting again.",
      type: res.conflict ? "info" : "error",
    });
    return;
  }
  showUndo(`Deleted ${path} (${SCOPE_LABEL[scope]})`, () => {
    void res.restore().then((ok) => {
      if (!ok) {
        toast.add({
          title: "Could not restore lesson",
          description:
            "Check the Studio connection and whether a lesson already exists at this path.",
          type: "error",
        });
      }
    });
  });
}
