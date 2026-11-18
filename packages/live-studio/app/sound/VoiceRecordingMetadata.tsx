import { Star } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import type { VoicePlaygroundItem } from "../../src/voice-playground.mjs";
import { patchPlaygroundItem } from "./voice-playground-client";

export function VoiceRecordingMetadata({ item }: { item: VoicePlaygroundItem }) {
  const id = useId();
  const [tags, setTags] = useState(item.tags?.join(", ") ?? "");
  const [description, setDescription] = useState(item.description ?? "");
  const [color, setColor] = useState(item.color ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  return (
    <form
      aria-label="Recording notes and tags"
      className="border-hairline flex flex-col gap-3 border-t pt-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setSaving(true);
        try {
          const result = await patchPlaygroundItem(item.id, {
            tags: [
              ...new Set(
                tags
                  .split(",")
                  .map((tag) => tag.trim())
                  .filter(Boolean),
              ),
            ],
            description,
            color: color || null,
          });
          setSaved(Boolean(result));
        } finally {
          setSaving(false);
        }
      }}
    >
      <div role="group" aria-label="Recording rating" className="flex flex-wrap items-center gap-1">
        <span className="text-muted-foreground mr-2 text-xs">Rating</span>
        {[1, 2, 3, 4, 5].map((rating) => (
          <Button
            key={rating}
            type="button"
            variant="favorite"
            size="icon-xs"
            aria-label={`${rating} ${rating === 1 ? "star" : "stars"}`}
            aria-pressed={item.rating === rating}
            onClick={() =>
              void patchPlaygroundItem(item.id, { rating: item.rating === rating ? null : rating })
            }
          >
            <Star className={rating <= (item.rating ?? 0) ? "fill-current" : ""} />
          </Button>
        ))}
      </div>
      <Field>
        <FieldLabel htmlFor={id + "-description"}>Description</FieldLabel>
        <Textarea
          id={id + "-description"}
          rows={2}
          maxLength={2000}
          value={description}
          onChange={(event) => {
            setDescription(event.currentTarget.value);
            setSaved(false);
          }}
          placeholder="When should this take be used?"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={id + "-tags"}>Tags</FieldLabel>
        <Input
          id={id + "-tags"}
          size="sm"
          value={tags}
          placeholder="Separate with commas"
          onChange={(event) => {
            setTags(event.currentTarget.value);
            setSaved(false);
          }}
        />
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-muted-foreground flex items-center gap-2 text-xs">
          Color
          <input
            type="color"
            value={color || "#558ad3"}
            className="h-7 w-9 cursor-pointer rounded"
            onChange={(event) => {
              setColor(event.currentTarget.value);
              setSaved(false);
            }}
          />
        </label>
        {color && (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => {
              setColor("");
              setSaved(false);
            }}
          >
            Clear color
          </Button>
        )}
        <Button type="submit" size="sm" variant="secondary" disabled={saving}>
          {saving ? "Saving…" : saved ? "Saved" : "Save details"}
        </Button>
      </div>
    </form>
  );
}
