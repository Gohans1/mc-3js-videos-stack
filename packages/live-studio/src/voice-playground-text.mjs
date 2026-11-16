// Shared zero-Node text helpers for GenVoice scripts, audio tags, and speaker labels.

export const AUDIO_TAG_RE = /\[([^\]\r\n]{1,400})\]/g;
const DIALOGUE_SPEAKER_LINE_RE = /^([ \t]*)\[([^\]\r\n:[\]]{1,80})\]:([ \t]*)/gm;

export const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const VIET_TEXT_RE =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ]/;

export const stripDialogueSpeakerBrackets = (text) =>
  String(text ?? "").replace(DIALOGUE_SPEAKER_LINE_RE, "$1$2:$3");

export const detectTextLanguage = (text) => {
  const plain = String(text ?? "").replace(AUDIO_TAG_RE, " ");
  return VIET_TEXT_RE.test(plain) ? "vi" : "en";
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
