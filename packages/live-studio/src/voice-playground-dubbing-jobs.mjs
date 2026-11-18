import { randomUUID } from "node:crypto";

import { uploadDubbingSource } from "./voice-playground-dubbing-upload.mjs";

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const safeTaskId = (id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(id);
import {
  DUBBING_CAPCUT_LANGUAGES as CAPCUT_LANGUAGES,
  DUBBING_MODELS as MODELS,
  DUBBING_TARGET_LANGUAGES as LANGUAGES,
  parseDubbingTask,
} from "./voice-playground-dubbing-contract.ts";
export function createDubbingJobs({
  store,
  sources,
  request,
  archive,
  emit = () => {},
  isClosed = () => false,
  onBind = () => {},
}) {
  const active = new Set(),
    observations = new Map();
  store.mutate("dubbing-jobs", (rows) => {
    for (const job of rows) {
      if (["uploading", "submitting"].includes(job.phase))
        job.phase = ["submitting", "uncertain"].includes(job.upload?.phase)
          ? "uncertain"
          : job.upload?.taskId
            ? "processing"
            : "upload_interrupted";
      if (job.phase === "retrying") job.phase = "uncertain";
      if (job.phase === "downloading") job.phase = "download_interrupted";
    }
  });
  const list = () => store.list("dubbing-jobs");
  const get = (id) => list().find((job) => job.id === id);
  const requireJob = (id) => {
    const job = get(id);
    if (!job) throw fail("Dubbing job not found", 404);
    return job;
  };
  const save = (job) => {
    if (isClosed()) throw new Error("Dubbing workspace closed; progress is saved for resume");
    const next = { ...job, updatedAt: new Date().toISOString() };
    store.mutate("dubbing-jobs", (rows) => {
      const index = rows.findIndex((row) => row.id === job.id);
      if (index < 0) rows.unshift(next);
      else rows[index] = next;
    });
    if (next.taskId) onBind(next);
    emit({ type: "dubbing", job: next });
    return next;
  };
  const prepare = (input) => {
    const source = sources.get(input.sourceId);
    if (!source || source.phase !== "prepared") throw fail("Finish uploading the source first");
    const provider = input.provider ?? "minimax";
    if (!MODELS[provider]) throw fail("Choose ElevenLabs, MiniMax or CapCut");
    if (
      ![...LANGUAGES, "mi", "tl"].includes(input.sourceLanguage) ||
      !LANGUAGES.includes(input.targetLanguage)
    )
      throw fail(
        "Choose a supported source and target language; automatic source detection is unavailable",
      );
    if (provider === "capcut" && !CAPCUT_LANGUAGES.includes(input.targetLanguage))
      throw fail("CapCut does not support this dubbing target language");
    if (typeof input.voiceId !== "string" || !input.voiceId.trim())
      throw fail("Choose a dubbing voice");
    if (provider === "capcut" && input.voiceLanguage !== input.targetLanguage)
      throw fail("Choose a CapCut voice whose language matches the target language");
    const settings = {
      sourceId: input.sourceId,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      provider,
      voiceId: input.voiceId.trim(),
      voiceName: input.voiceName,
      voiceLanguage: input.voiceLanguage,
      ttsVoiceId: input.ttsVoiceId,
      modelId: MODELS[provider],
    };
    return save({
      id: `dub_${randomUUID()}`,
      phase: "prepared",
      settings,
      sourceName: source.filename,
      durationSeconds: source.durationSeconds,
      estimatedCredits: Math.ceil(source.durationSeconds * 50),
      createdAt: new Date().toISOString(),
      progress: 0,
    });
  };
  const submit = async (id, { signal } = {}) => {
    let job = requireJob(id);
    if (active.has(id)) throw fail("This dubbing upload is already running", 409);
    if (!["prepared", "upload_interrupted"].includes(job.phase))
      throw fail(
        "This job was already submitted. Check its history before another paid request",
        409,
      );
    active.add(id);
    job = save({
      ...job,
      phase: "uploading",
      submittedAt: job.submittedAt ?? new Date().toISOString(),
      error: undefined,
    });
    try {
      const source = sources.get(job.settings.sourceId);
      const path = sources.path(source.id);
      const result = await uploadDubbingSource(
        path,
        { ...job.settings, filename: source.filename, contentType: Bun.file(path).type },
        {
          request,
          signal,
          checkpoint: job.upload,
          save: async (upload) => {
            job = save({
              ...job,
              upload,
              phase: upload.phase === "queued" ? "processing" : upload.phase,
              taskId: upload.taskId ?? job.taskId,
            });
          },
        },
      );
      if (!safeTaskId(result.taskId))
        throw new Error(
          "Dubbing returned an invalid task identity; inspect history before retrying",
        );
      return save({ ...job, phase: "processing", taskId: result.taskId });
    } catch (error) {
      if (isClosed()) throw error;
      const phase = ["submitting", "uncertain", "queued"].includes(job.upload?.phase)
        ? "uncertain"
        : job.upload?.phase === "rejected"
          ? "failed"
          : "upload_interrupted";
      save({ ...job, phase, error: error.message });
      throw error;
    } finally {
      active.delete(id);
    }
  };
  const observe = async (id, { signal } = {}) => {
    let job = requireJob(id);
    if (job.phase === "completed" && job.itemId) return job;
    if (!safeTaskId(job.taskId))
      throw fail(
        "No task ID captured. Find and link the existing Dubbing history task before submitting again",
      );
    const response = await request(`/aidubbing/history/${job.taskId}`, { signal });
    signal?.throwIfAborted();
    const data = parseDubbingTask(response.data);
    if (data.id !== job.taskId)
      throw new Error("Dubbing history returned a different task identity");
    if (
      job.retry &&
      !job.retryAcknowledged &&
      ["completed", "failed"].includes(data.status) &&
      (!data.updated_at || data.updated_at === job.previousRemoteUpdatedAt)
    )
      return save({
        ...job,
        phase: "uncertain",
        error:
          "Retry response is unconfirmed and history still shows the previous result. Refresh later; do not submit another paid retry.",
      });
    const fee =
      typeof data.credits_deducted === "number" &&
      Number.isFinite(data.credits_deducted) &&
      data.credits_deducted >= 0
        ? { creditsDeducted: data.credits_deducted }
        : {};
    job = {
      ...job,
      ...fee,
      remoteStatus: data.status,
      progress:
        typeof data.progress === "number"
          ? Math.max(0, Math.min(100, data.progress))
          : job.progress,
      lastCheckedAt: new Date().toISOString(),
    };
    if (data.status === "failed")
      return save({
        ...job,
        phase: "failed",
        error:
          typeof data.detail_error === "string"
            ? data.detail_error
            : typeof data.error === "string"
              ? data.error
              : "GenVoice could not finish this dubbing. Your source and previous recordings are kept.",
      });
    if (data.status !== "completed") return save({ ...job, phase: "processing" });
    job = save({ ...job, phase: "downloading" });
    try {
      const item = await archive(data, job, {
        signal,
        save: (patch) => {
          job = save({ ...job, ...patch });
        },
      });
      signal?.throwIfAborted();
      return save({ ...job, phase: "completed", progress: 100, itemId: item.id, error: undefined });
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      save({ ...job, phase: "download_interrupted", error: error.message });
      throw error;
    }
  };
  const refresh = (id, options) => {
    if (observations.has(id)) return observations.get(id);
    const observation = observe(id, options).finally(() => observations.delete(id));
    observations.set(id, observation);
    return observation;
  };
  const link = async (id, taskId, options) => {
    const job = requireJob(id);
    if (active.has(id)) throw fail("Wait for the current upload to finish", 409);
    if (!safeTaskId(taskId)) throw fail("Choose a valid task from Dubbing history");
    if (job.taskId && job.taskId !== taskId)
      throw fail("This saved dubbing already has a task identity");
    save({ ...job, taskId, linkedAt: new Date().toISOString() });
    return refresh(id, options);
  };
  const retry = async (id, { signal } = {}) => {
    const prior = requireJob(id);
    if (!safeTaskId(prior.taskId)) throw fail("A captured cloud task is required for retry");
    if (
      active.has(id) ||
      list().some(
        (job) =>
          job.taskId === prior.taskId &&
          ["uploading", "submitting", "retrying", "processing", "uncertain"].includes(job.phase),
      )
    )
      throw fail("This cloud task already has an active or unconfirmed attempt", 409);
    active.add(id);
    try {
      const response = await request(`/aidubbing/history/${prior.taskId}`, { signal }),
        data = parseDubbingTask(response.data);
      signal?.throwIfAborted();
      if (!["completed", "failed"].includes(data.status))
        throw fail("Wait until the current cloud task finishes before retrying", 409);
      let job = save({
        id: `dub_${randomUUID()}`,
        taskId: prior.taskId,
        settings: structuredClone(prior.settings),
        sourceName: prior.sourceName,
        durationSeconds: prior.durationSeconds,
        estimatedCredits: data.credits_deducted ?? prior.estimatedCredits,
        createdAt: new Date().toISOString(),
        phase: "retrying",
        progress: 0,
        retry: true,
        previousJobId: prior.id,
        previousRemoteUpdatedAt: data.updated_at,
        retryAcknowledged: false,
      });
      try {
        const result = await request(`/aidubbing/history/${prior.taskId}/retry`, {
          method: "POST",
          signal,
        });
        if ((result.data.task_id ?? result.data.id) !== prior.taskId)
          throw Error("Dubbing retry returned no matching task identity");
        job = save({ ...job, phase: "processing", retryAcknowledged: true });
      } catch (error) {
        if (isClosed()) throw error;
        job = save({
          ...job,
          phase: error.status >= 400 && error.status < 500 ? "failed" : "uncertain",
          error: error.message,
        });
      }
      return job;
    } finally {
      active.delete(id);
    }
  };
  const adopt = (raw) => {
    const task = parseDubbingTask(raw);
    if (!safeTaskId(task.id)) throw fail("Invalid Dubbing history task");
    const existing = list().find((job) => job.taskId === task.id);
    if (existing) return existing;
    if (!MODELS[task.provider] || !task.voice_id || !task.source_lang || !task.target_lang)
      throw fail("Dubbing history has incomplete provider, voice or language settings", 502);
    return save({
      id: `dub_${randomUUID()}`,
      taskId: task.id,
      phase: "processing",
      settings: {
        sourceLanguage: task.source_lang,
        targetLanguage: task.target_lang,
        provider: task.provider,
        voiceId: task.voice_id,
        voiceName: task.metadata?.voice_name,
        modelId: MODELS[task.provider],
      },
      sourceName: task.metadata?.source_file_name,
      createdAt: typeof task.created_at === "string" ? task.created_at : new Date().toISOString(),
      progress: 0,
      imported: true,
    });
  };
  return { list, get, prepare, submit, refresh, link, retry, adopt };
}
