import { AudioLines, FileAudio, Upload } from "lucide-react";
import { type ReactNode } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { PLAYGROUND_MODE_PRESENTATION } from "./voice-playground-presentation";
import { type VoiceTakeItem } from "./voice-view";

export type AudioSourceKind = "upload" | "playground" | "film_take";

export interface FilmTakeAudioOption {
  value: string;
  label: string;
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
  playgroundItems: ReadonlyArray<{ id: string; title: string; durationSeconds: number }>;
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
        <div className="bg-raised-2 inline-flex max-w-full flex-wrap rounded-md p-0.5 text-xs">
          {(
            [
              { id: "upload", label: "Upload File" },
              { id: "playground", label: "Playground Clip" },
              { id: "film_take", label: "Film Take" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              aria-pressed={sourceKind === opt.id}
              onClick={() => onSourceKindChange(opt.id)}
              className={cn(
                "focus-visible:ring-ring rounded px-2 py-0.5 font-medium transition-colors outline-none focus-visible:ring-2",
                sourceKind === opt.id
                  ? "bg-card text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
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
          items={playgroundItems.map((item) => ({
            value: item.id,
            label: `${item.title} (${item.durationSeconds.toFixed(1)}s)`,
          }))}
          value={selectedItemId}
          onValueChange={(v) => onSelectItemId(v ?? "")}
        >
          <SelectTrigger className="h-8 w-full" aria-label="Source playground clip">
            <SourceIcon className="text-muted-foreground size-3.5" />
            <SelectValue placeholder={playgroundPlaceholder} />
          </SelectTrigger>
          <SelectContent>
            {playgroundItems.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.title} ({item.durationSeconds.toFixed(1)}s)
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
          <SelectTrigger className="h-8 w-full" aria-label="Source film voice take">
            <SourceIcon className="text-muted-foreground size-3.5" />
            <SelectValue placeholder={takePlaceholder} />
          </SelectTrigger>
          <SelectContent>
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
