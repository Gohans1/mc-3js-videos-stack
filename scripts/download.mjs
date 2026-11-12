import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function download(url, target, valid, { referer } = {}) {
  if (existsSync(target) && (await valid(target))) return false;
  mkdirSync(dirname(target), { recursive: true });
  const partial = `${target}.${process.pid}.part`;
  try {
    await run(
      process.platform === "win32" ? "curl.exe" : "curl",
      [
        "--fail",
        "--location",
        "--proto",
        "=https,http",
        "--proto-redir",
        "=https,http",
        "--max-filesize",
        "209715200",
        "--silent",
        "--show-error",
        "--retry",
        "2",
        "--retry-max-time",
        "60",
        "--connect-timeout",
        "15",
        "--max-time",
        "120",
        ...(referer ? ["--referer", referer] : []),
        "--output",
        partial,
        url,
      ],
      { timeout: 180_000, windowsHide: true },
    );
    if (!(await valid(partial))) throw new Error(`Invalid downloaded asset: ${url}`);
    renameSync(partial, target);
    return true;
  } finally {
    rmSync(partial, { force: true });
  }
}

export async function validAudio(path) {
  if (!existsSync(path) || readFileSync(path).length < 44) return false;
  try {
    const { stdout } = await run(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "json", path],
      { timeout: 30_000, windowsHide: true },
    );
    return Number(JSON.parse(stdout).format?.duration) > 0;
  } catch (error) {
    if (error.code === "ENOENT") throw error;
    return false;
  }
}

export async function validWav(path) {
  const data = readFileSync(path);
  if (
    data.length < 44 ||
    data.toString("ascii", 0, 4) !== "RIFF" ||
    data.toString("ascii", 8, 12) !== "WAVE"
  )
    return false;
  return validAudio(path);
}
