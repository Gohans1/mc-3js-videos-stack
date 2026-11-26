import {
  cleanTranscriptText,
  hasReliableSentencePunctuation,
  median,
  segmentWords,
  splitPunctuatedSentences,
} from "./collect.ts";
import type { CatalogVideo, ReliabilityLevel } from "./types.ts";

export { hasReliableSentencePunctuation, splitPunctuatedSentences };

export interface CatalogBandStat {
  band: string;
  n: number;
  sharePct: number;
  winnerCount: number;
  medianCount: number;
  flopCount: number;
  winnerPct: number;
  flopPct: number;
  winRateDeltaPp: number | null;
  flopRateDeltaPp: number | null;
  medianOutlier: number | null;
  outlierIqr: number | null;
  medianViews: number | null;
  pValue: number | null;
  qValue: number | null;
  reliability: ReliabilityLevel;
}

export interface SubsampleBaseline {
  sampleN: number;
  baseWinnerPct: number | null;
  baseFlopPct: number | null;
}

export interface TitleModifierStat {
  modifier: string;
  n: number;
  sharePct: number;
  winnerPct: number;
  flopPct: number;
  winRateDeltaPp: number | null;
  medianOutlier: number | null;
  pValue: number | null;
  qValue: number | null;
  reliability: ReliabilityLevel;
}

export interface QuarterlyStabilityRow {
  quarter: string;
  n: number;
  medianViews: number;
  medianDurationSec: number | null;
  trailingEmojiPct: number;
  winnerPct: number;
  flopPct: number;
  medianOutlier: number | null;
}

export interface EraStabilityRow {
  era: string;
  n: number;
  medianViews: number;
  winnerPct: number;
  flopPct: number;
  medianOutlier: number | null;
  trailingEmojiPct: number;
}

const pct = (part: number, total: number): number =>
  total > 0 ? Number(((part / total) * 100).toFixed(1)) : 0;

const round1 = (n: number): number => Number(n.toFixed(1));
const round2 = (n: number): number => Number(n.toFixed(2));
const round4 = (n: number): number => Number(n.toFixed(4));

export function reliabilityLabel(n: number): ReliabilityLevel {
  if (n >= 8) return "stable";
  if (n >= 5) return "tentative";
  return "directional";
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0]!;
  const idx = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

export function iqr(values: number[]): number | null {
  if (values.length < 2) return null;
  const q1 = percentile(values, 0.25);
  const q3 = percentile(values, 0.75);
  if (q1 === null || q3 === null) return null;
  return round2(q3 - q1);
}

const logFactCache: number[] = [0];

function logFactorial(n: number): number {
  for (let i = logFactCache.length; i <= n; i++) {
    logFactCache[i] = logFactCache[i - 1]! + Math.log(i);
  }
  return logFactCache[n] ?? 0;
}

function hypergeomProb(a: number, b: number, c: number, d: number): number {
  const n = a + b + c + d;
  const lp =
    logFactorial(a + b) +
    logFactorial(c + d) +
    logFactorial(a + c) +
    logFactorial(b + d) -
    (logFactorial(a) + logFactorial(b) + logFactorial(c) + logFactorial(d) + logFactorial(n));
  return Math.exp(lp);
}

export function fisherExactTwoSided(a: number, b: number, c: number, d: number): number | null {
  if (a < 0 || b < 0 || c < 0 || d < 0) return null;
  const r1 = a + b;
  const r2 = c + d;
  const c1 = a + c;
  const n = r1 + r2;
  if (n === 0 || r1 === 0 || r2 === 0 || c1 === 0 || c1 === n) return null;
  const pObs = hypergeomProb(a, b, c, d);
  const minA = Math.max(0, c1 - r2);
  const maxA = Math.min(r1, c1);
  let pSum = 0;
  for (let k = minA; k <= maxA; k++) {
    const pk = hypergeomProb(k, r1 - k, c1 - k, r2 - (c1 - k));
    if (pk <= pObs * (1 + 1e-9)) pSum += pk;
  }
  return round4(Math.min(1, pSum));
}

export function benjaminiHochberg(
  pValues: Array<number | null>,
  totalTests?: number,
): Array<number | null> {
  const indexed: Array<{ idx: number; p: number }> = [];
  for (let i = 0; i < pValues.length; i++) {
    const p = pValues[i];
    if (typeof p === "number" && Number.isFinite(p) && p >= 0 && p <= 1) {
      indexed.push({ idx: i, p });
    }
  }
  const out: Array<number | null> = pValues.map(() => null);
  if (indexed.length === 0) return out;
  indexed.sort((a, b) => a.p - b.p || a.idx - b.idx);
  const m = Math.max(indexed.length, totalTests ?? indexed.length);
  const adjusted = Array.from<number>({ length: indexed.length }).fill(1);
  for (let i = indexed.length - 1; i >= 0; i--) {
    const raw = (indexed[i]!.p * m) / (i + 1);
    const bounded = Math.min(1, raw);
    adjusted[i] = i === indexed.length - 1 ? bounded : Math.min(bounded, adjusted[i + 1]!);
  }
  for (let i = 0; i < indexed.length; i++) {
    out[indexed[i]!.idx] = round4(adjusted[i]!);
  }
  return out;
}

function erfcApprox(x: number): number {
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const poly =
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const r = poly * Math.exp(-ax * ax);
  return x >= 0 ? r : 2 - r;
}

export function mannWhitneyTwoSided(a: number[], b: number[]): number | null {
  const n1 = a.length;
  const n2 = b.length;
  if (n1 === 0 || n2 === 0) return null;
  const combined: Array<{ v: number; grp: 0 | 1 }> = [
    ...a.map((v) => ({ v, grp: 0 as const })),
    ...b.map((v) => ({ v, grp: 1 as const })),
  ].sort((x, y) => x.v - y.v);
  const n = n1 + n2;
  let r1 = 0;
  let tieSum = 0;
  let i = 0;
  while (i < n) {
    let j = i + 1;
    while (j < n && combined[j]!.v === combined[i]!.v) j++;
    const avgRank = (i + 1 + j) / 2;
    const t = j - i;
    if (t > 1) tieSum += t * t * t - t;
    for (let k = i; k < j; k++) {
      if (combined[k]!.grp === 0) r1 += avgRank;
    }
    i = j;
  }
  const u1 = r1 - (n1 * (n1 + 1)) / 2;
  const mu = (n1 * n2) / 2;
  const denom = n > 1 ? n * (n - 1) : 1;
  const variance = ((n1 * n2) / 12) * (n + 1 - tieSum / denom);
  if (variance <= 0) return 1;
  const z = Math.max(0, Math.abs(u1 - mu) - 0.5) / Math.sqrt(variance);
  return round4(Math.min(1, Math.max(0, erfcApprox(z / Math.SQRT2))));
}

export function isEnglishTextSample(texts: string[]): boolean {
  let asciiLetters = 0;
  let allLetters = 0;
  let alphaWords = 0;
  let englishMarkers = 0;
  for (const raw of texts) {
    const t = stripTitleDecorations(raw);
    asciiLetters += (t.match(/[A-Za-z]/g) ?? []).length;
    allLetters += (t.match(/\p{L}/gu) ?? []).length;
    alphaWords += (t.match(/[A-Za-z]+/g) ?? []).length;
    englishMarkers += (
      t.match(
        /\b(?:the|and|that|this|with|from|into|when|what|which|how|why|have|were|been|they|their|there|most|not|for|you|your|she|him|her|them|his|our|would|could|should|if|was|are)\b/gi,
      ) ?? []
    ).length;
  }
  return (
    allLetters > 0 &&
    asciiLetters / allLetters >= 0.7 &&
    alphaWords > 0 &&
    englishMarkers >= (alphaWords >= 40 ? 2 : 1) &&
    englishMarkers / alphaWords >= 0.04
  );
}

