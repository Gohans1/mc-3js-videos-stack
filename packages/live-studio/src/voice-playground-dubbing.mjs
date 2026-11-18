import { basename, extname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { parseDubbingTask } from "./voice-playground-dubbing-contract.ts";
import { createDubbingJobs } from "./voice-playground-dubbing-jobs.mjs";
import { createDubbingArchiver, probeDubbingMedia } from "./voice-playground-dubbing-media.mjs";
import { createDubbingSources } from "./voice-playground-dubbing-sources.mjs";

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const safeTask = (id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(id);
export function createPlaygroundDubbing({
  scope,
  projectKey,
  storageDir,
  metadata,
  shared,
  request,
  download,
  saveItem,
  apiBase,
  getController,
  assertVoiceAvailable = () => {},
  emit = () => {},
  pollMs = 3000,
  maxWatchMs = 30 * 60_000,
  ensureStorage = () => {},
}) {
  let library,
    closed = false;
  const shutdown = new AbortController(),
    pending = new Map(),
    sourceCopies = new Map();
  const bindings = () => shared().list("dubbing-bindings");
  const visible = (taskId) => {
    const owned = bindings().filter((binding) => binding.taskId === taskId);
    return (
      !owned.length ||
      owned.some(
        (binding) =>
          binding.scope === "global" || (scope === "project" && binding.projectKey === projectKey),
      ) ||
      shared()
        .list("items")
        .some((item) => item.dubbing?.taskId === taskId)
    );
  };
  const requireVisible = (taskId) => {
    if (!safeTask(taskId)) throw fail("Invalid Dubbing task ID");
    if (!visible(taskId))
      throw fail(
        "This Dubbing belongs to another project; add its recording to Global there first",
        403,
      );
  };
  const deleted = (taskId) =>
    shared()
      .list("dubbing-deletions")
      .some((row) => row.taskId === taskId);
  const getLibrary = () => {
    if (closed) throw new Error("Dubbing workspace closed; continue from saved progress");
    if (library) return library;
    ensureStorage();
    const sources = createDubbingSources({
      dir: storageDir,
      store: metadata(),
      probe: probeDubbingMedia,
      isClosed: () => closed,
    });
    const archive = createDubbingArchiver({
      dir: storageDir,
      scope,
      sourceFor: async (job, options) => {
        if (!job.settings.sourceId) return undefined;
        const source = await sources.inspect(job.settings.sourceId, options);
        return { ...source, path: sources.path(source.id) };
      },
      download,
      saveItem: async (item) => {
        if (closed) throw Error("Dubbing workspace closed");
        return saveItem(item);
      },
      apiBase,
    });
    const jobs = createDubbingJobs({
      store: metadata(),
      sources,
      request,
      archive,
      isClosed: () => closed,
      emit: (payload) => emit({ ...payload, job: { ...payload.job, scope } }),
      onBind: (job) =>
        shared().mutate("dubbing-bindings", (rows) => {
          const binding = { taskId: job.taskId, jobId: job.id, scope, projectKey };
          const index = rows.findIndex(
            (row) => row.jobId === job.id && row.scope === scope && row.projectKey === projectKey,
          );
          if (index < 0) rows.push(binding);
          else rows[index] = binding;
        }),
    });
    return (library = { sources, jobs });
  };
  const scoped = (job) =>
    job
      ? {
          ...job,
          scope,
          ...(job.taskId && deleted(job.taskId) && job.phase !== "completed"
            ? {
                phase: "unavailable",
                error: "Cloud task deleted; archived recordings and sources are kept",
              }
            : {}),
        }
      : undefined;
  const getDubbing = (id) => scoped(getLibrary().jobs.get(id));
  const refreshDubbing = async (id, options = {}) => {
    const job = getDubbing(id);
    if (!job) throw fail("Dubbing job not found in this library", 404);
    if (job.phase === "unavailable") return job;
    return scoped(await getLibrary().jobs.refresh(id, options));
  };
  const watch = async (id, signal) => {
    while (!closed) {
      const job = await refreshDubbing(id, { signal });
      if (["completed", "failed", "uncertain", "unavailable"].includes(job.phase)) return job;
      await delay(pollMs, undefined, { signal });
    }
  };
  const schedule = (id, work) => {
    if (pending.has(id)) throw fail("This Dubbing is already running", 409);
    const signal = AbortSignal.any([shutdown.signal, AbortSignal.timeout(maxWatchMs)]);
    const operation = work(signal)
      .then((job) =>
        job.taskId && !["failed", "uncertain"].includes(job.phase) ? watch(id, signal) : job,
      )
      .catch((error) => {
        if (!closed) emit({ type: "dubbing-observation", id, error: error.message, scope });
      })
      .finally(() => pending.delete(id));
    pending.set(id, operation);
    return getDubbing(id);
  };
  const listDubbing = ({ includeGlobal = false } = {}) => [
    ...getLibrary().jobs.list().map(scoped),
    ...(includeGlobal && scope === "project"
      ? getController().forScope("global").listDubbing()
      : []),
  ];
  const prepareDubbing = (input) => {
    assertVoiceAvailable(input.provider ?? "minimax", input.voiceId);
    return scoped(getLibrary().jobs.prepare(input));
  };
  const submitDubbing = (id) => {
    const job = getDubbing(id);
    if (!job) throw fail("Dubbing job not found in this library", 404);
    if (!["prepared", "upload_interrupted"].includes(job.phase))
      throw fail(
        "This dubbing was already submitted; inspect its saved task before paying again",
        409,
      );
    return schedule(id, (signal) => getLibrary().jobs.submit(id, { signal }));
  };
  const listCloudDubbing = async ({ page = 0, pageSize = 30 } = {}) => {
    const { data } = await request(`/aidubbing/history?page_size=${pageSize}&page=${page}`);
    if (!Array.isArray(data.tasks)) throw Error("Invalid Dubbing history response");
    return {
      tasks: data.tasks
        .map(parseDubbingTask)
        .filter((task) => safeTask(task.id) && visible(task.id) && !deleted(task.id)),
      hasMore: Boolean(data.has_more),
    };
  };
  const importDubbing = async (taskId, options = {}) => {
    requireVisible(taskId);
    if (deleted(taskId)) throw fail("This cloud task was deleted; use its local recording");
    const { data } = await request(`/aidubbing/history/${taskId}`, { signal: options.signal });
    options.signal?.throwIfAborted();
    if (data.id !== taskId) throw Error("Dubbing history returned another task");
    const job = getLibrary().jobs.adopt(data);
    return refreshDubbing(job.id, options);
  };
  const linkDubbing = async (id, taskId, options = {}) => {
    requireVisible(taskId);
    return scoped(await getLibrary().jobs.link(id, taskId, options));
  };
  const retryDubbing = async (id, options = {}) => {
    const job = getDubbing(id);
    if (!job) throw fail("Dubbing job not found", 404);
    if (deleted(job.taskId))
      throw fail("Cloud task deleted; generate a new dubbing from its saved source");
    const retry = await getLibrary().jobs.retry(id, options);
    return retry.phase === "processing" ? schedule(retry.id, async () => retry) : scoped(retry);
  };
  const deleteCloudDubbing = async (id) => {
    const job = getDubbing(id);
    if (!job) throw fail("Dubbing job not found", 404);
    requireVisible(job.taskId);
    if (!deleted(job.taskId))
      await request(`/aidubbing/history/${job.taskId}`, { method: "DELETE" });
    shared().mutate("dubbing-deletions", (rows) => {
      if (!rows.some((row) => row.taskId === job.taskId))
        rows.push({ taskId: job.taskId, deletedAt: new Date().toISOString() });
    });
    emit({ type: "dubbing", job: getDubbing(id) });
    return getDubbing(id);
  };
  const stageDubbingFile = async (file, { sourceId, sourceRef, signal } = {}) => {
    signal?.throwIfAborted();
    const sources = getLibrary().sources;
    const source = sourceId
      ? sources.get(sourceId)
      : await sources.init({
          filename: file.name,
          bytes: file.size,
          lastModified: file.lastModified,
          sourceRef,
        });
    if (
      !source ||
      source.filename !== file.name ||
      source.bytes !== file.size ||
      (source.lastModified !== undefined &&
        file.lastModified !== undefined &&
        source.lastModified !== file.lastModified)
    )
      throw fail("Reselect the same original file to continue uploading");
    if (source.phase === "prepared") return source;
    for (let index = 0; index < Math.ceil(file.size / source.chunkSize); index++) {
      signal?.throwIfAborted();
      if (!source.uploaded.includes(index))
        await sources.append(
          source.id,
          index,
          file.slice(index * source.chunkSize, Math.min(file.size, (index + 1) * source.chunkSize)),
        );
    }
    signal?.throwIfAborted();
    return sources.complete(source.id);
  };
  const stageDubbingRecording = (itemId, { asset = "audio", signal } = {}) => {
    const sourceRef = `${itemId}:${asset}`;
    if (sourceCopies.has(sourceRef)) return sourceCopies.get(sourceRef);
    const operation = (async () => {
      signal?.throwIfAborted();
      const sources = getLibrary().sources;
      const existing = sources.list().find((source) => source.sourceRef === sourceRef);
      if (existing?.phase === "prepared") return existing;
      const controller = getController(),
        item = controller.getItem(itemId);
      if (!item) throw fail("Recording not found in this library", 404);
      const path =
        asset === "source"
          ? controller.dubbingAsset(itemId, "source")
          : controller.audioFile(item.audioFile);
      if (!path || !(await Bun.file(path).exists()))
        throw fail("This recording has no saved source for Dubbing", 404);
      const data = Bun.file(path);
      const readableName =
        asset === "source" && item.dubbing?.sourceName
          ? basename(item.dubbing.sourceName)
          : `${String(item.title || item.id)
              .replace(/[<>:"/\\|?*]/g, " ")
              .trim()
              .slice(0, 160)}${extname(path)}`;
      return stageDubbingFile(new File([data], readableName, { lastModified: data.lastModified }), {
        sourceId: existing?.id,
        sourceRef,
        signal,
      });
    })().finally(() => sourceCopies.delete(sourceRef));
    sourceCopies.set(sourceRef, operation);
    return operation;
  };
  const retainDubbingTemplateSource = async (draft) => {
    const id = draft.dubbing?.sourceId;
    if (!id || getLibrary().sources.get(id)?.phase === "prepared") return draft;
    const other = getController().forScope(scope === "project" ? "global" : "project");
    const source = other.getDubbingSource(id);
    if (source?.phase !== "prepared")
      throw fail("Original Dubbing template source is unavailable; select its file again");
    const copy = await stageDubbingFile(
      new File([Bun.file(other.dubbingSourcePath(id))], source.filename, {
        lastModified: source.lastModified,
      }),
    );
    return { ...draft, dubbing: { ...draft.dubbing, sourceId: copy.id } };
  };
  const stageDubbingSourceCopy = (id, sourceScope, { signal } = {}) => {
    const sourceRef = `source:${sourceScope}:${id}`;
    if (sourceCopies.has(sourceRef)) return sourceCopies.get(sourceRef);
    const operation = (async () => {
      signal?.throwIfAborted();
      const existing = getLibrary()
        .sources.list()
        .find((source) => source.sourceRef === sourceRef);
      if (existing?.phase === "prepared") return existing;
      const other = getController().forScope(sourceScope),
        source = other.getDubbingSource(id);
      if (source?.phase !== "prepared")
        throw fail("The original source is unavailable; choose its file again", 404);
      if (sourceScope === scope) return source;
      return stageDubbingFile(
        new File([Bun.file(other.dubbingSourcePath(id))], source.filename, {
          lastModified: source.lastModified,
        }),
        { sourceId: existing?.id, sourceRef, signal },
      );
    })().finally(() => sourceCopies.delete(sourceRef));
    sourceCopies.set(sourceRef, operation);
    return operation;
  };
  return {
    getDubbing,
    listDubbing,
    prepareDubbing,
    submitDubbing,
    refreshDubbing,
    listCloudDubbing,
    importDubbing,
    linkDubbing,
    retryDubbing,
    deleteCloudDubbing,
    stageDubbingFile,
    stageDubbingRecording,
    stageDubbingSourceCopy,
    retainDubbingTemplateSource,
    initDubbingSource: (input) => getLibrary().sources.init(input),
    getDubbingSource: (id) => getLibrary().sources.get(id),
    appendDubbingSource: (id, index, chunk) => getLibrary().sources.append(id, index, chunk),
    completeDubbingSource: (id) => getLibrary().sources.complete(id),
    dubbingSourcePath: (id) => getLibrary().sources.path(id),
    waitForDubbing: () => Promise.allSettled(pending.values()),
    closeDubbing: () => {
      closed = true;
      shutdown.abort(new Error("Dubbing workspace closed; continue from saved progress"));
    },
  };
}
