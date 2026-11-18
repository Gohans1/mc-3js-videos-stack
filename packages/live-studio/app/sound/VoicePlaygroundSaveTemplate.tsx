import { Bookmark, Loader2 } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { savePlaygroundTemplate, type VoicePlaygroundClientState } from "./voice-playground-client";

const SCOPES = [
  { value: "project", label: "This project" },
  { value: "global", label: "Global · all projects" },
];
export function VoicePlaygroundSaveTemplate({ pg }: { pg: VoicePlaygroundClientState }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [scope, setScope] = useState<"project" | "global">("project");
  const [error, setError] = useState("");
  const saving = pg.busyAction === "template";
  const sourcePending =
    pg.draft.mode === "stt" &&
    pg.draft.sttSourceKind === "upload" &&
    Boolean(pg.sttSourceUpload?.status && pg.sttSourceUpload.status !== "idle");
  const editing = Boolean(pg.draft.templateId && pg.draft.templateScope === scope);
  const save = async (update: boolean) => {
    if (!title.trim()) {
      setError("Enter a name for this template.");
      document.getElementById(`${id}-title`)?.focus();
      return;
    }
    setError("");
    if (await savePlaygroundTemplate(title.trim(), scope, update)) setOpen(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next, { event }) => {
        if (saving) return;
        if (next) {
          setKeyboardOpen(!(event instanceof MouseEvent) || event.detail === 0);
          const template = pg.templates.find((template) => template.id === pg.draft.templateId);
          setTitle(
            template?.title ||
              pg.draft.title ||
              (pg.draft.mode === "stt"
                ? `${pg.draft.sttSourceLabel || "Scribe v2"} · transcription`
                : `${pg.draft.voiceName || "Voice"} · ${pg.draft.mode}`),
          );
          setScope(pg.draft.templateScope ?? pg.scope ?? "project");
          setError("");
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger render={<Button type="button" size="sm" variant="secondary" />}>
        <Bookmark />
        Save template
      </PopoverTrigger>
      <PopoverContent
        align="end"
        motion={keyboardOpen ? "none" : "anchored"}
        className="max-h-[min(var(--available-height),calc(100dvh-1.5rem))] w-[min(24rem,calc(100vw-1.5rem))] overflow-y-auto overscroll-contain"
      >
        <form
          className="flex shrink-0 flex-col gap-2.5"
          onSubmit={(event) => {
            event.preventDefault();
            void save(editing);
          }}
        >
          <PopoverTitle>{editing ? "Edit template" : "Save a voice template"}</PopoverTitle>
          <div className="flex flex-col gap-3">
            <Field data-invalid={Boolean(error)}>
              <FieldLabel htmlFor={`${id}-title`}>Template name</FieldLabel>
              <Input
                id={`${id}-title`}
                value={title}
                maxLength={120}
                disabled={saving}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `${id}-error` : undefined}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Warm documentary narrator"
              />
              {error && (
                <p id={`${id}-error`} role="alert" className="text-destructive text-sm">
                  {error}
                </p>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-scope`}>Save to</FieldLabel>
              <Select
                items={SCOPES}
                value={scope}
                disabled={saving}
                onValueChange={(value) => setScope(value === "global" ? "global" : "project")}
              >
                <SelectTrigger id={`${id}-scope`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent finalFocus>
                  <SelectGroup>
                    {SCOPES.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>
                Full prompt, voice and settings. No generation charge.
              </FieldDescription>
            </Field>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {editing && (
              <Button
                type="button"
                variant="secondary"
                disabled={saving || sourcePending}
                onClick={() => void save(false)}
              >
                Save as new
              </Button>
            )}
            <Button type="submit" disabled={saving || sourcePending}>
              {saving && <Loader2 className="animate-spin motion-reduce:animate-none" />}
              {saving ? "Saving…" : editing ? "Update template" : "Save template"}
            </Button>
          </div>
          {sourcePending && (
            <p role="status" className="text-muted-foreground text-sm">
              {pg.sttSourceUpload?.status === "uploading"
                ? "Wait for the original source to finish saving."
                : "Retry the source upload before saving this template."}
            </p>
          )}
        </form>
      </PopoverContent>
    </Popover>
  );
}
