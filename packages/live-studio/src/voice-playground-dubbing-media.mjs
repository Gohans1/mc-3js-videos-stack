import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
export async function probeDubbingMedia(path, { signal } = {}) {
  const { stdout } = await run(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration,format_name:stream=codec_type:stream_disposition=attached_pic",
      "-of",
      "json",
      path,
    ],
    { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024, signal },
  );
  const info = JSON.parse(stdout);
  return {
    hasAudio: info.streams?.some((s) => s.codec_type === "audio") === true,
    hasVideo:
      info.streams?.some((s) => s.codec_type === "video" && s.disposition?.attached_pic !== 1) ===
      true,
    durationSeconds: Number(info.format?.duration),
    format: info.format?.format_name,
  };
}
const subtitleText = (srt) =>
  srt
    .split(/\r?\n\s*\r?\n/)
    .map((block) =>
      block
        .split(/\r?\n/)
        .filter((line) => !/^\d+$/.test(line.trim()) && !line.includes("-->"))
        .join(" ")
        .trim(),
    )
    .filter(Boolean)
    .join("\n");
export function createDubbingArchiver({ dir, scope, sourceFor, download, saveItem, apiBase }) {
  return async (task, job, { signal, save = async () => {} } = {}) => {
    if (typeof task.result?.audio_url !== "string")
      throw new Error("Dubbing completed without a downloadable result; refresh its history");
    const id = `pg_${job.id}`,
      source = await sourceFor(job, { signal }),
      video =
        source?.hasVideo === true ||
        Boolean(task.metadata?.original_video_url) ||
        /\.mp4(?:[?#]|$)/i.test(task.result.audio_url);
    for (const folder of ["audio", "video", "srt", "sources"])
      mkdirSync(join(dir, folder), { recursive: true });
    const downloads = { ...job.downloads };
    const fetchSaved = async (key, url, folder, file, maxBytes) => {
      const destination = join(dir, folder, file),
        checkpoint = downloads[key];
      if (!(checkpoint?.phase === "completed" && existsSync(destination))) {
        await download({
          url,
          destination,
          maxBytes,
          signal,
          checkpoint,
          save: async (next) => {
            downloads[key] = next;
            await save({ downloads: { ...downloads } });
          },
        });
      }
      signal?.throwIfAborted();
      return destination;
    };
    let sourceFile = source?.path ? basename(source.path) : undefined;
    if (!sourceFile) {
      const url = task.metadata?.original_video_url || task.source_audio_url;
      if (typeof url === "string" && url) {
        sourceFile = `duborig_${job.id}${task.metadata?.original_video_url ? ".mp4" : ".mp3"}`;
        await fetchSaved("original", url, "sources", sourceFile, 2 * 1024 ** 3);
      }
    }
    const resultFile = `${id}${video ? ".mp4" : ".mp3"}`,
      result = await fetchSaved(
        "result",
        task.result.audio_url,
        video ? "video" : "audio",
        resultFile,
        2 * 1024 ** 3,
      ),
      info = await probeDubbingMedia(result, { signal });
    if (
      !info.hasAudio ||
      info.hasVideo !== video ||
      !Number.isFinite(info.durationSeconds) ||
      info.durationSeconds <= 0
    )
      throw new Error("Downloaded Dubbing result has no valid matching audio/video stream");
    const audioFile = `${id}.mp3`,
      audioPath = join(dir, "audio", audioFile);
    if (video && !existsSync(audioPath)) {
      const part = `${audioPath}.part`;
      try {
        await run(
          "ffmpeg",
          [
            "-v",
            "error",
            "-y",
            "-i",
            result,
            "-map",
            "0:a:0",
            "-vn",
            "-c:a",
            "libmp3lame",
            "-q:a",
            "2",
            "-f",
            "mp3",
            part,
          ],
          { windowsHide: true, timeout: 20 * 60_000, maxBuffer: 1024 * 1024, signal },
        );
        signal?.throwIfAborted();
        renameSync(part, audioPath);
      } catch (error) {
        rmSync(part, { force: true });
        throw error;
      }
    }
    let srtFile, srtText;
    if (typeof task.result.srt_url === "string" && task.result.srt_url) {
      srtFile = `${id}.srt`;
      const path = await fetchSaved(
        "subtitles",
        task.result.srt_url,
        "srt",
        srtFile,
        8 * 1024 * 1024,
      );
      srtText = readFileSync(path, "utf8");
    }
    const now = new Date().toISOString(),
      settings = job.settings;
    return saveItem({
      id,
      scope,
      kind: "dubbing",
      title:
        job.title ||
        `${source?.filename || task.metadata?.source_file_name || "Dubbed recording"} · ${settings.targetLanguage}`,
      text: srtText ? subtitleText(srtText) : "",
      tags: [],
      provider: settings.provider,
      voiceId: settings.provider === "minimax" ? settings.ttsVoiceId || "" : settings.voiceId,
      voiceName: settings.voiceName || task.metadata?.voice_name || settings.voiceId,
      modelId: settings.modelId,
      languageCode: settings.targetLanguage,
      voiceSettings: {},
      audioFile,
      mimeType: "audio/mpeg",
      bytes: statSync(audioPath).size,
      durationSeconds: info.durationSeconds,
      srtFile,
      srtText,
      remoteTaskId: task.id,
      creditsDeducted: job.creditsDeducted,
      favorite: false,
      isTemplate: false,
      exportTranscript: Boolean(srtFile),
      rights: { status: "unverified", checkedAt: now },
      createdAt: job.createdAt,
      updatedAt: now,
      dubbing: {
        jobId: job.id,
        taskId: task.id,
        sourceFile,
        sourceName: source?.filename || task.metadata?.source_file_name,
        sourceLanguage: settings.sourceLanguage,
        targetLanguage: settings.targetLanguage,
        voiceId: settings.voiceId,
        ttsVoiceId: settings.ttsVoiceId,
        modelId: settings.modelId,
        resultFile: video ? resultFile : undefined,
        estimatedCredits: job.estimatedCredits,
        sourceUrl: apiBase(),
        createdAt: job.createdAt,
      },
    });
  };
}
