// Assembles voice/takes/NN.{mp3,wav} + .words.json onto full_voice.wav, updates edit.json voice.lines,
// builds renders/live/voice_map.json, and populates per-take draggable Phrase Bricks on src/timeline/audio.json.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cliArgs, jsonFile, needFilm } from "../../packages/live-studio/src/cli.mjs";
import { voiceMapOf } from "../../packages/live-studio/src/film.mjs";
import { compactJson } from "../../packages/live-studio/src/timeline_file.mjs";
import {
  planVoicePlacements,
  voiceFileOf,
  voiceFilterGraph,
  writeVoiceMap,
} from "../../packages/live-studio/src/voice-map.mjs";

const r3 = (x: number) => Math.round(x * 1000) / 1000;
let tmpSeq = 0;
const nextTmp = () => `${process.pid}.${Date.now()}.${++tmpSeq}`;

const inside = (root: string, file: string) => {
  const r = relative(root, file);
  return Boolean(r) && !r.startsWith("..") && !isAbsolute(r);
};

const assertInsideFilm = (realRoot: string, target: string, label: string) => {
  const abs = resolve(target);
  if (existsSync(abs) && lstatSync(abs).isSymbolicLink()) {
    throw new Error(`${label} must stay inside film directory (symlink refused)`);
  }
  let cur = abs;
  while (!existsSync(cur)) {
    const next = dirname(cur);
    if (next === cur) break;
    cur = next;
  }
  if (lstatSync(cur).isSymbolicLink()) {
    throw new Error(`${label} must stay inside film directory (symlinked parent refused)`);
  }
  const realAncestor = realpathSync(cur);
  const projected = resolve(realAncestor, relative(cur, abs));
  if (!inside(realRoot, projected)) {
    throw new Error(`${label} must stay inside film directory`);
  }
};

interface TakeEntry {
  id: string;
  t?: number;
  start?: number;
  text?: string;
  [k: string]: unknown;
}
interface AudioClip {
  at: number;
  start?: number;
  length?: number;
  name: string;
  gain: number;
  rate?: number;
  dialogue?: boolean;
  track?: string;
  gainKeys?: unknown[];
  [k: string]: unknown;
}
interface AudioTrack {
  id: string;
  name: string;
  mute?: boolean;
  lock?: boolean;
}
interface AudioDoc {
  narration?: string;
  voiceGain?: number;
  beds: unknown[];
  sfx: AudioClip[];
  tracks?: AudioTrack[];
  [k: string]: unknown;
}

const writeAtomicText = (target: string, content: string) => {
  mkdirSync(dirname(target), { recursive: true });
  const part = `${target}.${nextTmp()}.part`;
  writeFileSync(part, content, "utf8");
  renameSync(part, target);
};

