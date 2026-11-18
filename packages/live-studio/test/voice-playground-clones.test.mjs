import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSharedArchive } from "../src/voice-playground-archive.mjs";
import { createPlaygroundClones } from "../src/voice-playground-clones.mjs";
import { wrapPcm16ToWav } from "../src/voice-playground-genvoice.mjs";

test("a lost clone acknowledgement returns a recoverable saved identity instead of inviting a blind paid resubmission", async () => {
  const root = mkdtempSync(join(tmpdir(), "clone-lost-ack-")),
    store = openSharedArchive(root);
  let posts = 0;
  const controller = createPlaygroundClones({
    scope: "project",
    projectKey: "film",
    storageDir: root,
    metadata: () => store,
    shared: () => store,
    request: async () => {
      posts++;
      throw new Error("Connection lost");
    },
    getCatalog: async () => ({ models: [], languages: [] }),
    baseFavorites: () => [],
    emit: () => {},
  });
  try {
    const clone = await controller.createClone(
      new File([wrapPcm16ToWav(Buffer.alloc(16000 * 2 * 12), 16000)], "me.wav"),
      { name: "Me", language: "English", permissionConfirmed: true },
    );
    expect(clone).toMatchObject({ phase: "uncertain", error: "Connection lost" });
    expect(clone.id).toMatch(/^clone_/);
    expect(existsSync(controller.cloneSource(clone.id))).toBe(true);
    expect(controller.listClones()[0].id).toBe(clone.id);
    expect(posts).toBe(1);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("clone casting favorites stay in their project, then become reusable globally without another paid creation", async () => {
  const root = mkdtempSync(join(tmpdir(), "clone-casting-")),
    stores = [],
    controllers = {};
  let posts = 0,
    reads = 0;
  const remote = [];
  const shared = openSharedArchive(join(root, "global"));
  stores.push(shared);
  const audio = wrapPcm16ToWav(Buffer.alloc(16000 * 2 * 12), 16000);
  const request = async (path, init = {}) => {
    if (init.method === "POST") {
      posts++;
      const id = `remote_${posts}`;
      remote.push({
        id,
        voice_name: "My Vietnamese narrator",
        status: "processing",
        language_tag: "Vietnamese",
        gender: "Female",
      });
      return { id, status: "processing" };
    }
    reads++;
    return {
      voices: remote.map((voice) => ({
        ...voice,
        status: "done",
        sample_audio_url: "https://fixture.invalid/preview.wav",
      })),
    };
  };
  const build = (key, scope) => {
    const dir = join(root, key);
    const store = scope === "global" ? shared : openSharedArchive(dir);
    if (store !== shared) stores.push(store);
    const controller = createPlaygroundClones({
      scope,
      projectKey: key,
      storageDir: dir,
      metadata: () => store,
      shared: () => shared,
      request,
      download: async () => ({
        url: "https://fixture.invalid/preview.wav",
        contentType: "audio/wav",
        bytes: audio,
      }),
      apiBase: () => "https://fixture.invalid/v1",
      getCatalog: async () => ({ models: [], languages: [{ code: "vi", name: "Vietnamese" }] }),
      getController: () => controller,
      emit: () => {},
      baseFavorites: () => [],
      baseSetFavorite: () => {
        throw new Error("Owned clones must not enter generic Global favorites");
      },
    });
    controller.forScope = (target) => (target === scope ? controller : controllers.global);
    return controller;
  };
  try {
    controllers.global = build("global", "global");
    controllers.a = build("a", "project");
    controllers.b = build("b", "project");
    const created = await controllers.a.createClone(new File([audio], "my-voice.wav"), {
      name: "My Vietnamese narrator",
      language: "Vietnamese",
      gender: "Female",
      noiseReduction: false,
      previewText: "Hello",
      permissionConfirmed: true,
    });
    expect(created).toMatchObject({
      phase: "processing",
      settings: { language: "Vietnamese", noiseReduction: false },
    });
    expect(() => controllers.a.assertCloneAvailable("minimax", created.remoteId)).toThrow("ready");
    await controllers.a.refreshClones({ includeGlobal: true });
    expect(reads).toBe(1);
    await controllers.a.setVoiceFavorite({ provider: "minimax", id: created.remoteId }, true);
    expect(controllers.a.listVoiceFavorites()).toHaveLength(1);
    expect(controllers.b.listVoiceFavorites()).toEqual([]);
    const copy = await controllers.a.copyCloneToScope(created.id, "global");
    expect(existsSync(join(root, "global", "sources", copy.sourceFile))).toBe(true);
    expect(posts).toBe(1);
    expect(controllers.b.listClones({ includeGlobal: true })).toHaveLength(1);
    expect(controllers.b.listVoiceFavorites()[0].id).toBe(created.remoteId);
    await controllers.a.setVoiceFavorite({ provider: "minimax", id: created.remoteId }, false);
    expect(controllers.a.listVoiceFavorites()).toEqual([]);
    expect(controllers.b.listVoiceFavorites()).toEqual([]);
  } finally {
    for (const store of stores) store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
