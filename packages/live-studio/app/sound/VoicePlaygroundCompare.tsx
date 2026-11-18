import { ArrowUpRight, AudioWaveform, ChevronDown, ListPlus, Star, X } from "lucide-react";
import { type RefObject, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import type { PlaygroundJob } from "../../src/voice-playground.mjs";
import { auditionTarget, listening, listenUrl, subscribeAudition } from "./sound";
import {
  copyPlaygroundToScope,
  duplicateEntryToComposer,
  openRecordingEditor,
  reviewSpeechJob,
  selectPlaygroundUid,
  setPlaygroundSubTab,
  togglePlaygroundCompare,
  toggleUnifiedFavorite,
} from "./voice-playground-client";
import {
  extractDialogueSpeakerEntries,
  recordedFee,
  type UnifiedPlaygroundEntry,
} from "./voice-playground-view";
import { recordedVoiceSettings } from "./voice-setting-details";
import { VoiceRecordingPlayer } from "./VoicePlaygroundResults";
import { VoicePlaygroundUseTake } from "./VoicePlaygroundUseTake";
import { VoiceRecordingCaptions } from "./VoiceRecordingCaptions";
import { VoiceRecordingEdits } from "./VoiceRecordingEdits";
import { VoicePlaybackIcon } from "./VoicePlaybackIcon";

const scopedLabel = (entry: UnifiedPlaygroundEntry) =>
  entry.playgroundItem?.scope === "global" ? "Global" : "Project";

const feeLabel = (entry: UnifiedPlaygroundEntry) =>
  recordedFee(entry.playgroundItem ?? entry.sourceRecording);

export function VoicePlaygroundCompare({
  entries,
  uids,
  batchJobs = [],
  onAddVoices,
  onBrowseRecordings,
  headingRef,
}: {
  entries: readonly UnifiedPlaygroundEntry[];
  uids: readonly string[];
  batchJobs?: readonly PlaygroundJob[];
  onAddVoices?: () => void;
  onBrowseRecordings?: () => void;
  headingRef?: RefObject<HTMLHeadingElement | null>;
}) {
  const playing = useSyncExternalStore(subscribeAudition, listening, listening);
  const target = useSyncExternalStore(subscribeAudition, auditionTarget, auditionTarget);
  const [chosenUid, setChosenUid] = useState<string | null>(null);
  const [firstReadyUid, setFirstReadyUid] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const batchRows = batchJobs.map((job) => ({
    key: job.id,
    name: job.voiceName || job.voiceId,
    entry: job.itemId ? byId.get(job.itemId) : undefined,
    job,
  }));
  const retained = new Set(batchRows.flatMap((row) => row.entry?.uid ?? []));
  const otherRows = uids.flatMap((uid) => {
    if (retained.has(uid)) return [];
    const entry = entries.find((candidate) => candidate.uid === uid);
    return entry ? [{ key: entry.uid, name: entry.voiceName, entry, job: undefined }] : [];
  });
  const rows = [...batchRows, ...otherRows].slice(0, 7);
  const selected = rows.flatMap((row) => row.entry ?? []);
  const firstReady = selected.find((entry) => entry.uid === firstReadyUid) ?? selected[0];
  const readyUid = firstReady?.uid ?? null;
  if (readyUid !== firstReadyUid) setFirstReadyUid(readyUid);
  const current =
    selected.find((entry) => entry.auditionId === playing) ??
    selected.find((entry) => entry.uid === chosenUid) ??
    selected.find((entry) => entry.auditionId === target) ??
    firstReady;
  const play = (entry: UnifiedPlaygroundEntry) => {
    setChosenUid(entry.uid);
    listenUrl(entry.auditionId, entry.audioUrl);
  };
  const saveCopy = async (entry: UnifiedPlaygroundEntry) => {
    if (saving) return;
    setSaving(entry.uid);
    try {
      await copyPlaygroundToScope(entry.id);
    } finally {
      setSaving(null);
    }
  };
  if (!rows.length)
    return (
      <section
        aria-label="Compare saved takes"
        className="border-hairline flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-5 py-4"
      >
        <p className="text-muted-foreground text-sm">
          Add takes from Recordings to compare audio you already have.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {onAddVoices && (
            <Button onClick={onAddVoices}>
              <ListPlus /> Add voices
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={onBrowseRecordings ?? (() => setPlaygroundSubTab("library"))}
          >
            Browse recordings
          </Button>
        </div>
      </section>
    );

  const showDifference =
    selected.length > 1 && selected.some((entry) => entry.spoken.trim() !== current?.spoken.trim());
  const batchScripts = new Set(
    batchRows.flatMap(({ job, entry }) => {
      const script = job.generationRecipe?.requested.text ?? entry?.text;
      return script?.trim() ? [script.trim()] : [];
    }),
  );
  const currentBatchScript =
    batchScripts.size === 1
      ? batchScripts.values().next().value
      : (current?.playgroundItem?.generationRecipe?.requested.text ?? current?.text);
  const readyCount = batchJobs.filter(({ status }) => status === "completed").length;
  const failedCount = batchJobs.filter(({ status }) => status === "failed").length;
  const generatingCount = batchJobs.length - readyCount - failedCount;

  return (
    <section aria-label="Compare takes" className="@container/compare flex min-w-0 flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2
            ref={headingRef}
            tabIndex={headingRef ? -1 : undefined}
            className="text-heading-foreground focus-visible:ring-ring rounded-sm text-lg leading-tight font-semibold outline-none focus-visible:ring-2"
          >
            Audition
          </h2>
          {batchJobs.length > 0 && (
            <p role="status" aria-atomic="true" className="text-reading-foreground text-sm tabular-nums">
              {readyCount} ready · {failedCount} failed · {generatingCount} running
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onAddVoices && (
            <Button size="sm" variant="secondary" onClick={onAddVoices}>
              <ListPlus /> Add voices
            </Button>
          )}
          {otherRows.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => otherRows.forEach((row) => togglePlaygroundCompare(row.key))}
            >
              Remove saved takes
            </Button>
          )}
        </div>
      </div>
      <div className="grid min-w-0 items-start gap-5 @4xl/compare:grid-cols-[minmax(24rem,30rem)_minmax(0,1fr)]">
        <ol className="border-hairline bg-card divide-hairline divide-y overflow-hidden rounded-lg border">
          {rows.map(({ key, name, entry, job }, index) => {
            const letter = String.fromCharCode(65 + index);
            const active = entry && playing === entry.auditionId;
            const chosen = entry && current?.uid === entry.uid;
            const duration = entry?.durationSeconds;
            return (
              <li
                key={key}
                aria-current={chosen || undefined}
                className={cn(
                  "flex min-h-20 min-w-0 items-center gap-2 px-3 py-1",
                  "border-s-2 border-transparent",
                  chosen && "border-primary bg-primary/10",
                )}
              >
                <span
                  className={cn(
                    "w-5 shrink-0 text-center text-sm tabular-nums",
                    chosen ? "text-reading-foreground" : "text-muted-foreground",
                  )}
                >
                  {letter}
                </span>
                <Button
                  variant={active ? "lit" : "secondary"}
                  size="icon-sm"
                  disabled={!entry?.audioUrl}
                  aria-label={(active ? "Pause " : "Play ") + letter + " · " + name}
                  onClick={() => entry && play(entry)}
                >
                  <VoicePlaybackIcon playing={Boolean(active)} className="size-3.5" />
                </Button>
                <div className="min-w-0 grow">
                  <div className="flex min-w-0 items-baseline gap-2 leading-5">
                    <bdi className="truncate text-sm font-medium" title={name}>
                      {name}
                    </bdi>
                    {chosen && (
                      <span aria-hidden className="text-primary-text shrink-0 text-xs font-medium">
                        Selected
                      </span>
                    )}
                  </div>
                  {job?.status === "failed" && !entry ? (
                    <>
                      <p className="text-warn-text truncate text-xs leading-4 font-medium tabular-nums">
                        Failed ·{" "}
                        {job.creditsDeducted == null
                          ? "Fee not reported"
                          : `${job.creditsDeducted.toLocaleString()} credits reported`}
                      </p>
                      {job.error && (
                        <Popover>
                          <PopoverTrigger
                            type="button"
                            render={
                              <button
                                aria-label={`Read full error for take ${letter} · ${name}`}
                                className="text-reading-foreground hover:text-heading-foreground focus-visible:outline-ring flex w-full items-start gap-1 rounded-sm text-start text-xs leading-normal focus-visible:outline-2"
                              />
                            }
                          >
                            <span className="line-clamp-2 min-w-0 wrap-anywhere">{job.error}</span>
                            <ChevronDown aria-hidden className="mt-[3px] size-3 shrink-0" />
                          </PopoverTrigger>
                          <PopoverContent
                            align="start"
                            motion="none"
                            variant="flush"
                            className="w-96 max-w-(--available-width)"
                          >
                            <div className="grid gap-2 p-3">
                              <PopoverTitle>Take {letter} error</PopoverTitle>
                              <PopoverDescription render={<div />}>
                                <p
                                  tabIndex={0}
                                  className="text-reading-foreground focus-visible:outline-ring max-h-48 overflow-y-auto rounded-sm text-sm leading-relaxed wrap-anywhere focus-visible:outline-2"
                                >
                                  {job.error}
                                </p>
                              </PopoverDescription>
                              {job.generationRecipe && (
                                <p className="text-reading-foreground text-sm leading-relaxed">
                                  Review settings to choose another voice in Speech or try this
                                  voice again later.
                                </p>
                              )}
                            </div>
                          </PopoverContent>
                        </Popover>
                      )}
                    </>
                  ) : (
                    <p
                      className={cn(
                        "line-clamp-2 text-xs leading-4 tabular-nums",
                        entry ? "text-reading-foreground" : "text-muted-foreground",
                      )}
                    >
                      {entry
                        ? [
                            scopedLabel(entry),
                            typeof duration === "number" ? duration.toFixed(1) + " s" : "",
                            feeLabel(entry),
                          ]
                            .filter(Boolean)
                            .join(" · ")
                        : job?.status === "downloading"
                          ? "Saving audio…"
                          : job?.status === "completed"
                            ? "Recording is in the Archive or unavailable"
                            : "Generating…"}
                    </p>
                  )}
                </div>
                {!entry && job?.status === "failed" && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      job.generationRecipe ? reviewSpeechJob(job) : setPlaygroundSubTab("jobs")
                    }
                  >
                    {job.generationRecipe ? "Review settings" : "Open Jobs"}
                  </Button>
                )}
                {entry && (
                  <>
                    <Button
                      variant="favorite"
                      size="icon-sm"
                      aria-label={"Favorite take " + letter + " · " + name}
                      aria-pressed={entry.favorite}
                      onClick={() => toggleUnifiedFavorite(entry)}
                    >
                      <Star className={entry.favorite ? "fill-current" : ""} />
                    </Button>
                    {entry.playgroundItem && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={Boolean(saving)}
                        onClick={() => void saveCopy(entry)}
                      >
                        {entry.playgroundItem.scope === "global"
                          ? "Copy to Project"
                          : "Copy to Global"}
                      </Button>
                    )}
                    {!job && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={"Remove take " + letter}
                        onClick={() => togglePlaygroundCompare(entry.uid)}
                      >
                        <X />
                      </Button>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ol>
        <div
          className={cn(
            "border-hairline bg-card flex min-w-0 flex-col gap-4 rounded-lg border p-5",
            batchJobs.length > 0 && "@4xl/compare:min-h-120",
          )}
        >
          {batchJobs.length > 0 && (
            <section
              className="border-hairline flex min-w-0 flex-col gap-1 border-b pb-3"
              aria-label="Batch script"
            >
              <h3 className="text-foreground text-sm font-semibold">
                {batchScripts.size > 1
                  ? "Script for the selected take"
                  : "Script used for this batch"}
              </h3>
              {currentBatchScript ? (
                <p
                  dir="auto"
                  className="text-foreground max-h-24 max-w-[60ch] overflow-y-auto text-sm leading-relaxed wrap-anywhere whitespace-pre-wrap text-pretty"
                >
                  {currentBatchScript}
                </p>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {batchJobs.some((job) =>
                    ["pending", "processing", "downloading"].includes(job.status),
                  )
                    ? "Waiting for the generation receipt."
                    : "This batch has no saved script."}
                </p>
              )}
            </section>
          )}
          {current ? (
            <>
              <div className="flex min-w-0 items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3
                    className="text-heading-foreground truncate text-base leading-tight font-semibold"
                    title={current.voiceName}
                  >
                    <bdi>{current.voiceName}</bdi>
                  </h3>
                  <p className="text-muted-foreground text-sm">
                    {current.modelId} · {scopedLabel(current)}
                  </p>
                </div>
                <p className="text-foreground text-right text-xs tabular-nums">
                  {feeLabel(current)}
                </p>
              </div>
              <VoiceRecordingPlayer entry={current} />
              <VoiceRecordingCaptions entry={current} />
              {current.dialogue && (
                <details className="border-hairline border-t pt-3">
                  <summary className="text-foreground cursor-pointer text-sm font-medium">
                    Dialogue cast and settings
                  </summary>
                  <dl className="mt-2 grid gap-2">
                    {extractDialogueSpeakerEntries(current.dialogue.speakers).map((speaker) => (
                      <div key={speaker.name}>
                        <dt className="text-foreground text-sm font-medium">
                          {speaker.name} · {speaker.voice_name || speaker.voice_id}
                        </dt>
                        <dd className="text-muted-foreground text-xs leading-relaxed">
                          {[
                            speaker.model_id,
                            speaker.language_code,
                            ...recordedVoiceSettings(
                              speaker.provider ?? "elevenlabs",
                              speaker.voice_settings ?? {},
                              "Not recorded",
                            )
                              .filter((row) => row.value !== "Not recorded")
                              .map((row) => `${row.label} ${row.value}`),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {current.dialogue.pause_between_turns != null && (
                    <p className="text-muted-foreground mt-2 text-xs">
                      Pause between turns {current.dialogue.pause_between_turns}s
                    </p>
                  )}
                </details>
              )}
              {showDifference && (
                <p className="text-muted-foreground text-xs">The takes use different scripts.</p>
              )}
              <div className="border-hairline flex flex-wrap items-center gap-2 border-t pt-3">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => duplicateEntryToComposer(current)}
                >
                  Edit a copy
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    selectPlaygroundUid(current.uid);
                    setPlaygroundSubTab("inspect");
                  }}
                >
                  Recording details <ArrowUpRight />
                </Button>
                {current.playgroundItem && (
                  <Button
                    size="sm"
                    variant="ghost"
                    id="voice-playground-edit-compared"
                    onClick={(event) =>
                      openRecordingEditor(current.playgroundItem!, {
                        openerId: event.currentTarget.id,
                      })
                    }
                  >
                    <AudioWaveform /> Edit a section
                  </Button>
                )}
              </div>
              {current.playgroundItem && (
                <VoiceRecordingEdits item={current.playgroundItem} compact />
              )}
              {current.playgroundItem && (
                <VoicePlaygroundUseTake key={current.uid} entry={current} />
              )}
            </>
          ) : (
            <Empty>
              <EmptyHeader>
                <AudioWaveform className="text-muted-foreground mx-auto size-6" />
                <EmptyTitle>Waiting for takes</EmptyTitle>
                <EmptyDescription>Listen here as each take is ready.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      </div>
    </section>
  );
}
