export { resizeNarrationBrickForSwap } from "../../src/voice-swap";
export type { SwappedVoiceSpan } from "../../src/voice-swap";
import { matcher } from "../core/search";
import type { BeatMarkers } from "./beat-marks";
import type { GainClip } from "./gain";
import { type AudioProcessing, trimSource } from "./retime";
import { AUDIO_TAG_RE, stripDialogueSpeakerBrackets } from "./voice-tags";

export type VoiceTakeItem = import("../../src/voice.mjs").VoiceTakeRecord;

export interface VoiceWordSpan {
  w: string;
  s: number;
  e: number;
}

export interface VoiceLineSpan {
  s: number;
  e: number;
  text: string;
  words: readonly VoiceWordSpan[];
}

export interface VoiceClipInput extends AudioProcessing {
  name: string;
  at: number;
  start?: number;
  length?: number;
}

export interface MatchedVoiceTake {
  id?: string;
  spoken: string;
  tags: string[];
  voiceTitle: string;
  take: VoiceTakeItem | null;
}

export const SLOW_WPM = 130;
export const FAST_WPM = 280;
export const MIN_PACE_WORDS = 4;

export const KNOWN_VOICES: Record<string, string> = {
  ZaZosYpkIGmSqOwAlfnk: "Seff Echo",
  "99Hm6N8psCBzc1JwEVR2": "Riley",
  FyrYFW3P9GUxA348YGWu: "Madison",
  mJ5wtH88WGlTud22bihm: "Kathryn",
  no52gq1ZwK7Lmejv1EHz: "Clara",
  bAq8AI9QURijOtmeFFqT: "Sigma",
  ev2kMR9ZJZZsemuogS5u: "Jake",
  tZssYepgGaQmegsMEXjK: "True",
};
const dynamicVoices = new Map<string, string>();
let dynamicVoiceRev = 0;
const dynamicVoiceSubs = new Set<() => void>();

export const subscribeVoiceNames = (fn: () => void) => {
  dynamicVoiceSubs.add(fn);
  return () => {
    dynamicVoiceSubs.delete(fn);
  };
};

export const voiceNamesSnapshot = (): number => dynamicVoiceRev;

export const registerVoiceNames = (entries: ReadonlyArray<{ id: string; name: string }>) => {
  let changed = false;
  for (const e of entries) {
    if (!e.id || !e.name) continue;
    if (dynamicVoices.get(e.id) === e.name) continue;
    dynamicVoices.set(e.id, e.name);
    changed = true;
  }
  if (!changed) return;
  dynamicVoiceRev++;
  for (const fn of dynamicVoiceSubs) fn();
};

export const voiceAuditionId = (kind: "takes" | "try", file: string) => `voice:${kind}:${file}`;

export const shortTryLabel = (
  takeId: string,
  tryFile: string,
  alternatives?: VoiceTakeItem["alternatives"],
): string => {
  const saved = alternatives?.find((alternative) => alternative.file === tryFile)?.title;
  if (saved) return saved;
  const withoutExt = tryFile.replace(/\.(mp3|wav)$/i, "");
  const suffix = withoutExt.startsWith(`${takeId}_`)
    ? withoutExt.slice(takeId.length + 1)
    : withoutExt;
  return suffix === "orig" ? "Original" : `Try ${suffix}`;
};

