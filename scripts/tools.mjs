import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const both = (pkg) => ({ win32: pkg, darwin: pkg, linux: pkg });
// The programs the repo runs from PATH, what each is for and its package per OS (none: INSTALL.md says how).
// needed: setup:vault cannot finish without it; the rest are named so a human installs them before they are needed
const TOOLS = [
  { name: "curl", why: "downloads", needed: true, pkg: both("curl") },
  { name: "ffmpeg", why: "sound conversion and takes", needed: true, pkg: both("ffmpeg") },
  { name: "ffprobe", why: "sound lengths", needed: true, pkg: both("ffmpeg") },
  { name: "aria2c", why: "Sonniss torrent packs, bun run fetch:sound-raw", pkg: both("aria2") },
  {
    name: "python",
    why: "Jev ranking in bun run find, beat detection",
    pkg: { ...both("python"), linux: "python3" },
  },
  { name: "uv", why: "the earshot and whisperX venvs", pkg: { win32: "uv", darwin: "uv" } },
  { name: "earshot", why: "listening for the AI", pkg: {} },
  {
    name: "rubberband",
    why: "speed and pitch changes",
    pkg: { ...both("rubberband"), linux: "rubberband-cli" },
  },
];
// scripts/sound/process.py finds Rubber Band by RUBBERBAND, PATH, then this folder
const RUBBERBAND_HOME = join(
  homedir(),
  ".local/share/live-studio/tools/rubberband-4.0.0/rubberband.exe",
);
const MANAGER = { win32: "scoop install", darwin: "brew install", linux: "sudo apt install" };

export const toolCheck = (which = Bun.which, platform = process.platform) => {
  const stop = [],
    later = [];
  for (const { name, why, needed, pkg } of TOOLS) {
    if (
      which(name) ||
      (name === "rubberband" && (process.env.RUBBERBAND || existsSync(RUBBERBAND_HOME)))
    )
      continue;
    const how = pkg[platform] ? `${MANAGER[platform]} ${pkg[platform]}` : "see INSTALL.md";
    (needed ? stop : later).push(`${name} (${why}): ${how}`);
  }
  // a new Windows has no scoop, and every hint above uses it
  if (platform === "win32" && (stop.length || later.length) && !which("scoop"))
    (stop.length ? stop : later).unshift("scoop (installs the rest): see https://scoop.sh");
  return { stop, later };
};
