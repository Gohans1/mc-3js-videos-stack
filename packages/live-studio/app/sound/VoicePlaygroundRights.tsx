import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import type { VoicePlaygroundItem } from "../../src/voice-playground.mjs";
import { patchPlaygroundItem } from "./voice-playground-client";
import { extractDialogueSpeakerEntries } from "./voice-playground-view";
import { recordedCastSummary } from "./voice-setting-details";

type RightsSaveState =
  | { status: "idle"; error: string }
  | { status: "saving" };

export function VoicePlaygroundRights({ item }: { item: VoicePlaygroundItem }) {
  const id = useId();
  const [url, setUrl] = useState(item.rights?.evidenceUrl ?? "");
  const [notes, setNotes] = useState(item.rights?.notes ?? "");
  const [confirmed, setConfirmed] = useState(item.rights?.status === "user_confirmed");
  const [saveState, setSaveState] = useState<RightsSaveState>({ status: "idle", error: "" });
  const saving = saveState.status === "saving";
  const error = saveState.status === "idle" ? saveState.error : "";
  const cast = item.dialogue
    ? recordedCastSummary(extractDialogueSpeakerEntries(item.dialogue.speakers))
    : undefined;
  return (
    <details className="border-hairline rounded-lg border p-3">
      <summary className="text-foreground focus-visible:outline-ring cursor-pointer rounded text-sm font-semibold focus-visible:outline-2">
        Source & usage rights ·{" "}
        {item.rights?.status === "user_confirmed" ? "User confirmed" : "Unverified"}
      </summary>
      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          if (saving) return;
          if (confirmed && !url.trim() && !notes.trim()) {
            setSaveState({
              status: "idle",
              error: "Add an evidence link or record the permission you received.",
            });
            return;
          }
          setSaveState({ status: "saving" });
          try {
            await patchPlaygroundItem(item.id, {
              rights: {
                status: confirmed ? "user_confirmed" : "unverified",
                ...(url.trim() ? { evidenceUrl: url.trim() } : {}),
                notes: notes.trim(),
              },
            });
            setSaveState({ status: "idle", error: "" });
          } catch (cause) {
            setSaveState({
              status: "idle",
              error: cause instanceof Error ? cause.message : "Could not save rights record.",
            });
          }
        }}
      >
        <p className="text-muted-foreground text-xs leading-relaxed break-words">
          Source:{" "}
          {item.filmTakeSource
            ? `Film Take ${item.filmTakeSource.takeId}; provider not recorded`
            : `GenVoice / ${cast?.sources || item.provider}`}{" "}
          · Voices {cast?.voices || item.voiceId || "not recorded"} ·{" "}
          {new Date(item.createdAt).toLocaleString()}. An available API voice does not confirm
          commercial usage rights.
        </p>
        <a
          className="text-primary-text focus-visible:outline-ring rounded text-xs underline underline-offset-2 focus-visible:outline-2"
          href="https://genvoice.pro/llms.txt"
          target="_blank"
          rel="noreferrer"
        >
          GenVoice API documentation
        </a>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${id}-evidence`}>Terms or permission link</FieldLabel>
            <Input
              id={`${id}-evidence`}
              type="url"
              value={url}
              disabled={saving}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://…"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-notes`}>Permission notes</FieldLabel>
            <Textarea
              id={`${id}-notes`}
              value={notes}
              maxLength={2000}
              disabled={saving}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Who confirmed permission, for which use, and when"
            />
          </Field>
          <Field orientation="horizontal">
            <Checkbox
              id={`${id}-confirmed`}
              checked={confirmed}
              disabled={saving}
              onCheckedChange={(value) => setConfirmed(value === true)}
            />
            <FieldLabel htmlFor={`${id}-confirmed`}>
              I have confirmed permission for my intended use
            </FieldLabel>
          </Field>
        </FieldGroup>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <p className="text-muted-foreground text-xs">
          This records your confirmation. The app does not independently verify a license.
        </p>
        <Button type="submit" variant="secondary" size="sm" disabled={saving}>
          {saving ? "Saving…" : "Save rights record"}
        </Button>
      </form>
    </details>
  );
}
