import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { downloadDubbingFile } from "../src/voice-playground-dubbing-download.mjs";
import {
  createDubbingArchiver,
  probeDubbingMedia,
} from "../src/voice-playground-dubbing-media.mjs";

test("a dubbed video retains original source and video, while a separate real audio track and translated subtitles become a film recording", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dubbing-media-")),
    fixture = join(dir, "source.mp4");
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
      fixture,
    ],
    { windowsHide: true, timeout: 30000 },
  );
  const original = readFileSync(fixture),
    srt = "1\n00:00:00,000 --> 00:00:00,400\nXin chào.\n";
  let stored,
    downloads = 0,
    checkpoint = {};
  const archive = createDubbingArchiver({
    dir,
    scope: "project",
    apiBase: () => "https://api.genvoice.pro/v1",
    sourceFor: () => ({ path: fixture, filename: "source.mp4", hasVideo: true }),
    download: (options) =>
      downloadDubbingFile({
        ...options,
        checkUrl: async () => {},
        fetchImpl: async (url) => {
          downloads++;
          return new Response(url.endsWith(".srt") ? srt : original);
        },
      }),
    saveItem: async (item) => {
      stored ??= item;
      return stored;
    },
  });
  const job = {
    id: "dub_media",
    settings: {
      sourceId: "original",
      provider: "minimax",
      sourceLanguage: "en",
      targetLanguage: "vi",
      voiceId: "Wise_Woman",
      voiceName: "Wise Woman",
      modelId: "speech-2.8-hd",
    },
    createdAt: new Date().toISOString(),
    estimatedCredits: 20,
    creditsDeducted: 20,
  };
  try {
    const item = await archive(
      {
        id: "cloud_media",
        result: {
          audio_url: "https://cdn.invalid/result.mp4",
          srt_url: "https://cdn.invalid/vi.srt",
        },
      },
      job,
      {
        save: async (patch) => {
          checkpoint = { ...checkpoint, ...patch };
        },
      },
    );
    expect(item.kind).toBe("dubbing");
    expect(item.languageCode).toBe("vi");
    expect(item.text).toContain("Xin chào.");
    expect(item.dubbing.resultFile).toEndWith(".mp4");
    expect(item.voiceId).toBe("");
    expect(item.dubbing.voiceId).toBe("Wise_Woman");
    expect(await probeDubbingMedia(join(dir, "audio", item.audioFile))).toMatchObject({
      hasAudio: true,
      hasVideo: false,
    });
    expect(readFileSync(join(dir, "video", item.dubbing.resultFile))).toEqual(original);
    expect(readFileSync(fixture)).toEqual(original);
    expect(readFileSync(join(dir, "srt", item.srtFile), "utf8")).toBe(srt);
    const again = await archive(
      {
        id: "cloud_media",
        result: {
          audio_url: "https://cdn.invalid/result.mp4",
          srt_url: "https://cdn.invalid/vi.srt",
        },
      },
      { ...job, ...checkpoint },
    );
    expect(again.id).toBe(item.id);
    expect(downloads).toBe(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
