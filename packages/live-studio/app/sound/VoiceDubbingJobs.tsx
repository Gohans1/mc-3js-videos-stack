import {
  Check,
  Clock3,
  CloudDownload,
  ExternalLink,
  Link,
  Loader2,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import type { DubbingJob } from "../../src/voice-playground-dubbing.mjs";
import { say } from "../core/store";
import {
  acceptDubbingJob,
  dubbingPost,
  dubbingRequest,
  loadDubbingJobs,
} from "./voice-dubbing-client";
import {
  loadPlaygroundAll,
  selectPlaygroundUid,
  setComposerDraft,
  setPlaygroundFilters,
  setPlaygroundScope,
  setPlaygroundSubTab,
} from "./voice-playground-client";
import { DEFAULT_PLAYGROUND_FILTERS } from "./voice-playground-view";

export const DUBBING_PHASE_LABELS: Record<DubbingJob["phase"], string> = {
  prepared: "Quote prepared · not submitted",
  uploading: "Uploading to GenVoice",
  upload_interrupted: "Upload paused",
  submitting: "Confirming submission",
  processing: "Dubbing",
  retrying: "Confirming paid repeat",
  uncertain: "Submission unconfirmed",
  failed: "Failed",
  downloading: "Saving media",
  download_interrupted: "Saving interrupted",
  completed: "Ready",
  unavailable: "Cloud task unavailable",
};
const runningPhases = new Set<DubbingJob["phase"]>([
  "uploading",
  "submitting",
  "processing",
  "retrying",
  "downloading",
]);
export function reuseDubbingJob(job: DubbingJob) {
  const { modelId, ...dubbing } = job.settings;
  setPlaygroundScope(job.scope);
  setComposerDraft((current) => ({
    ...current,
    mode: "dubbing",
    dubbing,
    dubbingSourceScope: job.scope,
    provider: dubbing.provider,
    modelId,
    voiceId: dubbing.ttsVoiceId || (dubbing.provider === "minimax" ? "" : dubbing.voiceId),
    voiceName: dubbing.voiceName || dubbing.voiceId,
  }));
  setPlaygroundSubTab("create");
}
export async function openDubbingResult(job: DubbingJob) {
  if (!job.itemId) return;
  await loadPlaygroundAll({ refresh: true });
  setPlaygroundFilters(DEFAULT_PLAYGROUND_FILTERS);
  selectPlaygroundUid(`pg:${job.itemId}`);
  setPlaygroundSubTab("inspect");
}

type DubbingRowAction =
  | { kind: "idle"; error: string }
  | { kind: "confirming"; action: "submit" | "retry" | "delete" }
  | {
      kind: "running";
      action: "refresh" | "submit" | "retry" | "delete" | "link";
      fromConfirm?: "submit" | "retry" | "delete";
    };

function DubbingJobRow({ job, now }: { job: DubbingJob; now: number }) {
  const [rowAction, setRowAction] = useState<DubbingRowAction>({ kind: "idle", error: "" }),
    [taskId, setTaskId] = useState("");
  const operation = rowAction.kind === "running" ? rowAction.action : null;
  const confirm =
    rowAction.kind === "confirming"
      ? rowAction.action
      : rowAction.kind === "running"
        ? (rowAction.fromConfirm ?? null)
        : null;
  const error = rowAction.kind === "idle" ? rowAction.error : "";
  const active = runningPhases.has(job.phase),
    seconds = Math.max(
      0,
      Math.floor(
        ((active ? now : Date.parse(job.updatedAt)) -
          Date.parse(job.submittedAt || job.createdAt)) /
          1000,
      ),
    );
  const cost =
    typeof job.estimatedCredits === "number"
      ? `${job.estimatedCredits.toLocaleString()} credits`
      : "an unknown fee";
  const act = async (
    action: "refresh" | "submit" | "retry" | "delete" | "link",
    fromConfirm?: "submit" | "retry" | "delete",
  ) => {
    setRowAction({ kind: "running", action, ...(fromConfirm ? { fromConfirm } : {}) });
    let nextError = "";
    try {
      const result =
        action === "delete"
          ? await dubbingRequest<{ job: DubbingJob }>(
              `${encodeURIComponent(job.id)}/cloud`,
              job.scope,
              { method: "DELETE" },
            )
          : await dubbingPost<{ job: DubbingJob }>(
              `${encodeURIComponent(job.id)}/${action}`,
              job.scope,
              action === "link" ? { taskId: taskId.trim() } : undefined,
            );
      acceptDubbingJob(result.job);
      await loadDubbingJobs();
      say(
        action === "refresh"
          ? "Dubbing status checked. No new generation charge."
          : action === "delete"
            ? "Cloud task deleted. Local media is kept."
            : "Saved Dubbing updated.",
      );
    } catch (cause) {
      nextError =
        cause instanceof Error
          ? cause.message
          : "Unable to update this task. Check status before another paid attempt.";
      await loadDubbingJobs();
    } finally {
      setRowAction({ kind: "idle", error: nextError });
    }
  };
  return (
    <article
      className="border-hairline bg-card rounded-lg border p-4"
      aria-label={`Dubbing ${job.sourceName || job.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-foreground text-base font-semibold break-words">
            {job.sourceName || "Saved Dubbing"}
          </h4>
          <p className="text-muted-foreground mt-1 text-sm">
            {job.settings.sourceLanguage?.toUpperCase()} →{" "}
            {job.settings.targetLanguage?.toUpperCase()} ·{" "}
            {job.settings.voiceName || job.settings.voiceId}
          </p>
        </div>
        <Badge
          variant={
            job.phase === "completed"
              ? "done"
              : job.phase === "failed" || job.phase === "uncertain"
                ? "check"
                : "secondary"
          }
        >
          {job.phase === "completed" ? (
            <Check />
          ) : active ? (
            <Loader2 className="animate-spin motion-reduce:animate-none" />
          ) : (
            <Clock3 />
          )}
          {DUBBING_PHASE_LABELS[job.phase]}
        </Badge>
      </div>
      <div className="text-muted-foreground mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm tabular-nums">
        <span>{job.scope === "global" ? "Global" : "This project"}</span>
        <span>
          {active ? "Processing · " : "Processing time · "}
          {Math.floor(seconds / 60)}m {seconds % 60}s
        </span>
        <span>
          Estimate:{" "}
          {typeof job.estimatedCredits === "number"
            ? `${job.estimatedCredits.toLocaleString()} cr`
            : "Unknown fee"}
        </span>
        <span className="text-foreground">
          Actual:{" "}
          {typeof job.creditsDeducted === "number"
            ? `${job.creditsDeducted.toLocaleString()} cr`
            : "Not reported"}
        </span>
      </div>
      {active && job.progress > 0 && (
        <div className="mt-3 flex items-center gap-3">
          <progress
            value={Math.min(100, job.progress)}
            max={100}
            aria-label={`Progress for ${job.sourceName || "Dubbing"}`}
            className="accent-primary h-2 flex-1"
          />
          <span className="text-muted-foreground text-sm tabular-nums">
            {job.progress}% reported
          </span>
        </div>
      )}
      {job.error && (
        <p className="text-warn-text mt-3 text-sm leading-relaxed break-words">{job.error}</p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {job.phase === "completed" && job.itemId && (
          <Button
            size="sm"
            variant={confirm ? "secondary" : "default"}
            onClick={() => void openDubbingResult(job)}
          >
            Open recording
            <ExternalLink />
          </Button>
        )}
        {job.taskId && job.phase !== "unavailable" && (
          <Button
            size="sm"
            variant="secondary"
            disabled={Boolean(operation)}
            onClick={() => void act("refresh")}
          >
            {operation === "refresh" ? (
              <Loader2 className="animate-spin motion-reduce:animate-none" />
            ) : (
              <RefreshCw />
            )}
            {job.phase === "download_interrupted" ? "Resume saving · free" : "Check status · free"}
          </Button>
        )}
        {["prepared", "upload_interrupted"].includes(job.phase) && (
          <Button
            size="sm"
            variant="secondary"
            disabled={Boolean(operation)}
            onClick={() => setRowAction({ kind: "confirming", action: "submit" })}
          >
            {job.phase === "prepared"
              ? "Submit this quote · paid"
              : "Continue upload · paid submission"}
          </Button>
        )}
        {job.settings.sourceId && (
          <Button size="sm" variant="ghost" onClick={() => reuseDubbingJob(job)}>
            Reuse source & settings
          </Button>
        )}
      </div>
      {job.phase === "uncertain" && (
        <details className="border-hairline mt-4 border-t pt-3">
          <summary className="focus-visible:outline-ring cursor-pointer rounded text-sm font-medium focus-visible:outline-2">
            Find and link the existing cloud task
          </summary>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
            Check Cloud recovery for the matching source, languages and voice. Linking checks the
            saved task and does not submit another generation.
          </p>
          <FieldGroup className="mt-3">
            <Field>
              <FieldLabel htmlFor={`${job.id}-link`}>Existing GenVoice task ID</FieldLabel>
              <Input
                id={`${job.id}-link`}
                value={taskId}
                onChange={(event) => setTaskId(event.target.value)}
                placeholder="829ed5ec-8ad3-47ee-9fc2-9485ca31ef8f"
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setPlaygroundSubTab("remote")}>
                <CloudDownload />
                Open Cloud recovery
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!taskId.trim() || Boolean(operation)}
                onClick={() => void act("link")}
              >
                <Link />
                Link task · free
              </Button>
            </div>
          </FieldGroup>
        </details>
      )}
      {job.taskId && !active && job.phase !== "unavailable" && (
        <details className="border-hairline mt-4 border-t pt-3">
          <summary className="text-muted-foreground focus-visible:outline-ring cursor-pointer rounded text-sm focus-visible:outline-2">
            Paid repeat & cloud cleanup
          </summary>
          <p className="text-muted-foreground mt-2 max-w-[60ch] text-sm leading-relaxed text-pretty">
            A paid repeat updates the same cloud task; earlier local recordings stay unchanged.
            Deleting the cloud task affects its links in Project and Global; local files remain.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={Boolean(operation)}
              onClick={() => setRowAction({ kind: "confirming", action: "retry" })}
            >
              <RotateCcw />
              Repeat original Dubbing · paid
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={Boolean(operation)}
              onClick={() => setRowAction({ kind: "confirming", action: "delete" })}
            >
              Delete cloud task…
            </Button>
          </div>
        </details>
      )}
      {confirm && (
        <Alert variant="warn" className="mt-4">
          <AlertTitle>
            {confirm === "delete"
              ? "Delete this provider task and its cloud files?"
              : `${confirm === "retry" ? "Repeat" : "Start"} dubbing for “${job.sourceName || "saved source"}”?`}
          </AlertTitle>
          <AlertDescription>
            {confirm === "delete"
              ? "Project and Global links share this task. Local recordings, source files and earlier versions remain."
              : `GenVoice may charge even if dubbing fails. ${typeof job.estimatedCredits === "number" ? `The estimated charge is ${cost}.` : "The total fee is unknown."}`}
          </AlertDescription>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={confirm === "delete" ? "destructive" : "default"}
              disabled={Boolean(operation)}
              onClick={() => void act(confirm, confirm)}
            >
              {operation ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : null}
              {confirm === "delete"
                ? "Delete cloud task"
                : confirm === "retry"
                  ? "Repeat paid dubbing"
                  : "Start paid dubbing"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={Boolean(operation)}
              onClick={() => setRowAction({ kind: "idle", error: "" })}
            >
              Cancel
            </Button>
          </div>
        </Alert>
      )}
      {error && (
        <p role="alert" className="text-warn-text mt-3 text-sm leading-relaxed break-words">
          {error}
        </p>
      )}
    </article>
  );
}

export function VoiceDubbingJobs({
  jobs,
  compact = false,
}: {
  jobs: readonly DubbingJob[];
  compact?: boolean;
}) {
  const [now, setNow] = useState(Date.now),
    active = jobs.some((job) => runningPhases.has(job.phase));
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  const submitted = jobs.filter((job) => job.phase !== "prepared"),
    quotes = jobs.filter((job) => job.phase === "prepared");
  if (compact)
    return submitted.length ? (
      <section aria-label="Dubbing progress" className="flex flex-col gap-3">
        <h4 className="text-foreground text-sm font-semibold">Dubbing progress</h4>
        {submitted.slice(0, 3).map((job) => (
          <div key={job.id} className="border-hairline flex flex-col gap-2 rounded-lg border p-3">
            <div className="flex items-start justify-between gap-2">
              <span className="text-foreground min-w-0 text-sm font-medium break-words">
                {job.sourceName || "Dubbing"}
              </span>
              {runningPhases.has(job.phase) && (
                <Loader2 className="text-primary-text size-4 flex-none animate-spin motion-reduce:animate-none" />
              )}
            </div>
            <p className="text-muted-foreground text-sm">
              {DUBBING_PHASE_LABELS[job.phase]} ·{" "}
              {Math.max(
                0,
                Math.floor(
                  ((runningPhases.has(job.phase) ? now : Date.parse(job.updatedAt)) -
                    Date.parse(job.submittedAt || job.createdAt)) /
                    1000,
                ),
              )}
              s
            </p>
            {job.error && (
              <p className="text-warn-text text-sm leading-relaxed break-words">{job.error}</p>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                job.phase === "completed"
                  ? void openDubbingResult(job)
                  : setPlaygroundSubTab("jobs")
              }
            >
              {job.phase === "completed" ? "Open result" : "Open saved job"}
            </Button>
          </div>
        ))}
      </section>
    ) : null;
  return (
    <section aria-label="Dubbing jobs" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-foreground text-lg leading-tight font-semibold">Dubbing</h3>
        <Button variant="secondary" size="sm" onClick={() => void loadDubbingJobs()}>
          <RefreshCw />
          Refresh saved jobs
        </Button>
      </div>
      {!jobs.length ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No Dubbing jobs yet</EmptyTitle>
            <EmptyDescription>
              Choose an original recording and prepare a quote in Dubbing. Uploading and quoting are
              free.
            </EmptyDescription>
          </EmptyHeader>
          <Button
            variant="secondary"
            onClick={() => {
              setComposerDraft({ mode: "dubbing" });
              setPlaygroundSubTab("create");
            }}
          >
            Open Dubbing
          </Button>
        </Empty>
      ) : (
        submitted.map((job) => <DubbingJobRow key={job.id} job={job} now={now} />)
      )}
      {quotes.length > 0 && (
        <details className="border-hairline rounded-lg border p-4">
          <summary className="focus-visible:outline-ring cursor-pointer rounded text-sm font-medium focus-visible:outline-2">
            Prepared quotes · {quotes.length} not submitted
          </summary>
          <div className="mt-4 flex flex-col gap-3">
            {quotes.map((job) => (
              <DubbingJobRow key={job.id} job={job} now={now} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
