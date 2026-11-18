import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
export async function probeVoiceSample(path) {
  const { stdout } = await run(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", path],
    { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 },
  );
  const info = JSON.parse(stdout);
  return {
    hasAudio: info.streams?.some((stream) => stream.codec_type === "audio") === true,
    durationSeconds: Number(info.format?.duration),
  };
}