const replaceWithRetry = async (fresh: string, target: string) => {
  for (let i = 0; i < 20; i++) {
    try {
      renameSync(fresh, target);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (i === 19 || (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY")) throw err;
      await new Promise((done) => setTimeout(done, 50));
    }
  }
};

const isPristineNarrationClips = (clips: AudioClip[]) =>
  clips.length === 0 ||
  (clips.length === 1 && clips[0].at === 0 && (clips[0].start ?? 0) === 0) ||
  clips.every(
    (c) => Math.abs(c.at - (c.start ?? 0)) < 1e-6 && (c.rate ?? 1) === 1 && !c.gainKeys?.length,
  );

export const runAssemble = async (opts: { cwd?: string; args?: string[] } = {}) => {
  const root = resolve(opts.cwd ?? process.cwd());
  const realRoot = realpathSync(root);
  const args = opts.args ?? process.argv.slice(2);
  const forceClips = args.includes("--clips");

  const editPath = join(root, "src/edit.json");
  assertInsideFilm(realRoot, editPath, "src/edit.json");
  const edit = jsonFile(editPath, root) as {
    end?: number;
    voice?: { lines: [number, number][]; edits: Record<string, unknown>; warp: [number, number][] };
    takes?: TakeEntry[];
    [k: string]: unknown;
  };
  const outWav = voiceFileOf(root);
  assertInsideFilm(realRoot, outWav, "Output path");
  const voiceMapPath = voiceMapOf(root);
  assertInsideFilm(realRoot, voiceMapPath, "Voice map path");
  mkdirSync(dirname(outWav), { recursive: true });

  const placed = planVoicePlacements(root, { strict: true });
  const lines: [number, number][] = placed.map((p) => [p.spokenStart, p.spokenEnd]);

  const maxNeed = placed.length ? r3(Math.max(...placed.map((p) => p.naturalEnd)) + 0.5) : 1;
  const end = Math.max(edit.end ?? 0, maxNeed);
  edit.end = end;

  const { inputs, filter } = voiceFilterGraph(placed, end);
  const freshWav = `${outWav}.${nextTmp()}.new.wav`;
  try {
    if (!filter) {
      const ff = spawnSync(
        "ffmpeg",
        [
          "-v",
          "error",
          "-y",
          "-f",
          "lavfi",
          "-t",
          String(end),
          "-i",
          "anullsrc=r=48000:cl=mono",
          "-c:a",
          "pcm_s16le",
          freshWav,
        ],
        { encoding: "utf8", timeout: 60_000, windowsHide: true },
      );
      if (ff.status !== 0) throw new Error(`ffmpeg silence failed: ${ff.stderr}`);
    } else {
      const ff = spawnSync(
        "ffmpeg",
        [
          "-v",
          "error",
          "-y",
          ...inputs,
          "-filter_complex",
          filter,
          "-map",
          "[out]",
          "-t",
          String(end),
          "-ac",
          "1",
          "-c:a",
          "pcm_s16le",
          freshWav,
        ],
        { encoding: "utf8", timeout: 120_000, windowsHide: true },
      );
      if (ff.status !== 0) throw new Error(`ffmpeg voice assemble failed: ${ff.stderr}`);
    }
    await replaceWithRetry(freshWav, outWav);
  } catch (err) {
    rmSync(freshWav, { force: true });
    throw err;
  }

  edit.voice ??= { lines: [], edits: {}, warp: [] };
  edit.voice.lines = lines;
  writeAtomicText(editPath, JSON.stringify(edit, null, 1) + "\n");
  writeVoiceMap(root, voiceMapPath, placed);

  // Slice audio.json narration into per-take draggable Phrase Bricks when narration is enabled and clips aren't custom-edited
  const pkgPath = join(root, "package.json");
  const conf = existsSync(pkgPath) ? (jsonFile(pkgPath, root)["live-studio"] ?? {}) : {};
  const audioRel = conf.soundTimeline ?? "src/timeline/audio.json";
  const audioPath = join(root, audioRel);
  assertInsideFilm(realRoot, audioPath, "Audio timeline path");
  let bricksWritten = 0;
  if (placed.length && existsSync(audioPath)) {
    const audio = jsonFile(audioPath, root) as AudioDoc;
    let narrationName = audio.narration;
    if (!narrationName && forceClips) {
      narrationName = "narration";
      audio.narration = narrationName;
    }
    if (narrationName) {
      const existing = (audio.sfx ?? []).filter((c) => c.name === narrationName);
      if (forceClips || isPristineNarrationClips(existing)) {
        const baseGain = existing[0]?.gain ?? audio.voiceGain ?? 0;
        let trackId = existing[0]?.track;
        if (!trackId && Array.isArray(audio.tracks)) {
          const found = audio.tracks.find((t) => t.id === "voice");
          if (found) trackId = found.id;
          else {
            audio.tracks.unshift({ id: "voice", name: "Voice" });
            trackId = "voice";
          }
        }
        const bricks: AudioClip[] = placed.map((p, idx) => {
          const nextStart = idx + 1 < placed.length ? placed[idx + 1].start : end;
          const clipEnd = Math.max(p.spokenEnd, Math.min(p.naturalEnd, nextStart));
          const length = r3(Math.max(0.05, clipEnd - p.start));
          return {
            at: p.start,
            start: p.start,
            length,
            name: narrationName,
            gain: baseGain,
            dialogue: true,
            ...(trackId ? { track: trackId } : {}),
          };
        });
        audio.sfx = [...bricks, ...(audio.sfx ?? []).filter((c) => c.name !== narrationName)];
        writeAtomicText(audioPath, compactJson(audio) + "\n");
        bricksWritten = bricks.length;
      }
    }
  }

  return { outWav, lines, bricksWritten };
};

const HELP = `Lays the narration takes (voice/takes/<id>.mp3|wav with .words.json) onto the film: writes full_voice.wav, the
lines in src/edit.json voice.lines, renders/live/voice_map.json and one draggable Phrase Brick per take in
src/timeline/audio.json. Run inside the film, after bun run voice:gen.
  bun run voice:assemble
  --clips   rewrite the Phrase Bricks even where they were moved by hand
Next: bun run voice:cues for the heard second of every line, word and gap.`;

const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  cliArgs(HELP, ["--clips"], 0);
  const film = needFilm(process.env.LIVE_PROJECT);
  const res = await runAssemble({ cwd: film }).catch((e: Error) => {
    console.error(e.message);
    process.exit(1);
  });
  console.log("full_voice.wav", res.lines.length, "takes,", res.bricksWritten, "phrase bricks");
  console.log(
    "next: bun run voice:cues for the second of every line and word; hear it: bun run studio. The draft video gets the new voice through bun run render clip (the picture follows the voice, so every chunk) then bun run mix renders/draft_video.mp4",
  );
}
