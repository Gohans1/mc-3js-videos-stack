import { z } from "zod";

import { SAFE_REMOTE_ID_RE } from "./voice-playground-text.mjs";

export const DUBBING_TARGET_LANGUAGES =
  "af ar hy as az be bn bs bg ca ceb ny zh hr cs da nl en et fil fi fr gl ka de el gu ha he hi hu is id ga it ja jv kn kk ky ko lv ln lt lb mk ms ml mr ne no ps fa pl pt pa ro ru sr sd sk sl so es sw sv ta te th tr uk ur vi cy nn yue".split(
    " ",
  );
export const DUBBING_CAPCUT_LANGUAGES = "en zh es id pt fr de vi ja th tr it".split(" ");
export const DUBBING_MODELS = {
  minimax: "speech-2.8-hd",
  elevenlabs: "eleven_v3",
  capcut: "capcut",
};
export const DUBBING_CHUNK_BYTES = 16 * 1024 * 1024;
export const SAFE_DUBBING_SOURCE_FILE = /^[A-Za-z0-9_-]{1,120}\.(mp3|wav|aac|m4a|mp4|mov)$/;
export const SAFE_DUBBING_VIDEO_FILE = /^[A-Za-z0-9_-]{1,120}\.mp4$/;
const id = z.string().regex(SAFE_REMOTE_ID_RE, "Invalid Dubbing identity");
export const DubbingSourceInit = z.strictObject({
  filename: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine((value) => !/\p{Cc}/u.test(value), "Invalid source filename"),
  bytes: z
    .number()
    .int()
    .min(1)
    .max(2 * 1024 ** 3),
  lastModified: z.number().finite().nonnegative().optional(),
});
export const DubbingRecordingSource = z.strictObject({
  itemId: id,
  asset: z.enum(["audio", "source"]).default("audio"),
});
export const DubbingSourceCopy = z.strictObject({
  sourceId: id,
  sourceScope: z.enum(["project", "global"]),
});
export const DubbingSourceInput = z.union([
  DubbingSourceInit,
  DubbingRecordingSource,
  DubbingSourceCopy,
]);
const dubbingFields = {
  sourceLanguage: z.enum([...DUBBING_TARGET_LANGUAGES, "mi", "tl"]),
  targetLanguage: z.enum(DUBBING_TARGET_LANGUAGES),
  provider: z.enum(["elevenlabs", "minimax", "capcut"]).default("minimax"),
  voiceId: id,
  voiceName: z.string().trim().max(200).optional(),
  voiceLanguage: z.string().trim().max(40).optional(),
  ttsVoiceId: id.optional(),
};
const capcutLanguageMatches = (input: {
  provider?: string;
  targetLanguage: string;
  voiceLanguage?: string;
}) =>
  input.provider !== "capcut" ||
  (DUBBING_CAPCUT_LANGUAGES.includes(input.targetLanguage) &&
    input.voiceLanguage === input.targetLanguage);
const capcutMessage = "Choose a CapCut voice matching the supported target language";
export const DubbingInput = z
  .strictObject({ sourceId: id, ...dubbingFields })
  .refine(capcutLanguageMatches, capcutMessage);
export const DubbingLink = z.strictObject({ taskId: id });
export const DubbingTemplateDraft = z
  .strictObject({ sourceId: id.optional(), ...dubbingFields })
  .refine(capcutLanguageMatches, capcutMessage);
export const DubbingHistoryQuery = z.strictObject({
  page: z.coerce.number().int().nonnegative().default(0),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});
const RemoteDubbing = z.object({
  id,
  status: z.string().min(1).max(60),
  progress: z.number().finite().optional(),
  source_lang: z.string().max(20).optional(),
  target_lang: z.string().max(20).optional(),
  provider: z.enum(["elevenlabs", "minimax", "capcut"]).optional(),
  voice_id: z.string().max(200).optional(),
  model_id: z.string().max(120).optional(),
  source_audio_url: z.url().optional(),
  credits_deducted: z.number().finite().nonnegative().optional(),
  created_at: z.string().max(60).optional(),
  updated_at: z.string().max(60).optional(),
  detail_error: z.string().max(4000).optional(),
  error: z.string().max(4000).optional(),
  metadata: z
    .object({
      voice_name: z.string().max(200).optional(),
      source_file_name: z.string().max(255).optional(),
      original_video_url: z.url().optional(),
    })
    .optional(),
  result: z
    .object({ audio_url: z.url().optional(), srt_url: z.url().optional() })
    .nullable()
    .optional(),
});
export function parseDubbingTask(input: unknown) {
  const parsed = RemoteDubbing.safeParse(input);
  if (!parsed.success)
    throw Object.assign(new Error("Invalid Dubbing history response from GenVoice"), {
      status: 502,
    });
  return parsed.data;
}
