import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { documentText, type Part } from "./model";
import { type Asset, type Segment } from "./store";

export const chunks = (duration: number): Segment[] => {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 86400)
    throw new Error("Media duration must be between 0 and 86400 seconds");
  const limit = 30;
  const segments = Array.from({ length: Math.ceil(duration / limit) }, (_, i) => ({
    from: i * limit,
    to: Math.min(duration, (i + 1) * limit),
  }));
  // A sub-frame tail encodes no content and Gemini rejects the near-empty audio/video as INVALID_ARGUMENT.
  const tail = segments.at(-1)!,
    previous = segments.at(-2);
  if (previous && tail.to - tail.from < 0.05) {
    previous.to = tail.to;
    segments.pop();
  }
  return segments;
};
const run = (tool: string, args: string[], deadline: number, limit: number) => {
  const timeout = Math.min(limit, deadline - Date.now());
  if (timeout < 1) throw new Error("Index time limit reached; completed vectors are saved");
  const result = spawnSync(tool, args, {
    encoding: "utf8",
    timeout,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || result.status !== 0)
    throw new Error(`${tool}: ${result.error?.message ?? result.stderr.slice(-1000)}`);
  return result.stdout;
};
const localFile = (asset: Asset) => {
  const file = resolve(asset.media!.file);
  if (!statSync(file).isFile()) throw new Error(`Media is not a file: ${file}`);
  return file;
};
export const sourceHash = async (asset: Asset, deadline: number) => {
  if (!asset.media) return "text";
  const hash = createHash("sha256"),
    stream = createReadStream(localFile(asset));
  try {
    for await (const data of stream) {
      if (Date.now() >= deadline)
        throw new Error("Index time limit reached while hashing; resume later");
      hash.update(data);
    }
    return hash.digest("hex");
  } finally {
    stream.destroy();
  }
};
export const segmentsFor = (asset: Asset, deadline = Date.now() + 10000): Segment[] => {
  if (!asset.media || asset.media.kind === "image") return [{ from: 0, to: 0 }];
  const output = run(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "json", localFile(asset)],
    deadline,
    10000,
  );
  const data = JSON.parse(output) as { format?: { duration?: string } };
  return chunks(Number(data.format?.duration));
};
export const inputFor = async (asset: Asset, spec: Segment, deadline: number): Promise<Part[]> => {
  const content: Part[] = [
    { type: "text", text: documentText(asset.title, asset.text, !!asset.media) },
  ];
  if (!asset.media) return content;
  const source = localFile(asset),
    folder = mkdtempSync(join(tmpdir(), "film-embedding-"));
  try {
    const kind = asset.media.kind,
      extension = kind === "audio" ? "mp3" : kind === "video" ? "mp4" : "png";
    const file = join(folder, `input.${extension}`);
    const trim = kind === "image" ? [] : ["-ss", String(spec.from)];
    const output =
      kind === "audio"
        ? [
            "-t",
            String(spec.to - spec.from),
            "-vn",
            "-ac",
            "2",
            "-ar",
            "48000",
            "-c:a",
            "libmp3lame",
            "-b:a",
            "128k",
          ]
        : kind === "video"
          ? [
              "-t",
              String(spec.to - spec.from),
              "-an",
              "-vf",
              "fps=1:round=up,scale=512:512:force_original_aspect_ratio=decrease:force_divisible_by=2",
              "-c:v",
              "libx264",
              "-pix_fmt",
              "yuv420p",
              "-crf",
              "28",
            ]
          : ["-frames:v", "1", "-vf", "scale=768:768:force_original_aspect_ratio=decrease"];
    run(
      "ffmpeg",
      [
        "-nostdin",
        "-v",
        "error",
        "-y",
        ...trim,
        "-i",
        source,
        ...output,
        "-map_metadata",
        "-1",
        file,
      ],
      deadline,
      45000,
    );
    if (statSync(file).size > 8 * 1024 * 1024)
      throw new Error("Prepared media exceeds the local 8 MB request cap");
    const data = `data:${kind === "audio" ? "audio/mp3" : kind === "video" ? "video/mp4" : "image/png"};base64,${readFileSync(file).toString("base64")}`;
    content.push(
      kind === "audio"
        ? { type: "input_audio", input_audio: { data, format: "mp3" } }
        : kind === "video"
          ? { type: "input_video", input_video: { data } }
          : { type: "image_url", image_url: { url: data } },
    );
    return content;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
};
