import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cliArgs, envTypos, jsonFile, needFilm } from "../../packages/live-studio/src/cli.mjs";
import { voiceMapOf } from "../../packages/live-studio/src/film.mjs";
import {
  compileLayerTiming,
  isTornByReorder,
} from "../../packages/live-studio/src/layer-timing.mjs";
import { LINKAGE_KINDS } from "../../packages/live-studio/src/linkage.mjs";
import {
  type NarrationAudio,
  narrationClipLength,
  type NarrationLine,
  narrationLines,
} from "../../packages/live-studio/src/narration.ts";
import { openSound, pickSoundClip, probeAudio } from "../../packages/live-studio/src/sound.mjs";
import { mapVoice } from "../../packages/live-studio/src/timing-data.mjs";
import { compileTiming } from "../../packages/live-studio/src/timing.mjs";
import {
  assertInsideDir,
  planVoicePlacements,
  voiceFileOf,
} from "../../packages/live-studio/src/voice-map.mjs";
import { warp } from "../../packages/live-studio/src/warp.mjs";

const r3 = (x: number) => Math.round(x * 1000) / 1000;

export interface VoiceGap {
  from: number;
  to: number;
  dur: number;
  afterLine: number;
}

type AudioTimeline = NarrationAudio & { voice?: boolean };

