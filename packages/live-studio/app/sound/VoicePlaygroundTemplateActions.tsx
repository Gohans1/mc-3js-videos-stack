import { Archive, CopyPlus, RotateCcw } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import type { PlaygroundTemplate } from "../../src/voice-playground.mjs";
import {
  copyPlaygroundTemplate,
  deletePlaygroundTemplate,
  recordingRemovalFocus,
  updatePlaygroundTemplate,
} from "./voice-playground-client";

export function VoicePlaygroundTemplateActions({ template }: { template: PlaygroundTemplate }) {
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(template.title);
  const [description, setDescription] = useState(template.description ?? "");
  const [tags, setTags] = useState(template.tags?.join(", ") ?? "");
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-xs">
        Template ·{" "}
        {template.scope === "global"
          ? "Global · available in every project"
          : "Project · this film only"}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await copyPlaygroundTemplate(template);
            } finally {
              setBusy(false);
            }
          }}
        >
          <CopyPlus />
          Save copy to {template.scope === "global" ? "Project" : "Global"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-disabled={busy}
          onClick={async (event) => {
            if (busy) return;
            const focusNearby = recordingRemovalFocus(event.currentTarget);
            setBusy(true);
            try {
              const updated = template.archivedAt
                ? await updatePlaygroundTemplate(template, { archived: false })
                : await deletePlaygroundTemplate(template);
              if (updated) focusNearby();
            } finally {
              setBusy(false);
            }
          }}
        >
          {template.archivedAt ? <RotateCcw /> : <Archive />}
          {template.archivedAt ? "Restore template" : "Move to Archive"}
        </Button>
      </div>
      <details className="border-hairline mt-2 border-t pt-3">
        <summary className="text-foreground cursor-pointer text-sm">Template details</summary>
        <form
          className="mt-3 flex flex-col gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!title.trim() || busy) return;
            setBusy(true);
            try {
              await updatePlaygroundTemplate(template, {
                title: title.trim(),
                description,
                tags: [
                  ...new Set(
                    tags
                      .split(",")
                      .map((tag) => tag.trim())
                      .filter(Boolean),
                  ),
                ],
              });
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field>
            <FieldLabel htmlFor={`${id}-title`}>Template name</FieldLabel>
            <Input
              id={`${id}-title`}
              value={title}
              maxLength={120}
              required
              onChange={(event) => setTitle(event.currentTarget.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-description`}>Description</FieldLabel>
            <Textarea
              id={`${id}-description`}
              rows={2}
              value={description}
              maxLength={2000}
              onChange={(event) => setDescription(event.currentTarget.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-tags`}>Tags</FieldLabel>
            <Input
              id={`${id}-tags`}
              value={tags}
              onChange={(event) => setTags(event.currentTarget.value)}
              placeholder="Separate with commas"
            />
          </Field>
          <Button
            type="submit"
            variant="secondary"
            size="sm"
            className="self-start"
            disabled={busy || !title.trim()}
          >
            Save details
          </Button>
        </form>
      </details>
    </div>
  );
}
