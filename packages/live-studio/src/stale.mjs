// Is a rendered video older than the film data its picture comes from? framecheck imports it; sheet.py and jumps.py run
// `bun stale.mjs <video>` inside the film and print what it prints. The sound timeline is left out: it never changes a frame.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export const staleVideo = (root, video) => {
  const file = resolve(root, video);
  if (!existsSync(file)) return null;
  const made = statSync(file).mtimeMs;
  let sound = null;
  try {
    sound =
      JSON.parse(readFileSync(join(root, "package.json"), "utf8"))["live-studio"]?.soundTimeline ??
      null;
  } catch {}
  let newest = null;
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else {
        const rel = relative(root, p).replaceAll("\\", "/");
        const m = statSync(p).mtimeMs;
        if (rel !== sound && m > made && (!newest || m > newest.m)) newest = { rel, m };
      }
    }
  };
  if (existsSync(join(root, "src"))) walk(join(root, "src"));
  if (!newest) return null;
  const shown = relative(root, file).replaceAll("\\", "/");
  // a chunk's stamp covers the whole built film (render.mjs stamp), so any change draws every chunk again
  const again = shown.endsWith("final_video.mp4")
    ? "bun run render final draws it again"
    : "bun run render clip draws it again (CHUNKS=<n> for one 30 s chunk only)";
  return {
    file: newest.rel,
    message: `${shown} is older than ${newest.rel} (changed ${Math.max(1, Math.round((newest.m - made) / 60000))} min after it): its frames may not show that change; ${again}`,
  };
};

if (import.meta.main) {
  const s = staleVideo(
    process.env.LIVE_PROJECT || process.cwd(),
    process.argv[2] ?? "renders/draft_video.mp4",
  );
  if (s) console.log(s.message);
}
