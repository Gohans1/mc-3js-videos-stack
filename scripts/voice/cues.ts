// Audio-Lock Word & Silence-Gap GPS: reads the current Phrase Bricks on src/timeline/audio.json plus Speed/Freeze/Cuts
// in src/timeline/timing.json and outputs the exact heard seconds of every line, word, and silent breathing gap.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cliArgs, jsonFile, needFilm } from "../../packages/live-studio/src/cli.mjs";
import { voiceMapOf } from "../../packages/live-studio/src/film.mjs";
import { compileLayerTiming } from "../../packages/live-studio/src/layer-timing.mjs";
import {
  type NarrationAudio,
  type NarrationLine,
  narrationLines,
} from "../../packages/live-studio/src/narration.ts";
import { wavInfo } from "../../packages/live-studio/src/sound.mjs";
import { mapVoice } from "../../packages/live-studio/src/timing-data.mjs";
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
  const rawLines: NarrationLine[] =
    freshLines.length > 0
      ? freshLines
      : existsSync(mapPath) &&
          (!existsSync(voiceWav) || statSync(mapPath).mtimeMs + 50 >= statSync(voiceWav).mtimeMs)
        ? ((jsonFile(mapPath, root).lines ?? []) as NarrationLine[])
        : [];

  const editPath = assertInsideDir(root, "src/edit.json", "src/edit.json");
  const edit = existsSync(editPath) ? jsonFile(editPath, root) : {};
  const w = edit.voice?.warp ?? [];
  const heard = (s: number) => warp(w, s, 0, 1);

  const baseLines: NarrationLine[] = rawLines.map((l) => ({
    ...l,
    s: heard(l.s),
    e: heard(l.e),
    words: l.words.map((v) => ({ ...v, s: heard(v.s), e: heard(v.e) })),
  }));

  const pkgPath = assertInsideDir(root, "package.json", "package.json");
  const conf = existsSync(pkgPath) ? (jsonFile(pkgPath, root)["live-studio"] ?? {}) : {};
  const audioPath = assertInsideDir(
    root,
    conf.soundTimeline ?? "src/timeline/audio.json",
    "Audio timeline",
  );
  const audio: NarrationAudio | null = existsSync(audioPath) ? jsonFile(audioPath, root) : null;

  const wavDur = existsSync(voiceWav) ? (wavInfo(voiceWav)?.seconds ?? 0) : 0;
  const projected = narrationLines(baseLines, audio, wavDur, true);

  const timingPath = assertInsideDir(
    root,
    conf.timingTimeline ?? "src/timeline/timing.json",
    "Timing timeline",
  );
  const timing = existsSync(timingPath) ? jsonFile(timingPath, root) : {};
  const sourceDur = Math.max(heard(edit.end ?? wavDur), ...projected.map((l) => l.e), wavDur);
  const clock = compileLayerTiming(timing, Math.max(0.1, sourceDur), "voice");
  // speed: how much faster than spoken the line plays, when the voice follows the picture's Speed (timing.json layerKinds.voice)
  const lines: (NarrationLine & { speed: number })[] = mapVoice(projected, clock).map(
    (l: NarrationLine, i: number) => ({
      text: l.text,
      s: r3(l.s),
      e: r3(l.e),
      speed: r3((projected[i]!.e - projected[i]!.s) / Math.max(l.e - l.s, 1e-3)),
      words: l.words.map((v) => ({ w: v.w, s: r3(v.s), e: r3(v.e) })),
    }),
  );

  const gaps: VoiceGap[] = [];
  let prevEnd = 0;
  lines.forEach((l, idx) => {
    const dur = r3(l.s - prevEnd);
    if (dur >= minGap) gaps.push({ from: r3(prevEnd), to: l.s, dur, afterLine: idx - 1 });
    prevEnd = Math.max(prevEnd, l.e);
  });
  const tail = r3(clock.duration - prevEnd);
  if (tail >= minGap)
    gaps.push({
      from: r3(prevEnd),
      to: r3(clock.duration),
      dur: tail,
      afterLine: lines.length - 1,
    });

  // takes newer than the assembled voice: their words are read at the old take's place, cut to its length
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

  return { duration: r3(clock.duration), lines, gaps, unplaced };
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
  const film = needFilm(process.env.LIVE_PROJECT);
  let cues: ReturnType<typeof buildVoiceCues>;
  try {
    cues = buildVoiceCues(film);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
  if (!cues.lines.length) {
    // takes made but not laid on the film yet: generating again would spend credits for nothing
    const takes = resolve(film, "voice/takes");
    const made = existsSync(takes) && readdirSync(takes).some((f) => /\.(mp3|wav)$/.test(f));
    console.error(
      made
        ? "no narration lines on the film yet, but voice/takes has audio: bun run voice:assemble lays them on it"
        : "no narration lines yet: bun run voice:gen (what it would make), then voice:gen --yes, then voice:assemble",
    );
  }
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
      console.log(
        `pace: ${wpm(words, cues.lines.at(-1)!.e - cues.lines[0]!.s)} wpm from the first word to the last, pauses included (narrated documentaries: about 120-160)`,
      );
    }
  }
  if (cues.lines.length && !process.argv.includes("--json"))
    console.error(
      "next: a sound on a word goes at that second in src/timeline/audio.json (pick one: bun run find <words>), a cut or title in src/timeline; then bun run check",
    );
}
