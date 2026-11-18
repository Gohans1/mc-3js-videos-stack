// Assembles voice/takes/NN.{mp3,wav} + .words.json onto full_voice.wav, updates edit.json voice.lines,
// builds renders/live/voice_map.json, and populates per-take draggable Phrase Bricks on src/timeline/audio.json.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cliArgs, envTypos, jsonFile, needFilm } from "../../packages/live-studio/src/cli.mjs";
import { SoundTimeline } from "../../packages/live-studio/src/contract.ts";
import { voiceMapOf } from "../../packages/live-studio/src/film.mjs";
import {
  MOUTH_MAP,
  speakingTakes,
  writeMouthMap,
} from "../../packages/live-studio/src/mouth-map.mjs";
import { startJob } from "../../packages/live-studio/src/tell.mjs";
import { compactJson } from "../../packages/live-studio/src/timeline_file.mjs";
import {
  assertInsideDir,
  planVoicePlacements,
  voiceFileOf,
  voiceFilterGraph,
  type VoicePlacement,
  writeVoiceMap,
} from "../../packages/live-studio/src/voice-map.mjs";

const r3 = (x: number) => Math.round(x * 1000) / 1000;
let tmpSeq = 0;
const nextTmp = () => `${process.pid}.${Date.now()}.${++tmpSeq}`;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const assertInsideFilm = (root: string, target: string, label: string) => {
  try {
    return assertInsideDir(root, target, label);
  } catch (err) {
    throw new Error(`${label} must stay inside film directory: ${(err as Error).message}`);
  }
};