export const parseTakeScript = (raw: string): { tags: string[]; spoken: string } => {
  const tags: string[] = [];
  const seen = new Set<string>();
  const spoken = stripDialogueSpeakerBrackets(raw)
    .replace(AUDIO_TAG_RE, (_, inner: string) => {
      const cleaned = inner.trim().replace(/\s+/g, " ");
      if (cleaned && !seen.has(cleaned)) {
        seen.add(cleaned);
        tags.push(cleaned);
      }
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();
  return { tags, spoken };
};

export const voiceActorTitle = (voice?: string): string => {
  if (!voice) return "Seff Echo";
  const known = KNOWN_VOICES[voice] ?? dynamicVoices.get(voice);
  if (known) return known;
  if (/^[A-Za-z0-9]{16,}$/.test(voice)) return `Voice · ${voice.slice(0, 6)}`;
  return voice;
};

export const filterVoiceTakes = (
  takes: readonly VoiceTakeItem[],
  query: string,
): VoiceTakeItem[] => {
  const hit = matcher(query);
  return takes.filter((t) => {
    const { tags, spoken } = parseTakeScript(t.text);
    return hit(`${t.id} ${spoken} ${tags.join(" ")} ${voiceActorTitle(t.voice)} ${t.voice ?? ""}`);
  });
};

const clipSourceSpan = (clip: VoiceClipInput, narrationSeconds: number): [number, number] => {
  const orig = clip.__timing?.source ?? clip;
  const rate = orig.rate ?? clip.rate ?? 1;
  const start = orig.start ?? clip.start ?? 0;
  const dur =
    clip.__timing?.duration ?? clip.length ?? Math.max(0, (narrationSeconds - start) / rate);
  return [start, start + Math.max(0, dur) * rate];
};

export function recordingCandidatesForClip(
  clip: VoiceClipInput & { name: string },
  narrationName: string | undefined,
  narrationSeconds: number,
  placements: readonly { id: string; start: number; naturalEnd: number }[],
  takes: readonly VoiceTakeItem[],
): VoiceTakeItem[] {
  if (clip.name !== narrationName) return [];
  const recorded = takes.filter((take) => take.file);
  if (!placements.length) return recorded;
  const [from, to] = clipSourceSpan(clip, narrationSeconds);
  const ids = new Set(
    placements
      .filter((placement) => placement.naturalEnd > from + 0.01 && placement.start < to - 0.01)
      .map((placement) => placement.id),
  );
  return recorded.filter((take) => ids.has(take.id));
}

const normSpeech = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const speechTokens = (s: string): Set<string> => {
  const n = normSpeech(s);
  return n ? new Set(n.split(" ")) : new Set<string>();
};

const pairLinesWithTakes = (
  voiceBase: readonly VoiceLineSpan[],
  takes: readonly VoiceTakeItem[],
): (VoiceTakeItem | null)[] => {
  const aligned = takes.filter((t) => t.aligned);
  if (aligned.length === voiceBase.length) return [...aligned];
  const pool = aligned.length ? aligned : takes;
  const paired: (VoiceTakeItem | null)[] = Array(voiceBase.length).fill(null);
  const used = new Set<VoiceTakeItem>();

  for (let i = 0; i < voiceBase.length; i++) {
    const line = voiceBase[i];
    const byTime = pool.find((t) => {
      if (used.has(t)) return false;
      const anchor = typeof t.t === "number" ? t.t : t.start;
      return typeof anchor === "number" && Math.abs(anchor - line.s) <= 0.6;
    });
    if (byTime) {
      paired[i] = byTime;
      used.add(byTime);
      continue;
    }

    const lineNorm = normSpeech(line.text);
    if (lineNorm) {
      const bySpeech = pool.find(
        (t) => !used.has(t) && normSpeech(parseTakeScript(t.text).spoken) === lineNorm,
      );
      if (bySpeech) {
        paired[i] = bySpeech;
        used.add(bySpeech);
        continue;
      }
      const lineToks = speechTokens(line.text);
      if (lineToks.size > 0) {
        let best: VoiceTakeItem | null = null;
        let bestScore = 0;
        for (const t of pool) {
          if (used.has(t)) continue;
          const takeToks = speechTokens(parseTakeScript(t.text).spoken);
          if (!takeToks.size) continue;
          let overlap = 0;
          for (const tok of lineToks) if (takeToks.has(tok)) overlap++;
          const score = overlap / Math.min(lineToks.size, takeToks.size);
          if (score >= 0.6 && score > bestScore) {
            bestScore = score;
            best = t;
          }
        }
        if (best) {
          paired[i] = best;
          used.add(best);
        }
      }
    }
  }

  let remIdx = 0;
  const remaining = pool.filter((t) => !used.has(t));
  for (let i = 0; i < paired.length && remIdx < remaining.length; i++) {
    if (!paired[i]) paired[i] = remaining[remIdx++];
  }
  return paired;
};

export const findTakeLineIndex = (
  takeId: string,
  voiceBase: readonly VoiceLineSpan[],
  takes: readonly VoiceTakeItem[],
): number => {
  const paired = pairLinesWithTakes(voiceBase, takes);
  return paired.findIndex((t) => t?.id === takeId);
};

export const voiceClipSummary = (
  clip: VoiceClipInput,
  narrationSeconds: number,
  voiceBase: readonly VoiceLineSpan[],
  takes: readonly VoiceTakeItem[],
): {
  sourceRange: [number, number];
  matches: MatchedVoiceTake[];
  wordCount: number;
  wpm: number | null;
} => {
  const [wavFrom, wavTo] = clipSourceSpan(clip, narrationSeconds);
  const paired = pairLinesWithTakes(voiceBase, takes);
  const matches: MatchedVoiceTake[] = [];
  let wordCount = 0;
  let spokenSourceSpan = 0;

  for (let i = 0; i < voiceBase.length; i++) {
    const line = voiceBase[i];
    if (line.e <= wavFrom + 0.02 || line.s >= wavTo - 0.02) continue;
    const wordsInSlice = line.words.filter((w) => w.e > wavFrom + 0.01 && w.s < wavTo - 0.01);
    if (line.words.length > 0 && wordsInSlice.length === 0) continue;

    const take = paired[i] ?? null;
    const parsed = take ? parseTakeScript(take.text) : { tags: [], spoken: line.text };
    const isFullLine = line.words.length === 0 || wordsInSlice.length >= line.words.length;
    const spoken = isFullLine ? parsed.spoken || line.text : wordsInSlice.map((w) => w.w).join(" ");

    matches.push({
      id: take?.id,
      spoken,
      tags: parsed.tags,
      voiceTitle: voiceActorTitle(take?.voice),
      take,
    });

    if (wordsInSlice.length) {
      wordCount += wordsInSlice.length;
      spokenSourceSpan += Math.max(0, wordsInSlice[wordsInSlice.length - 1].e - wordsInSlice[0].s);
    }
  }

  const orig = clip.__timing?.source ?? clip;
  const rate = orig.rate ?? clip.rate ?? 1;
  const spokenSpan = spokenSourceSpan > 0 ? spokenSourceSpan / rate : 0;
  const wpm =
    wordCount >= MIN_PACE_WORDS && spokenSpan > 0.2
      ? Math.round((wordCount / spokenSpan) * 60)
      : null;

  return {
    sourceRange: [wavFrom, wavTo],
    matches,
    wordCount,
    wpm,
  };
};

export const voiceClipLabel = (
  clip: VoiceClipInput,
  narrationSeconds: number,
  voiceBase: readonly VoiceLineSpan[],
  takes: readonly VoiceTakeItem[],
): string => {
  if (!voiceBase.length) return "Voiceover";
  const { matches } = voiceClipSummary(clip, narrationSeconds, voiceBase, takes);
  if (!matches.length) return "Voiceover (silence)";
  const first = matches[0];
  if (matches.length === 1) {
    return first.id ? `${first.id} · ${first.spoken}` : first.spoken;
  }
  return `Voiceover (${matches.length} takes) · ${first.spoken}`;
};

export const phraseBrickWindows = (
  clipSpan: readonly [number, number],
  linesOut: readonly { s: number; e: number }[],
  headPad = 0.08,
  tailPad = 0.18,
): [number, number][] => {
  const [clipFrom, clipTo] = clipSpan;
  const inside = linesOut
    .filter((l) => l.e > clipFrom + 0.02 && l.s < clipTo - 0.02)
    .map((l) => ({ s: Math.max(clipFrom, l.s), e: Math.min(clipTo, l.e) }))
    .filter((l) => l.e - l.s >= 0.05)
    .sort((a, b) => a.s - b.s);

  if (inside.length < 2) return [];

  return inside.map((line, i) => {
    const prev = i > 0 ? inside[i - 1] : null;
    const next = i + 1 < inside.length ? inside[i + 1] : null;
    const minFrom = prev ? (prev.e + line.s) / 2 + 0.005 : clipFrom;
    const maxTo = next ? (line.e + next.s) / 2 - 0.005 : clipTo;
    const from = Math.min(line.s, Math.max(clipFrom, minFrom, line.s - headPad));
    const to = Math.max(line.e, Math.min(clipTo, maxTo, line.e + tailPad));
    return [Math.round(from * 1000) / 1000, Math.round(Math.max(from + 0.05, to) * 1000) / 1000];
  });
};

// Slices a narration clip directly in source coordinates so timeline speeds and freezes never truncate phrase bricks.
export const sliceNarrationClip = <
  T extends GainClip &
    AudioProcessing &
    BeatMarkers & {
      at: number;
      name: string;
      start?: number;
      length?: number;
      fadeIn?: number;
      fadeOut?: number;
    },
>(
  sourceClip: T,
  narrationSeconds: number,
  voiceBase: readonly { s: number; e: number }[],
): T[] => {
  if (sourceClip.reverse) return [];
  const rate = sourceClip.rate ?? 1;
  const wavFrom = sourceClip.start ?? 0;
  const clipDur = sourceClip.length ?? Math.max(0, (narrationSeconds - wavFrom) / rate);
  const wavTo = wavFrom + Math.max(0, clipDur) * rate;
  const wavWins = phraseBrickWindows([wavFrom, wavTo], voiceBase, 0.08 * rate, 0.18 * rate);
  if (wavWins.length < 2) return [];

  return wavWins.map(([wFrom, wTo]) => {
    const left = (wFrom - wavFrom) / rate;
    const right = (wTo - wavFrom) / rate;
    const b = structuredClone(sourceClip);
    trimSource(b, left, right, clipDur, narrationSeconds, false);
    b.at = Math.round((sourceClip.at + left) * 1000) / 1000;
    b.length = Math.round(Math.max(0.05, right - left) * 1000) / 1000;
    b.dialogue = true;
    delete b.__timing;
    delete b.fadeIn;
    delete b.fadeOut;
    return b;
  });
};
