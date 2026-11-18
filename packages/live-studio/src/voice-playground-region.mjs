import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { renderAudio } from "./audio-process.mjs";

const run = promisify(execFile);
const command = (name, args, timeout = 120000) =>
  run(name, args, { windowsHide: true, timeout, maxBuffer: 1024 * 1024 });
export const probeAudioMedia = async (path) => {
  const { stdout } = await command(
    "ffprobe",
    [
      "-v",
      "error",
      "-protocol_whitelist",
      "file",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=codec_name,sample_rate,channels,bit_rate:format=duration,format_name,bit_rate",
      "-of",
      "json",
      path,
    ],
    15000,
  );
  const { streams, format } = JSON.parse(stdout);
  if (!streams?.length) throw new Error("The recording does not contain audio");
  const [audio] = streams;
  const number = (value) =>
    Number(value) > 0 && Number.isFinite(Number(value)) ? Number(value) : null;
  return {
    container: format?.format_name ?? null,
    codec: audio.codec_name ?? null,
    durationSeconds: number(format?.duration),
    sampleRateHz: number(audio.sample_rate),
    channels: number(audio.channels),
    bitRateBps: number(audio.bit_rate),
    containerBitRateBps: number(format?.bit_rate),
  };
};
const duration = async (path) => {
  const { stdout } = await command("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "json",
    path,
  ]);
  const seconds = Number(JSON.parse(stdout).format?.duration);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("Audio duration is unavailable");
  return seconds;
};

export const renderRegion = async (
  source,
  { from, to, rate = 1, pitch = 0, gainDb = 0, pause = 0, blendMs = 6, fitToSelection = false },
  { python = "python", replacement } = {},
) => {
  const total = await duration(source);
  if (!(from >= 0 && to > from && to <= total + 0.001))
    throw new Error("Choose a region inside the recording");
  const folder = await mkdtemp(join(tmpdir(), "voice-region-render-"));
  try {
    const patch = join(folder, "section.wav"),
      output = join(folder, "result.wav");
    const replacementDuration = replacement ? await duration(replacement) : 0;
    const targetDuration = to - from - pause;
    if (replacement && fitToSelection && targetDuration <= 0)
      throw new Error("Choose a longer region than the added pause");
    const effectiveRate =
      replacement && fitToSelection ? replacementDuration / targetDuration : rate;
    const section = await renderAudio(
      replacement || source,
      {
        start: replacement ? 0 : from,
        duration: (replacement ? replacementDuration : to - from) / effectiveRate,
        rate: effectiveRate,
        pitch,
      },
      python,
    );
    await writeFile(patch, section);
    const sectionDuration = await duration(patch);
    const samples = (time) => Math.round(time * 48000);
    const start = samples(from),
      end = samples(to);
    const blend = Math.min(
      samples(blendMs / 1000),
      Math.floor((end - start) / 4),
      Math.floor(samples(sectionDuration) / 4),
    );
    const graph = [
      `[0:a]aresample=48000,aformat=sample_fmts=flt:channel_layouts=stereo,asplit=${blend > 0 ? 4 : 2}[p][s]${blend > 0 ? "[l][r]" : ""}`,
      `[p]atrim=end_sample=${start},asetpts=PTS-STARTPTS[pre]`,
      `[s]atrim=start_sample=${end},asetpts=PTS-STARTPTS[post]`,
      `[1:a]volume=${10 ** (gainDb / 20)},apad=pad_len=${samples(pause)}[mid]`,
    ];
    if (blend > 0)
      graph.push(
        `[l]atrim=start_sample=${start}:end_sample=${start + blend},asetpts=PTS-STARTPTS[left]`,
        `[r]atrim=start_sample=${end - blend}:end_sample=${end},asetpts=PTS-STARTPTS[right]`,
        `[left][mid]acrossfade=nb_samples=${blend}:curve1=tri:curve2=tri[fade]`,
        `[fade][right]acrossfade=nb_samples=${blend}:curve1=tri:curve2=tri[edited]`,
      );
    graph.push(`[pre][${blend > 0 ? "edited" : "mid"}][post]concat=n=3:v=0:a=1[out]`);
    await command("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-i",
      source,
      "-i",
      patch,
      "-filter_complex",
      graph.join(";"),
      "-map",
      "[out]",
      "-c:a",
      "pcm_f32le",
      output,
    ]);
    if ((await stat(output)).size > 384 * 1024 * 1024)
      throw new Error("Edited audio exceeds 384 MB; choose a shorter recording");
    return {
      bytes: await readFile(output),
      durationSeconds: await duration(output),
      regionSeconds: sectionDuration + pause,
      fitRate: effectiveRate,
    };
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
};

export { duration as probeAudioDuration };
const mapTime = (seconds, { from, to, rate = 1, pause = 0 }, end) => {
  const duration = (to - from) / rate;
  const shifted =
    seconds <= from
      ? seconds
      : seconds > to || (seconds === to && !end)
        ? seconds + duration + pause - (to - from)
        : from + (seconds - from) / rate;
  return Math.round(shifted * 1000) / 1000;
};
export const retimeWords = (words, edit) =>
  words.map((word) => ({
    ...word,
    s: mapTime(word.s, edit, false),
    e: mapTime(word.e, edit, true),
  }));
const read = (text) => {
  const [h, m, s] = text.replace(",", ".").split(":").map(Number);
  return h * 3600 + m * 60 + s;
};
const print = (time) => {
  const ms = Math.round(time * 1000),
    pad = (n, width = 2) => String(n).padStart(width, "0");
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
};
export const retimeSrt = (srt, edit) =>
  srt.replace(
    /(\d{2,}:\d{2}:\d{2}[,.]\d{3})(\s*-->\s*)(\d{2,}:\d{2}:\d{2}[,.]\d{3})/g,
    (_, start, arrow, end) =>
      `${print(mapTime(read(start), edit, false))}${arrow}${print(mapTime(read(end), edit, true))}`,
  );
