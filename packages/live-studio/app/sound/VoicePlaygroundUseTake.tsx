import { Check, Film, Loader2 } from "lucide-react";
import { useId, useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useVoiceTakes } from "./voice-client";
import {
  setPlaygroundTargetTake,
  usePlaygroundTakeInFilm,
  useVoicePlaygroundSelector,
} from "./voice-playground-client";
import type { UnifiedPlaygroundEntry } from "./voice-playground-view";
import { parseTakeScript } from "./voice-view";

export function VoicePlaygroundUseTake({
  entry,
  secondary = false,
}: {
  entry: UnifiedPlaygroundEntry;
  secondary?: boolean;
}) {
  const id = useId();
  const takes = useVoiceTakes();
  const target = useVoicePlaygroundSelector((state) => state.targetTakeId, false);
  const usage = useVoicePlaygroundSelector((state) => state.usage, false) ?? [];
  const busy = useVoicePlaygroundSelector((state) => state.busyAction, false);
  const choices = useMemo(
    () =>
      takes.map((take) => ({
        value: take.id,
        label: `Take ${take.id}: ${parseTakeScript(take.text).spoken}`,
      })),
    [takes],
  );
  const matches = takes.filter(
    (take) => parseTakeScript(take.text).spoken.trim() === entry.spoken.trim(),
  );
  const chosen = takes.some((take) => take.id === target)
    ? target
    : matches.length === 1
      ? matches[0]!.id
      : "";
  const inUse = usage.some((record) => record.itemId === entry.id && record.takeId === chosen);
  if (!entry.playgroundItem || !takes.length) return null;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Field>
        <FieldLabel htmlFor={`${id}-take`} variant="compact">
          Replace film line
        </FieldLabel>
        <Select
          items={choices}
          value={chosen || null}
          disabled={Boolean(busy)}
          onValueChange={(value) => setPlaygroundTargetTake(value ?? "")}
        >
          <SelectTrigger id={`${id}-take`} size="sm" className="w-full">
            <SelectValue placeholder="Choose a film line…" />
          </SelectTrigger>
          <SelectContent finalFocus>
            <SelectGroup>
              {choices.map((choice) => (
                <SelectItem key={choice.value} value={choice.value}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <Button
        type="button"
        variant={inUse ? "lit" : secondary ? "secondary" : "default"}
        size="sm"
        disabled={!chosen || Boolean(busy) || inUse}
        onClick={() => void usePlaygroundTakeInFilm(entry, chosen)}
      >
        {busy === `use:${entry.id}` ? (
          <Loader2 className="animate-spin motion-reduce:animate-none" />
        ) : inUse ? (
          <Check />
        ) : (
          <Film />
        )}
        {inUse ? `In use · Line ${chosen}` : "Use this take"}
      </Button>
      {chosen && !matches.some((take) => take.id === chosen) && (
        <p className="text-warn-text text-xs leading-relaxed">
          This recording has different words from the selected film line. Listen before replacing
          it.
        </p>
      )}
    </div>
  );
}