export function isCorruptTranscript(
  v: Pick<
    CatalogVideo,
    "transcriptText" | "wordCount" | "wpm" | "durationSec" | "transcriptTiming"
  >,
  channelMedianWpm?: number | null,
): boolean {
  if (typeof v.wpm === "number" && v.wpm > 0 && (v.wpm < 15 || v.wpm > 380)) return true;
  const txt = (v.transcriptText ?? "").trim();
  if (txt) {
    const words = segmentWords(txt);
    if (
      /[,、，\u2026]\s*$/.test(txt) &&
      words.length >= 5 &&
      words.length < 50 &&
      (v.wpm == null || v.wpm < 110)
    ) {
      return true;
    }
  }
  if (
    typeof channelMedianWpm === "number" &&
    channelMedianWpm >= 120 &&
    typeof v.wpm === "number" &&
    v.wpm > 0 &&
    v.wpm < Math.min(75, channelMedianWpm * 0.45) &&
    (!v.transcriptTiming ||
      v.transcriptTiming.speakingCoveragePct === null ||
      v.transcriptTiming.speakingCoveragePct < 55)
  ) {
    return true;
  }
  return false;
}

export function computeChannelMedianWpm(
  videos: Array<
    Pick<CatalogVideo, "transcriptText" | "wordCount" | "wpm" | "durationSec" | "transcriptTiming">
  >,
): number | null {
  const plausible = videos
    .filter(
      (v) => typeof v.wpm === "number" && v.wpm >= 15 && v.wpm <= 380 && !isCorruptTranscript(v),
    )
    .map((v) => v.wpm!);
  return plausible.length >= 3 ? median(plausible) : null;
}

const TRAILING_TAG_SUFFIX_RE =
  /(?:\s*(?:#[^\s#()[\]【】（）]+|\([^)]*\)|\[[^\]]*\]|【[^】]*】|（[^）]*）))+[\s.!?:;。！？：；-]*$/u;
const LEADING_BADGE_RE =
  /^(?:\s*(?:#[^\s#()[\]【】（）]+|\([^)]*\)|\[[^\]]*\]|【[^】]*】|（[^）]*）))+[\s:：—–-]*/u;
const TRAILING_EMOJI_RE =
  /((?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|\uFE0F|\u200D\p{Extended_Pictographic})*))[\s.!?:;。！？：；-]*$/u;
const EMOJI_STRIP_RE =
  /\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|\uFE0F|\u200D|\u20E3/gu;
const WIDE_DISPLAY_CHAR_RE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303F\uFF01-\uFF60\uFFE0-\uFFE6]|\p{Extended_Pictographic}/u;

const WORD_SEGMENTER =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "word" })
    : null;

function stripTitleDecorations(title: string): string {
  const noTrail = title
    .trim()
    .replace(EMOJI_STRIP_RE, " ")
    .trim()
    .replace(TRAILING_TAG_SUFFIX_RE, " ")
    .replace(EMOJI_STRIP_RE, " ")
    .trim();
  const noLead = noTrail.replace(LEADING_BADGE_RE, "").trim();
  return noLead || noTrail;
}

export function extractTrailingEmoji(title: string): string {
  const core = title.trim().replace(TRAILING_TAG_SUFFIX_RE, "").trim();
  const m = core.match(TRAILING_EMOJI_RE);
  return m ? m[1]! : "NONE";
}

export function classifyEmojiValence(emoji: string): string {
  if (emoji === "NONE") return "none";
  const norm = emoji.replace(/\uFE0F/g, "");
  if (/(?:😱|😨|😰|🤯|😳|😮|😯|😲|💀|☠|🔥|⚡|💥|🚨|⚠)/u.test(norm)) return "high_arousal_shock";
  if (/(?:🤔|🤨|🧐|❓|❔|👀|💡|🕵)/u.test(norm)) return "curiosity_skeptic";
  if (/(?:😊|🥹|❤|💖|😍|🥰|🙏|😌|✨|🎉|👍|😂|🤣|😄|😁|😏)/u.test(norm)) return "wholesome_relief";
  if (/(?:😢|😭|💔|😞|😔|🥺|😿|🪦)/u.test(norm)) return "sad_tragic";
  if (/(?:🤢|🤮|😬|😖|😫|😵|🥴|🪳|🪱|🕷|🦟)/u.test(norm)) return "food_disgust_cringe";
  return "other_emoji";
}

