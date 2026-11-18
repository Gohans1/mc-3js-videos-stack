import { Check, CloudDownload, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

import type { CloudDubbingTask, DubbingJob } from "../../src/voice-playground-dubbing.mjs";
import {
  acceptDubbingJob,
  dubbingPost,
  loadCloudDubbing,
  loadDubbingJobs,
} from "./voice-dubbing-client";
import { openDubbingResult } from "./VoiceDubbingJobs";

const historyError = (cause: unknown) =>
  cause instanceof TypeError
    ? "Couldn’t load Dubbing history. Check your connection, then select Refresh cloud history."
    : "Couldn’t load Dubbing history. Select Refresh cloud history to try again.";

export function VoiceDubbingCloud({
  configured,
  jobs,
}: {
  configured: boolean;
  jobs: readonly DubbingJob[];
}) {
  const [tasks, setTasks] = useState<CloudDubbingTask[]>([]),
    [page, setPage] = useState(0),
    [hasMore, setHasMore] = useState(false),
    [loading, setLoading] = useState(configured),
    [importing, setImporting] = useState<string | null>(null),
    [error, setError] = useState("");
  const load = async (next = 0) => {
    setLoading(true);
    setError("");
    try {
      const data = await loadCloudDubbing("project", next);
      setTasks((old) =>
        next === 0
          ? data.tasks
          : [
              ...old,
              ...data.tasks.filter((task) => !old.some((existing) => existing.id === task.id)),
            ],
      );
      setPage(next);
      setHasMore(data.hasMore);
    } catch (cause) {
      setError(historyError(cause));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (!configured) return;
    let active = true;
    void loadCloudDubbing("project")
      .then((data) => {
        if (active) {
          setTasks(data.tasks);
          setPage(0);
          setHasMore(data.hasMore);
        }
      })
      .catch((cause) => {
        if (active) setError(historyError(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [configured]);
  const archive = async (task: CloudDubbingTask) => {
    setImporting(task.id);
    setError("");
    try {
      const { job } = await dubbingPost<{ job: DubbingJob }>("import", "project", {
        taskId: task.id,
      });
      acceptDubbingJob(job);
      await loadDubbingJobs();
      if (job.phase === "completed") await openDubbingResult(job);
    } catch (cause) {
      setError(
        cause instanceof TypeError
          ? "Couldn’t confirm the save. Check your connection and open Jobs to continue."
          : cause instanceof Error
            ? cause.message
            : "Saving was interrupted. Check Jobs to continue without generating again.",
      );
    } finally {
      setImporting(null);
    }
  };
  return (
    <section
      aria-label="Cloud Dubbing history"
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground max-w-prose text-sm leading-relaxed">
          Save cloud dubs to Recordings in this project. Copy them to Global from the saved
          recording.
        </p>
        <Button
          variant="secondary"
          disabled={!configured}
          aria-disabled={!configured || loading}
          onClick={() => {
            if (configured && !loading) void load();
          }}
        >
          {loading ? (
            <Loader2 className="animate-spin motion-reduce:animate-none" />
          ) : (
            <RefreshCw />
          )}
          Refresh cloud history
        </Button>
      </div>
      <p
        role="status"
        className={configured && !error ? "text-muted-foreground text-sm tabular-nums" : "sr-only"}
      >
        {configured && !error
          ? loading
            ? "Loading Dubbing history…"
            : tasks.length
              ? `${tasks.length} ${tasks.length === 1 ? "dub" : "dubs"} found`
              : "No Dubbing tasks found"
          : ""}
      </p>
      {error && (
        <p role="alert" className="text-warn-text text-sm leading-relaxed break-words">
          {error}
        </p>
      )}
      {!configured ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Connect GenVoice to check cloud history</EmptyTitle>
            <EmptyDescription>
              Open the API key control in the Workbench header. Saved local recordings are still
              available.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        tasks.map((task) => {
          const saved = jobs.find(
              (job) => job.taskId === task.id && job.phase === "completed" && job.itemId,
            ),
            complete = task.status === "completed" && Boolean(task.result?.audio_url),
            busy = importing === task.id;
          const createdAt = task.created_at ? Date.parse(task.created_at) : NaN;
          return (
            <article
              key={task.id}
              className="border-hairline bg-card flex flex-wrap items-start justify-between gap-4 rounded-lg border p-4"
            >
              <div className="min-w-0 flex-1">
                <h4 className="text-foreground text-base font-semibold break-words">
                  {task.metadata?.source_file_name || "Cloud Dubbing"}
                </h4>
                <p className="text-muted-foreground mt-1 text-sm">
                  {task.source_lang?.toUpperCase() || "Unknown source"} →{" "}
                  {task.target_lang?.toUpperCase() || "Unknown target"} ·{" "}
                  {task.metadata?.voice_name || task.voice_id || "Voice not reported"}
                </p>
                {Number.isFinite(createdAt) && (
                  <time
                    dateTime={task.created_at}
                    className="text-muted-foreground mt-1 block text-sm tabular-nums"
                  >
                    {new Date(createdAt).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "medium",
                    })}
                  </time>
                )}
                <p className="text-muted-foreground mt-2 text-sm tabular-nums">
                  Actual fee:{" "}
                  {typeof task.credits_deducted === "number"
                    ? `${task.credits_deducted.toLocaleString()} credits`
                    : "Unknown fee"}
                </p>
                <details className="mt-2">
                  <summary className="text-muted-foreground focus-visible:outline-ring cursor-pointer rounded text-sm focus-visible:outline-2">
                    Cloud task ID
                  </summary>
                  <p className="text-foreground mt-2 font-mono text-sm break-all select-text">
                    {task.id}
                  </p>
                  <p className="text-muted-foreground mt-1 max-w-[60ch] text-sm leading-relaxed text-pretty">
                    Compare the source, languages and voice before linking this ID in Jobs. Linking
                    does not generate.
                  </p>
                </details>
              </div>
              <div className="flex flex-col items-end gap-3">
                <Badge variant={saved ? "done" : "secondary"}>
                  {saved ? <Check /> : null}
                  {saved ? "Saved to Recordings" : task.status}
                </Badge>
                {saved || complete ? (
                  <Button
                    variant={saved ? "secondary" : "default"}
                    aria-disabled={Boolean(importing)}
                    onClick={() => {
                      if (importing) return;
                      if (saved) void openDubbingResult(saved);
                      else void archive(task);
                    }}
                  >
                    {busy ? (
                      <Loader2 className="animate-spin motion-reduce:animate-none" />
                    ) : (
                      <CloudDownload />
                    )}
                    {saved
                      ? "Open recording"
                      : busy
                        ? "Saving media…"
                        : "Save to Recordings · free"}
                  </Button>
                ) : (
                  <p className="text-muted-foreground max-w-[32ch] text-right text-sm text-pretty">
                    {task.status === "failed"
                      ? "Dubbing failed. Check Jobs for recovery options."
                      : task.status === "completed"
                        ? "Audio unavailable. Refresh to check for audio."
                        : task.status === "cancelled" || task.status === "canceled"
                          ? "Dubbing was canceled."
                          : task.status === "expired"
                            ? "Cloud audio has expired."
                            : "Still processing. Refresh to check progress."}
                  </p>
                )}
              </div>
            </article>
          );
        })
      )}
      {hasMore && (
        <Button variant="secondary" disabled={loading} onClick={() => void load(page + 1)}>
          {loading ? "Loading…" : "Load more Dubbing history"}
        </Button>
      )}
    </section>
  );
}
