import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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

export const TEXT = "font-md text-base/[1.6] whitespace-pre-wrap wrap-anywhere [tab-size:4] p-3";

export function ConfirmDeleteButton({
  label,
  size = "icon-sm",
  revealOnRowHover = false,
  onConfirm,
}: {
  label: string;
  size?: "icon-sm" | "icon-lg";
  revealOnRowHover?: boolean;
  onConfirm: () => void;
}) {
  const action = "Delete " + label;
  return (
    <div
      className={cn(
        "flex-none",
        revealOnRowHover &&
          "me-0.5 opacity-0 transition-opacity duration-150 group-focus-within/row:opacity-100 group-hover/row:opacity-100 motion-reduce:transition-none pointer-coarse:opacity-100",
      )}
    >
      <Dialog>
        <DialogTrigger
          render={<Button variant="remove" size={size} title={action} aria-label={action} />}
        >
          <Trash2 size={16} absoluteStrokeWidth aria-hidden />
        </DialogTrigger>
        <DialogContent showCloseButton={false} motion="fade">
          <DialogTitle>Delete lesson?</DialogTitle>
          <DialogDescription>{action}. The deletion notification offers Undo.</DialogDescription>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <DialogClose render={<Button variant="destructive" />} onClick={onConfirm}>
              Delete lesson
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