const findNarrationOffChoice = (root: string, narrationName: string): string | null => {
  for (const name of ["choices.json", "sound_choices.json"]) {
    const p = join(root, name);
    if (!existsSync(p)) continue;
    try {
      assertInsideFilm(root, p, name);
      const raw = JSON.parse(readFileSync(p, "utf8")) as Record<string, { set?: unknown }>;
      if (isPlainObject(raw) && raw[narrationName]?.set === "off") return name;
    } catch {
      /* choices.json schema/parse issues are validated by bun run check */
    }
  }
  return null;
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

const writeAtomicText = async (target: string, content: string) => {
  mkdirSync(dirname(target), { recursive: true });
  const part = `${target}.${nextTmp()}.part`;
  try {
    writeFileSync(part, content, "utf8");
    await replaceWithRetry(part, target);
  } catch (err) {
    rmSync(part, { force: true });
    throw err;
  }
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

const isUntouchedClip = (c: AudioClip) =>
  Math.abs(c.at - (c.start ?? 0)) < 1e-6 &&
  (c.rate ?? 1) === 1 &&
  c.dialogue !== false &&
  !c.gainKeys?.length &&
  !c.pitch &&
  !c.changePitch &&
  !c.reverse &&
  (!c.voiceFilter || c.voiceFilter === "none") &&
  !c.voiceStrength &&
  !(Array.isArray(c.filters) && c.filters.length) &&
  !c.pan &&
  !c.fadeIn &&
  !c.fadeOut &&
  !(Array.isArray(c.try) && c.try.length) &&
  !(Array.isArray(c.beats) && c.beats.length) &&
  !c.duck &&
  !c.duckRelease;

const isPristineNarrationClips = (
  clips: AudioClip[],
  expected: readonly Pick<VoicePlacement, "start" | "spokenEnd" | "naturalEnd">[],
  assembled: boolean,
) => {
  if (clips.length === 0) return !assembled;
  if (!clips.every(isUntouchedClip)) return false;
  if (clips.length === 1) {
    const c = clips[0];
    if (Math.abs(c.at) < 1e-6 && Math.abs(c.start ?? 0) < 1e-6) {
      if (c.length === undefined) return true;
      if (!assembled && expected.length > 1) {
        const firstEnd = Math.max(
          expected[0].spokenEnd,
          Math.min(expected[0].naturalEnd, expected[1].start),
        );
        if (c.length > r3(firstEnd - expected[0].start) + 0.25) return true;
      }
    }
  }
  return (
    clips.length === expected.length &&
    clips.every((c, i) => {
      const p = expected[i];
      const end = Math.max(p.spokenEnd, Math.min(p.naturalEnd, expected[i + 1]?.start ?? Infinity));
      return (
        Math.abs(c.at - p.start) < 1e-6 &&
        Math.abs((c.start ?? 0) - p.start) < 1e-6 &&
        c.length === r3(Math.max(0.05, end - p.start)) &&
        c.gain === clips[0].gain &&
        c.track === clips[0].track
      );
    })
  );
};

const retargetBrick = (
  clip: AudioClip,
  previous: readonly VoicePlacement[],
  placed: readonly VoicePlacement[],
) => {
  const start = clip.start ?? 0;
  const old = previous.find((p) => start >= p.start - 1e-6 && start < p.naturalEnd - 1e-6);
  if (!old) return clip;
  const next = placed.find((p) => p.id === old.id);
  if (!next) return null;
  if (old.start === next.start && old.naturalEnd === next.naturalEnd) return clip;
  const newStart = r3(next.start + start - old.start);
  const available = r3(next.naturalEnd - newStart);
  if (available <= 0) return null;
  const rate = clip.rate ?? 1;
  let length = clip.length;
  if (length !== undefined && start + length * rate <= old.naturalEnd + 1e-6) {
    length =
      Math.abs(start - old.start) < 1e-6 && Math.abs(start + length * rate - old.naturalEnd) < 1e-6
        ? available / rate
        : Math.min(length, available / rate);
  }
  return { ...clip, start: newStart, ...(length !== undefined && { length: r3(length) }) };
};

interface EditDoc {
  end?: number;
  voice?: { lines: [number, number][]; edits: Record<string, unknown>; warp: [number, number][] };
  takes?: TakeEntry[];
  [k: string]: unknown;
}

const loadAndValidateInputs = (root: string) => {
  const editPath = join(root, "src/edit.json");
  assertInsideFilm(root, editPath, "src/edit.json");
  const rawEdit = jsonFile(editPath, root);
  if (!isPlainObject(rawEdit)) {
    throw new Error("src/edit.json must be a JSON object");
  }
  if (
    rawEdit.end !== undefined &&
    (typeof rawEdit.end !== "number" || !Number.isFinite(rawEdit.end) || rawEdit.end < 0)
  ) {
    throw new Error('src/edit.json "end" must be a non-negative finite number');
  }
  if (rawEdit.voice !== undefined && !isPlainObject(rawEdit.voice)) {
    throw new Error('src/edit.json "voice" must be an object');
  }
  if (rawEdit.takes !== undefined) {
    if (!Array.isArray(rawEdit.takes)) {
      throw new Error('src/edit.json "takes" must be an array');
    }
    const seenIds = new Set<string>();
    for (const k of rawEdit.takes) {
      if (isPlainObject(k) && typeof k.id === "string") {
        if (seenIds.has(k.id)) {
          throw new Error(
            `Duplicate take id "${k.id}" in src/edit.json takes: each take id must be unique`,
          );
        }
        seenIds.add(k.id);
      }
    }
  }
  const edit = rawEdit as EditDoc;

  const pkgPath = join(root, "package.json");
  assertInsideFilm(root, pkgPath, "package.json");
  let conf: Record<string, unknown> = {};
  if (existsSync(pkgPath)) {
    const rawPkg = jsonFile(pkgPath, root);
    if (!isPlainObject(rawPkg)) throw new Error("package.json must be a JSON object");
    const rawConf = rawPkg["live-studio"];
    if (rawConf !== undefined) {
      if (!isPlainObject(rawConf)) throw new Error('package.json "live-studio" must be an object');
      conf = rawConf;
    }
    if (
      conf.soundTimeline !== undefined &&
      (typeof conf.soundTimeline !== "string" || !conf.soundTimeline.trim())
    ) {
      throw new Error('package.json "live-studio".soundTimeline must be a non-empty string');
    }
    if (conf.soundSources !== undefined && !isPlainObject(conf.soundSources)) {
      throw new Error('package.json "live-studio".soundSources must be an object');
    }
  }

  const audioRel = (conf.soundTimeline as string | undefined) ?? "src/timeline/audio.json";
  const audioPath = join(root, audioRel);
  assertInsideFilm(root, audioPath, "Audio timeline path");
  let audio: AudioDoc | null = null;
  if (existsSync(audioPath)) {
    const rawAudio = jsonFile(audioPath, root);
    if (!isPlainObject(rawAudio)) throw new Error(`${audioRel} must be a JSON object`);
    if (rawAudio.narration !== undefined && typeof rawAudio.narration !== "string") {
      throw new Error(`${audioRel} "narration" must be a string`);
    }
    if (
      rawAudio.voiceGain !== undefined &&
      (typeof rawAudio.voiceGain !== "number" || !Number.isFinite(rawAudio.voiceGain))
    ) {
      throw new Error(`${audioRel} "voiceGain" must be a finite number`);
    }
    if (rawAudio.sfx !== undefined && !Array.isArray(rawAudio.sfx)) {
      throw new Error(`${audioRel} "sfx" must be an array`);
    }
    if (rawAudio.tracks !== undefined && !Array.isArray(rawAudio.tracks)) {
      throw new Error(`${audioRel} "tracks" must be an array`);
    }
    const checked = SoundTimeline.safeParse({ beds: [], sfx: [], ...rawAudio });
    if (!checked.success) {
      const issues = checked.error.issues.filter(
        (issue) =>
          !(
            issue.code === "custom" &&
            issue.path[0] === "sfx" &&
            issue.path[2] === "track" &&
            Array.isArray(rawAudio.sfx) &&
            rawAudio.sfx[Number(issue.path[1])]?.name === rawAudio.narration
          ),
      );
      if (issues.length)
        throw new Error(
          `${audioRel}: ${issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
        );
    }
    audio = rawAudio as AudioDoc;
  }

  if (conf.soundSources !== undefined) {
    const narKey = audio?.narration || "narration";
    const srcVal = (conf.soundSources as Record<string, unknown>)[narKey];
    if (srcVal !== undefined && (typeof srcVal !== "string" || !srcVal.trim())) {
      throw new Error(
        `package.json "live-studio".soundSources.${narKey} must be a non-empty string`,
      );
    }
  }

  assertInsideFilm(root, join(root, "voice/takes"), "Voice takes path");
  const outWav = voiceFileOf(root);
  assertInsideFilm(root, outWav, "Output path");
  const voiceMapPath = voiceMapOf(root);
  assertInsideFilm(root, voiceMapPath, "Voice map path");
  const mouthMapPath = join(root, MOUTH_MAP);
  assertInsideFilm(root, mouthMapPath, "Mouth map path");

  const placed = planVoicePlacements(root, { strict: true });
  const sortedPlaced = [...placed].sort(
    (a, b) => a.start - b.start || a.spokenStart - b.spokenStart,
  );
  for (let i = 1; i < sortedPlaced.length; i++) {
    const prev = sortedPlaced[i - 1];
    const curr = sortedPlaced[i];
    if (Math.abs(curr.start - prev.start) <= 0.01 || curr.start < prev.spokenEnd - 0.01) {
      throw new Error(
        `Overlapping voice takes "${prev.id}" (${prev.start}s..${prev.spokenEnd}s) and "${curr.id}" (starts ${curr.start}s): move "${curr.id}" after ${prev.spokenEnd}s or omit its t to pack sequentially`,
      );
    }
  }

  return {
    editPath,
    edit,
    audioPath,
    audio,
    outWav,
    voiceMapPath,
    mouthMapPath,
    placed: sortedPlaced,
  };
};

export const runAssemble = async (opts: { cwd?: string; args?: string[] } = {}) => {
  const root = resolve(opts.cwd ?? process.cwd());
  const args = opts.args ?? process.argv.slice(2);
  const forceClips = args.includes("--clips");

  const { editPath, edit, audioPath, audio, outWav, voiceMapPath, mouthMapPath, placed } =
    loadAndValidateInputs(root);
  const priorMap = (() => {
    try {
      return JSON.parse(readFileSync(voiceMapPath, "utf8"));
    } catch {
      return null;
    }
  })();
  const previous = priorMap?.placements;
  const layout =
    Array.isArray(previous) &&
    previous.every(
      (p) =>
        p &&
        typeof p.id === "string" &&
        [p.start, p.spokenEnd, p.naturalEnd].every(Number.isFinite),
    )
      ? previous
      : placed;
  const refreshClips =
    forceClips ||
    isPristineNarrationClips(
      (audio?.sfx ?? []).filter((c) => c.name === audio?.narration),
      layout,
      existsSync(outWav),
    );

  const lines: [number, number][] = placed.map((p) => [p.spokenStart, p.spokenEnd]);
  if (
    !forceClips &&
    !refreshClips &&
    layout === placed &&
    existsSync(outWav) &&
    audio?.sfx?.some((c) => c.name === audio.narration)
  ) {
    const oldLines =
      edit.voice?.lines ?? priorMap?.lines?.map((l: { s: number; e: number }) => [l.s, l.e]);
    if (JSON.stringify(oldLines) !== JSON.stringify(lines)) {
      throw new Error(
        "No previous assembly layout for these edited bricks: audio was kept. bun run voice:assemble --clips rebuilds the bricks and replaces hand edits",
      );
    }
  }
  const maxNeed = placed.length ? r3(Math.max(...placed.map((p) => p.naturalEnd)) + 0.5) : 1;
  const end = Math.max(edit.end ?? 0, maxNeed);
  edit.end = end;

  mkdirSync(dirname(outWav), { recursive: true });
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
      if (ff.error || ff.status !== 0) {
        const msg = ff.error?.message || ff.stderr?.trim() || `exit ${ff.status}`;
        throw new Error(`ffmpeg silence failed: ${msg}`);
      }
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
      if (ff.error || ff.status !== 0) {
        const msg = ff.error?.message || ff.stderr?.trim() || `exit ${ff.status}`;
        throw new Error(`ffmpeg voice assemble failed: ${msg}`);
      }
    }
    await replaceWithRetry(freshWav, outWav);
  } catch (err) {
    rmSync(freshWav, { force: true });
    throw err;
  }

  edit.voice = {
    edits: edit.voice?.edits ?? {},
    warp: edit.voice?.warp ?? [],
    ...edit.voice,
    lines,
  };
  await writeAtomicText(editPath, JSON.stringify(edit, null, 1) + "\n");
  writeVoiceMap(root, voiceMapPath, placed);
  // the takes said on screen keep their mouth shapes where the voice now places them
  const onScreen = speakingTakes(root);
  if (onScreen.length || existsSync(mouthMapPath)) writeMouthMap(root);
  const unshaped = onScreen.filter((k) => !k.fresh).map((k) => k.id);

  // Slice audio.json narration into per-take draggable Phrase Bricks when narration is enabled and clips aren't custom-edited
  let bricksWritten = 0;
  let narrationName = audio?.narration;
  if (audio) {
    if (!narrationName && forceClips && placed.length) {
      narrationName = "narration";
      audio.narration = narrationName;
    }
    if (narrationName) {
      const existing = (audio.sfx ?? []).filter((c) => c.name === narrationName);
      let repairedTracks = false;
      if (
        audio.tracks &&
        existing.some((c) => c.track && !audio.tracks!.some((t) => t.id === c.track))
      ) {
        if (!audio.tracks.some((t) => t.id === "voice"))
          audio.tracks.unshift({ id: "voice", name: "Voice" });
        for (const c of existing) {
          if (c.track && !audio.tracks.some((t) => t.id === c.track)) {
            c.track = "voice";
            repairedTracks = true;
          }
        }
      }
      const shouldUpdate = (placed.length > 0 || existing.length > 0) && refreshClips;
      if (shouldUpdate) {
        const baseGain = existing[0]?.gain ?? audio.voiceGain ?? 0;
        let trackId = existing[0]?.track;
        if (Array.isArray(audio.tracks)) {
          const validExisting = trackId && audio.tracks.some((t) => t.id === trackId);
          if (!validExisting) {
            const found = audio.tracks.find((t) => t.id === "voice");
            if (found) trackId = found.id;
            else {
              audio.tracks.unshift({ id: "voice", name: "Voice" });
              trackId = "voice";
            }
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
            name: narrationName!,
            gain: baseGain,
            dialogue: true,
            ...(trackId ? { track: trackId } : {}),
          };
        });
        audio.sfx = [...bricks, ...(audio.sfx ?? []).filter((c) => c.name !== narrationName)];
        await writeAtomicText(audioPath, compactJson(audio) + "\n");
        bricksWritten = bricks.length;
      } else if (layout === previous) {
        audio.sfx = (audio.sfx ?? []).flatMap((c) => {
          if (c.name !== narrationName) return [c];
          const remapped = retargetBrick(c, layout, placed);
          return remapped ? [remapped] : [];
        });
        await writeAtomicText(audioPath, compactJson(audio) + "\n");
      } else if (repairedTracks) {
        await writeAtomicText(audioPath, compactJson(audio) + "\n");
      }
    }
  }

  const choicesOff = narrationName ? findNarrationOffChoice(root, narrationName) : null;
  return { outWav, lines, bricksWritten, unshaped, narrationName, choicesOff };
};

const HELP = `Lays the narration takes (voice/takes/<id>.mp3|wav with <file>.words.json) onto the film: writes full_voice.wav, the
lines in src/edit.json voice.lines, renders/live/voice_map.json and one draggable Phrase Brick per take in
src/timeline/audio.json. Run inside the film, after bun run voice:gen.
  bun run voice:assemble
  --clips   rewrite the Phrase Bricks even where they were moved by hand; also needed when changed takes belong to an older assembly with no saved layout
Next: bun run voice:cues for the heard second of every line, word and gap.`;

const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  cliArgs(HELP, ["--clips"], 0);
  envTypos(["LIVE_PROJECT"]);
  const film = needFilm(process.env.LIVE_PROJECT);
  const ended = await startJob(film, "voice:assemble", {
    say: "Assembling voice takes onto full_voice.wav",
  });
  let res: Awaited<ReturnType<typeof runAssemble>>;
  try {
    res = await runAssemble({ cwd: film });
  } catch (err) {
    const msg = (err as Error).message || String(err);
    await ended({ say: `voice:assemble failed: ${msg}`.slice(0, 200), level: "fail" });
    console.error(msg);
    process.exit(1);
  }
  await ended({
    say: `Assembled ${res.lines.length} voice takes (${res.bricksWritten} phrase bricks)`,
    level: res.unshaped.length ? "warn" : "ok",
  });
  const voiceRel = relative(film, res.outWav).replaceAll("\\", "/") || "full_voice.wav";
  const voiceLabel =
    voiceRel === "assets/public/agent/full_voice.wav" ? "full_voice.wav" : voiceRel;
  console.log(voiceLabel, res.lines.length, "takes,", res.bricksWritten, "phrase bricks");
  if (res.choicesOff && res.narrationName)
    console.log(
      `note: narration "${res.narrationName}" is set to "off" in ${res.choicesOff} (studio mix mutes it until changed)`,
    );
  if (res.unshaped.length)
    console.log(
      `takes said on screen without mouth shapes (${res.unshaped.join(", ")}): bun run voice:lips`,
    );
  const nextLine = res.unshaped.length
    ? `next: bun run voice:lips to add mouth shapes (${res.unshaped.join(", ")}), then bun run voice:cues`
    : res.lines.length === 0
      ? "next: add takes in src/edit.json and run bun run voice:gen"
      : "next: bun run voice:cues for the second of every line and word; hear it: bun run studio. The draft video gets the new voice through bun run render clip (the picture follows the voice, so every chunk) then bun run mix renders/draft_video.mp4";
  console.log(nextLine);
}
