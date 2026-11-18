import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { basename, extname, join } from "node:path";

import { submitCloneRecord } from "./voice-playground-clone-protocol.mjs";
import { visibleCloudClones } from "./voice-playground-clone-view.mjs";

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const safeId = (id) => typeof id === "string" && /^[A-Za-z0-9_-]+$/.test(id);
const clonePhase = (status) =>
  status === "done" ? "ready" : status === "failed" ? "failed" : "processing";
const activeSubmissions = new Set();

export function createCloneLibrary({
  dir,
  scope,
  projectKey,
  store,
  registry,
  request,
  probe,
  archiveSample,
  emit = () => {},
}) {
  if (!registry) throw new Error("A shared clone registry is required");
  const sources = join(dir, "sources");
  const pathFor = (folder, file) => {
    if (!file || file !== basename(file) || !/^[A-Za-z0-9_.-]+$/.test(file) || file.includes(".."))
      throw fail("Invalid saved clone file");
    return join(dir, folder, file);
  };
  const list = () => {
    const deleted = new Set(registry.list("clone-deletions").map((record) => record.remoteId));
    const runs = new Map(registry.list("clone-runs").map((run) => [run.remoteId, run]));
    return store.list("clones").map((record) => {
      const run = runs.get(record.remoteId);
      const phase = run?.phase ?? record.phase;
      return {
        ...record,
        scope,
        ...(run
          ? {
              phase: run.phase,
              submittedAt: run.submittedAt,
              error: run.error,
              creditsDeducted: run.creditsDeducted,
              ...(record.cloudRevision !== run.revision
                ? { previewStale: true, lastCheckedAt: undefined }
                : {}),
            }
          : {}),
        ...(phase === "submitting" && !activeSubmissions.has(run?.revision ?? record.id)
          ? {
              phase: "uncertain",
              warning:
                "Submission was interrupted. Check the existing cloud voice before creating again.",
            }
          : {}),
        ...(deleted.has(record.remoteId)
          ? {
              phase: "unavailable",
              warning: "Cloud voice deleted. Source files and existing recordings are preserved.",
            }
          : {}),
      };
    });
  };
  const get = (id) => list().find((record) => record.id === id);
  const requireRecord = (id) => {
    const record = get(id);
    if (!record) throw fail("Clone not found in this library", 404);
    return record;
  };
  const bind = (next) => {
    if (next.remoteId)
      registry.mutate("clone-bindings", (bindings) => {
        for (let index = bindings.length - 1; index >= 0; index--)
          if (bindings[index].localId === next.id) bindings.splice(index, 1);
        bindings.push({ remoteId: next.remoteId, localId: next.id, scope, projectKey });
      });
    emit({ type: "clones", clone: next });
    return next;
  };
  const save = (record) => {
    const next = { ...record, scope, projectKey, updatedAt: new Date().toISOString() };
    store.mutate("clones", (rows) => {
      const index = rows.findIndex((row) => row.id === record.id);
      if (index < 0) rows.unshift(next);
      else rows[index] = next;
    });
    if (next.cloudRevision && next.remoteId)
      registry.mutate("clone-runs", (runs) => {
        const index = runs.findIndex((run) => run.remoteId === next.remoteId);
        const run = {
          remoteId: next.remoteId,
          revision: next.cloudRevision,
          phase: next.phase,
          submittedAt: next.submittedAt,
          error: next.error,
          creditsDeducted: next.creditsDeducted,
        };
        if (index < 0) runs.push(run);
        else if (runs[index].revision === run.revision || next.phase === "submitting")
          runs[index] = run;
      });
    return bind(next);
  };
  const prepare = async (file, settings) => {
    if (settings.permissionConfirmed !== true)
      throw fail("Confirm that you have permission to clone this voice");
    if (file.size < 1 || file.size > 80 * 1024 * 1024)
      throw fail("Choose a voice sample up to 80 MB");
    const id = `clone_${randomUUID()}`,
      extension = extname(file.name).toLowerCase();
    const sourceFile = `${id}${/^\.[a-z0-9]{1,8}$/.test(extension) ? extension : ".wav"}`,
      path = join(sources, sourceFile);
    mkdirSync(sources, { recursive: true });
    await Bun.write(path, file);
    try {
      let info;
      try {
        info = await probe(path);
      } catch {
        throw fail("Could not read this sample. Choose a supported audio or video file.");
      }
      if (!info.hasAudio) throw fail("Choose a file with an audio track");
      if (
        !Number.isFinite(info.durationSeconds) ||
        info.durationSeconds < 10 ||
        info.durationSeconds > 300
      )
        throw fail("Voice samples must be 10 seconds to 5 minutes");
      return save({
        id,
        phase: "prepared",
        sourceFile,
        sourceName: file.name,
        durationSeconds: info.durationSeconds,
        bytes: file.size,
        settings: {
          name: settings.name,
          language: settings.language ?? "English",
          gender: settings.gender ?? "Male",
          noiseReduction: settings.noiseReduction !== false,
          previewText: settings.previewText ?? "Hello",
        },
        permission: { confirmed: true, confirmedAt: new Date().toISOString() },
        createdAt: new Date().toISOString(),
        favorite: false,
        attempts: [],
      });
    } catch (error) {
      rmSync(path, { force: true });
      throw error;
    }
  };
  const submit = async (id) => {
    const record = requireRecord(id);
    if (record.phase !== "prepared")
      throw fail("This clone was already submitted; refresh its saved status", 409);
    activeSubmissions.add(id);
    try {
      return await submitCloneRecord(
        record,
        pathFor("sources", record.sourceFile),
        request,
        (next) => {
          if (next.phase !== "submitting") return save(next);
          store.mutate("clones", (rows) => {
            const index = rows.findIndex((row) => row.id === id);
            if (index < 0 || rows[index].phase !== "prepared")
              throw fail("This clone was already submitted; refresh its saved status", 409);
            rows[index] = { ...next, updatedAt: new Date().toISOString() };
            next = rows[index];
          });
          return bind(next);
        },
      );
    } finally {
      activeSubmissions.delete(id);
    }
  };
  const cloud = async () => {
    const data = await request("/minimax/voices");
    if (!Array.isArray(data.voices)) throw new Error("GenVoice returned no clone list");
    return visibleCloudClones(data.voices, registry.list("clone-bindings"), { scope, projectKey });
  };
  const observe = async (record, remote, { signal } = {}) => {
    signal?.throwIfAborted();
    const run = registry.list("clone-runs").find((run) => run.remoteId === record.remoteId);
    if (!remote)
      return save({
        ...record,
        ...(run ? { cloudRevision: run.revision } : {}),
        phase: "unavailable",
        warning:
          "This voice is not listed in GenVoice. Your source and saved recordings remain on disk.",
      });
    let next = {
      ...record,
      ...(run ? { cloudRevision: run.revision } : {}),
      phase: clonePhase(remote.status),
      warning: undefined,
      error: remote.error ?? remote.detail_error,
      remoteStatus: remote.status,
      lastCheckedAt: new Date().toISOString(),
    };
    if (typeof remote.credits_deducted === "number") next.creditsDeducted = remote.credits_deducted;
    if (next.phase === "ready" && !remote.sample_audio_url)
      next = {
        ...next,
        sampleAudioFile: undefined,
        sampleUrl: undefined,
        previewStale: false,
        previewError: undefined,
      };
    if (
      next.phase === "ready" &&
      remote.sample_audio_url &&
      (!record.sampleAudioFile ||
        record.sampleUrl !== remote.sample_audio_url ||
        record.previewStale)
    ) {
      try {
        const sample = await archiveSample(
          remote.sample_audio_url,
          `${record.id}_${record.attempts?.length ?? 0}`,
          { signal },
        );
        next = {
          ...next,
          sampleAudioFile: sample.audioFile,
          sampleUrl: remote.sample_audio_url,
          previewError: undefined,
          previewStale: false,
        };
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        next.previewError = error.message;
      }
    }
    signal?.throwIfAborted();
    const current = requireRecord(record.id);
    if (
      current.submittedAt !== record.submittedAt ||
      (current.phase === "unavailable" && record.phase !== "unavailable")
    )
      return current;
    return save({ ...next, favorite: current.favorite, displayName: current.displayName });
  };
  const observeAll = async (voices) => {
    await Promise.allSettled(
      list()
        .filter(
          (record) =>
            record.remoteId &&
            (["processing", "uncertain"].includes(record.phase) ||
              (record.phase === "ready" &&
                !record.previewError &&
                (!record.lastCheckedAt || record.previewStale))),
        )
        .map((record) =>
          observe(
            record,
            voices.find((voice) => voice.id === record.remoteId),
          ),
        ),
    );
    return list();
  };
  const refresh = async (id, { signal } = {}) => {
    const record = requireRecord(id);
    if (record.phase === "submitting") return record;
    if (!record.remoteId)
      throw fail(
        "No cloud ID was captured. Inspect cloud voices and link the existing voice before creating another one",
      );
    const data = await request("/minimax/voices", { signal });
    if (!Array.isArray(data.voices)) throw new Error("GenVoice returned no clone list");
    return observe(
      record,
      data.voices.find((voice) => voice.id === record.remoteId),
      { signal },
    );
  };
  const link = async (id, { remoteId, permissionConfirmed }) => {
    const record = requireRecord(id);
    if (record.remoteId && record.remoteId !== remoteId)
      throw fail("This saved clone already has a cloud identity");
    if (!permissionConfirmed || !safeId(remoteId))
      throw fail("Confirm permission and choose an existing cloud voice");
    const remote = (await cloud()).find((voice) => voice.id === remoteId);
    if (!remote) throw fail("Cloud voice not visible in this project", 404);
    return observe(save({ ...record, remoteId }), remote);
  };
  const adopt = async ({ remoteId, permissionConfirmed }) => {
    if (!permissionConfirmed || !safeId(remoteId))
      throw fail("Confirm permission and choose an existing cloud voice");
    const existing = list().find((record) => record.remoteId === remoteId);
    if (existing) return refresh(existing.id);
    const remote = (await cloud()).find((voice) => voice.id === remoteId);
    if (!remote) throw fail("Cloud voice not visible in this project", 404);
    const now = new Date().toISOString();
    return observe(
      save({
        id: `clone_${randomUUID()}`,
        remoteId,
        phase: clonePhase(remote.status),
        imported: true,
        settings: {
          name: remote.voice_name || remoteId,
          language: remote.language_tag || "English",
          gender: remote.gender || "Not recorded",
        },
        permission: { confirmed: true, confirmedAt: now },
        createdAt: now,
        favorite: false,
        attempts: [],
      }),
      remote,
    );
  };
  const patch = (id, input) => {
    const record = requireRecord(id);
    return save({
      ...record,
      ...(typeof input.favorite === "boolean" ? { favorite: input.favorite } : {}),
      ...(typeof input.name === "string" ? { displayName: input.name.trim() } : {}),
    });
  };
  const retry = async (id) => {
    const record = requireRecord(id);
    if (!["failed", "ready"].includes(record.phase) || !record.remoteId)
      throw fail("Only a failed or completed cloud clone can be retried; refresh its status first");
    const attempts = structuredClone(record.attempts ?? []);
    if (typeof record.creditsDeducted === "number") {
      if (!attempts.length)
        attempts.push({
          submittedAt: record.remoteCreatedAt ?? record.createdAt,
          settings: record.settings,
          imported: true,
        });
      attempts.at(-1).creditsDeducted = record.creditsDeducted;
    }
    const revision = randomUUID();
    activeSubmissions.add(revision);
    let next = save({
      ...record,
      phase: "submitting",
      cloudRevision: revision,
      submittedAt: new Date().toISOString(),
      previewStale: true,
      error: undefined,
      creditsDeducted: undefined,
      attempts: [
        ...attempts,
        { submittedAt: new Date().toISOString(), settings: record.settings, retry: true },
      ],
    });
    try {
      const data = await request(`/minimax/voices/${record.remoteId}/retry`, { method: "POST" });
      next = save({ ...next, phase: clonePhase(data.status), error: undefined });
      return next;
    } catch (error) {
      save({
        ...next,
        phase: error.status >= 400 && error.status < 500 ? "failed" : "uncertain",
        error: error.message,
      });
      throw error;
    } finally {
      activeSubmissions.delete(revision);
    }
  };
  const removeCloud = async (id) => {
    const record = requireRecord(id);
    if (!record.remoteId) throw fail("No cloud voice ID to delete");
    await request(`/minimax/voices/${record.remoteId}`, { method: "DELETE" });
    registry.mutate("clone-deletions", (rows) => {
      if (!rows.some((row) => row.remoteId === record.remoteId))
        rows.push({ remoteId: record.remoteId, deletedAt: new Date().toISOString() });
    });
    return save({
      ...requireRecord(id),
      phase: "unavailable",
      warning: "Cloud voice deleted. Existing recordings and source files are preserved.",
    });
  };
  const acceptCopy = async (record, files) => {
    const existing = record.remoteId && list().find((row) => row.remoteId === record.remoteId);
    if (existing) return existing;
    const id = `clone_${randomUUID()}`,
      written = [];
    const next = {
      ...structuredClone(record),
      id,
      scope,
      projectKey,
      copiedFrom: { id: record.id, scope: record.scope },
      sourceFile: undefined,
      sampleAudioFile: undefined,
    };
    try {
      if (files.source) {
        mkdirSync(sources, { recursive: true });
        next.sourceFile = `${id}${extname(record.sourceFile)}`;
        const path = pathFor("sources", next.sourceFile);
        await Bun.write(path, files.source);
        written.push(path);
      }
      if (files.sample) {
        mkdirSync(join(dir, "audio"), { recursive: true });
        next.sampleAudioFile = `${id}${extname(record.sampleAudioFile)}`;
        const path = pathFor("audio", next.sampleAudioFile);
        await Bun.write(path, files.sample);
        written.push(path);
      }
      return save(next);
    } catch (error) {
      for (const path of written) rmSync(path, { force: true });
      throw error;
    }
  };
  const copyTo = async (id, target) => {
    const record = requireRecord(id);
    return target.acceptCopy(record, {
      ...(record.sourceFile ? { source: Bun.file(pathFor("sources", record.sourceFile)) } : {}),
      ...(record.sampleAudioFile
        ? { sample: Bun.file(pathFor("audio", record.sampleAudioFile)) }
        : {}),
    });
  };
  return {
    list,
    get,
    prepare,
    submit,
    refresh,
    observeAll,
    cloud,
    adopt,
    link,
    patch,
    retry,
    removeCloud,
    copyTo,
    acceptCopy,
    sourcePath: (id) => {
      const record = requireRecord(id);
      if (!record.sourceFile)
        throw fail("The original sample was not saved when this cloud voice was imported", 404);
      return pathFor("sources", record.sourceFile);
    },
  };
}
