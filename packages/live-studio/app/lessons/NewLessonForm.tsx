import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { Segmented } from "../components/inspector";
import { SCOPE_LABEL, SCOPE_SHORT } from "./lesson-ui";
import { type LessonScope } from "./lessons";

/** Inline creation form for a new project-local or global lesson markdown file. */
export function NewLessonForm({
  nameInputRef,
  hasProject,
  newScope,
  setNewScope,
  naming,
  setNaming,
  showErr,
  errMsg,
  compact,
  onSubmit,
  onClose,
}: {
  nameInputRef: React.RefObject<HTMLInputElement | null>;
  hasProject: boolean;
  newScope: LessonScope;
  setNewScope: (s: LessonScope) => void;
  naming: string;
  setNaming: (v: string) => void;
  showErr: boolean;
  errMsg: string | null;
  compact: boolean;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const hintId = useId(),
    errId = useId();
  return (
    <form
      noValidate
      className={cn(
        "animate-in fade-in slide-in-from-top-1 flex flex-none flex-col gap-1.5 pb-2 duration-150 ease-out motion-reduce:animate-none",
        compact ? "px-2 pt-1.5" : "px-3",
      )}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {hasProject && (
        <Segmented<LessonScope>
          label="New lesson scope"
          value={newScope}
          className={compact ? "[&_[role=radio]]:text-ui" : "[&_[role=radio]]:text-sm"}
          items={
            compact
              ? [
                  { id: "film", title: SCOPE_SHORT.film },
                  { id: "all", title: SCOPE_SHORT.all },
                ]
              : [
                  { id: "film", title: SCOPE_LABEL.film },
                  { id: "all", title: SCOPE_LABEL.all },
                ]
          }
          onChange={setNewScope}
        />
      )}
      <Field data-invalid={showErr || undefined}>
        <div className="flex gap-1.5">
          <Input
            ref={nameInputRef}
            size="md"
            aria-label="New lesson file's name"
            aria-invalid={showErr || undefined}
            aria-describedby={showErr ? `${hintId} ${errId}` : hintId}
            placeholder={compact ? "dir/topic" : "camera or craft/walk"}
            value={naming}
            className="min-w-0 flex-1"
            onChange={(e) => setNaming(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") onClose();
            }}
          />
          <Button type="submit" size={compact ? "sm" : "md"}>
            Create
          </Button>
        </div>
        <FieldDescription id={hintId}>
          {hasProject && newScope === "film"
            ? "This film only (project lessons/). One file per topic."
            : "Shared across all films (global lessons/). One file per topic."}
        </FieldDescription>
        {showErr && <FieldError id={errId}>{errMsg}</FieldError>}
      </Field>
    </form>
  );
}
