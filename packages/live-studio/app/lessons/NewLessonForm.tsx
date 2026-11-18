import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { LESSON_PATH_MAX } from "../../src/lesson-template";
import { Segmented } from "../components/inspector";
import { SCOPE_LABEL } from "./lesson-ui";
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
  openExisting = false,
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
  openExisting?: boolean;
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
      className={cn("flex flex-none flex-col gap-1.5 pb-2", compact ? "px-2 pt-1.5" : "px-3")}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {hasProject && (
        <Segmented<LessonScope>
          keepClickFocus
          label="New lesson scope"
          animateIndicator={false}
          value={newScope}
          className={compact ? "[&_[role=radio]]:text-ui" : "[&_[role=radio]]:text-sm"}
          items={[
            { id: "film", title: SCOPE_LABEL.film },
            { id: "all", title: SCOPE_LABEL.all },
          ]}
          onChange={setNewScope}
        />
      )}
      <Field data-invalid={showErr || undefined}>
        <div className="flex flex-wrap gap-1.5">
          <Input
            ref={nameInputRef}
            size="md"
            aria-label="Lesson name"
            aria-invalid={showErr || undefined}
            aria-describedby={showErr ? `${hintId} ${errId}` : hintId}
            placeholder="camera/framing"
            value={naming}
            className="grow basis-32"
            onChange={(e) => setNaming(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") onClose();
            }}
          />
          <Button type="submit" size={compact ? "sm" : "md"}>
            {openExisting ? "Open existing lesson" : "Create"}
          </Button>
          <Button type="button" variant="ghost" size={compact ? "sm" : "md"} onClick={onClose}>
            Cancel
          </Button>
        </div>
        <FieldDescription id={hintId}>
          Use letters (A–Z or a–z), numbers, hyphens, or underscores. Use one slash between folders.
          Keep the path within {LESSON_PATH_MAX} characters, including .md.
        </FieldDescription>
        {showErr && <FieldError id={errId}>{errMsg}</FieldError>}
      </Field>
    </form>
  );
}
