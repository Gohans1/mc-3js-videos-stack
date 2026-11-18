import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSharedArchive } from "../src/voice-playground-archive.mjs";
import { downloadDubbingFile } from "../src/voice-playground-dubbing-download.mjs";
import { createPlaygroundDubbing } from "../src/voice-playground-dubbing.mjs";
import { wrapPcm16ToWav } from "../src/voice-playground-genvoice.mjs";

test("Dubbing source staging, honest quote, background completion and private-project history integrate through persistent real storage", async () => {
  const root = mkdtempSync(join(tmpdir(), "dubbing-controller-")),
    global = openSharedArchive(join(root, "global"));
  const stores = [],
    controllers = [];
  let paid = 0;
  const mp3 = join(root, "result.mp3");
  execFileSync(
    "ffmpeg",
    ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000", "-t", "0.4", mp3],
    { windowsHide: true, timeout: 30000 },
  );
  const remote = {
    id: "cloud_one",
    status: "completed",
    source_lang: "en",
    target_lang: "vi",
    provider: "elevenlabs",
    voice_id: "actor",
    credits_deducted: 20,
    result: { audio_url: "https://cdn.invalid/result.mp3", srt_url: "https://cdn.invalid/vi.srt" },
  };
  const request = async (path) => {
    if (path.endsWith("/init"))
      return { data: { upload_id: "upload_one", chunk_size: 1024 * 1024 } };
    if (path.endsWith("/chunk")) return { data: { received: true } };
    if (path.endsWith("/complete")) {
      paid++;
      return { data: { task_id: "cloud_one" } };
    }
    return { data: path.includes("?") ? { tasks: [remote], has_more: false } : remote };
  };
  const make = (projectKey, scope = "project") => {
    const dir = join(root, scope === "global" ? "global" : projectKey),
      store = scope === "global" ? global : openSharedArchive(dir);
    if (store !== global) stores.push(store);
    const controller = createPlaygroundDubbing({
      scope,
      projectKey,
      storageDir: dir,
      metadata: () => store,
      shared: () => global,
      request,
      apiBase: () => "https://api.genvoice.pro/v1",
      download: (options) =>
        downloadDubbingFile({
          ...options,
          checkUrl: async () => {},
          fetchImpl: async (url) =>
            new Response(
              url.endsWith(".srt")
                ? "1\n00:00:00,000 --> 00:00:00,400\nXin chào.\n"
                : Bun.file(mp3),
            ),
        }),
      saveItem: async (item) => {
        store.mutate("items", (rows) => {
          if (!rows.some((row) => row.id === item.id)) rows.push(item);
        });
        return store.list("items").find((row) => row.id === item.id);
      },
      pollMs: 1,
      maxWatchMs: 5000,
    });
    controllers.push(controller);
    return controller;
  };
  try {
    const a = make("a"),
      source = await a.stageDubbingFile(
        new File([wrapPcm16ToWav(Buffer.alloc(16000 * 2 * 0.4), 16000)], "scene.wav", {
          lastModified: 123,
        }),
      );
    const prepared = a.prepareDubbing({
      sourceId: source.id,
      provider: "elevenlabs",
      sourceLanguage: "en",
      targetLanguage: "vi",
      voiceId: "actor",
    });
    expect(prepared.estimatedCredits).toBe(20);
    expect(paid).toBe(0);
    expect(a.submitDubbing(prepared.id).phase).toBe("uploading");
    await a.waitForDubbing();
    expect(a.getDubbing(prepared.id)).toMatchObject({ phase: "completed", creditsDeducted: 20 });
    expect(paid).toBe(1);
    const b = make("b");
    expect((await b.listCloudDubbing()).tasks).toEqual([]);
    await expect(b.importDubbing("cloud_one")).rejects.toThrow("another project");
    expect((await a.listCloudDubbing()).tasks[0].id).toBe("cloud_one");
    expect(readFileSync(a.dubbingSourcePath(source.id))).toEqual(
      Buffer.from(
        await new File(
          [wrapPcm16ToWav(Buffer.alloc(16000 * 2 * 0.4), 16000)],
          "scene.wav",
        ).arrayBuffer(),
      ),
    );
  } finally {
    for (const c of controllers) c.closeDubbing();
    for (const store of stores) store.close();
    global.close();
    rmSync(root, { recursive: true, force: true });
  }
});