export const buildVoiceCues = (projectDir = process.cwd(), minGap = 0.4) => {
  const root = resolve(projectDir);
  const voiceWav = assertInsideDir(root, voiceFileOf(root), "Voice audio");
  const mapPath = assertInsideDir(root, voiceMapOf(root), "Voice map");
  const freshLines: NarrationLine[] = planVoicePlacements(root)
    .filter((p) => p.words.length > 0)
    .map((p) => ({
      s: p.spokenStart,
      e: p.spokenEnd,
      text: p.words.map((w) => w.w).join(" "),
      words: p.words,
    }));
  const assembled = existsSync(voiceWav);
  const currentMap =
    existsSync(mapPath) &&
    assembled &&
    statSync(mapPath).mtimeMs + 50 >= statSync(voiceWav).mtimeMs;
  const baseLines: NarrationLine[] = currentMap
    ? ((jsonFile(mapPath, root).lines ?? []) as NarrationLine[])
    : freshLines.length > 0
      ? freshLines
      : existsSync(mapPath) && !assembled
        ? ((jsonFile(mapPath, root).lines ?? []) as NarrationLine[])
        : [];

  const editPath = assertInsideDir(root, "src/edit.json", "src/edit.json");
  const edit = existsSync(editPath) ? jsonFile(editPath, root) : {};
  const w = edit.voice?.warp ?? [];
  const heard = (s: number) => warp(w, s, 0, 1);

  const pkgPath = assertInsideDir(root, "package.json", "package.json");
  const conf = existsSync(pkgPath) ? (jsonFile(pkgPath, root)["live-studio"] ?? {}) : {};
  const audioPath = assertInsideDir(
    root,
    conf.soundTimeline ?? "src/timeline/audio.json",
    "Audio timeline",
  );
  const rawAudio: AudioTimeline | null = existsSync(audioPath) ? jsonFile(audioPath, root) : null;
  const choicesName = ["choices.json", "sound_choices.json"].find((f) => existsSync(join(root, f)));
  const choicesFile = choicesName ? assertInsideDir(root, choicesName, choicesName) : undefined;
  const choices = (choicesFile ? jsonFile(choicesFile, root) : {}) as Record<
    string,
    { set?: string } | undefined
  >;
  const sound = (() => {
    try {
      return openSound(root, {
        ...conf,
        soundTimeline: conf.soundTimeline ?? "src/timeline/audio.json",
        sfx: conf.sfx ?? "sound/sfx",
      });
    } catch {
      return null;
    }
  })();
  const pickOf = (c: NarrationAudio["sfx"][number] & { try?: string[] }) =>
    pickSoundClip(c, choices?.[c.name]);
  const durOf = (file: string) => (existsSync(file) ? (probeAudio(file)?.seconds ?? 0) : 0);
  const wavDur = durOf(voiceWav);
  const durByName = new Map<string, number>();
  const durFor = (name: string) => {
    if (!durByName.has(name)) {
      const file = sound?.fileOf(name) ?? null;
      durByName.set(name, file ? durOf(file) : wavDur);
    }
    return durByName.get(name)!;
  };
  const mutedTracks = new Set(
    (Array.isArray(rawAudio?.tracks) ? rawAudio.tracks : [])
      .filter((t) => t?.mute && typeof t.id === "string")
      .map((t) => t.id!),
  );
  const narrClips: NarrationAudio["sfx"][number][] = [];
  const mutedClips: NarrationAudio["sfx"][number][] = [];
  for (const c of Array.isArray(rawAudio?.sfx) ? rawAudio.sfx : []) {
    if (!rawAudio?.narration || !c || c.name !== rawAudio.narration) continue;
    const picked = pickOf(c);
    if (!picked) continue;
    if (picked.muted || (picked.track && mutedTracks.has(picked.track))) mutedClips.push(picked);
    else narrClips.push(picked);
  }
  const projectClip = (c: NarrationAudio["sfx"][number]) =>
    narrationLines(baseLines, { ...rawAudio, narration: c.name, sfx: [c] }, durFor(c.name), true);
  const projected = !rawAudio?.narration
    ? narrationLines(baseLines, rawAudio, wavDur, true)
    : narrClips.flatMap(projectClip).sort((a, b) => a.s - b.s);
  const maxNarrDur = narrClips.length ? Math.max(...narrClips.map((c) => durFor(c.name))) : wavDur;

  const timingPath = conf.timingTimeline
    ? assertInsideDir(root, conf.timingTimeline, "Timing timeline")
    : null;
  const timing = timingPath && existsSync(timingPath) ? jsonFile(timingPath, root) : {};
  const hasEnd = typeof edit.end === "number";
  const camEnd = (() => {
    if (hasEnd) return 0;
    try {
      const camPath = assertInsideDir(root, conf.camTimeline ?? "src/timeline/cam.json", "Camera");
      if (!existsSync(camPath)) return 0;
      const camData = jsonFile(camPath, root);
      const keys = Array.isArray(camData) ? camData : (camData?.keys ?? []);
      return Array.isArray(keys)
        ? Math.max(0, ...keys.map((k: { t?: unknown }) => (typeof k?.t === "number" ? k.t : 0)))
        : 0;
    } catch {
      return 0;
    }
  })();
  const sourceDur = hasEnd
    ? heard(edit.end)
    : Math.max(maxNarrDur, ...projected.map((l) => l.e), camEnd);
  const clampedSourceDur = Math.max(0.1, sourceDur);
  const pictureClock = compileTiming(timing, clampedSourceDur);
  const layerCache = new Map<string, ReturnType<typeof compileLayerTiming>>();
  const compiledLayers = LINKAGE_KINDS.map((kind) => {
    const history = timing.layerKinds?.[kind] ?? timing.layers;
    if (!history) return { kind, clock: pictureClock };
    const key = JSON.stringify([clampedSourceDur, history]);
    let compiled = layerCache.get(key);
    if (!compiled) {
      compiled = compileLayerTiming(timing, clampedSourceDur, kind);
      layerCache.set(key, compiled);
    }
    return { kind, clock: compiled };
  });
  const clock = compiledLayers.find((entry) => entry.kind === "voice")?.clock ?? pictureClock;
  const filmDuration = Math.max(
    clock.duration,
    pictureClock.duration,
    ...compiledLayers.map((entry) => entry.clock.duration),
  );
  const heardLines = !rawAudio?.narration
    ? mapVoice(projected, clock)
    : narrClips.flatMap((c) => {
        const lines = projectClip(c);
        const length = c.length ?? narrationClipLength(c, durFor(c.name));
        if (!isTornByReorder(clock, c.at, c.at + length)) {
          const from = clock.outputAt(c.at),
            to = clock.outputAt(c.at + length, "before");
          return mapVoice(lines, clock).filter((l) => l.s >= from - 1e-9 && l.e <= to + 1e-9);
        }
        const shift = clock.outputAt(c.at) - c.at;
        return lines.map((l) => ({
          ...l,
          s: l.s + shift,
          e: l.e + shift,
          speed: 1,
          words: l.words.map((v) => ({ ...v, s: v.s + shift, e: v.e + shift })),
        }));
      });
  const mappedLines: (NarrationLine & { speed: number })[] = heardLines
    .flatMap((l: NarrationLine & { speed?: number }) => {
      const end = hasEnd ? Math.min(l.e, filmDuration) : l.e;
      if (hasEnd && (l.s >= filmDuration - 1e-3 || end - l.s < 1e-3)) return [];
      const words = l.words.flatMap((v) => {
        const vEnd = hasEnd ? Math.min(v.e, filmDuration) : v.e;
        if (hasEnd && (v.s >= filmDuration - 1e-3 || vEnd - v.s < 1e-3)) return [];
        return [{ w: v.w, s: r3(v.s), e: r3(vEnd) }];
      });
      if (hasEnd && l.words.length > 0 && words.length === 0) return [];
      const span = end - l.s;
      return [
        {
          text: l.text,
          s: r3(l.s),
          e: r3(end),
          speed:
            l.speed ??
            (span > 1e-6 ? r3((clock.sourceAt(end, "before") - clock.sourceAt(l.s)) / span) : 1),
          words,
        },
      ];
    })
    .sort((a, b) => a.s - b.s || a.e - b.e);

  const voiceOff = Boolean(
    (rawAudio && !rawAudio.narration && rawAudio.voice === false) ||
    (rawAudio?.narration && choices?.[rawAudio.narration]?.set === "off"),
  );
  const trackMuted =
    !voiceOff &&
    !narrClips.length &&
    mutedClips.length > 0 &&
    mutedClips.every((c) => Boolean(c.track && mutedTracks.has(c.track)));
  const voiceMuted = trackMuted ? mutedClips[0]!.track! : null;
  const voiceClipMuted = !voiceOff && !narrClips.length && mutedClips.length > 0 && !trackMuted;
  const isVoiceMuted = Boolean(voiceMuted || voiceClipMuted);
  const hasLines = mappedLines.length > 0;
  const lines = voiceOff ? [] : mappedLines;

  const expectsVoiceAudio =
    !voiceOff &&
    !isVoiceMuted &&
    (rawAudio?.narration ? narrClips.length > 0 : assembled || baseLines.length > 0);
  const wordTimingMissing = expectsVoiceAudio && !baseLines.length;
  const missingAudio = expectsVoiceAudio
    ? rawAudio?.narration
      ? [
          ...new Set(
            narrClips
              .filter((c) => !sound?.fileOf(c.name) || !(durFor(c.name) > 0))
              .map((c) => c.name),
          ),
        ]
      : wavDur > 0
        ? []
        : [relative(root, voiceWav).replaceAll("\\", "/")]
    : [];
  const audioFault = missingAudio.length
    ? `missing or unreadable voice audio: ${missingAudio.join(", ")}. Restore the files; bun run voice:assemble rebuilds the default voice from existing takes`
    : wordTimingMissing
      ? `word timings unavailable for existing voice audio: add or restore ${relative(root, mapPath).replaceAll("\\", "/")} from the existing audio/takes`
      : null;

  const gaps: VoiceGap[] = [];
  let prevEnd = 0;
  lines.forEach((l, idx) => {
    const dur = r3(l.s - prevEnd);
    if (dur >= minGap) gaps.push({ from: r3(prevEnd), to: l.s, dur, afterLine: idx - 1 });
    prevEnd = Math.max(prevEnd, l.e);
  });
  const tail = r3(filmDuration - prevEnd);
  if (!wordTimingMissing && tail >= minGap)
    gaps.push({
      from: r3(prevEnd),
      to: r3(filmDuration),
      dur: tail,
      afterLine: lines.length - 1,
    });

  const takesDir = join(root, "voice/takes");
  const unplaced =
    existsSync(voiceWav) && existsSync(takesDir)
      ? readdirSync(takesDir)
          .filter(
            (f) =>
              /^[^.].*\.(mp3|wav)$/.test(f) &&
              statSync(join(takesDir, f)).mtimeMs > statSync(voiceWav).mtimeMs,
          )
          .map((f) => f.replace(/\.(mp3|wav)$/, ""))
          .sort()
      : [];

  const unlaid =
    !voiceOff &&
    !isVoiceMuted &&
    !rawAudio?.narration &&
    !existsSync(voiceWav) &&
    existsSync(takesDir) &&
    readdirSync(takesDir).some((f) => /^[^.].*\.(mp3|wav)$/.test(f));

  return {
    duration: r3(filmDuration),
    lines,
    gaps,
    unplaced,
    unlaid,
    voiceOff,
    voiceMuted,
    voiceClipMuted,
    hasLines,
    audioFault,
  };
};

