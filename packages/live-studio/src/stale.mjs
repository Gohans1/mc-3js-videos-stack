// Is a rendered video older than the film data its picture comes from? framecheck imports it; sheet.py and jumps.py run
// `bun stale.mjs <video>` inside the film and print what it prints. The sound timeline is left out: it never changes a frame.
// draft.mp4 and final.mp4 are mix's: <name>_video.mp4's picture with the sound of when mix ran, so their sound counts too.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

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
  const shown = relative(root, file).replaceAll("\\", "/");
  const picture =
    /^(draft|final)\.mp4$/.test(basename(file)) && file.replace(/\.mp4$/, "_video.mp4");
  if (picture) {
    const rel = (p) => relative(root, p).replaceAll("\\", "/");
    const mix = `bun run mix ${rel(picture)}`;
    if (existsSync(picture) && statSync(picture).mtimeMs > made)
      return {
        file: rel(picture),
        message: `${shown} has an older picture than ${rel(picture)}: ${mix} puts the new picture with the sound`,
      };
    if (newest)
      return {
        file: newest.rel,
        message: `${shown} is older than ${newest.rel}: its frames may not show that change; bun run render clip draws the picture again, then ${mix}`,
      };
    const heard = [
      sound && join(root, sound),
      join(root, "assets/public/agent/full_voice.wav"),
    ].find((p) => p && existsSync(p) && statSync(p).mtimeMs > made);
    return heard
      ? { file: rel(heard), message: `${shown} has an older sound than ${rel(heard)}: ${mix}` }
      : null;
  }
  if (!newest) return null;
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
