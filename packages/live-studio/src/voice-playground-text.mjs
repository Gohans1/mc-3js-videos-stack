export const AUDIO_TAG_RE = /\[([^\]\r\n]{1,400})\]/g;
const DIALOGUE_SPEAKER_LINE_RE = /^([ \t]*)\[([^\]\r\n:[\]]{1,80})\]:([ \t]*)/gm;

export const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
export const SAFE_MEDIA_FILE =
  /^[A-Za-z0-9_-]{1,120}\.(mp3|wav|ogg|m4a|webm|flac|aac|mp4|mov|aiff|aif|opus|avi)$/;
export const SAFE_REMOTE_ID_RE = /^(?!\.\.?$)[A-Za-z0-9._-]{1,200}$/;

export const recordingRootId = (item) => item.version?.rootId ?? item.retry?.rootId ?? item.id;
export const recordingAudioFiles = (item) => [
  ...new Map(
    [...(item.replacedAudioFiles ?? []), item.audioFile]
      .filter((file) => typeof file === "string" && file)
      .map((file) => [file.toLowerCase(), file]),
  ).values(),
];
export const hasUnverifiedZeroCharge = (item) =>
  item?.creditsDeducted === 0 &&
  (item.connection ?? "genvoice") === "genvoice" &&
  !item.creditsReported &&
  !item.creditsSource &&
  item.sttResult?.creditsDeducted !== 0 &&
  !item.version;
export const withChargeEvidence = (item) =>
  hasUnverifiedZeroCharge(item)
    ? { ...item, legacyCreditsDeducted: 0, creditsDeducted: undefined }
    : item;
export const hasProvisionalGenVoiceCharge = (item) =>
  item?.creditsSource === "acknowledgement" || item?.creditsSource === "processing";
export const isFailedGenVoiceTask = (status) =>
  ["failed", "error", "cancelled", "canceled"].includes(status);
export const genVoiceTaskChargeSource = (status) =>
  status === "completed" || isFailedGenVoiceTask(status) ? "history" : "processing";
const hasLegacySpeechSettings = (item) =>
  Boolean(
    item.fallbackNote ||
    item.fromTemplateId ||
    (Number.isFinite(item.seed) && Object.keys(item.voiceSettings ?? {}).length),
  );
export const isUnverifiedCloudSpeech = (item) =>
  item?.kind === "tts" &&
  !item.version &&
  !item.generationRecipe &&
  Boolean(
    item.cloudRecipeUnverified ||
    item.cloudImported ||
    (item.remoteTaskId && !item.connection && !hasLegacySpeechSettings(item)),
  );

export function estimateSpeechModelCredits(characters, rate, takes, subtitles) {
  if (!Number.isFinite(rate) || rate < 0) return null;
  return Math.ceil(Number((characters * rate * (subtitles ? 1.15 : 1)).toFixed(6))) * takes;
}

export const recordingWords = (item) => {
  const transcribed = (item.sttResult?.words ?? [])
    .filter(
      (word) =>
        typeof word.text === "string" &&
        word.text.trim() &&
        Number.isFinite(word.start) &&
        Number.isFinite(word.end) &&
        word.start >= 0 &&
        word.end >= word.start,
    )
    .map((word) => ({
      w: word.text,
      s: word.start,
      e: word.end,
      ...(word.speaker_id ? { speakerId: word.speaker_id } : {}),
    }));
  return transcribed.length ? transcribed : (item.wordTimings ?? []);
};

const VIET_TEXT_RE = /[ạảầấậẩẫăằắặẳẵẹẻẽềếệểễịỉĩọỏồốộổỗơờớợởỡụủưừứựửữỵỷỹđ]/iu;
const SHARED_ACCENT_RE = /[àáãâèéêìíòóõôùúỳý]/iu;
const VIET_ACCENTED_SYLLABLE_RE =
  /^(?:ch|gh|gi|kh|ngh?|nh|ph|qu|th|tr|[bcdghklmnpqrstvx])?[aàáãâeèéêiìíoòóõôuùúyỳý]+(?:ch|ng|nh|[cmnpt])?$/iu;

export const stripDialogueSpeakerBrackets = (text) =>
  String(text ?? "").replace(DIALOGUE_SPEAKER_LINE_RE, "$1$2:$3");

export const detectTextLanguage = (text) => {
  const plain = String(text ?? "")
    .replace(AUDIO_TAG_RE, " ")
    .normalize("NFC");
  if (VIET_TEXT_RE.test(plain)) return "vi";
  const tokens = plain.match(/\p{L}+/gu) ?? [];
  return tokens.some(
    (token) =>
      token.length > 1 && SHARED_ACCENT_RE.test(token) && VIET_ACCENTED_SYLLABLE_RE.test(token),
  )
    ? "vi"
    : "en";
};

export const parseDialogueTurnNames = (text) => {
  const normalized = stripDialogueSpeakerBrackets(text);
  const out = [];
  const seen = new Set();
  for (const m of normalized.matchAll(/^[ \t]*([^:\r\n]{1,80}):/gm)) {
    const name = String(m[1] ?? "").trim();
    if (!name || DANGEROUS_KEYS.has(name)) continue;
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
};

export const extractAudioTags = (text) => {
  if (typeof text !== "string" || !text) return [];
  const cleanText = stripDialogueSpeakerBrackets(text);
  const tags = [];
  const seen = new Set();
  for (const m of cleanText.matchAll(AUDIO_TAG_RE)) {
    const clean = (m[1] ?? "").trim().replace(/\s+/g, " ");
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      tags.push(clean);
    }
  }
  return tags;
};
