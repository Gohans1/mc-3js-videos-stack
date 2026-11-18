import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSharedArchive } from "../src/voice-playground-archive.mjs";
import { wrapPcm16ToWav } from "../src/voice-playground-genvoice.mjs";
import { playgroundExtensions } from "../src/voice-playground-routes.mjs";
import { openVoicePlayground } from "../src/voice-playground.mjs";

test("Dubbing API stages a source, quotes before billing and archives a completed take with its original and subtitles", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dubbing-api-"));
  const output = join(dir, "result.mp3");
  execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=16000",
      "-t",
      "0.4",
      output,
    ],
    { windowsHide: true, timeout: 30000 },
  );
  const source = wrapPcm16ToWav(Buffer.alloc(16000 * 2 * 0.4), 16000);
  let paid = 0;
  const pg = openVoicePlayground({
    dir,
    env: { GENVOICE_API_KEY: "fixture-only" },
    configFile: join(dir, "no-config.json"),
    secretsFile: join(dir, "no-secrets.env"),
    lookup: async () => [{ address: "8.8.8.8", family: 4 }],
    pollIntervalMs: 1,
    fetchImpl: async (url, init = {}) => {
      const path = new URL(url).pathname;
      if (path.endsWith("/init"))
        return Response.json({ upload_id: "upload_one", chunk_size: 1024 * 1024 });
      if (path.endsWith("/chunk")) return Response.json({ received: true });
      if (path.endsWith("/complete")) {
        paid++;
        return Response.json({ task_id: "cloud_one" });
      }
      if (path.endsWith("/cloud_one"))
        return Response.json({
          id: "cloud_one",
          status: "completed",
          provider: "elevenlabs",
          source_lang: "en",
          target_lang: "vi",
          voice_id: "actor",
          credits_deducted: 20,
          result: {
            audio_url: "https://cdn.invalid/result.mp3",
            srt_url: "https://cdn.invalid/vi.srt",
          },
        });
      if (path.endsWith("/vi.srt"))
        return new Response("1\n00:00:00,000 --> 00:00:00,400\nXin chào.\n");
      if (path.endsWith("/result.mp3")) {
        expect(new Headers(init.headers).has("xi-api-key")).toBe(false);
        return new Response(Bun.file(output));
      }
      throw new Error(`Unexpected fixture request ${path}`);
    },
  });
  const app = playgroundExtensions(pg);
  const send = (path, input, method = "POST") =>
    app.request(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  try {
    expect((await app.request("/dubbing/missing/submit", { method: "POST" })).status).toBe(404);
    expect(
      (
        await send("/dubbing", {
          sourceId: "missing",
          sourceLanguage: "auto",
          targetLanguage: "vi",
          voiceId: "actor",
        })
      ).status,
    ).toBe(400);
    const initial = await send("/dubbing/sources", { filename: "scene.wav", bytes: source.length });
    expect(initial.status).toBe(201);
    const { source: upload } = await initial.json();
    const chunk = await app.request(`/dubbing/sources/${upload.id}/chunks/0`, {
      method: "PUT",
      body: source,
    });
    expect(chunk.status).toBe(200);
    expect(
      (await app.request(`/dubbing/sources/${upload.id}/complete`, { method: "POST" })).status,
    ).toBe(200);
    const preparation = await send("/dubbing", {
      sourceId: upload.id,
      provider: "elevenlabs",
      sourceLanguage: "en",
      targetLanguage: "vi",
      voiceId: "actor",
    });
    expect(preparation.status).toBe(201);
    const { job } = await preparation.json();
    expect(job.estimatedCredits).toBe(20);
    expect(paid).toBe(0);
    expect((await app.request(`/dubbing/${job.id}/submit`, { method: "POST" })).status).toBe(202);
    await pg.waitForAllJobs();
    const { job: completed } = await (await app.request(`/dubbing/${job.id}`)).json();
    expect(completed.phase).toBe("completed");
    expect(completed.creditsDeducted).toBe(20);
    expect(pg.getItem(completed.itemId)).toMatchObject({
      kind: "dubbing",
      languageCode: "vi",
      text: "Xin chào.",
    });
    const original = await app.request(`/dubbing/sources/${upload.id}/file`);
    expect(original.status).toBe(200);
    expect(Buffer.from(await original.arrayBuffer())).toEqual(source);
    const slice = await app.request(`/dubbing/sources/${upload.id}/file`, {
      headers: { range: "bytes=0-3" },
    });
    expect(slice.status).toBe(206);
    expect(Buffer.from(await slice.arrayBuffer()).toString()).toBe("RIFF");
    expect(readFileSync(pg.audioFile(pg.getItem(completed.itemId).audioFile))).toEqual(
      readFileSync(output),
    );
    expect(paid).toBe(1);
    expect((await app.request(`/dubbing/${job.id}/submit`, { method: "POST" })).status).toBe(409);
    expect(paid).toBe(1);
  } finally {
    pg.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("audio editing creates an independent result and deleting it preserves the original Dubbing video", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dubbing-edit-video-")),
    movie = join(dir, "source.mp4");
  execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=160x90:r=5",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=44100",
      "-t",
      "0.4",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      movie,
    ],
    { windowsHide: true, timeout: 30000 },
  );
  const originalBytes = readFileSync(movie);
  const pg = openVoicePlayground({
    dir: join(dir, "archive"),
    globalDir: join(dir, "global"),
    env: { GENVOICE_API_KEY: "fixture-only" },
    configFile: join(dir, "no-config"),
    secretsFile: join(dir, "no-secrets"),
    lookup: async () => [{ address: "8.8.8.8", family: 4 }],
    fetchImpl: async (url, init = {}) => {
      if (init.method && init.method !== "GET") throw Error("Audio editing must not generate");
      return new URL(url).pathname.endsWith("/remote")
        ? Response.json({
            id: "remote",
            status: "completed",
            provider: "elevenlabs",
            voice_id: "actor",
            source_lang: "en",
            target_lang: "vi",
            metadata: { original_video_url: "https://cdn.invalid/source.mp4" },
            result: { audio_url: "https://cdn.invalid/result.mp4" },
          })
        : new Response(Bun.file(movie));
    },
  });
  try {
    const job = await pg.importDubbing("remote"),
      original = pg.getItem(job.itemId);
    const edit = await pg.startRegionEdit(original.id, {
      mode: "local",
      from: 0,
      to: 0.2,
      gainDb: -6,
    });
    const version = await pg.waitForJob(edit.job.id);
    expect(pg.dubbingAsset(version.id, "result")).toEndWith(".wav");
    expect(readFileSync(pg.dubbingAsset(original.id, "result"))).toEqual(originalBytes);
    await pg.deleteItem(version.id);
    expect(readFileSync(pg.dubbingAsset(original.id, "result"))).toEqual(originalBytes);
    const global = await pg.copyToScope(original.id, "global");
    expect(readFileSync(pg.forScope("global").dubbingAsset(global.id, "result"))).toEqual(
      originalBytes,
    );
  } finally {
    pg.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("covered MP3 is audio and an already-submitted attempt recovers from old video metadata without another charge", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dubbing-mp3-cover-")),
    archive = join(dir, "archive"),
    source = join(dir, "source.mp3"),
    result = join(dir, "result.mp3");
  execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=44100",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=160x90:r=1",
      "-map",
      "0:a",
      "-map",
      "1:v",
      "-c:a",
      "libmp3lame",
      "-c:v",
      "mjpeg",
      "-disposition:v",
      "attached_pic",
      "-t",
      "0.4",
      source,
    ],
    { windowsHide: true, timeout: 30000 },
  );
  execFileSync("ffmpeg", ["-v", "error", "-i", source, "-vn", "-c:a", "copy", result], {
    windowsHide: true,
    timeout: 30000,
  });
  let paid = 0;
  const pg = openVoicePlayground({
    dir: archive,
    globalDir: join(dir, "global"),
    env: { GENVOICE_API_KEY: "fixture-only" },
    configFile: join(dir, "no-config"),
    secretsFile: join(dir, "no-secrets"),
    lookup: async () => [{ address: "8.8.8.8", family: 4 }],
    fetchImpl: async (url, init = {}) => {
      if (init.method && init.method !== "GET") {
        paid++;
        throw Error("Recover the existing task, do not generate again");
      }
      return new URL(url).pathname.endsWith("/remote")
        ? Response.json({
            id: "remote",
            status: "completed",
            provider: "elevenlabs",
            voice_id: "actor",
            source_lang: "en",
            target_lang: "vi",
            credits_deducted: 20,
            result: { audio_url: "https://cdn.invalid/result.mp3" },
          })
        : new Response(Bun.file(result));
    },
  });
  try {
    const staged = await pg.stageDubbingFile(new File([Bun.file(source)], "source.mp3"));
    expect(staged.hasVideo).toBe(false);
    const store = openSharedArchive(archive);
    store.mutate("dubbing-sources", (rows) => {
      rows.find((row) => row.id === staged.id).hasVideo = true;
    });
    store.mutate("dubbing-jobs", (rows) =>
      rows.push({
        id: "legacy",
        taskId: "remote",
        phase: "download_interrupted",
        settings: {
          sourceId: staged.id,
          provider: "elevenlabs",
          voiceId: "actor",
          sourceLanguage: "en",
          targetLanguage: "vi",
          modelId: "eleven_v3",
        },
        createdAt: new Date().toISOString(),
        creditsDeducted: 20,
        downloads: {
          result: {
            url: "https://cdn.invalid/result.mp3",
            phase: "completed",
            bytes: Bun.file(result).size,
          },
        },
      }),
    );
    store.close();
    mkdirSync(join(archive, "video"), { recursive: true });
    writeFileSync(join(archive, "video", "pg_legacy.mp4"), readFileSync(result));
    const recovered = await pg.refreshDubbing("legacy");
    expect(recovered.phase).toBe("completed");
    expect(recovered.creditsDeducted).toBe(20);
    expect(pg.getDubbingSource(staged.id).hasVideo).toBe(false);
    expect(pg.dubbingAsset(recovered.itemId, "result")).toEndWith(".mp3");
    expect(readFileSync(pg.dubbingSourcePath(staged.id))).toEqual(readFileSync(source));
    expect(paid).toBe(0);
  } finally {
    pg.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
