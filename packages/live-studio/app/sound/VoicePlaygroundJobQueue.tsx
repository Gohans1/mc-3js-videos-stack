import { AudioWaveform, Check, CircleAlert, Clock3, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import type { PlaygroundJob, VoicePlaygroundItem } from "../../src/voice-playground.mjs";
import {
  openRecordingEditor,
  openSpeechComparison,
  recoverDialogueRecording,
  reviewDialogueJob,
  reviewSpeechJob,
  selectPlaygroundUid,
  setPlaygroundSubTab,
  switchPlaygroundTool,
} from "./voice-playground-client";
import { topLevelPlaygroundJobs } from "./voice-playground-view";

function elapsed(job: PlaygroundJob, now: number) {
  const seconds = Math.max(
    0,
    Math.floor(
      ((job.finishedAt ? Date.parse(job.finishedAt) : now) - Date.parse(job.createdAt)) / 1000,
    ),
  );
  return Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : "—";
}
export function VoicePlaygroundJobQueue({
  jobs: allJobs,
  items,
  onRecover,
}: {
  jobs: readonly PlaygroundJob[];
  items: readonly VoicePlaygroundItem[];
  onRecover?: () => void;
}) {
  const jobs = topLevelPlaygroundJobs(allJobs);
  const available = new Set(items.filter((item) => !item.archivedAt).map((item) => item.id));
  const active = jobs.filter((job) => job.status !== "completed" && job.status !== "failed");
  const completed = jobs.filter((job) => job.status === "completed").slice(0, 5);
  const failed = jobs.filter((job) => job.status === "failed");
  const batches = new Map<string, PlaygroundJob[]>();
  for (const job of jobs) {
    if (!job.batch) continue;
    const entries = batches.get(job.batch.id) ?? [];
    entries.push(job);
    batches.set(job.batch.id, entries);
  }
  for (const [id, entries] of batches) if (entries.length < 2) batches.delete(id);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active.length) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active.length]);
  if (!jobs.length) return null;
  return (
    <section
      aria-label="Generation queue"
      className="border-hairline bg-surface-subtle flex flex-col gap-2 rounded-lg border p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-foreground flex items-center gap-1.5 text-lg leading-tight font-semibold">
          <Clock3 className="size-4" />
          Generation queue
        </h3>
        <span className="text-muted-foreground text-xs tabular-nums">
          {active.length} running ·{" "}
          {
            jobs.filter(
              (job) => job.status === "completed" && job.itemId && available.has(job.itemId),
            ).length
          }{" "}
          ready
          {failed.length > 0 && ` · ${failed.length} ${failed.length === 1 ? "needs" : "need"} attention`}
        </span>
      </div>
      {batches.size > 0 && (
        <div className="border-hairline grid gap-2 border-b pb-3" aria-label="Speech batches">
          {[...batches].map(([id, entries]) => {
            const ready = entries.filter((job) => job.status === "completed").length;
            const errors = entries.filter((job) => job.status === "failed").length;
            const booked = entries.reduce((sum, job) => sum + (job.creditsDeducted ?? 0), 0);
            const confirmed = entries.every((job) => job.creditsSource === "history");
            return (
              <div
                key={id}
                className="border-hairline bg-card flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border p-3"
              >
                <AudioWaveform className="text-primary-text size-4 shrink-0" aria-hidden />
                <div className="min-w-36 grow">
                  <p className="text-foreground text-sm font-medium">
                    Speech batch · {entries.length} takes
                  </p>
                  <p className="text-muted-foreground text-xs tabular-nums">
                    {ready} ready · {entries.length - ready - errors} running
                    {errors > 0 && ` · ${errors} ${errors === 1 ? "needs" : "need"} attention`}
                    {confirmed ? ` · ${booked.toLocaleString()} credits` : " · Final fees pending"}
                  </p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => openSpeechComparison(id)}>
                  Open comparison
                </Button>
              </div>
            );
          })}
        </div>
      )}
      <div role="status" className="text-muted-foreground text-xs">
        {active.length
          ? "You can keep editing while these takes generate."
          : failed.length
            ? "Review the tasks needing attention. Your saved recordings are kept."
            : "All tasks finished."}
      </div>
      {active.map((job) => (
        <div key={job.id} className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-start gap-2">
            <Loader2 className="text-primary-text mt-0.5 size-3.5 flex-none animate-spin motion-reduce:animate-none" />
            <div className="min-w-0 flex-1">
              <p className="text-foreground text-sm font-medium break-words">{job.title}</p>
              <p className="text-muted-foreground text-xs break-words">
                {job.voiceName || job.voiceId} · {job.modelId}
              </p>
            </div>
            <span className="text-muted-foreground text-xs tabular-nums">{elapsed(job, now)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Badge variant="secondary">
              {job.status === "pending"
                ? "Waiting for server"
                : job.status === "downloading"
                  ? "Saving audio"
                  : job.kind === "region_edit"
                    ? "Editing audio"
                    : job.kind === "stt"
                      ? "Transcribing"
                      : "Generating"}
            </Badge>
            <span className="text-muted-foreground text-xs tabular-nums">
              {job.progress > 0 ? `${job.progress}%` : "Waiting for progress"}
            </span>
          </div>
          {job.progress > 0 && (
            <progress
              className="accent-primary h-1 w-full"
              value={Math.min(100, job.progress)}
              max={100}
              aria-label={`Progress for ${job.title}`}
            />
          )}
        </div>
      ))}
      {completed.length > 0 && (
        <details>
          <summary className="text-muted-foreground focus-visible:outline-ring cursor-pointer rounded text-xs focus-visible:outline-2">
            Recently completed ({completed.length})
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            {completed.map((job) => (
              <div key={job.id} className="flex items-center gap-2">
                <Check className="text-ok-text size-3.5 flex-none" />
                <span className="text-foreground min-w-0 flex-1 text-xs break-words">
                  {job.title} · {elapsed(job, now)}
                </span>
                {job.itemId && available.has(job.itemId) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      selectPlaygroundUid(`pg:${job.itemId}`);
                      setPlaygroundSubTab("inspect");
                    }}
                  >
                    Open take
                  </Button>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
      {failed.length > 0 && (
        <section aria-label="Failed generation tasks" className="flex flex-col gap-2">
          <h4 className="text-warn-text flex items-center gap-1.5 text-base leading-tight font-semibold tabular-nums">
            <CircleAlert className="size-4" />
            Needs attention ({failed.length})
          </h4>
          {failed.map((job) => {
            const { kind, regionEdit } = job;
            const replacementPhrase = Boolean(job.parentJobId);
            const original =
              regionEdit &&
              items.find(
                (item) =>
                  item.id === regionEdit.itemId &&
                  (item.scope ?? "project") === (job.scope ?? "project"),
              );
            return (
              <article
                key={job.id}
                className="border-warn-text/30 bg-warn-card flex min-w-0 flex-col gap-2 rounded-lg border p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h5 className="text-foreground text-sm font-semibold break-words">
                      {job.title}
                    </h5>
                    {job.voiceName && (
                      <p className="text-muted-foreground mt-0.5 text-sm">{job.voiceName}</p>
                    )}
                  </div>
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                    Failed · {elapsed(job, now)}
                  </span>
                </div>
                <p className="text-warn-text text-sm break-words">
                  {job.error ||
                    "No details were returned. Open the tool to review its source and settings."}
                </p>
                <p className="text-muted-foreground text-xs">
                  {kind === "region_edit"
                    ? !original
                      ? "The original recording is unavailable."
                      : regionEdit?.input.mode === "regenerate"
                        ? "The edit was not saved. A new generation may charge credits."
                        : "The edit was not saved. Reopen it to adjust the section."
                    : replacementPhrase
                      ? "The section edit is unavailable. Open its source recording to edit the section again."
                      : "Review settings before starting a new generation, which may charge credits."}
                </p>
                <div className="flex flex-wrap gap-2">
                  {kind === "region_edit" ? (
                    original &&
                    regionEdit && (
                      <Button
                        id={`voice-playground-reopen-${job.id}`}
                        size="sm"
                        variant="secondary"
                        onClick={(event) =>
                          openRecordingEditor(original, {
                            initialEdit: regionEdit.input,
                            failedJobId: job.id,
                            openerId: event.currentTarget.id,
                          })
                        }
                      >
                        Reopen section edit
                      </Button>
                    )
                  ) : !replacementPhrase ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        if (job.dialogueRecipe) {
                          reviewDialogueJob(job);
                          return;
                        }
                        if (kind === "tts" && job.generationRecipe) {
                          reviewSpeechJob(job);
                          return;
                        }
                        document
                          .getElementById(`voice-playground-nav-${kind}`)
                          ?.focus({ preventScroll: true });
                        switchPlaygroundTool(kind);
                      }}
                    >
                      {kind === "dialogue" && !job.dialogueRecipe
                        ? "Open Dialogue"
                        : kind === "tts" && !job.generationRecipe
                          ? "Open Speech"
                          : "Review settings"}
                    </Button>
                  ) : null}
                  {kind === "dialogue" && job.dialogueRecipe && job.remoteTaskId && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void recoverDialogueRecording(job)}
                    >
                      Recover saved audio
                    </Button>
                  )}
                  {onRecover &&
                    !replacementPhrase &&
                    job.remoteTaskId &&
                    !(kind === "dialogue" && job.dialogueRecipe) &&
                    kind !== "stt" &&
                    kind !== "region_edit" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          onRecover();
                        }}
                      >
                        Check Cloud recovery
                      </Button>
                    )}
                </div>
              </article>
            );
          })}
        </section>
      )}
    </section>
  );
}
