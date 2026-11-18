import { AudioLines, FileAudio, Upload } from "lucide-react";
import { type ReactNode } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import type { VoicePlaygroundItem } from "../../src/voice-playground.mjs";
import { PLAYGROUND_MODE_PRESENTATION } from "./voice-playground-presentation";
import { type VoiceTakeItem } from "./voice-view";

export type AudioSourceKind = "upload" | "playground" | "film_take";

export interface FilmTakeAudioOption {
  value: string;
  label: string;
}

export function recordingSourceOptions(
  entries: readonly (Pick<
    VoicePlaygroundItem,
    "title" | "durationSeconds" | "voiceName" | "scope"
  > & { id: string })[],
) {
  const options = entries.map((entry) => ({
    value: entry.id,
    label: [
      entry.title,
      entry.voiceName,
      entry.scope === "global" ? "Global" : "Project",
      `${entry.durationSeconds.toFixed(1)} s`,
    ]
      .filter(Boolean)
      .join(" · "),
  }));
  const counts = new Map<string, number>();
  for (const { label } of options) counts.set(label, (counts.get(label) ?? 0) + 1);
  return options.map(({ value, label }) => ({
    value,
    label: counts.get(label) === 1 ? label : `${label} · ${value.slice(-8)}`,
  }));
}

export function parseTakeRef(val: string): { kind: "takes" | "try"; file: string } | null {
  const parts = val.split(":");
  if (parts.length < 2) return null;
  return { kind: parts[0] as "takes" | "try", file: parts.slice(1).join(":") };
}

export function buildFilmTakeAudioOptions(
  filmTakes: readonly VoiceTakeItem[],
): FilmTakeAudioOption[] {
  const list: FilmTakeAudioOption[] = [];
  for (const t of filmTakes) {
    if (t.file) list.push({ value: `takes:${t.file}`, label: `Take ${t.id} · Main (${t.file})` });
    for (const tf of t.tries ?? []) {
      list.push({ value: `try:${tf}`, label: `Take ${t.id} · ${tf}` });
    }
  }
  return list;
}

/**
 * Shared audio input selector supporting local file upload, archived Playground clip, or Film Take.
 */
export function VoicePlaygroundAudioSource({
  title,
  sourceKind,
  onSourceKindChange,
  uploadedFile,
  onFileChange,
  accept,
  uploadPlaceholder,
  playgroundItems,
  selectedItemId,
  onSelectItemId,
  playgroundPlaceholder,
  filmTakeOptions,
  selectedTakeValue,
  onSelectTakeValue,
  takePlaceholder,
  itemIcon = "file",
  tone,
  children,
}: {
  title: string;
  sourceKind: AudioSourceKind;
  onSourceKindChange: (next: AudioSourceKind) => void;
  uploadedFile: File | null;
  onFileChange: (file: File | null) => void;
  accept: string;
  uploadPlaceholder: string;
  playgroundItems: readonly VoicePlaygroundItem[];
  selectedItemId: string;
  onSelectItemId: (id: string) => void;
  playgroundPlaceholder: string;
  filmTakeOptions: readonly FilmTakeAudioOption[];
  selectedTakeValue: string;
  onSelectTakeValue: (val: string) => void;
  takePlaceholder: string;
  itemIcon?: "file" | "wave";
  tone?: "voice_changer" | "stt";
  children?: ReactNode;
}) {
  const SourceIcon = itemIcon === "wave" ? AudioLines : FileAudio;
  const options = recordingSourceOptions(playgroundItems);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={cn(
            "text-sm font-semibold",
            tone ? PLAYGROUND_MODE_PRESENTATION[tone].text : "text-foreground",
          )}
        >
          {title}
        </span>
        <ToggleGroup
          variant="pick"
          size="lg"
          value={[sourceKind]}
          aria-label="Audio source type"
          className="flex-wrap"
          onValueChange={([value]) => {
            if (value === "upload" || value === "playground" || value === "film_take") {
              onSourceKindChange(value);
            }
          }}
        >
          <ToggleGroupItem value="upload">Upload File</ToggleGroupItem>
          <ToggleGroupItem value="playground">Playground Clip</ToggleGroupItem>
          <ToggleGroupItem value="film_take">Film Take</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {sourceKind === "upload" && (
        <label className="border-hairline-strong hover:bg-card focus-within:border-ring focus-within:ring-ring/40 flex cursor-pointer items-center justify-between gap-2 rounded-md border border-dashed px-3 py-2 text-sm focus-within:ring-2">
          <span className="flex min-w-0 items-center gap-2">
            <Upload className="text-primary-text size-3.5" />
            <span className="truncate">
              {uploadedFile
                ? `${uploadedFile.name} (${(uploadedFile.size / 1024).toFixed(0)} KB)`
                : uploadPlaceholder}
            </span>
          </span>
          <input
            type="file"
            accept={accept}
            className="sr-only"
            onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
          />
        </label>
      )}

      {sourceKind === "playground" && (
        <Select
          items={options}
          value={selectedItemId}
          onValueChange={(v) => onSelectItemId(v ?? "")}
        >
          <SelectTrigger size="readable" className="w-full" aria-label="Source playground clip">
            <SourceIcon className="text-muted-foreground size-3.5" />
            <SelectValue placeholder={playgroundPlaceholder} />
          </SelectTrigger>
          <SelectContent finalFocus>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {sourceKind === "film_take" && (
        <Select
          items={filmTakeOptions.map((opt) => ({ value: opt.value, label: opt.label }))}
          value={selectedTakeValue}
          onValueChange={(v) => onSelectTakeValue(v ?? "")}
        >
          <SelectTrigger size="readable" className="w-full" aria-label="Source film voice take">
            <SourceIcon className="text-muted-foreground size-3.5" />
            <SelectValue placeholder={takePlaceholder} />
          </SelectTrigger>
          <SelectContent finalFocus>
            {filmTakeOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {children}
    </>
  );
}
