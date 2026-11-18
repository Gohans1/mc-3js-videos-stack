import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSharedArchive } from "../src/voice-playground-archive.mjs";
import { createDubbingJobs } from "../src/voice-playground-dubbing-jobs.mjs";
import { createDubbingSources } from "../src/voice-playground-dubbing-sources.mjs";

test("a submitted dubbing survives restart, archives its completed result and preserves the original without another paid completion", async () => {
  const root = mkdtempSync(join(tmpdir(), "dub-jobs-"));
  let store = openSharedArchive(root),
    paid = 0,
    done = false,
    archives = 0;
  const request = async (path, init = {}) => {
    if (path.endsWith("/init")) return { data: { upload_id: "upload_one", chunk_size: 4 } };
    if (path.endsWith("/chunk")) return { data: { received: true } };
    if (path.endsWith("/complete")) {
      paid++;
      expect(init.body.get("source_language")).toBe("en");
      expect(init.body.get("target_language")).toBe("vi");
      expect(init.body.get("voice_id")).toBe("Wise_Woman");
      return { data: { task_id: "task_one", status: "pending" } };
    }
    return {
      data: {
        id: "task_one",
        status: done ? "completed" : "processing",
        progress: done ? 100 : 30,
        credits_deducted: 600,
        result: done
          ? { audio_url: "https://cdn.invalid/dub.mp4", srt_url: "https://cdn.invalid/vi.srt" }
          : undefined,
      },
    };
  };
  const sourcesFor = () =>
    createDubbingSources({
      dir: root,
      store,
      probe: async () => ({ hasAudio: true, hasVideo: true, durationSeconds: 12 }),
      chunkSize: 4,
    });
  const archive = async () => {
    archives++;
    await Bun.write(join(root, "archived.mp4"), "dubbed result");
    return { id: "recording_one" };
  };
  try {
    let sources = sourcesFor(),
      jobs = createDubbingJobs({ store, sources, request, archive });
    const source = await sources.init({ filename: "scene.mp4", bytes: 6 });
    await sources.append(source.id, 0, new Blob(["abcd"]));
    await sources.append(source.id, 1, new Blob(["ef"]));
    await sources.complete(source.id);
    const prepared = jobs.prepare({
      sourceId: source.id,
      sourceLanguage: "en",
      targetLanguage: "vi",
      provider: "minimax",
      voiceId: "Wise_Woman",
      voiceName: "Wise Woman",
    });
    expect(prepared).toMatchObject({ phase: "prepared", estimatedCredits: 600 });
    expect((await jobs.submit(prepared.id)).taskId).toBe("task_one");
    await jobs.refresh(prepared.id);
    store.close();
    store = openSharedArchive(root);
    sources = sourcesFor();
    jobs = createDubbingJobs({ store, sources, request, archive });
    done = true;
    const complete = await jobs.refresh(prepared.id);
    expect(complete).toMatchObject({
      phase: "completed",
      itemId: "recording_one",
      creditsDeducted: 600,
    });
    expect(readFileSync(sources.path(source.id), "utf8")).toBe("abcdef");
    await jobs.refresh(prepared.id);
    expect(archives).toBe(1);
    expect(paid).toBe(1);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a lost final submission response cannot be resubmitted and can link its existing history task for free recovery", async () => {
  const root = mkdtempSync(join(tmpdir(), "dub-jobs-lost-")),
    store = openSharedArchive(root);
  let paid = 0;
  const sources = createDubbingSources({
    dir: root,
    store,
    probe: async () => ({ hasAudio: true, durationSeconds: 1 }),
    chunkSize: 4,
  });
  const request = async (path) => {
    if (path.endsWith("/init")) return { data: { upload_id: "upload_lost", chunk_size: 4 } };
    if (path.endsWith("/chunk")) return { data: { received: true } };
    if (path.endsWith("/complete")) {
      paid++;
      throw new Error("Response lost");
    }
    return {
      data: {
        id: "existing_task",
        status: "completed",
        credits_deducted: 50,
        result: { audio_url: "https://cdn.invalid/result.mp3" },
      },
    };
  };
  const jobs = createDubbingJobs({
    store,
    sources,
    request,
    archive: async () => ({ id: "recovered_audio" }),
  });
  try {
    const source = await sources.init({ filename: "scene.mp3", bytes: 3 });
    await sources.append(source.id, 0, new Blob(["abc"]));
    await sources.complete(source.id);
    const job = jobs.prepare({
      sourceId: source.id,
      sourceLanguage: "en",
      targetLanguage: "vi",
      provider: "capcut",
      voiceId: "vietnamese_actor",
      voiceLanguage: "vi",
    });
    await expect(jobs.submit(job.id)).rejects.toThrow("Response lost");
    expect(jobs.get(job.id).phase).toBe("uncertain");
    await expect(jobs.submit(job.id)).rejects.toThrow("history");
    expect(await jobs.link(job.id, "existing_task")).toMatchObject({
      phase: "completed",
      itemId: "recovered_audio",
    });
    expect(paid).toBe(1);
    expect(readFileSync(sources.path(source.id), "utf8")).toBe("abc");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("known CapCut language mismatches are rejected before any native upload or billing", () => {
  const root = mkdtempSync(join(tmpdir(), "dub-jobs-language-")),
    store = openSharedArchive(root);
  const jobs = createDubbingJobs({
    store,
    sources: { get: () => ({ phase: "prepared", durationSeconds: 1 }) },
    request: () => {
      throw new Error("Unexpected network");
    },
  });
  try {
    expect(() =>
      jobs.prepare({
        sourceId: "source",
        sourceLanguage: "en",
        targetLanguage: "vi",
        provider: "capcut",
        voiceId: "actor_en",
        voiceLanguage: "en",
      }),
    ).toThrow("matches");
    expect(jobs.list()).toEqual([]);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("native dubbing completion describes the original WAV source with its actual MIME type", async () => {
  const root = mkdtempSync(join(tmpdir(), "dub-jobs-mime-")),
    store = openSharedArchive(root);
  const sources = createDubbingSources({
    dir: root,
    store,
    probe: async () => ({ hasAudio: true, durationSeconds: 1 }),
    chunkSize: 4,
  });
  let contentType;
  const jobs = createDubbingJobs({
    store,
    sources,
    request: async (path, init) => {
      if (path.endsWith("/init")) return { data: { upload_id: "mime_upload", chunk_size: 4 } };
      if (path.endsWith("/chunk")) return { data: { received: true } };
      contentType = init.body.get("content_type");
      return { data: { task_id: "mime_task" } };
    },
  });
  try {
    const source = await sources.init({ filename: "scene.wav", bytes: 3 });
    await sources.append(source.id, 0, new Blob(["abc"]));
    await sources.complete(source.id);
    await jobs.submit(
      jobs.prepare({
        sourceId: source.id,
        sourceLanguage: "en",
        targetLanguage: "vi",
        provider: "elevenlabs",
        voiceId: "narrator",
      }).id,
    );
    expect(contentType).toMatch(/^audio\/(x-)?wav$/);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("an interrupted chunk upload can continue after restart without repeating confirmed chunks or the paid completion", async () => {
  const root = mkdtempSync(join(tmpdir(), "dub-jobs-upload-restart-"));
  let store = openSharedArchive(root),
    chunks = 0,
    paid = 0,
    failChunk = true;
  const request = async (path) => {
    if (path.endsWith("/init")) return { data: { upload_id: "resume_upload", chunk_size: 3 } };
    if (path.endsWith("/chunk")) {
      chunks++;
      if (failChunk && chunks === 2) throw Error("Network stopped");
      return { data: { received: true } };
    }
    paid++;
    return { data: { task_id: "resume_task" } };
  };
  const setup = () => {
    const sources = createDubbingSources({
      dir: root,
      store,
      probe: async () => ({ hasAudio: true, durationSeconds: 1 }),
      chunkSize: 3,
    });
    return { sources, jobs: createDubbingJobs({ store, sources, request }) };
  };
  try {
    let { sources, jobs } = setup();
    const source = await sources.init({ filename: "scene.mp3", bytes: 6 });
    await sources.append(source.id, 0, new Blob(["abc"]));
    await sources.append(source.id, 1, new Blob(["def"]));
    await sources.complete(source.id);
    const job = jobs.prepare({
      sourceId: source.id,
      sourceLanguage: "en",
      targetLanguage: "vi",
      voiceId: "Wise_Woman",
    });
    await expect(jobs.submit(job.id)).rejects.toThrow("Network stopped");
    expect(jobs.get(job.id).phase).toBe("upload_interrupted");
    store.close();
    store = openSharedArchive(root);
    ({ sources, jobs } = setup());
    failChunk = false;
    expect((await jobs.submit(job.id)).phase).toBe("processing");
    expect(chunks).toBe(3);
    expect(paid).toBe(1);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("reopening a process killed before paid completion keeps the upload recoverable", () => {
  const root = mkdtempSync(join(tmpdir(), "dub-jobs-killed-")),
    store = openSharedArchive(root);
  try {
    store.mutate("dubbing-jobs", (rows) =>
      rows.push({ id: "saved", phase: "uploading", upload: { phase: "uploading", uploaded: [0] } }),
    );
    const jobs = createDubbingJobs({ store });
    expect(jobs.get("saved").phase).toBe("upload_interrupted");
    store.mutate("dubbing-jobs", (rows) =>
      rows.push({
        id: "unconfirmed",
        phase: "submitting",
        upload: { phase: "submitting", uploaded: [0] },
      }),
    );
    const reopened = createDubbingJobs({ store });
    expect(reopened.get("unconfirmed").phase).toBe("uncertain");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("documented languages beyond the preferred English and Vietnamese remain available to AI clients", () => {
  const root = mkdtempSync(join(tmpdir(), "dub-jobs-languages-")),
    store = openSharedArchive(root);
  const jobs = createDubbingJobs({
    store,
    sources: { get: () => ({ phase: "prepared", durationSeconds: 1, filename: "scene.wav" }) },
  });
  try {
    expect(
      jobs.prepare({
        sourceId: "source",
        sourceLanguage: "en",
        targetLanguage: "ja",
        provider: "elevenlabs",
        voiceId: "actor",
      }).settings.targetLanguage,
    ).toBe("ja");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("explicit paid retry creates a separate saved version and never overwrites the original recording or its fee", async () => {
  const root = mkdtempSync(join(tmpdir(), "dub-jobs-retry-")),
    store = openSharedArchive(root);
  let retries = 0;
  store.mutate("dubbing-jobs", (rows) =>
    rows.push({
      id: "original",
      taskId: "existing",
      phase: "completed",
      itemId: "old_recording",
      creditsDeducted: 50,
      estimatedCredits: 50,
      settings: {
        sourceLanguage: "en",
        targetLanguage: "vi",
        provider: "elevenlabs",
        voiceId: "actor",
        modelId: "eleven_v3",
      },
    }),
  );
  const jobs = createDubbingJobs({
    store,
    request: async (path, init = {}) => {
      if (init.method === "POST") {
        retries++;
        return { data: { task_id: "existing", status: "pending" } };
      }
      return {
        data: {
          id: "existing",
          status: "completed",
          updated_at: "2026-11-17T02:00:00Z",
          credits_deducted: 50,
          result: { audio_url: "https://cdn.invalid/retry.mp3" },
        },
      };
    },
    archive: async (_, job) => ({ id: `item_${job.id}` }),
  });
  try {
    const rerun = await jobs.retry("original");
    expect(rerun.id).not.toBe("original");
    expect(rerun.phase).toBe("processing");
    expect(rerun.creditsDeducted).toBeUndefined();
    const completed = await jobs.refresh(rerun.id);
    expect(completed.itemId).not.toBe("old_recording");
    expect(jobs.get("original")).toMatchObject({
      itemId: "old_recording",
      creditsDeducted: 50,
      phase: "completed",
    });
    expect(retries).toBe(1);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("lost retry acknowledgement cannot mistake the unchanged previous result for a new recording", async () => {
  const root = mkdtempSync(join(tmpdir(), "dub-jobs-retry-lost-")),
    store = openSharedArchive(root);
  let archives = 0;
  store.mutate("dubbing-jobs", (rows) =>
    rows.push({
      id: "old",
      taskId: "existing",
      phase: "completed",
      itemId: "old_recording",
      settings: {},
    }),
  );
  const jobs = createDubbingJobs({
    store,
    request: async (_, init = {}) => {
      if (init.method === "POST") throw Error("Lost acknowledgement");
      return {
        data: {
          id: "existing",
          status: "completed",
          updated_at: "2026-11-17T02:00:00Z",
          result: { audio_url: "https://cdn.invalid/previous.mp3" },
        },
      };
    },
    archive: async () => {
      archives++;
      return { id: "wrong" };
    },
  });
  try {
    const retry = await jobs.retry("old");
    expect(retry.phase).toBe("uncertain");
    expect((await jobs.refresh(retry.id)).phase).toBe("uncertain");
    expect(archives).toBe(0);
    expect(jobs.get("old").itemId).toBe("old_recording");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("malformed provider history cannot become an archived recording", async () => {
  const root = mkdtempSync(join(tmpdir(), "dub-invalid-history-")),
    store = openSharedArchive(root);
  store.mutate("dubbing-jobs", (rows) =>
    rows.push({ id: "saved", taskId: "cloud", phase: "processing", settings: {} }),
  );
  const jobs = createDubbingJobs({
    store,
    request: async () => ({
      data: {
        id: "cloud",
        status: "completed",
        metadata: { voice_name: { bad: "shape" } },
        result: { audio_url: "https://cdn.invalid/result.mp3" },
      },
    }),
    archive: async () => ({ id: "invalid_recording" }),
  });
  try {
    await expect(jobs.refresh("saved")).rejects.toThrow("Invalid Dubbing history");
    expect(jobs.get("saved").itemId).toBeUndefined();
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