const HELP = `The heard second of every narration line, word and silent gap, after the Phrase Bricks in src/timeline/audio.json
and the Speed, Freeze and Cuts in src/timeline/timing.json: where to put a cut, a sound or a title on a word. Run inside
the film.
  bun run voice:cues          [NN] start -> end | text, then GAP lines
  bun run voice:cues --json   the same with every word's seconds`;

const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  cliArgs(HELP, ["--json"], 0);
  envTypos(["LIVE_PROJECT"]);
  const film = needFilm(process.env.LIVE_PROJECT);
  let cues: ReturnType<typeof buildVoiceCues>;
  try {
    cues = buildVoiceCues(film);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
  if (!cues.lines.length) {
    console.error(
      cues.audioFault ??
        (cues.voiceOff
          ? "narration: off (no voice in the mix)"
          : cues.voiceClipMuted
            ? "narration: muted (its clip is disabled in audio.json: the mix leaves the voice out)"
            : cues.voiceMuted
              ? `narration: muted (its clip sits on track ${cues.voiceMuted}, muted in tracks[]: the mix leaves the voice out)`
              : cues.unlaid
                ? "no narration lines on the film yet, but voice/takes has audio: bun run voice:assemble lays them on it"
                : "no narration lines yet: bun run voice:gen (what it would make), then voice:gen --yes, then voice:assemble"),
    );
  }
  if (cues.lines.length && cues.unlaid)
    console.error(
      "⚠ full_voice.wav is not on the film yet (the mix is silent): lines below sit where bun run voice:assemble will put them",
    );
  if (cues.lines.length && cues.audioFault && !cues.unlaid)
    console.error(`⚠ ${cues.audioFault}. The lines below are planning data, not audible words.`);
  if (cues.lines.length && cues.unplaced.length)
    console.error(
      `⚠ take${cues.unplaced.length > 1 ? "s" : ""} ${cues.unplaced.join(", ")} newer than the film's voice: ${cues.unplaced.length > 1 ? "their" : "its"} words below sit at the old take's place, cut to its length. bun run voice:assemble lays ${cues.unplaced.length > 1 ? "them" : "it"} on the film, then this again`,
    );
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(cues, null, 2));
  } else {
    const wpm = (words: number, secs: number) => Math.round((words * 60) / Math.max(secs, 0.01));
    cues.lines.forEach((l, i) =>
      console.log(
        `[${String(i + 1).padStart(2, "0")}] ${l.s.toFixed(3)}s -> ${l.e.toFixed(3)}s ${String(wpm(l.words.length, l.e - l.s)).padStart(3)} wpm${Math.abs(l.speed - 1) > 0.03 ? ` x${l.speed}` : ""} | ${l.text}`,
      ),
    );
    const sped = cues.lines.flatMap((l, i) => (Math.abs(l.speed - 1) > 0.03 ? [i + 1] : []));
    if (sped.length)
      console.error(
        `lines ${sped.join(", ")} play at another speed than spoken (x after the pace): the narration follows the picture's Speed or Freeze there (src/timeline/timing.json layerKinds.voice). Over about 1.1x words blur; keep the voice at x1 unless that is the effect`,
      );
    for (const g of cues.gaps)
      console.log(`  GAP ${g.from.toFixed(3)}s -> ${g.to.toFixed(3)}s (${g.dur.toFixed(3)}s)`);
    if (cues.lines.length > 1) {
      const words = cues.lines.reduce((n, l) => n + l.words.length, 0);
      const span =
        Math.max(...cues.lines.map((l) => l.e)) - Math.min(...cues.lines.map((l) => l.s));
      console.log(
        `pace: ${wpm(words, span)} wpm from the first word to the last, pauses included (narrated documentaries: about 120-160)`,
      );
    }
  }
  if (cues.lines.length && !process.argv.includes("--json"))
    console.error(
      `next: bun run at ${cues.lines[0].s} converts a heard word second to scene seconds; check the sound layer's linkage before placing it in src/timeline/audio.json, then bun run check`,
    );
}
