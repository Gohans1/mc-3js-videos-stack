import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSharedArchive } from "../src/voice-playground-archive.mjs";
import { createCloneLibrary } from "../src/voice-playground-clone-library.mjs";

test("retrying a shared clone replaces stale previews and fees in both libraries even when the cloud URL stays the same", async () => {
  const root = mkdtempSync(join(tmpdir(), "clone-shared-retry-"));
  const globalStore = openSharedArchive(join(root, "global")),
    projectStore = openSharedArchive(join(root, "project"));
  let version = 1;
  const make = (scope, store) =>
    createCloneLibrary({
      dir: join(root, scope),
      scope,
      projectKey: "film",
      store,
      registry: globalStore,
      request: async (path, init = {}) => {
        if (path.endsWith("/retry")) {
          version = 2;
          return { status: "processing" };
        }
        if (init.method === "POST") return { id: "shared", status: "done", credits_deducted: 10 };
        return {
          voices: [
            {
              id: "shared",
              status: "done",
              sample_audio_url: "https://fixture.invalid/preview.wav",
              credits_deducted: version * 10,
            },
          ],
        };
      },
      probe: async () => ({ hasAudio: true, durationSeconds: 12 }),
      archiveSample: async () => {
        const audioFile = `preview-${version}.wav`;
        await Bun.write(join(root, scope, "audio", audioFile), `preview ${version}`);
        return { audioFile };
      },
    });
  const project = make("project", projectStore),
    global = make("global", globalStore);
  try {
    const prepared = await project.prepare(new File(["own source"], "me.wav"), {
      name: "Me",
      permissionConfirmed: true,
    });
    await project.submit(prepared.id);
    await project.refresh(prepared.id);
    const copied = await project.copyTo(prepared.id, global);
    global.patch(copied.id, { name: "My global alias", favorite: true });
    await project.retry(prepared.id);
    expect(global.get(copied.id)).toMatchObject({ phase: "processing", previewStale: true });
    expect(global.get(copied.id).creditsDeducted).toBeUndefined();
    await global.refresh(copied.id);
    await project.refresh(prepared.id);
    for (const [library, id, folder] of [
      [project, prepared.id, "project"],
      [global, copied.id, "global"],
    ]) {
      const saved = library.get(id);
      expect(saved).toMatchObject({ phase: "ready", creditsDeducted: 20, previewStale: false });
      expect(readFileSync(join(root, folder, "audio", saved.sampleAudioFile), "utf8")).toBe(
        "preview 2",
      );
    }
    expect(global.get(copied.id)).toMatchObject({ displayName: "My global alias", favorite: true });
  } finally {
    projectStore.close();
    globalStore.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("deleting a shared cloud identity makes every saved copy unavailable while keeping local samples", async () => {
  const root = mkdtempSync(join(tmpdir(), "clone-shared-delete-")),
    globalStore = openSharedArchive(join(root, "global")),
    projectStore = openSharedArchive(join(root, "project"));
  const common = {
    registry: globalStore,
    request: async (path, init = {}) =>
      init.method === "POST" ? { id: "remote_shared", status: "done" } : { success: true },
    probe: async () => ({ hasAudio: true, durationSeconds: 12 }),
  };
  const project = createCloneLibrary({
    ...common,
    dir: join(root, "project"),
    store: projectStore,
    scope: "project",
    projectKey: "film",
  });
  const global = createCloneLibrary({
    ...common,
    dir: join(root, "global"),
    store: globalStore,
    scope: "global",
    projectKey: "film",
  });
  try {
    const prepared = await project.prepare(new File(["own source"], "me.wav"), {
      name: "Me",
      permissionConfirmed: true,
    });
    await project.submit(prepared.id);
    const copied = await project.copyTo(prepared.id, global);
    await project.removeCloud(prepared.id);
    expect(project.get(prepared.id).phase).toBe("unavailable");
    expect(global.get(copied.id).phase).toBe("unavailable");
    expect(readFileSync(join(root, "global", "sources", copied.sourceFile), "utf8")).toBe(
      "own source",
    );
  } finally {
    projectStore.close();
    globalStore.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a project clone stays private until copied to Global; copying retains source and identity without another paid submission", async () => {
  const root = mkdtempSync(join(tmpdir(), "clone-scopes-"));
  const globalStore = openSharedArchive(join(root, "global")),
    aStore = openSharedArchive(join(root, "a")),
    bStore = openSharedArchive(join(root, "b"));
  let posts = 0;
  const request = async (path, init = {}) => {
    if (init.method === "POST") {
      posts++;
      return { id: "remote_a", status: "processing" };
    }
    return {
      voices: [
        { id: "remote_a", voice_name: "My narrator", status: "processing" },
        { id: "external", voice_name: "Unassigned", status: "done" },
      ],
    };
  };
  const common = {
    registry: globalStore,
    request,
    probe: async () => ({ hasAudio: true, durationSeconds: 12 }),
  };
  const a = createCloneLibrary({
    ...common,
    dir: join(root, "a"),
    store: aStore,
    scope: "project",
    projectKey: "a",
  });
  const b = createCloneLibrary({
    ...common,
    dir: join(root, "b"),
    store: bStore,
    scope: "project",
    projectKey: "b",
  });
  const global = createCloneLibrary({
    ...common,
    dir: join(root, "global"),
    store: globalStore,
    scope: "global",
    projectKey: "a",
  });
  try {
    const prepared = await a.prepare(new File(["own source"], "own.wav"), {
      name: "My narrator",
      permissionConfirmed: true,
    });
    await a.submit(prepared.id);
    expect((await b.cloud()).map((voice) => voice.id)).toEqual(["external"]);
    const copied = await a.copyTo(prepared.id, global);
    expect((await a.copyTo(prepared.id, global)).id).toBe(copied.id);
    expect(copied).toMatchObject({
      scope: "global",
      remoteId: "remote_a",
      settings: { name: "My narrator" },
      permission: { confirmed: true },
    });
    expect(readFileSync(join(root, "global", "sources", copied.sourceFile), "utf8")).toBe(
      "own source",
    );
    expect((await b.cloud()).map((voice) => voice.id)).toEqual(["remote_a", "external"]);
    expect(b.list()).toEqual([]);
    expect(a.list()).toHaveLength(1);
    expect(global.list()).toHaveLength(1);
    expect(posts).toBe(1);
  } finally {
    aStore.close();
    bStore.close();
    globalStore.close();
    rmSync(root, { recursive: true, force: true });
  }
});
