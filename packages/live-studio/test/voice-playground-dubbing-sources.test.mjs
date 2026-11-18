import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSharedArchive } from "../src/voice-playground-archive.mjs";
import { createDubbingSources } from "../src/voice-playground-dubbing-sources.mjs";

test("local large-file staging resumes confirmed chunks across restart without loading the whole source", async () => {
  const root = mkdtempSync(join(tmpdir(), "dub-sources-"));
  let store = openSharedArchive(root);
  const probe = async () => ({ hasAudio: true, hasVideo: true, durationSeconds: 12.5 });
  try {
    let library = createDubbingSources({ dir: root, store, probe, chunkSize: 4 });
    const source = await library.init({ filename: "scene.mp4", bytes: 10, lastModified: 123 });
    await library.append(source.id, 0, new Blob(["abcd"]));
    store.close();
    store = openSharedArchive(root);
    library = createDubbingSources({ dir: root, store, probe, chunkSize: 4 });
    expect(library.get(source.id).uploaded).toEqual([0]);
    await library.append(source.id, 2, new Blob(["ij"]));
    await expect(library.complete(source.id)).rejects.toThrow("missing");
    await library.append(source.id, 1, new Blob(["efgh"]));
    const prepared = await library.complete(source.id);
    expect(prepared).toMatchObject({ phase: "prepared", durationSeconds: 12.5, hasVideo: true });
    expect(readFileSync(library.path(source.id), "utf8")).toBe("abcdefghij");
    expect((await library.complete(source.id)).id).toBe(source.id);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("overlapping completion requests leave one prepared source with its original bytes", async () => {
  const root = mkdtempSync(join(tmpdir(), "dub-complete-overlap-")),
    store = openSharedArchive(root);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const sources = createDubbingSources({
    dir: root,
    store,
    probe: async () => {
      await gate;
      return { hasAudio: true, durationSeconds: 1 };
    },
  });
  try {
    const source = await sources.init({ filename: "scene.wav", bytes: 3 });
    await sources.append(source.id, 0, new Blob(["abc"]));
    const pending = [sources.complete(source.id), sources.complete(source.id)];
    release();
    const results = await Promise.allSettled(pending);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(sources.get(source.id).phase).toBe("prepared");
    expect(readFileSync(sources.path(source.id), "utf8")).toBe("abc");
    expect((await sources.complete(source.id)).phase).toBe("prepared");
  } finally {
    release?.();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a source probe finishing after its workspace closes preserves recoverable bytes without reopening storage", async () => {
  const root = mkdtempSync(join(tmpdir(), "dub-source-shutdown-"));
  let store = openSharedArchive(root),
    closed = false,
    release,
    enter;
  const entered = new Promise((resolve) => {
      enter = resolve;
    }),
    gate = new Promise((resolve) => {
      release = resolve;
    });
  const sources = createDubbingSources({
    dir: root,
    store,
    isClosed: () => closed,
    probe: async () => {
      enter();
      await gate;
      return { hasAudio: true, durationSeconds: 1 };
    },
  });
  try {
    const source = await sources.init({ filename: "scene.wav", bytes: 3 });
    await sources.append(source.id, 0, new Blob(["abc"]));
    const pending = sources.complete(source.id);
    await entered;
    closed = true;
    store.close();
    release();
    await expect(pending).rejects.toThrow("workspace closed");
    store = openSharedArchive(root);
    const reopened = createDubbingSources({
      dir: root,
      store,
      probe: async () => ({ hasAudio: true, durationSeconds: 1 }),
    });
    expect((await reopened.complete(source.id)).phase).toBe("prepared");
    expect(readFileSync(reopened.path(source.id), "utf8")).toBe("abc");
  } finally {
    release?.();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("staging rejects malformed chunks and unsupported duration before a source can be submitted", async () => {
  const root = mkdtempSync(join(tmpdir(), "dub-bad-source-")),
    store = openSharedArchive(root);
  const library = createDubbingSources({
    dir: root,
    store,
    probe: async () => ({ hasAudio: true, hasVideo: false, durationSeconds: 9001 }),
    chunkSize: 4,
  });
  try {
    await expect(library.init({ filename: "scene.exe", bytes: 5 })).rejects.toThrow("supported");
    const source = await library.init({ filename: "scene.wav", bytes: 5 });
    await expect(library.append(source.id, 0, new Blob(["too long"]))).rejects.toThrow("size");
    await expect(library.append(source.id, 3, new Blob(["a"]))).rejects.toThrow("index");
    expect(library.get(source.id).uploaded).toEqual([]);
    await library.append(source.id, 0, new Blob(["abcd"]));
    await library.append(source.id, 1, new Blob(["e"]));
    await expect(library.complete(source.id)).rejects.toThrow("2.5 hours");
    expect(library.get(source.id).phase).toBe("receiving");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
