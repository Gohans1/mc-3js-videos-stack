// Is a rendered video older than the film data its picture comes from? framecheck and pace import it; sheet.py and deliver.py run
// `bun stale.mjs <video>` inside the film and print what it prints. Of the sound timeline only the narration clips change a
// frame (the mouths follow them): a video ages when they moved since render drew it (<chunks>/seen-sound.json, seenSound).
// draft.mp4 and final.mp4 are mix's: <name>_video.mp4's picture with the sound of when mix ran, so their sound counts too.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { seenSound } from "./narration.ts";
import { drawnCuts, filmVideo, readRenderEvidence, renderIdentity } from "./video.mjs";

const mixer = fileURLToPath(new URL("../../../scripts/sound/mix.py", import.meta.url));

const currentAudioSources = (root, names) => {
  const result = spawnSync("python", [mixer, "--resolve-audio"], {
    cwd: root,
    input: JSON.stringify({ names }),
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
};

export const staleVideo = (root, video) => {
  const file = resolve(root, video);
  const where = filmVideo(root, file);
  const legacyCutList = file === resolve(root, "renders/cuts.json") && existsSync(file);
  if (!where && !legacyCutList) return null;
  const made = statSync(file).mtimeMs;
  const picture = where?.mixed && file.replace(/\.mp4$/, "_video.mp4");
  const pictureFile = picture && existsSync(picture) ? picture : file;
  const pictureMade = pictureFile === file ? made : statSync(pictureFile).mtimeMs;
  const evidence = readRenderEvidence(pictureFile);
  const mixedEvidence = picture ? readRenderEvidence(file) : null;
  const relName = (p) => relative(root, p).replaceAll("\\", "/");
  if ((mixedEvidence && !("size" in mixedEvidence)) || (evidence && !("size" in evidence))) {
    const bad = mixedEvidence && !("size" in mixedEvidence) ? file : pictureFile;
    const render = `bun run render ${where?.final ? "final" : "clip"}`;
    const next =
      bad === file && picture
        ? `bun run mix ${relName(picture)}`
        : picture
          ? `${render}, then bun run mix ${relName(picture)}`
          : render;
    return {
      file: relName(bad),
      message: `review metadata no longer matches ${relName(bad)}; ${next}`,
    };
  }
  let config = {};
  try {
    config = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))["live-studio"] ?? {};
  } catch {}
  const sound = config.soundTimeline ?? "src/timeline/audio.json";
  const hasNarrationSnapshot = Boolean(config.soundTimeline || evidence?.seenSound);
  let newest = null;
  const consider = (p) => {
    const rel = relative(root, p).replaceAll("\\", "/");
    const m = statSync(p).mtimeMs;
    if ((!hasNarrationSnapshot || rel !== sound) && m > pictureMade && (!newest || m > newest.m))
      newest = { rel, m };
  };
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) consider(p);
    }
  };
  if (existsSync(join(root, "src"))) walk(join(root, "src"));
  const shown = relative(root, file).replaceAll("\\", "/");
  const choices = ["choices.json", "sound_choices.json"].find((p) => existsSync(join(root, p)));
  for (const rel of [
    "package.json",
    config.camTimeline,
    config.lightsTimeline,
    config.shotsTimeline,
    config.textTimeline,
    config.adjustTimeline,
    config.timingTimeline,
    ...Object.keys(config.keyFiles ?? {}),
  ]) {
    if (typeof rel === "string" && existsSync(resolve(root, rel))) consider(resolve(root, rel));
  }
  let choiceChanged;
  if (evidence?.pictureChoices)
    try {
      const picked = choices ? JSON.parse(readFileSync(join(root, choices), "utf8")) : {};
      choiceChanged = Object.entries(evidence.pictureChoices).some(
        ([id, set]) => (picked[id]?.set ?? null) !== set,
      );
    } catch {}
  if (choiceChanged === true && !newest)
    newest = { rel: choices ?? "choices.json (removed)", m: Date.now() };
  else if (choiceChanged === undefined && choices) consider(join(root, choices));
  let voiceMoved = false;
  const drawnWith = join(
    root,
    "renders",
    where?.final ? "final_chunks" : "chunks",
    "seen-sound.json",
  );
  if (sound)
    try {
      const before =
        evidence?.seenSound ??
        (where?.kind !== "span" && existsSync(drawnWith) ? readFileSync(drawnWith, "utf8") : null);
      if (before != null) {
        const now = seenSound(JSON.parse(readFileSync(join(root, sound), "utf8")));
        voiceMoved = JSON.stringify(now) !== before;
      }
    } catch {}
  const moved = `the narration clips moved in ${sound} since it was drawn (the mouths follow them)`;
  const oldChunks = evidence?.oldChunks;
  if (!voiceMoved && Array.isArray(oldChunks) && oldChunks.length) {
    const again = `bun run render ${where?.final ? "final" : "clip"}`;
    const remix = picture
      ? `, then bun run mix ${relative(root, picture).replaceAll("\\", "/")}`
      : "";
    return {
      file: relative(root, pictureFile).replaceAll("\\", "/"),
      message: `${shown} joins older chunks (${oldChunks.join(", ")}); ${again} updates them${remix}`,
    };
  }
  if (picture) {
    const rel = (p) => relative(root, p).replaceAll("\\", "/");
    const mix = `bun run mix ${rel(picture)}`;
    const storedPicture = mixedEvidence?.pictureInput;
    if (storedPicture) {
      if (!existsSync(picture)) {
        const draw = `bun run render ${where?.final ? "final" : "clip"}`;
        return {
          file: rel(picture),
          message: `${shown}'s input picture is missing: ${draw}, then ${mix}`,
        };
      }
      const current = renderIdentity(picture);
      if (current.size !== storedPicture.size || current.mtimeMs !== storedPicture.mtimeMs)
        return {
          file: rel(picture),
          message: `${shown} was mixed from a different version of ${rel(picture)}: ${mix}`,
        };
    }
    if (!storedPicture && pictureMade > made)
      return {
        file: rel(picture),
        message: `${shown} has an older picture than ${rel(picture)}: ${mix} puts the new picture with the sound`,
      };
    if (voiceMoved)
      return {
        file: sound,
        message: `${shown}: ${moved}; bun run render ${where?.final ? "final" : "clip"} draws them again, then ${mix}`,
      };
    if (newest)
      return {
        file: newest.rel,
        message: `${shown} has a picture older than ${newest.rel}: its frames may not show that change; bun run render ${basename(file) === "final.mp4" ? "final" : "clip"} draws the picture again, then ${mix}`,
      };
    if (mixedEvidence && Object.hasOwn(mixedEvidence, "audioChoices")) {
      const recorded = mixedEvidence.audioChoices;
      const current = choices ? { file: choices, ...renderIdentity(join(root, choices)) } : null;
      if (
        recorded?.file !== current?.file ||
        recorded?.size !== current?.size ||
        recorded?.mtimeMs !== current?.mtimeMs
      ) {
        const changed = choices ?? recorded.file;
        return {
          file: changed,
          message: `${shown} used different audio choices (${changed}): ${mix}`,
        };
      }
    }
    const inputs = mixedEvidence?.audioInputs;
    for (const item of Array.isArray(inputs) ? inputs : []) {
      if (typeof item?.path !== "string") continue;
      const usedPath = resolve(root, item.path);
      let identity = null;
      try {
        identity = renderIdentity(usedPath);
      } catch {}
      if (
        item.missing
          ? identity !== null
          : identity?.mtimeMs !== item.mtimeMs || identity?.size !== item.size
      )
        return {
          file: rel(usedPath),
          message: `${shown} used a different audio input (${rel(usedPath)}): ${mix}`,
        };
    }
    const sources = Object.entries(mixedEvidence?.audioSources ?? {});
    if (sources.length) {
      const now = currentAudioSources(
        root,
        sources.map(([name]) => name),
      );
      if (!now)
        return {
          file: sound,
          message: `could not verify audio source selection for ${shown}; bun run check, then ${mix}`,
        };
      for (const [name, oldPath] of sources) {
        if (now[name] !== oldPath) {
          const changed = now[name] ?? oldPath;
          return {
            file: changed,
            message: `${shown} used a different file for audio cue ${name} (${changed}): ${mix}`,
          };
        }
      }
    }
    const heard = [
      sound && join(root, sound),
      choices && join(root, choices),
      join(root, "assets/public/agent/full_voice.wav"),
    ].find((p) => p && existsSync(p) && statSync(p).mtimeMs > made);
    return heard
      ? { file: rel(heard), message: `${shown} has an older sound than ${rel(heard)}: ${mix}` }
      : null;
  }
  if (!newest && !voiceMoved) return null;
  // a chunk's stamp covers the whole built film (render.mjs stamp), so any change draws every chunk again
  const again = where?.final
    ? "bun run render final draws it again"
    : where?.kind === "span"
      ? `SPAN=${where.span.join(",")} bun run render clip draws it again`
      : "bun run render clip draws it again (CHUNKS=<n> for one 30 s chunk only)";
  if (!newest) return { file: sound, message: `${shown}: ${moved}; ${again}` };
  return {
    file: newest.rel,
    message: `${shown} is older than ${newest.rel} (changed ${Math.max(1, Math.round((newest.m - made) / 60000))} min after it): its frames may not show that change; ${again}`,
  };
};

if (import.meta.main) {
  const { cliArgs } = await import("./cli.mjs");
  const args = cliArgs(
    `Check whether a video predates its film inputs; read-only.
  bun ../../packages/live-studio/src/stale.mjs [video] [--json]
Run inside a film, or set LIVE_PROJECT. Default: renders/draft_video.mp4.
Prints the changed input and rerender advice when stale; prints nothing otherwise.
--json prints the recognized render, its film offset, and any stale reason.`,
    ["--json"],
    1,
  );
  const video = args.find((a) => a !== "--json") ?? "renders/draft_video.mp4";
  const root = process.env.LIVE_PROJECT || process.cwd();
  const stale = staleVideo(root, video);
  if (args.includes("--json")) {
    const render = filmVideo(root, video);
    console.log(
      JSON.stringify({ render, stale, cuts: render ? drawnCuts(root, video, stale) : null }),
    );
  } else if (stale) console.log(stale.message);
}
