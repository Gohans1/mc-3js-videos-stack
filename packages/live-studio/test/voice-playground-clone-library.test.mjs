import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSharedArchive } from "../src/voice-playground-archive.mjs";
import { createCloneLibrary } from "../src/voice-playground-clone-library.mjs";

test("a recreated voice without a returned demo does not present its previous demo as the new voice", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clone-no-preview-")),
    store = openSharedArchive(dir);
  store.mutate("clones", (rows) =>
    rows.push({
      id: "local",
      remoteId: "cloud",
      phase: "processing",
      sampleAudioFile: "old.wav",
      previewStale: true,
      settings: { name: "Me" },
    }),
  );
  const library = createCloneLibrary({
    dir,
    scope: "project",
    projectKey: "film",
    store,
    registry: store,
    request: async () => ({ voices: [{ id: "cloud", status: "done" }] }),
  });
  try {
    const ready = await library.refresh("local");
    expect(ready.phase).toBe("ready");
    expect(ready.sampleAudioFile).toBeUndefined();
    expect(ready.previewStale).toBe(false);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reopening an interrupted submission shows an unconfirmed response and can recover without another paid request", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clone-interrupted-")),
    store = openSharedArchive(dir);
  let posts = 0;
  store.mutate("clones", (rows) =>
    rows.push({
      id: "saved",
      remoteId: "existing",
      phase: "submitting",
      submittedAt: new Date().toISOString(),
      settings: { name: "Me" },
    }),
  );
  const library = createCloneLibrary({
    dir,
    scope: "project",
    projectKey: "film",
    store,
    registry: store,
    request: async (path, init = {}) => {
      if (init.method === "POST") posts++;
      return { voices: [{ id: "existing", status: "done" }] };
    },
  });
  try {
    expect(library.get("saved").phase).toBe("uncertain");
    expect((await library.refresh("saved")).phase).toBe("ready");
    expect(posts).toBe(0);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("finishing a delayed preview preserves a favorite and library name changed while it downloads", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clone-preview-metadata-")),
    store = openSharedArchive(dir);
  let enter, release;
  const entered = new Promise((resolve) => (enter = resolve)),
    gate = new Promise((resolve) => (release = resolve));
  const clones = createCloneLibrary({
    dir,
    scope: "project",
    projectKey: "film",
    store,
    registry: store,
    probe: async () => ({ hasAudio: true, durationSeconds: 12 }),
    request: async (path, init = {}) =>
      init.method === "POST"
        ? { id: "remote_preview", status: "processing" }
        : {
            voices: [
              {
                id: "remote_preview",
                status: "done",
                sample_audio_url: "https://fixture.invalid/sample.wav",
              },
            ],
          },
    archiveSample: async () => {
      enter();
      await gate;
      return { audioFile: "preview.wav" };
    },
  });
  try {
    const prepared = await clones.prepare(new File(["voice"], "me.wav"), {
      name: "Original",
      permissionConfirmed: true,
    });
    await clones.submit(prepared.id);
    const refresh = clones.refresh(prepared.id);
    await entered;
    clones.patch(prepared.id, { favorite: true, name: "My narrator" });
    release();
    expect(await refresh).toMatchObject({
      phase: "ready",
      favorite: true,
      displayName: "My narrator",
      settings: { name: "Original" },
    });
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a prepared clone retains source, permission and remote identity across restart; observation never resubmits", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clone-library-"));
  let store = openSharedArchive(dir);
  const requests = [];
  const request = async (path, init = {}) => {
    requests.push({ path, method: init.method ?? "GET" });
    return init.method === "POST"
      ? { id: "remote_123", status: "processing" }
      : {
          voices: [
            {
              id: "remote_123",
              voice_name: "Me",
              language_tag: "English",
              status: "done",
              sample_audio_url: "https://fixture.invalid/sample.mp3",
            },
          ],
        };
  };
  const args = {
    dir,
    scope: "project",
    projectKey: "film-a",
    request,
    probe: async () => ({ durationSeconds: 12, hasAudio: true }),
    archiveSample: async () => ({ audioFile: "sample.mp3" }),
  };
  try {
    let clones = createCloneLibrary({ ...args, store, registry: store });
    const prepared = await clones.prepare(new File(["source recording"], "sample.wav"), {
      name: "Me",
      language: "English",
      gender: "Male",
      noiseReduction: true,
      previewText: "Hello",
      permissionConfirmed: true,
    });
    const submitted = await clones.submit(prepared.id);
    expect(submitted).toMatchObject({
      phase: "processing",
      remoteId: "remote_123",
      permission: { confirmed: true },
      settings: { name: "Me" },
    });
    expect(existsSync(join(dir, "sources", submitted.sourceFile))).toBe(true);
    store.close();
    store = openSharedArchive(dir);
    clones = createCloneLibrary({ ...args, store, registry: store });
    expect(clones.list()[0].remoteId).toBe("remote_123");
    const ready = await clones.refresh(prepared.id);
    expect(ready).toMatchObject({
      phase: "ready",
      sampleAudioFile: "sample.mp3",
      remoteId: "remote_123",
    });
    expect(requests.filter((request) => request.method === "POST")).toHaveLength(1);
    await expect(clones.submit(prepared.id)).rejects.toThrow("already submitted");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("invalid voice samples and missing permission are rejected before saving a clone or spending", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clone-validation-"));
  const store = openSharedArchive(dir);
  let submitted = 0;
  const clones = createCloneLibrary({
    dir,
    scope: "project",
    projectKey: "film-a",
    store,
    registry: store,
    request: async () => {
      submitted++;
    },
    probe: async () => ({ durationSeconds: 5, hasAudio: false }),
  });
  try {
    await expect(
      clones.prepare(new File(["source"], "source.mp4"), {
        name: "Me",
        permissionConfirmed: false,
      }),
    ).rejects.toThrow("permission");
    await expect(
      clones.prepare(new File(["source"], "source.mp4"), { name: "Me", permissionConfirmed: true }),
    ).rejects.toThrow("audio");
    expect(clones.list()).toEqual([]);
    expect(submitted).toBe(0);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("simultaneous clone submissions spend once and preserve the attempt recipe", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clone-claim-")),
    store = openSharedArchive(dir);
  let posts = 0;
  const clones = createCloneLibrary({
    dir,
    scope: "project",
    projectKey: "film-a",
    store,
    registry: store,
    probe: async () => ({ hasAudio: true, durationSeconds: 12 }),
    request: async () => {
      posts++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { id: "remote_claim", status: "processing" };
    },
  });
  try {
    const prepared = await clones.prepare(new File(["voice"], "me.wav"), {
      name: "Me",
      permissionConfirmed: true,
    });
    const results = await Promise.allSettled([
      clones.submit(prepared.id),
      clones.submit(prepared.id),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(posts).toBe(1);
    expect(clones.get(prepared.id).attempts).toHaveLength(1);
    expect(clones.get(prepared.id).attempts[0].settings.name).toBe("Me");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("linking an uncertain submission to its existing cloud voice never creates another clone", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clone-link-")),
    store = openSharedArchive(dir);
  let posts = 0;
  const request = async (path, init = {}) => {
    if (init.method === "POST") {
      posts++;
      throw new Error("Response lost");
    }
    return {
      voices: [
        { id: "remote_existing", voice_name: "Me", language_tag: "English", status: "done" },
      ],
    };
  };
  const clones = createCloneLibrary({
    dir,
    scope: "project",
    projectKey: "film-a",
    store,
    registry: store,
    probe: async () => ({ hasAudio: true, durationSeconds: 12 }),
    request,
  });
  try {
    const prepared = await clones.prepare(new File(["voice"], "me.wav"), {
      name: "Me",
      permissionConfirmed: true,
    });
    await expect(clones.submit(prepared.id)).rejects.toThrow("Response lost");
    const linked = await clones.link(prepared.id, {
      remoteId: "remote_existing",
      permissionConfirmed: true,
    });
    expect(linked).toMatchObject({
      phase: "ready",
      remoteId: "remote_existing",
      sourceFile: prepared.sourceFile,
    });
    expect(posts).toBe(1);
    expect(linked.permission.confirmed).toBe(true);
    expect(linked.rights).toBeUndefined();
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a library rename preserves the original cloning recipe, and paid retry does not reuse an old actual fee", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clone-retry-fees-")),
    store = openSharedArchive(dir);
  let posts = 0;
  const clones = createCloneLibrary({
    dir,
    scope: "project",
    projectKey: "film-a",
    store,
    registry: store,
    probe: async () => ({ hasAudio: true, durationSeconds: 12 }),
    request: async (path, init = {}) => {
      if (init.method === "POST") {
        posts++;
        return posts === 1
          ? { id: "remote_fee", status: "done", credits_deducted: 25 }
          : { id: "remote_fee", status: "processing" };
      }
      return { voices: [] };
    },
  });
  try {
    const prepared = await clones.prepare(new File(["voice"], "source.wav"), {
      name: "Original clone",
      permissionConfirmed: true,
    });
    const ready = await clones.submit(prepared.id);
    const renamed = clones.patch(ready.id, { name: "My narrator" });
    expect(renamed.settings.name).toBe("Original clone");
    expect(renamed.displayName).toBe("My narrator");
    const retry = await clones.retry(ready.id);
    expect(retry.creditsDeducted).toBeUndefined();
    expect(retry.attempts[0].creditsDeducted).toBe(25);
    expect(retry.attempts.at(-1).settings.name).toBe("Original clone");
    expect(posts).toBe(2);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const seconds of [10, 300]) {
  test(`a permitted ${seconds}-second sample is accepted at the duration boundary`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "clone-boundary-"));
    const store = openSharedArchive(dir);
    const clones = createCloneLibrary({
      dir,
      scope: "project",
      projectKey: "film",
      store,
      registry: store,
      probe: async () => ({ hasAudio: true, durationSeconds: seconds }),
      request: async () => {
        throw new Error("Validation must not contact GenVoice");
      },
    });
    try {
      const saved = await clones.prepare(new File(["sample"], "voice.wav"), {
        name: "Me",
        permissionConfirmed: true,
      });
      expect(saved.durationSeconds).toBe(seconds);
      expect(existsSync(join(dir, "sources", saved.sourceFile))).toBe(true);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
for (const seconds of [9.999, 300.001]) {
  test(`a ${seconds}-second sample outside the supported duration is rejected without saving`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "clone-boundary-"));
    const store = openSharedArchive(dir);
    const clones = createCloneLibrary({
      dir,
      scope: "project",
      projectKey: "film",
      store,
      registry: store,
      probe: async () => ({ hasAudio: true, durationSeconds: seconds }),
      request: async () => {
        throw new Error("Validation must not contact GenVoice");
      },
    });
    try {
      await expect(
        clones.prepare(new File(["sample"], "voice.wav"), {
          name: "Me",
          permissionConfirmed: true,
        }),
      ).rejects.toThrow("10 seconds to 5 minutes");
      expect(clones.list()).toEqual([]);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