export function countTitleWords(title: string): number {
  const stripped = stripTitleDecorations(title);
  if (!stripped) return 0;
  if (WORD_SEGMENTER) {
    let count = 0;
    for (const seg of WORD_SEGMENTER.segment(stripped)) {
      if (seg.isWordLike) count++;
    }
    return count;
  }
  return stripped.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

const GRAPHEME_SEGMENTER =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

export function countTitleChars(title: string): number {
  const trimmed = title.trim();
  if (!trimmed) return 0;
  if (GRAPHEME_SEGMENTER) {
    let count = 0;
    for (const _ of GRAPHEME_SEGMENTER.segment(trimmed)) count++;
    return count;
  }
  return Array.from(trimmed).length;
}

export function countTitleDisplayUnits(title: string): number {
  const trimmed = title.trim();
  if (!trimmed) return 0;
  let units = 0;
  if (GRAPHEME_SEGMENTER) {
    for (const { segment } of GRAPHEME_SEGMENTER.segment(trimmed)) {
      units += WIDE_DISPLAY_CHAR_RE.test(segment) ? 2 : 1;
    }
    return units;
  }
  for (const ch of Array.from(trimmed)) {
    units += WIDE_DISPLAY_CHAR_RE.test(ch) ? 2 : 1;
  }
  return units;
}

const LEADING_TITLE_DECOR_RE =
  /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|\uFE0F|\u200D|\u20E3|#[^\s#()[\]【】（）]+\s*|\[[^\]]*\]\s*|\([^)]*\)\s*|【[^】]*】\s*|（[^）]*）\s*|["'“”‘’([{\s!?.…—–-])+/u;

export function classifyTitleOpener(title: string): string {
  const t = title.trim().replace(LEADING_TITLE_DECOR_RE, "").trim();
  if (/^how to\b/i.test(t)) return "How To ...";
  if (/^how\b/i.test(t)) return "How ...";
  if (/^why\b/i.test(t)) return "Why ...";
  if (/^what\b/i.test(t)) return "What ...";
  if (/^(?:when|where|who)\b/i.test(t)) return "When/Where/Who ...";
  if (/^(?:can|could|would|should)\b/i.test(t)) return "Can/Could/Would ...";
  if (/^(?:do|does|did|is|are|was|were)\b/i.test(t)) return "Does/Is/Was ...";
  if (/^the\b/i.test(t)) return "The ...";
  if (/^(?:he|she|they|his|her|their|this|these|someone)\b/i.test(t)) return "He/She/They/This ...";
  if (/^(?:i|my|we|our)\b/i.test(t)) return "I/My/We ...";
  if (/^\d/.test(t)) return "Number/Stat ...";
  if (/^[A-Za-z]{2,}ing\b/i.test(t)) return "Action -ing ...";
  return "Other";
}

export function classifyOpeningSentence(line: string): string {
  const t = line.trim();
  if (!t) return "other_direct";
  if (/^(?:did you know|fun fact|believe it or not)\b/i.test(t)) return "cliche_did_you_know";
  if (/^(?:if|imagine|what if|suppose)\b/i.test(t)) return "hypothetical_if_you";
  if (/^(?:when|as|while)\b/i.test(t)) return "in_medias_res_temporal";
  if (/^(?:stop|never|don't|do not)\b/i.test(t)) return "warning_prohibition";
  if (/^(?:lay|rest|place|put|take|mix|cut|add|grab|pour|fold|hold)\b/i.test(t))
    return "imperative_diy_command";
  if (
    /[?？؟]$/.test(t) ||
    /^(?:who|what|why|how|do|does|did|can|could|would|have|has|is|are)\b/i.test(t)
  )
    return "question";
  if (/^(?:you|your|you're|you'll|you'd)\b/i.test(t)) return "second_person_direct";
  if (/^(?:i|we|my|our|i'm|we're)\b/i.test(t)) return "first_person_i_we";
  if (/^(?:he|she|they|it|its|it's|the|this|a|an|in|on|during|back in)\b/i.test(t))
    return "direct_story_or_fact";
  return "other_direct";
}

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "that",
  "with",
  "this",
  "from",
  "your",
  "have",
  "will",
  "what",
  "when",
  "where",
  "which",
  "their",
  "they",
  "them",
  "there",
  "these",
  "those",
  "would",
  "could",
  "should",
  "about",
  "into",
  "over",
  "after",
  "before",
  "been",
  "were",
  "was",
  "are",
  "can",
  "did",
  "does",
  "how",
  "why",
  "who",
  "you",
  "its",
  "not",
  "but",
  "out",
  "all",
  "one",
  "two",
  "just",
  "like",
  "more",
  "very",
  "some",
  "than",
  "then",
  "here",
]);

function contentTokens(raw: string): Set<string> {
  const clean = stripTitleDecorations(raw).normalize("NFC").toLowerCase();
  const out = new Set<string>();
  const tokens = segmentWords(clean).flatMap((w) =>
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(w)
      ? /\p{Script=Han}|[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]{2,}/u.test(w)
        ? [w]
        : []
      : (w.match(/[\p{L}\p{M}\p{N}]+/gu) ?? []).filter(
          (tok) => tok.replace(/\p{M}/gu, "").length >= 2 && tok.length >= 3,
        ),
  );
  for (const rawTok of tokens) {
    if (STOPWORDS.has(rawTok)) continue;
    const stem =
      rawTok.length >= 5 && rawTok.endsWith("s") && !rawTok.endsWith("ss")
        ? rawTok.slice(0, -1)
        : rawTok;
    out.add(stem);
  }
  return out;
}

export function countSharedContentWords(title: string, openingLine: string): number {
  const titleSet = contentTokens(title);
  if (titleSet.size === 0) return 0;
  const openSet = contentTokens(openingLine);
  let shared = 0;
  for (const tok of titleSet) {
    if (openSet.has(tok)) shared++;
  }
  return shared;
}

function subsampleBaseline(videos: CatalogVideo[]): SubsampleBaseline {
  if (videos.length === 0) return { sampleN: 0, baseWinnerPct: null, baseFlopPct: null };
  return {
    sampleN: videos.length,
    baseWinnerPct: pct(videos.filter((v) => v.tier === "winner").length, videos.length),
    baseFlopPct: pct(videos.filter((v) => v.tier === "flop").length, videos.length),
  };
}

function summarizeCatalogBand(
  band: string,
  videos: CatalogVideo[],
  allVideos: CatalogVideo[],
  base: SubsampleBaseline,
): CatalogBandStat {
  const winnerCount = videos.filter((v) => v.tier === "winner").length;
  const medianCount = videos.filter((v) => v.tier === "median").length;
  const flopCount = videos.filter((v) => v.tier === "flop").length;
  const winnerPct = pct(winnerCount, videos.length);
  const flopPct = pct(flopCount, videos.length);
  const outliers = videos.map((v) => v.outlierRolling);
  const totalWinners = allVideos.filter((v) => v.tier === "winner").length;
  const totalFlops = allVideos.filter((v) => v.tier === "flop").length;
  const pValue =
    totalWinners > 0 && totalFlops > 0
      ? fisherExactTwoSided(
          winnerCount,
          flopCount,
          totalWinners - winnerCount,
          totalFlops - flopCount,
        )
      : null;
  return {
    band,
    n: videos.length,
    sharePct: pct(videos.length, allVideos.length),
    winnerCount,
    medianCount,
    flopCount,
    winnerPct,
    flopPct,
    winRateDeltaPp: base.baseWinnerPct !== null ? round1(winnerPct - base.baseWinnerPct) : null,
    flopRateDeltaPp: base.baseFlopPct !== null ? round1(flopPct - base.baseFlopPct) : null,
    medianOutlier: outliers.length > 0 ? round2(median(outliers)) : null,
    outlierIqr: iqr(outliers),
    medianViews: videos.length > 0 ? Math.round(median(videos.map((v) => v.views))) : null,
    pValue,
    qValue: null,
    reliability: reliabilityLabel(videos.length),
  };
}

function buildGroupBands(
  videos: CatalogVideo[],
  keyOf: (v: CatalogVideo) => string,
  orderedKeys?: string[],
): CatalogBandStat[] {
  const base = subsampleBaseline(videos);
  const grouped = new Map<string, CatalogVideo[]>();
  for (const v of videos) {
    const k = keyOf(v);
    const list = grouped.get(k) ?? [];
    list.push(v);
    grouped.set(k, list);
  }
  const keys = orderedKeys
    ? orderedKeys.filter((k) => grouped.has(k))
    : [...grouped.keys()].sort(
        (a, b) =>
          (grouped.get(b)?.length ?? 0) - (grouped.get(a)?.length ?? 0) || a.localeCompare(b),
      );
  const rows = keys.map((k) => summarizeCatalogBand(k, grouped.get(k) ?? [], videos, base));
  const qVals = benjaminiHochberg(rows.map((r) => r.pValue));
  for (let i = 0; i < rows.length; i++) rows[i]!.qValue = qVals[i] ?? null;
  return rows;
}

function buildTitleModifierStat(
  modifier: string,
  mature: CatalogVideo[],
  base: SubsampleBaseline,
  pred: (v: CatalogVideo) => boolean,
): TitleModifierStat {
  const matched = mature.filter(pred);
  const band = summarizeCatalogBand(modifier, matched, mature, base);
  return {
    modifier,
    n: band.n,
    sharePct: band.sharePct,
    winnerPct: band.winnerPct,
    flopPct: band.flopPct,
    winRateDeltaPp: band.winRateDeltaPp,
    medianOutlier: band.medianOutlier,
    pValue: band.pValue,
    qValue: null,
    reliability: band.reliability,
  };
}

function isTitleCaseTitle(title: string): boolean {
  const clean = stripTitleDecorations(title);
  const words = clean.split(/\s+/).filter((w) => /^[\p{Lu}\p{Ll}]/u.test(w));
  if (words.length < 3) return false;
  const multiLetter = words
    .map((w) => w.replace(/[^\p{Lu}\p{Ll}]/gu, ""))
    .filter((letters) => letters.length >= 2);
  if (multiLetter.length >= 2) {
    const allUpper = multiLetter.filter((letters) => !/\p{Ll}/u.test(letters)).length;
    if (allUpper / multiLetter.length >= 0.7) return false;
  }
  const capitalized = words.filter((w) => /^\p{Lu}/u.test(w)).length;
  return capitalized / words.length >= 0.7;
}

function summarizeQuarterlyStability(mature: CatalogVideo[]): QuarterlyStabilityRow[] {
  const byQuarter = new Map<string, CatalogVideo[]>();
  for (const v of mature) {
    if (!v.uploadDate || !/^\d{8}$/.test(v.uploadDate)) continue;
    const yr = v.uploadDate.slice(0, 4);
    const mo = Number(v.uploadDate.slice(4, 6));
    if (!Number.isFinite(mo) || mo < 1 || mo > 12) continue;
    const q = `${yr}-Q${Math.ceil(mo / 3)}`;
    const list = byQuarter.get(q) ?? [];
    list.push(v);
    byQuarter.set(q, list);
  }
  return [...byQuarter.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([quarter, list]) => {
      const durs = list
        .map((v) => v.durationSec)
        .filter((d): d is number => typeof d === "number" && d > 0);
      const outliers = list.map((v) => v.outlierRolling);
      return {
        quarter,
        n: list.length,
        medianViews: Math.round(median(list.map((v) => v.views))),
        medianDurationSec: durs.length > 0 ? round1(median(durs)) : null,
        trailingEmojiPct: pct(
          list.filter((v) => extractTrailingEmoji(v.title) !== "NONE").length,
          list.length,
        ),
        winnerPct: pct(list.filter((v) => v.tier === "winner").length, list.length),
        flopPct: pct(list.filter((v) => v.tier === "flop").length, list.length),
        medianOutlier: outliers.length > 0 ? round2(median(outliers)) : null,
      };
    });
}

function summarizeEraStability(mature: CatalogVideo[]): EraStabilityRow[] {
  const onFeed = mature.filter((v) => !v.offFeed);
  if (onFeed.length < 16) return [];
  const allDated = onFeed.every((v) => Boolean(v.uploadDate && /^\d{8}$/.test(v.uploadDate)));
  const oldestFirst = [...onFeed].sort((a, b) =>
    allDated
      ? a.uploadDate!.localeCompare(b.uploadDate!) ||
        b.playlistIndex - a.playlistIndex ||
        a.id.localeCompare(b.id)
      : b.playlistIndex - a.playlistIndex || a.id.localeCompare(b.id),
  );
  const labels = ["Oldest 25%", "Mid-Old 25%", "Mid-Recent 25%", "Newest 25%"];
  const rows: EraStabilityRow[] = [];
  for (let q = 0; q < 4; q++) {
    const start = Math.floor((q * oldestFirst.length) / 4);
    const end = Math.floor(((q + 1) * oldestFirst.length) / 4);
    const slice = oldestFirst.slice(start, end);
    if (slice.length === 0) continue;
    const outliers = slice.map((v) => v.outlierRolling);
    rows.push({
      era: labels[q]!,
      n: slice.length,
      medianViews: Math.round(median(slice.map((v) => v.views))),
      winnerPct: pct(slice.filter((v) => v.tier === "winner").length, slice.length),
      flopPct: pct(slice.filter((v) => v.tier === "flop").length, slice.length),
      medianOutlier: outliers.length > 0 ? round2(median(outliers)) : null,
      trailingEmojiPct: pct(
        slice.filter((v) => extractTrailingEmoji(v.title) !== "NONE").length,
        slice.length,
      ),
    });
  }
  return rows;
}

export function summarizeCatalogPackaging(mature: CatalogVideo[]) {
  const withDuration = mature.filter((v) => typeof v.durationSec === "number" && v.durationSec > 0);
  const rawWithWpm = mature.filter((v) => typeof v.wpm === "number" && v.wpm > 0);
  const channelMedianWpm = computeChannelMedianWpm(rawWithWpm);
  const withWpm = rawWithWpm.filter((v) => !isCorruptTranscript(v, channelMedianWpm));
  const excludedCorruptWpmCount = rawWithWpm.length - withWpm.length;
  const durationBase = subsampleBaseline(withDuration);
  const wpmBase = subsampleBaseline(withWpm);
  const titleBase = subsampleBaseline(mature);

  const medDur = withDuration.length > 0 ? median(withDuration.map((v) => v.durationSec!)) : 0;
  const durationFormatMode: "shorts" | "midform" | "longform" =
    medDur > 300 ? "longform" : medDur > 90 ? "midform" : "shorts";
  const durationBands =
    durationFormatMode === "longform"
      ? buildGroupBands(
          withDuration,
          (v) => {
            const d = v.durationSec!;
            if (d < 300) return "<5m";
            if (d < 600) return "5-9m";
            if (d < 1200) return "10-19m";
            if (d < 2400) return "20-39m";
            return "40m+";
          },
          ["<5m", "5-9m", "10-19m", "20-39m", "40m+"],
        )
      : durationFormatMode === "midform"
        ? buildGroupBands(
            withDuration,
            (v) => {
              const d = v.durationSec!;
              if (d < 60) return "<60s";
              if (d < 120) return "60-119s";
              if (d < 180) return "120-179s";
              if (d < 300) return "180-299s";
              return "300s+";
            },
            ["<60s", "60-119s", "120-179s", "180-299s", "300s+"],
          )
        : buildGroupBands(
            withDuration,
            (v) => {
              const d = v.durationSec!;
              if (d < 25) return "<25s";
              if (d < 35) return "25-34s";
              if (d < 45) return "35-44s";
              if (d < 55) return "45-54s";
              if (d < 65) return "55-64s";
              return "65s+";
            },
            ["<25s", "25-34s", "35-44s", "45-54s", "55-64s", "65s+"],
          );

  const wpmBandMode: "slow" | "standard" | "fast" =
    channelMedianWpm !== null && channelMedianWpm < 110
      ? "slow"
      : channelMedianWpm !== null && channelMedianWpm > 210
        ? "fast"
        : "standard";
  const wpmBands =
    wpmBandMode === "slow"
      ? buildGroupBands(
          withWpm,
          (v) => {
            const w = v.wpm!;
            if (w < 60) return "<60";
            if (w < 80) return "60-79";
            if (w < 100) return "80-99";
            if (w < 120) return "100-119";
            if (w < 140) return "120-139";
            return "140+";
          },
          ["<60", "60-79", "80-99", "100-119", "120-139", "140+"],
        )
      : wpmBandMode === "fast"
        ? buildGroupBands(
            withWpm,
            (v) => {
              const w = v.wpm!;
              if (w < 170) return "<170";
              if (w < 190) return "170-189";
              if (w < 210) return "190-209";
              if (w < 230) return "210-229";
              if (w < 250) return "230-249";
              return "250+";
            },
            ["<170", "170-189", "190-209", "210-229", "230-249", "250+"],
          )
        : buildGroupBands(
            withWpm,
            (v) => {
              const w = v.wpm!;
              if (w < 130) return "<130";
              if (w < 150) return "130-149";
              if (w < 165) return "150-164";
              if (w < 180) return "165-179";
              if (w < 200) return "180-199";
              return "200+";
            },
            ["<130", "130-149", "150-164", "165-179", "180-199", "200+"],
          );

  const isNonSpaceTitles =
    mature.length > 0 &&
    mature.filter((v) =>
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u.test(
        v.title,
      ),
    ).length /
      mature.length >=
      0.5;
  const titleWordBands = isNonSpaceTitles
    ? []
    : buildGroupBands(
        mature,
        (v) => {
          const c = countTitleWords(v.title);
          if (c <= 5) return "<=5 words";
          if (c <= 7) return "6-7 words";
          if (c <= 9) return "8-9 words";
          return "10+ words";
        },
        ["<=5 words", "6-7 words", "8-9 words", "10+ words"],
      );
  const titleCharBands = buildGroupBands(
    mature,
    (v) => {
      const c = countTitleDisplayUnits(v.title);
      if (c <= 35) return "<=35 units";
      if (c <= 50) return "36-50 units";
      if (c <= 65) return "51-65 units";
      return "66+ units";
    },
    ["<=35 units", "36-50 units", "51-65 units", "66+ units"],
  );
  const isEnglishTitles = isEnglishTextSample(mature.map((v) => v.title));
  const titleOpeners = isEnglishTitles
    ? buildGroupBands(mature, (v) => classifyTitleOpener(v.title))
    : [];
  const topTrailingEmojis = buildGroupBands(mature, (v) => extractTrailingEmoji(v.title)).slice(
    0,
    12,
  );
  const emojiValenceFamilies = buildGroupBands(mature, (v) =>
    classifyEmojiValence(extractTrailingEmoji(v.title)),
  );

  const titleModifiers: TitleModifierStat[] = [
    buildTitleModifierStat("parenthetical_or_bracket_tag", mature, titleBase, (v) =>
      /\([^)]+\)|\[[^\]]+\]|【[^】]+】|（[^）]+）|「[^」]+」|『[^』]+』/.test(v.title),
    ),
    buildTitleModifierStat("hashtag_suffix", mature, titleBase, (v) => /#\S+/.test(v.title)),
    buildTitleModifierStat("title_case", mature, titleBase, (v) => isTitleCaseTitle(v.title)),
    buildTitleModifierStat("all_caps_emphasis_word", mature, titleBase, (v) =>
      /(?:^|[^\p{L}\p{N}])\p{Lu}{3,}(?:$|[^\p{L}\p{N}])/u.test(stripTitleDecorations(v.title)),
    ),
    buildTitleModifierStat("question_mark", mature, titleBase, (v) => /[?？؟]/.test(v.title)),
    buildTitleModifierStat("concrete_number", mature, titleBase, (v) => /\d/.test(v.title)),
    buildTitleModifierStat("exclamation_mark", mature, titleBase, (v) => /[!！]/.test(v.title)),
    buildTitleModifierStat("ellipsis_cliffhanger", mature, titleBase, (v) =>
      /\.{3}|…/.test(v.title),
    ),
    buildTitleModifierStat("two_part_colon_or_dash", mature, titleBase, (v) =>
      /(?::\s|：|\s[-–—|｜]\s|[|｜])/.test(stripTitleDecorations(v.title)),
    ),
    ...(isEnglishTitles
      ? [
          buildTitleModifierStat("second_person_you", mature, titleBase, (v) =>
            /\b(?:you|your|you're|you'll|yourself)\b/i.test(v.title),
          ),
          buildTitleModifierStat("first_person_i_we", mature, titleBase, (v) =>
            /\b(?:i|my|we|our|i'm|we're)\b/i.test(v.title),
          ),
        ]
      : []),
  ].filter((m) => m.n > 0);
  const modQ = benjaminiHochberg(titleModifiers.map((m) => m.pValue));
  for (let i = 0; i < titleModifiers.length; i++) titleModifiers[i]!.qValue = modQ[i] ?? null;

  const winners = mature.filter((v) => v.tier === "winner");
  const flops = mature.filter((v) => v.tier === "flop");
  const shareMatching = (list: CatalogVideo[], pred: (v: CatalogVideo) => boolean) =>
    list.length > 0 ? pct(list.filter(pred).length, list.length) : null;
  const emojiShare = (list: CatalogVideo[]) =>
    shareMatching(list, (v) => extractTrailingEmoji(v.title) !== "NONE");
  const questionShare = (list: CatalogVideo[]) =>
    shareMatching(list, (v) => /[?？؟]/.test(v.title));
  const numberShare = (list: CatalogVideo[]) => shareMatching(list, (v) => /\d/.test(v.title));
  const medWords = (list: CatalogVideo[]) =>
    list.length > 0 ? round1(median(list.map((v) => countTitleWords(v.title)))) : null;
  const medChars = (list: CatalogVideo[]) =>
    list.length > 0 ? round1(median(list.map((v) => countTitleChars(v.title)))) : null;
  const medDisplayUnits = (list: CatalogVideo[]) =>
    list.length > 0 ? round1(median(list.map((v) => countTitleDisplayUnits(v.title)))) : null;

  const withHeatmap = mature.filter((v) => typeof v.heatmapPeakPct === "number");
  const hmWin = withHeatmap.filter((v) => v.tier === "winner");
  const hmFlop = withHeatmap.filter((v) => v.tier === "flop");
  const hmTail = (list: CatalogVideo[]) => {
    const vals = list
      .map((v) => v.heatmapTailLift)
      .filter((x): x is number => typeof x === "number");
    return vals.length > 0 ? round2(median(vals)) : null;
  };
  const heatmapSummary =
    withHeatmap.length > 0
      ? {
          sampleN: withHeatmap.length,
          medianPeakPct: round1(median(withHeatmap.map((v) => v.heatmapPeakPct!))),
          medianTailLift: hmTail(withHeatmap),
          winnerMedianTailLift: hmTail(hmWin),
          flopMedianTailLift: hmTail(hmFlop),
          medianEarly: (() => {
            const vals = withHeatmap
              .map((v) => v.heatmapEarly)
              .filter((x): x is number => typeof x === "number");
            return vals.length > 0 ? round2(median(vals)) : null;
          })(),
          medianEnd: (() => {
            const vals = withHeatmap
              .map((v) => v.heatmapEnd)
              .filter((x): x is number => typeof x === "number");
            return vals.length > 0 ? round2(median(vals)) : null;
          })(),
        }
      : null;

  const withChapters = mature.filter(
    (v) => typeof v.chaptersCount === "number" && v.chaptersCount > 0,
  );
  const chaptersSummary =
    withChapters.length > 0
      ? {
          sampleN: withChapters.length,
          shareOfMaturePct: pct(withChapters.length, mature.length),
          medianChaptersCount: round1(median(withChapters.map((v) => v.chaptersCount!))),
          medianFirstChapterEndSec: (() => {
            const vals = withChapters
              .map((v) => v.firstChapterEndSec)
              .filter((x): x is number => typeof x === "number");
            return vals.length > 0 ? round1(median(vals)) : null;
          })(),
          medianChapterSec: (() => {
            const vals = withChapters
              .map((v) => v.medianChapterSec)
              .filter((x): x is number => typeof x === "number");
            return vals.length > 0 ? round1(median(vals)) : null;
          })(),
        }
      : null;

  return {
    durationFormatMode,
    durationSampleN: durationBase.sampleN,
    durationBaseWinnerPct: durationBase.baseWinnerPct,
    durationBaseFlopPct: durationBase.baseFlopPct,
    durationBands,
    wpmBandMode,
    wpmSampleN: wpmBase.sampleN,
    excludedCorruptWpmCount,
    wpmBaseWinnerPct: wpmBase.baseWinnerPct,
    wpmBaseFlopPct: wpmBase.baseFlopPct,
    wpmBands,
    isEnglishTitles,
    isNonSpaceTitles,
    titleWordBands,
    titleCharBands,
    titleOpeners,
    titleModifiers,
    topTrailingEmojis,
    emojiValenceFamilies,
    temporalStability: summarizeQuarterlyStability(mature),
    eraStability: summarizeEraStability(mature),
    heatmapSummary,
    chaptersSummary,
    titleSummary: {
      sampleN: titleBase.sampleN,
      baseWinnerPct: titleBase.baseWinnerPct,
      baseFlopPct: titleBase.baseFlopPct,
      medianTitleWords: medWords(mature),
      winnerMedianTitleWords: medWords(winners),
      flopMedianTitleWords: medWords(flops),
      medianTitleChars: medChars(mature),
      winnerMedianTitleChars: medChars(winners),
      flopMedianTitleChars: medChars(flops),
      medianTitleDisplayUnits: medDisplayUnits(mature),
      winnerMedianTitleDisplayUnits: medDisplayUnits(winners),
      flopMedianTitleDisplayUnits: medDisplayUnits(flops),
      trailingEmojiPct: emojiShare(mature),
      winnerTrailingEmojiPct: emojiShare(winners),
      flopTrailingEmojiPct: emojiShare(flops),
      questionTitlePct: questionShare(mature) ?? 0,
      winnerQuestionTitlePct: questionShare(winners),
      flopQuestionTitlePct: questionShare(flops),
      numberTitlePct: numberShare(mature) ?? 0,
      winnerNumberTitlePct: numberShare(winners),
      flopNumberTitlePct: numberShare(flops),
    },
  };
}

function estimateEnglishSyllables(word: string): number {
  const clean = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!clean) return 0;
  if (clean.length <= 3) return 1;
  const trimmed = clean.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

const SPOKEN_STARTER_RE = /^(but|so|now|then|and|well|actually|still|yet)\b/i;
const PARTICIPLE_TAIL_RE = /,\s+[a-z]{3,}ing\b/i;
const PIVOT_COMMA_RE = /,\s+(?:but|so|until|which)\b/i;
const FLASHBACK_REWIND_RE = /\byou\s+see\b/i;
const FORMAL_TRANSITION_RE =
  /\b(?:however|therefore|furthermore|moreover|nevertheless|consequently|in conclusion)\b/i;
const AI_SLOP_BUZZWORD_RE =
  /\b(?:delve|tapestry|testament|ever-evolving|game-changer|mind-blowing|buckle up|let's dive in|dive into|unpack this|rollercoaster|realm of|beacon of|symphony of)\b/i;
const YT_FILLER_INTRO_RE =
  /^(?:hey guys|what's up guys|welcome back|in today's video|today we're going to|before we start|make sure to like|smash that|don't forget to subscribe)\b/i;
const MORALIZING_ENDING_RE =
  /\b(?:remember to|the moral of|this teaches us|the lesson here|always remember|in the end,?\s+we\s+(?:should|must|learn)|so next time you)\b/i;
const META_DIRECTORIAL_LEAK_RE =
  /\b(?:camera\s+(?:path|angle|pans?|zooms?|cuts?|tracks?|pulls?)|from\s+above\s+the\s+scene|cut\s+to\s+a\s+close-?up|slow-?motion\s+shot|smash\s+cut|whip\s+pan|screen\s+flips?\s+into|split\s+screen\s+shows?)\b/i;
const CONTRACTION_RE = /\b[a-z]+'(?:t|s|re|ve|ll|d|m)\b/i;

function summarizeTimingSubset(list: CatalogVideo[]) {
  const firstVals = list
    .map((v) => v.transcriptTiming?.firstSpokenSec)
    .filter((x): x is number => typeof x === "number");
  const covVals = list
    .map((v) => v.transcriptTiming?.speakingCoveragePct)
    .filter((x): x is number => typeof x === "number");
  const maxGapVals = list
    .filter((v) => v.transcriptTiming?.isGenerated !== true)
    .map((v) => v.transcriptTiming?.maxGapSec)
    .filter((x): x is number => typeof x === "number");
  const silCountVals = list
    .filter((v) => v.transcriptTiming?.isGenerated !== true)
    .map((v) => v.transcriptTiming?.silenceGapCount)
    .filter((x): x is number => typeof x === "number");
  const activeWpmVals = list
    .map((v) => v.transcriptTiming?.activeSpeechWpm)
    .filter((x): x is number => typeof x === "number" && x > 0);
  const lateRatioVals = list
    .map((v) => v.transcriptTiming?.lateToEarlyWpmRatio)
    .filter((x): x is number => typeof x === "number" && x > 0);
  const tailVals = list
    .map((v) => v.transcriptTiming?.captionTailSec)
    .filter((x): x is number => typeof x === "number");
  const genKnown = list.filter((v) => typeof v.transcriptTiming?.isGenerated === "boolean");
  const zeroDeadAir = firstVals.filter((t) => t <= 0.5).length;
  return {
    sampleN: list.length,
    activeSpeechSampleN: activeWpmVals.length,
    autoGeneratedPct:
      genKnown.length > 0
        ? pct(
            genKnown.filter((v) => v.transcriptTiming?.isGenerated === true).length,
            genKnown.length,
          )
        : null,
    medianFirstSpokenSec: firstVals.length > 0 ? round2(median(firstVals)) : null,
    zeroDeadAirStartPct: firstVals.length > 0 ? pct(zeroDeadAir, firstVals.length) : null,
    medianSpeakingCoveragePct: covVals.length > 0 ? round1(median(covVals)) : null,
    medianActiveSpeechWpm: activeWpmVals.length > 0 ? round1(median(activeWpmVals)) : null,
    medianLateToEarlyWpmRatio: lateRatioVals.length > 0 ? round2(median(lateRatioVals)) : null,
    medianCaptionTailSec: tailVals.length > 0 ? round2(median(tailVals)) : null,
    medianMaxGapSec: maxGapVals.length > 0 ? round2(median(maxGapVals)) : null,
    medianSilenceGapCount: silCountVals.length > 0 ? round1(median(silCountVals)) : null,
  };
}

function detectPositionalPovShift(sents: string[]): boolean {
  if (sents.length < 4) return false;
  const half = Math.floor(sents.length / 2);
  const scoreHalf = (chunk: string) => {
    const noYouSee = chunk.replace(/\byou\s+see\b/gi, " ");
    const c1 = (chunk.match(/\b(?:i|we|my|our|i'm|we're|me|us)\b/gi) ?? []).length;
    const c2 = (noYouSee.match(/\b(?:you|your|you're|you'll|you'd|yourself)\b/gi) ?? []).length;
    const c3 = (chunk.match(/\b(?:he|she|him|her|his)\b/gi) ?? []).length;
    const counts = { first: c1, second: c2, third: c3 };
    const total = c1 + c2 + c3;
    const dominant = (["first", "second", "third"] as const).find(
      (k) => counts[k] >= 2 && counts[k] > total - counts[k],
    );
    return { counts, dominant: dominant ?? null };
  };
  const h1 = scoreHalf(sents.slice(0, half).join(" "));
  const h2 = scoreHalf(sents.slice(half).join(" "));
  return (
    h1.dominant !== null &&
    h2.dominant !== null &&
    h1.dominant !== h2.dominant &&
    h2.counts[h1.dominant] <= 1
  );
}

export function summarizeTranscriptLinguistics(mature: CatalogVideo[]) {
  const channelMedianWpm = computeChannelMedianWpm(mature);
  const rawWithText = mature.filter((v) =>
    Boolean(v.transcriptText && /[\p{L}\p{N}]/u.test(v.transcriptText)),
  );
  const withText = rawWithText.filter((v) => !isCorruptTranscript(v, channelMedianWpm));
  const excludedCorruptCount = rawWithText.length - withText.length;

  const openerEntries = mature
    .filter((v) => !isCorruptTranscript(v, channelMedianWpm))
    .map((v) => {
      const explicit = v.openingTranscriptLine?.trim();
      if (explicit && /[\p{L}\p{N}]/u.test(explicit) && segmentWords(explicit).length <= 45) {
        return { video: v, opener: explicit };
      }
      if (v.transcriptText?.trim()) {
        const opener = cleanTranscriptText(
          v.transcriptText,
          v.transcriptTiming?.isGenerated ?? null,
        ).openingSentence;
        if (opener) return { video: v, opener };
      }
      if (explicit && /[\p{L}\p{N}]/u.test(explicit)) {
        const opener = cleanTranscriptText(
          explicit,
          v.transcriptTiming?.isGenerated ?? null,
        ).openingSentence;
        if (opener) return { video: v, opener };
      }
      return null;
    })
    .filter((x): x is { video: CatalogVideo; opener: string } => x !== null);

  const openerVideos = openerEntries.map((x) => x.video);
  const openerById = new Map(openerEntries.map((x) => [x.video.id, x.opener]));
  const openerBase = subsampleBaseline(openerVideos);
  const isEnglishOpeners = isEnglishTextSample(openerEntries.map((x) => x.opener));
  const openingSentencePatterns = isEnglishOpeners
    ? buildGroupBands(openerVideos, (v) => classifyOpeningSentence(openerById.get(v.id) ?? ""))
    : [];
  const titleOpeningAnchorBands = buildGroupBands(
    openerVideos,
    (v) => {
      const shared = countSharedContentWords(v.title, openerById.get(v.id) ?? "");
      if (shared === 0) return "0 shared words";
      if (shared === 1) return "1 shared word";
      return "2+ shared words";
    },
    ["0 shared words", "1 shared word", "2+ shared words"],
  );

  const sentenceLengths: number[] = [];
  const perVideoShortPcts: number[] = [];
  const sentencesPerVideo: number[] = [];
  const firstSentWords: number[] = [];
  const lastSentWords: number[] = [];
  const perVideoCvs: number[] = [];
  const winVideoCvs: number[] = [];
  const flopVideoCvs: number[] = [];
  const perVideoMinLens: number[] = [];
  const perVideoMaxLens: number[] = [];
  const perVideoMaxMinRatios: number[] = [];
  const perVideoAdjJumps: number[] = [];
  const fkGrades: number[] = [];
  const avgWordLens: number[] = [];
  let punctuatedSampleN = 0;
  let shortClosingCount = 0;
  let shortSentences = 0;
  let totalSentences = 0;
  let spokenStarterSentCount = 0;
  const spokenStarterCounts = new Map<string, number>();
  let totalWordTokens = 0;
  let simpleSyllableWords = 0;
  let count2nd = 0;
  let count3rd = 0;
  let count1st = 0;
  let contractionVideos = 0;
  let participleVideos = 0;
  let participleWinners = 0;
  let participleFlops = 0;
  let pivotCommaVideos = 0;
  let flashbackVideos = 0;
  let flashbackWinners = 0;
  let flashbackFlops = 0;
  let formalTransitionVideos = 0;
  let aiSlopVideos = 0;
  let ytFillerIntroVideos = 0;
  let moralizingEndingVideos = 0;
  let metaDirectorialLeakVideos = 0;
  let inScriptQuestionVideos = 0;
  let exclamationVideos = 0;
  let concreteNumberVideos = 0;
  let totalNumbers = 0;
  let echoSampleN = 0;
  let openingClosingEchoVideos = 0;
  let titleClosingEchoVideos = 0;
  let barePronounOpenerVideos = 0;
  let povShiftSampleN = 0;
  let midScriptPovShiftVideos = 0;
  let hypotheticalModalVideos = 0;
  let hypotheticalModalWinners = 0;
  let hypotheticalModalFlops = 0;

  const withTextWinners = withText.filter((v) => v.tier === "winner").length;
  const withTextFlops = withText.filter((v) => v.tier === "flop").length;

  for (const v of withText) {
    const txt = v.transcriptText!.trim();
    const sents = splitPunctuatedSentences(txt);
    const totalTxtWords = segmentWords(txt).length;
    const hasReliablePunctuation = hasReliableSentencePunctuation(
      sents,
      totalTxtWords,
      v.transcriptTiming?.isGenerated ?? null,
    );
    let lastSentText = txt.slice(-180);
    if (hasReliablePunctuation) {
      punctuatedSampleN++;
      if (sents.length >= 2) {
        echoSampleN++;
        const firstSent = sents[0]!;
        const lastSent = sents[sents.length - 1]!;
        if (countSharedContentWords(firstSent, lastSent) >= 1) openingClosingEchoVideos++;
        if (countSharedContentWords(v.title, lastSent) >= 1) titleClosingEchoVideos++;
      }
      if (sents.length >= 4) {
        povShiftSampleN++;
        if (detectPositionalPovShift(sents)) midScriptPovShiftVideos++;
      }
      if (/^(?:he|she|they|it)\b/i.test(sents[0]!.trim().replace(/^["'“”‘’]+/, ""))) {
        barePronounOpenerVideos++;
      }
      const vidSentLens: number[] = [];
      let vidShort = 0;
      let vidSyllables = 0;
      let vidWords = 0;
      for (const s of sents) {
        const words = segmentWords(s);
        const wc = words.length;
        if (wc > 0) {
          sentenceLengths.push(wc);
          vidSentLens.push(wc);
          totalSentences++;
          if (wc <= 8) {
            shortSentences++;
            vidShort++;
          }
          const starter = s.match(SPOKEN_STARTER_RE);
          if (starter) {
            spokenStarterSentCount++;
            const key = starter[1]!.toLowerCase();
            spokenStarterCounts.set(key, (spokenStarterCounts.get(key) ?? 0) + 1);
          }
          for (const w of words) {
            const alpha = w.replace(/[^A-Za-z]/g, "");
            if (alpha.length > 0) {
              const syl = estimateEnglishSyllables(alpha);
              vidSyllables += syl;
              vidWords++;
              totalWordTokens++;
              if (syl <= 2) simpleSyllableWords++;
            }
          }
        }
      }
      if (vidSentLens.length > 0) {
        lastSentText = sents[sents.length - 1] ?? lastSentText;
        sentencesPerVideo.push(vidSentLens.length);
        perVideoShortPcts.push(pct(vidShort, vidSentLens.length));
        firstSentWords.push(vidSentLens[0]!);
        const lastWc = vidSentLens[vidSentLens.length - 1]!;
        lastSentWords.push(lastWc);
        if (lastWc <= 8) shortClosingCount++;
        if (vidSentLens.length >= 3) {
          const meanL = vidSentLens.reduce((s, x) => s + x, 0) / vidSentLens.length;
          const variance =
            vidSentLens.reduce((s, x) => s + (x - meanL) ** 2, 0) / vidSentLens.length;
          const cv = meanL > 0 ? Math.sqrt(variance) / meanL : 0;
          const minL = Math.min(...vidSentLens);
          const maxL = Math.max(...vidSentLens);
          let jumpSum = 0;
          for (let i = 1; i < vidSentLens.length; i++) {
            jumpSum += Math.abs(vidSentLens[i]! - vidSentLens[i - 1]!);
          }
          perVideoCvs.push(cv);
          if (v.tier === "winner") winVideoCvs.push(cv);
          if (v.tier === "flop") flopVideoCvs.push(cv);
          perVideoMinLens.push(minL);
          perVideoMaxLens.push(maxL);
          perVideoMaxMinRatios.push(maxL / Math.max(1, minL));
          perVideoAdjJumps.push(jumpSum / (vidSentLens.length - 1));
        }
        if (vidWords >= 5) {
          const grade =
            0.39 * (vidWords / vidSentLens.length) + 11.8 * (vidSyllables / vidWords) - 15.59;
          fkGrades.push(round1(Math.max(0, grade)));
        }
      }
    }

    const alphaWords = txt.match(/[A-Za-z]+/g) ?? [];
    if (alphaWords.length > 0) {
      avgWordLens.push(
        round2(alphaWords.reduce((sum, w) => sum + w.length, 0) / alphaWords.length),
      );
    }

    const noYouSee = txt.replace(/\byou\s+see\b/gi, " ");
    const v2nd = (noYouSee.match(/\b(?:you|your|you're|you'll|you'd|yourself)\b/gi) ?? []).length;
    const v3rd = (txt.match(/\b(?:he|she|they|him|her|them|his|their)\b/gi) ?? []).length;
    const v1st = (txt.match(/\b(?:i|we|my|our|i'm|we're|me|us)\b/gi) ?? []).length;
    count2nd += v2nd;
    count3rd += v3rd;
    count1st += v1st;
    if (/\b(?:would|could)\b/i.test(txt)) {
      hypotheticalModalVideos++;
      if (v.tier === "winner") hypotheticalModalWinners++;
      if (v.tier === "flop") hypotheticalModalFlops++;
    }

    if (CONTRACTION_RE.test(txt)) contractionVideos++;
    if (PARTICIPLE_TAIL_RE.test(txt)) {
      participleVideos++;
      if (v.tier === "winner") participleWinners++;
      if (v.tier === "flop") participleFlops++;
    }
    if (PIVOT_COMMA_RE.test(txt)) pivotCommaVideos++;
    if (FLASHBACK_REWIND_RE.test(txt)) {
      flashbackVideos++;
      if (v.tier === "winner") flashbackWinners++;
      if (v.tier === "flop") flashbackFlops++;
    }
    if (FORMAL_TRANSITION_RE.test(txt)) formalTransitionVideos++;
    if (AI_SLOP_BUZZWORD_RE.test(txt)) aiSlopVideos++;
    if (YT_FILLER_INTRO_RE.test(txt)) ytFillerIntroVideos++;
    if (MORALIZING_ENDING_RE.test(lastSentText)) moralizingEndingVideos++;
    if (META_DIRECTORIAL_LEAK_RE.test(txt)) metaDirectorialLeakVideos++;
    if (/[?？؟]/.test(txt)) inScriptQuestionVideos++;
    if (/[!！]/.test(txt)) exclamationVideos++;
    const numHits = (txt.match(/\b\d+(?:[.,]\d+)?\b/g) ?? []).length;
    if (numHits > 0) {
      concreteNumberVideos++;
      totalNumbers += numHits;
    }
  }

  const pronounMatches = count2nd + count3rd + count1st;
  const isEnglishCorpus =
    withText.length > 0 && isEnglishTextSample(withText.map((v) => v.transcriptText!));

  const timedVideos = withText.filter((v) => Boolean(v.transcriptTiming));
  const timedWin = timedVideos.filter((v) => v.tier === "winner");
  const timedFlop = timedVideos.filter((v) => v.tier === "flop");
  const universalInScriptQuestionPct = pct(inScriptQuestionVideos, withText.length);
  const universalExclamationPct = pct(exclamationVideos, withText.length);
  const universalConcreteNumberPct = pct(concreteNumberVideos, withText.length);
  const universalMeanNumbers = withText.length > 0 ? round2(totalNumbers / withText.length) : 0;

  return {
    sampleN: withText.length,
    excludedCorruptCount,
    punctuatedSampleN,
    openingSampleN: openerBase.sampleN,
    openingBaseWinnerPct: openerBase.baseWinnerPct,
    openingBaseFlopPct: openerBase.baseFlopPct,
    isEnglishCorpus,
    isEnglishOpeners,
    medianWordsPerSentence: sentenceLengths.length > 0 ? round1(median(sentenceLengths)) : null,
    sentenceLengthIqr: iqr(sentenceLengths),
    shortPunchySentencePct: totalSentences > 0 ? pct(shortSentences, totalSentences) : null,
    perVideoMedianShortSentPct:
      perVideoShortPcts.length > 0 ? round1(median(perVideoShortPcts)) : null,
    medianSentencesPerVideo:
      sentencesPerVideo.length > 0 ? round1(median(sentencesPerVideo)) : null,
    medianFirstSentenceWords: firstSentWords.length > 0 ? round1(median(firstSentWords)) : null,
    medianLastSentenceWords: lastSentWords.length > 0 ? round1(median(lastSentWords)) : null,
    shortClosingPct: lastSentWords.length > 0 ? pct(shortClosingCount, lastSentWords.length) : null,
    burstiness:
      perVideoCvs.length > 0
        ? {
            sampleN: perVideoCvs.length,
            medianPerVideoSentLenCv: round2(median(perVideoCvs)),
            winnerMedianSentLenCv: winVideoCvs.length > 0 ? round2(median(winVideoCvs)) : null,
            flopMedianSentLenCv: flopVideoCvs.length > 0 ? round2(median(flopVideoCvs)) : null,
            medianPerVideoMinSentWords: round1(median(perVideoMinLens)),
            medianPerVideoMaxSentWords: round1(median(perVideoMaxLens)),
            medianPerVideoMaxMinRatio: round2(median(perVideoMaxMinRatios)),
            medianPerVideoAdjSentJump: round1(median(perVideoAdjJumps)),
          }
        : null,
    inScriptQuestionVideoPct: universalInScriptQuestionPct,
    exclamationVideoPct: universalExclamationPct,
    openingClosingEchoPct: echoSampleN > 0 ? pct(openingClosingEchoVideos, echoSampleN) : null,
    titleClosingEchoPct: echoSampleN > 0 ? pct(titleClosingEchoVideos, echoSampleN) : null,
    concreteNumberVideoPct: universalConcreteNumberPct,
    meanNumbersPerVideo: universalMeanNumbers,
    pronounMatches: isEnglishCorpus ? pronounMatches : 0,
    pronounProfilePct:
      isEnglishCorpus && pronounMatches > 0
        ? {
            secondPersonYou: pct(count2nd, pronounMatches),
            thirdPersonStory: pct(count3rd, pronounMatches),
            firstPersonIWe: pct(count1st, pronounMatches),
          }
        : null,
    englishProfile: isEnglishCorpus
      ? {
          medianFkGrade: fkGrades.length > 0 ? round1(median(fkGrades)) : null,
          simpleWordPct: totalWordTokens > 0 ? pct(simpleSyllableWords, totalWordTokens) : null,
          medianAvgWordLen: avgWordLens.length > 0 ? round2(median(avgWordLens)) : null,
          contractionVideoPct: pct(contractionVideos, withText.length),
          participleConsequenceVideoPct: pct(participleVideos, withText.length),
          winnerParticipleConsequencePct:
            withTextWinners > 0 ? pct(participleWinners, withTextWinners) : null,
          flopParticipleConsequencePct:
            withTextFlops > 0 ? pct(participleFlops, withTextFlops) : null,
          spokenStarterSentPct:
            totalSentences > 0 ? pct(spokenStarterSentCount, totalSentences) : null,
          topSpokenStarters: [...spokenStarterCounts.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, 6)
            .map(([word, count]) => ({ word, count, sentPct: pct(count, totalSentences) })),
          pivotCommaVideoPct: pct(pivotCommaVideos, withText.length),
          flashbackRewindMarkerPct: pct(flashbackVideos, withText.length),
          winnerFlashbackRewindPct:
            withTextWinners > 0 ? pct(flashbackWinners, withTextWinners) : null,
          flopFlashbackRewindPct: withTextFlops > 0 ? pct(flashbackFlops, withTextFlops) : null,
          formalTransitionVideoPct: pct(formalTransitionVideos, withText.length),
          aiSlopBuzzwordVideoPct: pct(aiSlopVideos, withText.length),
          ytFillerIntroVideoPct: pct(ytFillerIntroVideos, withText.length),
          moralizingEndingVideoPct: pct(moralizingEndingVideos, withText.length),
          metaDirectorialLeakPct: pct(metaDirectorialLeakVideos, withText.length),
          barePronounOpenerPct:
            punctuatedSampleN > 0 ? pct(barePronounOpenerVideos, punctuatedSampleN) : null,
          midScriptPovShiftVideoPct:
            povShiftSampleN > 0 ? pct(midScriptPovShiftVideos, povShiftSampleN) : null,
          hypotheticalModalVideoPct: pct(hypotheticalModalVideos, withText.length),
          winnerHypotheticalModalPct:
            withTextWinners > 0 ? pct(hypotheticalModalWinners, withTextWinners) : null,
          flopHypotheticalModalPct:
            withTextFlops > 0 ? pct(hypotheticalModalFlops, withTextFlops) : null,
          inScriptQuestionVideoPct: universalInScriptQuestionPct,
          concreteNumberVideoPct: universalConcreteNumberPct,
          meanNumbersPerVideo: universalMeanNumbers,
        }
      : null,
    openingSentencePatterns,
    titleOpeningAnchorBands,
    transcriptTimingSummary:
      timedVideos.length > 0
        ? {
            ...summarizeTimingSubset(timedVideos),
            byTier: {
              winner: summarizeTimingSubset(timedWin),
              flop: summarizeTimingSubset(timedFlop),
            },
          }
        : null,
  };
}
