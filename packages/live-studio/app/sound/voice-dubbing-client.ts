import { useEffect, useSyncExternalStore } from "react";

import type {
  CloudDubbingTask,
  DubbingJob,
  DubbingSource,
} from "../../src/voice-playground-dubbing.mjs";

export type DubbingScope = "project" | "global";
type Transport = typeof fetch;
const terminal = new Set<DubbingJob["phase"]>([
  "completed",
  "failed",
  "uncertain",
  "unavailable",
  "download_interrupted",
  "upload_interrupted",
  "prepared",
]);

export async function dubbingRequest<T>(
  path: string,
  scope: DubbingScope = "project",
  init: RequestInit = {},
  fetchImpl: Transport = fetch,
): Promise<T> {
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetchImpl(
    `/api/voice/playground/dubbing${path.startsWith("?") ? path : path ? `/${path}` : ""}${separator}scope=${scope}`,
    init,
  );
  const text = await response.text();
  let data: Record<string, unknown>;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw Error(
      response.ok
        ? "Invalid Dubbing response. Check status before submitting again."
        : `Dubbing request failed (${response.status}). Check the saved task before retrying.`,
    );
  }
  if (!response.ok)
    throw Error(
      typeof data.error === "string" ? data.error : `Dubbing request failed (${response.status})`,
    );
  return data as T;
}

export const dubbingPost = <T>(
  path: string,
  scope: DubbingScope,
  body?: unknown,
  signal?: AbortSignal,
) =>
  dubbingRequest<T>(path, scope, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal,
  });

export async function stageDubbingUpload(
  file: File,
  scope: DubbingScope,
  {
    sourceId,
    onProgress,
    signal,
    fetchImpl = fetch,
  }: {
    sourceId?: string;
    onProgress?: (source: DubbingSource) => void;
    signal?: AbortSignal;
    fetchImpl?: Transport;
  } = {},
) {
  signal?.throwIfAborted();
  let { source } = sourceId
    ? await dubbingRequest<{ source: DubbingSource }>(
        `sources/${encodeURIComponent(sourceId)}`,
        scope,
        { signal },
        fetchImpl,
      )
    : await dubbingRequest<{ source: DubbingSource }>(
        "sources",
        scope,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            bytes: file.size,
            lastModified: file.lastModified,
          }),
          signal,
        },
        fetchImpl,
      );
  if (
    source.filename !== file.name ||
    source.bytes !== file.size ||
    source.lastModified !== file.lastModified
  )
    throw Error("Choose the same original file to resume, or start a new upload.");
  onProgress?.(source);
  if (source.phase === "prepared") return source;
  for (let index = 0; index < Math.ceil(file.size / source.chunkSize); index++) {
    signal?.throwIfAborted();
    if (source.uploaded.includes(index)) continue;
    ({ source } = await dubbingRequest<{ source: DubbingSource }>(
      `sources/${encodeURIComponent(source.id)}/chunks/${index}`,
      scope,
      {
        method: "PUT",
        body: file.slice(
          index * source.chunkSize,
          Math.min(file.size, (index + 1) * source.chunkSize),
        ),
        signal,
      },
      fetchImpl,
    ));
    onProgress?.(source);
  }
  signal?.throwIfAborted();
  ({ source } = await dubbingRequest<{ source: DubbingSource }>(
    `sources/${encodeURIComponent(source.id)}/complete`,
    scope,
    { method: "POST", signal },
    fetchImpl,
  ));
  onProgress?.(source);
  return source;
}

type DubbingLoadState =
  | { status: "idle"; jobs: DubbingJob[] }
  | { status: "loading"; jobs: DubbingJob[]; promise: Promise<void> }
  | { status: "error"; jobs: DubbingJob[]; error: string };

type DubbingState = { jobs: DubbingJob[]; loading: boolean; error: string | null };
let loadState: DubbingLoadState = { status: "idle", jobs: [] };
const toSnapshot = (s: DubbingLoadState): DubbingState => ({
  jobs: s.jobs,
  loading: s.status === "loading",
  error: s.status === "error" ? s.error : null,
});
let state: DubbingState = toSnapshot(loadState);
const listeners = new Set<() => void>(),
  notified = new Set<string>();
const notices = new Set<(message: string) => void>();
export const onDubbingNotice = (listener: (message: string) => void) => {
  notices.add(listener);
  return () => {
    notices.delete(listener);
  };
};
const setLoadState = (next: DubbingLoadState) => {
  loadState = next;
  state = toSnapshot(next);
  listeners.forEach((listener) => listener());
};
export const dubbingSnapshot = () => state;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function acceptDubbingJob(job: DubbingJob, notify = true) {
  const old = loadState.jobs.find((row) => row.id === job.id);
  if (old && old.updatedAt > job.updatedAt) return;
  const jobs = [...loadState.jobs.filter((row) => row.id !== job.id), job].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  setLoadState({ ...loadState, jobs });
  if (!notify) {
    if (terminal.has(job.phase)) notified.add(`${job.id}:${job.phase}`);
    return;
  }
  if (
    old &&
    !terminal.has(old.phase) &&
    ["completed", "failed", "uncertain", "download_interrupted"].includes(job.phase) &&
    !notified.has(`${job.id}:${job.phase}`)
  ) {
    notified.add(`${job.id}:${job.phase}`);
    const message =
      job.phase === "completed"
        ? `Dubbing ready: ${job.sourceName || "Recording"} → ${job.settings.targetLanguage}. Open it in Jobs.`
        : `Dubbing needs attention: ${job.error || job.phase}. Open Jobs for recovery.`;
    notices.forEach((listener) => listener(message));
  }
}

export function loadDubbingJobs() {
  if (loadState.status === "loading") return loadState.promise;
  const promise = dubbingRequest<{ jobs: DubbingJob[] }>("?includeGlobal=1")
    .then(({ jobs }) => {
      for (const job of jobs ?? [])
        acceptDubbingJob(
          job,
          loadState.jobs.some((old) => old.id === job.id),
        );
      setLoadState({ status: "idle", jobs: loadState.jobs });
    })
    .catch((error) =>
      setLoadState({
        status: "error",
        jobs: loadState.jobs,
        error: error instanceof Error ? error.message : "Unable to load Dubbing jobs",
      }),
    );
  setLoadState({ status: "loading", jobs: loadState.jobs, promise });
  return promise;
}

export function useDubbingJobs(enabled = true) {
  const snapshot = useSyncExternalStore(subscribe, dubbingSnapshot, dubbingSnapshot);
  useEffect(() => {
    if (enabled) void loadDubbingJobs();
  }, [enabled]);
  useEffect(() => {
    if (
      !enabled ||
      !snapshot.jobs.some(
        (job) =>
          !terminal.has(job.phase) &&
          Date.now() - Date.parse(job.submittedAt || job.createdAt) < 30 * 60_000,
      )
    )
      return;
    const timer = setInterval(() => void loadDubbingJobs(), 4000);
    return () => clearInterval(timer);
  }, [enabled, snapshot.jobs]);
  return snapshot;
}

export const loadCloudDubbing = (scope: DubbingScope, page = 0) =>
  dubbingRequest<{ tasks: CloudDubbingTask[]; hasMore: boolean }>(
    `cloud?page=${page}&pageSize=30`,
    scope,
  );
