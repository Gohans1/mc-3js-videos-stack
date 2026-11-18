import { z } from "zod";

import { DubbingTemplateDraft } from "./voice-playground-dubbing-contract";
import { SAFE_MEDIA_FILE, SAFE_REMOTE_ID_RE } from "./voice-playground-text.mjs";

export const PlaygroundProvider = z.enum(["elevenlabs", "minimax", "capcut"]);
export const PlaygroundConnection = z.enum(["genvoice", "elevenlabs", "google"]);

const RegionSelection = {
  from: z.number().finite().min(0),
  to: z.number().finite().positive(),
  name: z.string().trim().max(120).optional(),
  pitch: z.number().finite().min(-24).max(24).default(0),
  gainDb: z.number().finite().min(-30).max(12).default(0),
  pause: z.number().finite().min(0).max(5).default(0),
  blendMs: z.number().finite().min(0).max(50).default(6),
};
export const PlaygroundLocalEdit = z
  .object({
    ...RegionSelection,
    mode: z.literal("local"),
    rate: z.number().finite().min(0.25).max(4).default(1),
  })
  .refine((input) => input.to > input.from, "Choose an end after the start");

export const PlaygroundVoiceSettings = z
  .strictObject({
    stability: z.number().min(0).max(1).optional(),
    similarity_boost: z.number().min(0).max(1).optional(),
    style: z.number().min(0).max(1).optional(),
    use_speaker_boost: z.boolean().optional(),
    speed: z.number().min(0.5).max(2).optional(),
    pitch: z.number().int().min(-12).max(12).optional(),
    vol: z.number().min(0.01).max(10).optional(),
  })
  .optional();
export const PlaygroundConfig = z.object({
  connection: PlaygroundConnection.optional(),
  apiKey: z.string().max(500).optional(),
  apiBase: z.string().max(500).optional(),
  clearOverride: z.boolean().optional(),
});
export const PlaygroundConnectionQuery = z.object({
  connection: PlaygroundConnection.optional(),
});
export const PlaygroundVoiceSearch = PlaygroundConnectionQuery.extend({
  provider: PlaygroundProvider.optional(),
  emotion: z.string().optional(),
  pageToken: z
    .string()
    .optional()
    .describe("Direct-provider cursor. For GenVoice pass page and follow nextPage."),
  pitch: z.string().optional(),
  persona: z.string().optional(),
  region: z.string().optional(),
  page: z.number().int().nonnegative().optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  search: z.string().optional(),
  language: z.string().optional(),
  gender: z.string().optional(),
  age: z.string().optional(),
  accent: z.string().optional(),
  category: z.string().optional(),
  useCase: z.string().optional(),
  useCases: z.string().max(300).optional().describe("Comma-separated use cases"),
  sort: z.string().optional(),
  creatorId: z.string().regex(SAFE_REMOTE_ID_RE).optional(),
  favoriteCreatorsOnly: z.boolean().optional(),
  descriptive: z.string().max(200).optional(),
  scanPages: z.number().int().min(1).max(10).optional(),
}).strict();
const savedVoicePreviewUrl = z
  .union([z.literal(""), z.url({ protocol: /^https?$/ }).max(2048)])
  .optional();
const scopedVoicePreviewUrl = z
  .string()
  .regex(
    new RegExp(
      `^/api/voice/playground/audio/${SAFE_MEDIA_FILE.source.slice(1, -1)}\\?scope=(project|global)$`,
    ),
  );
export const PlaygroundVoicePreview = z.strictObject({
  previewUrl: z.union([z.url({ protocol: /^https?$/ }).max(2048), scopedVoicePreviewUrl]),
});
const voiceCreatorId = z.string().regex(SAFE_REMOTE_ID_RE, "Invalid creator ID");
const voiceCreatorName = z.string().trim().min(1).max(200);
const voiceCreatorDescription = z.string().trim().max(2000);
export const PlaygroundTts = z.object({
  connection: PlaygroundConnection.optional(),
  speechStyle: z.string().trim().max(2000).optional(),
  provider: PlaygroundProvider.optional(),
  voiceId: z.string().regex(SAFE_REMOTE_ID_RE, "Invalid voiceId"),
  voiceName: z.string().max(200).optional(),
  creatorId: voiceCreatorId.optional(),
  voiceGender: z.string().max(30).optional(),
  voicePreviewUrl: savedVoicePreviewUrl,
  modelId: z.string().max(120).optional(),
  languageCode: z.string().max(40).optional(),
  text: z.string().min(1).max(40_000),
  voiceSettings: PlaygroundVoiceSettings,
  preserveSettings: z
    .boolean()
    .describe("Send the recorded GenVoice settings and stop if the provider rejects them")
    .optional(),
  previousText: z.string().max(5000).optional(),
  nextText: z.string().max(5000).optional(),
  seed: z.number().int().min(0).max(4294967295).optional(),
  outputFormat: z.string().max(40).optional(),
  applyTextNormalization: z.enum(["auto", "on", "off"]).optional(),
  exportTranscript: z.boolean().optional(),
  variations: z.number().int().min(1).max(3).optional(),
  name: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  sourceTakeId: z.string().max(80).optional(),
  fromTemplateId: z.string().max(120).optional(),
});
const GenVoiceBatchEntry = PlaygroundTts.extend({
  connection: z.literal("genvoice").optional(),
}).strict();
const batchLabel = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .optional()
  .describe("Label shown in Audio > Recordings and saved as a tag on every take");
const batchEntries = <T extends z.ZodType>(entry: T) => z.array(entry).min(1).max(12);
export const PlaygroundTtsBatch = z
  .union([
    z.strictObject({ label: batchLabel, entries: batchEntries(GenVoiceBatchEntry) }),
    z.strictObject({
      label: batchLabel,
      text: PlaygroundTts.shape.text,
      voices: batchEntries(GenVoiceBatchEntry.omit({ text: true })),
    }),
  ])
  .refine(
    (input) =>
      ("entries" in input ? input.entries : input.voices).reduce(
        (total, entry) => total + (entry.variations ?? 1),
        0,
      ) <= 12,
    "Keep each batch to at most 12 takes",
  );
export const speechBatchEntries = (input: z.infer<typeof PlaygroundTtsBatch>) =>
  "entries" in input
    ? input.entries
    : input.voices.map((voice) => ({ ...voice, text: input.text }));
export const PlaygroundRegenerateRegion = PlaygroundTts.omit({ text: true, variations: true })
  .extend({
    ...RegionSelection,
    mode: z.literal("regenerate"),
    replacementText: z.string().trim().min(1).max(40_000),
    fullText: z.string().trim().min(1).max(40_000),
    fitToSelection: z.boolean().default(true),
  })
  .refine((input) => input.to > input.from, "Choose an end after the start");
export const PlaygroundRegionEdit = z.discriminatedUnion("mode", [
  PlaygroundLocalEdit,
  PlaygroundRegenerateRegion,
]);
export const PlaygroundResumeRegion = z.strictObject({
  edit: PlaygroundRegenerateRegion,
  replacementItemId: z.string().min(1).max(120),
});
export const PlaygroundDialogueSpeaker = z.strictObject({
  speech_style: z.string().trim().max(2000).optional(),
  provider: PlaygroundProvider.optional(),
  voice_id: z.string().regex(SAFE_REMOTE_ID_RE, "Invalid speaker voice_id"),
  voice_name: z.string().max(200).optional(),
  model_id: z.string().max(120).optional(),
  language_code: z.string().max(40).optional(),
  voice_settings: PlaygroundVoiceSettings,
});
export const PlaygroundDialogue = z.strictObject({
  connection: PlaygroundConnection.optional(),
  fromTemplateId: z.string().max(120).optional(),
  modelId: z.string().max(120).optional(),
  languageCode: z.string().max(40).optional(),
  voiceSettings: PlaygroundVoiceSettings,
  outputFormat: z.string().max(40).optional(),
  seed: z.number().int().min(0).max(4294967295).optional(),
  text: z.string().min(1).max(40_000),
  speakers: z.record(z.string().min(1).max(120), PlaygroundDialogueSpeaker),
  pause_between_turns: z.number().min(0).max(3).optional(),
  exportTranscript: z.boolean().optional(),
  name: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
});
export const PlaygroundVoiceChanger = z.object({
  sourceFile: z.string().regex(SAFE_MEDIA_FILE).optional(),
  sourceItemId: z.string().max(120).optional(),
  sourceTakeKind: z.enum(["takes", "try"]).optional(),
  sourceTakeFile: z.string().max(240).optional(),
  voiceId: z.string().regex(SAFE_REMOTE_ID_RE, "Invalid voiceId"),
  voiceName: z.string().max(200).optional(),
  modelId: z.string().max(120).optional(),
  removeBackgroundNoise: z.boolean().optional(),
  voiceSettings: PlaygroundVoiceSettings,
  seed: z.number().int().min(0).max(4294967295).optional(),
  name: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
});
export const PlaygroundStt = z.object({
  sourceLabel: z.string().max(240).optional(),
  sourceFile: z.string().regex(SAFE_MEDIA_FILE).optional(),
  itemId: z.string().max(120).optional(),
  sourceItemId: z.string().max(120).optional(),
  sourceTakeKind: z.enum(["takes", "try"]).optional(),
  sourceTakeFile: z.string().max(240).optional(),
  languageCode: z.string().max(40).optional(),
  timestampsGranularity: z.enum(["none", "word", "character"]).optional(),
  diarize: z.boolean().optional(),
  numSpeakers: z.number().int().min(1).max(32).optional(),
  diarizationThreshold: z.number().min(0).max(1.5).optional(),
  tagAudioEvents: z.boolean().optional(),
  noVerbatim: z.boolean().optional(),
  temperature: z.number().min(0).max(2).optional(),
  seed: z.number().int().min(0).max(2147483647).optional(),
  fileFormat: z.enum(["pcm_s16le_16", "other"]).optional(),
  useMultiChannel: z.boolean().optional(),
  keyterms: z.array(z.string().max(49)).max(1000).optional(),
  entityDetection: z.array(z.string().min(1).max(40)).max(20).optional(),
  entityRedaction: z.array(z.string().min(1).max(40)).max(20).optional(),
  entityRedactionMode: z.enum(["redacted", "entity_type", "enumerated_entity_type"]).optional(),
  additionalFormats: z
    .array(z.enum(["srt", "txt", "segmented_json", "docx", "pdf", "html"]))
    .max(10)
    .optional(),
});
export const PlaygroundResumeStt = PlaygroundStt.extend({
  taskId: z.string().regex(SAFE_REMOTE_ID_RE, "Invalid transcription task ID"),
}).strict();
export const PlaygroundPatch = z.object({
  rights: z
    .object({
      status: z.enum(["unverified", "user_confirmed"]),
      evidenceUrl: z
        .url()
        .refine((url) => /^https?:/.test(url), "Use an HTTP or HTTPS evidence URL")
        .optional(),
      notes: z.string().max(2000).optional(),
    })
    .refine(
      (rights) =>
        rights.status !== "user_confirmed" || Boolean(rights.evidenceUrl || rights.notes?.trim()),
      "Record an evidence link or confirmation note",
    )
    .optional(),
  favorite: z.boolean().optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .nullable()
    .optional(),
  archived: z.boolean().optional(),
  isTemplate: z.boolean().optional(),
  templateName: z.string().max(120).optional(),
  title: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
  description: z.string().max(2000).optional(),
  tags: z.array(z.string().max(200)).max(40).optional(),
});
export const PlaygroundRecordingBatchPatch = z.strictObject({
  ids: z.array(z.string().min(1).max(120)).min(1).max(100),
  patch: PlaygroundPatch.strict(),
});
export const PlaygroundArchivePurge = PlaygroundRecordingBatchPatch.pick({ ids: true });
export const PlaygroundRecordingQuery = z.strictObject({
  includeGlobal: z.boolean().optional(),
  q: z.string().trim().min(1).max(250).optional(),
  kind: z.enum(["tts", "dialogue", "voice_changer", "stt", "dubbing"]).optional(),
  connection: PlaygroundConnection.optional(),
  provider: z.enum(["elevenlabs", "minimax", "capcut", "google"]).optional(),
  voiceId: z.string().max(200).optional(),
  creatorId: voiceCreatorId.optional(),
  batchId: z.string().regex(SAFE_REMOTE_ID_RE).optional(),
  modelId: z.string().max(120).optional(),
  language: z.string().max(40).optional(),
  gender: z.string().max(30).optional(),
  tag: z.string().max(200).optional(),
  project: z.string().max(180).optional(),
  favorite: z.boolean().optional(),
  archived: z.boolean().optional(),
  minRating: z.number().int().min(0).max(5).optional(),
  maxRating: z.number().int().min(0).max(5).optional(),
  minSeconds: z.number().min(0).optional(),
  maxSeconds: z.number().min(0).optional(),
  after: z.iso.date().optional(),
  before: z.iso.date().optional(),
  sort: z.enum(["relevance", "newest", "oldest", "shortest", "longest", "rating"]).optional(),
  page: z.number().int().nonnegative().optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});
export const PlaygroundVoiceUsageQuery = PlaygroundRecordingQuery.pick({
  includeGlobal: true,
  page: true,
  pageSize: true,
}).extend({
  provider: PlaygroundProvider.optional(),
  sort: z.enum(["in-film", "recordings"]).optional(),
});
export const PlaygroundRetry = z.strictObject({
  connection: PlaygroundConnection.optional(),
  speechStyle: z.string().trim().max(2000).optional(),
  provider: PlaygroundProvider.optional(),
  voiceId: z.string().regex(SAFE_REMOTE_ID_RE, "Invalid voiceId").optional(),
  voiceName: z.string().max(200).optional(),
  creatorId: PlaygroundTts.shape.creatorId.describe(
    "Speech only. Creator ID for a replacement voice; by default a same-voice retry keeps its creator.",
  ),
  speakerKey: z.string().max(120).optional(),
  speakers: z.record(z.string().min(1).max(120), PlaygroundDialogueSpeaker).optional(),
  pauseBetweenTurns: z.number().min(0).max(3).optional(),
  modelId: z.string().max(120).optional(),
  languageCode: z.string().max(40).optional(),
  text: z.string().max(40_000).optional(),
  voiceSettings: PlaygroundVoiceSettings,
  previousText: z.string().max(5000).optional(),
  nextText: z.string().max(5000).optional(),
  seed: z.number().int().min(0).max(4294967295).optional(),
  outputFormat: z.string().max(40).optional(),
  applyTextNormalization: z.enum(["auto", "on", "off"]).optional(),
  removeBackgroundNoise: z.boolean().optional(),
  exportTranscript: z.boolean().optional(),
  variations: z.number().int().min(1).max(3).optional(),
  name: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
});
export const PlaygroundPromote = z.object({
  itemId: z.string().min(1).max(120),
  takeId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
});
export const PlaygroundTtsRecipe = z
  .strictObject({
    version: z.literal(1),
    requested: PlaygroundTts.extend({ connection: z.literal("genvoice") }).strict(),
    effective: z.strictObject({
      path: z.string().max(240),
      body: z.strictObject({
        text: PlaygroundTts.shape.text,
        model_id: z.string().min(1).max(120),
        provider: PlaygroundProvider,
        language_code: PlaygroundTts.shape.languageCode,
        voice_settings: PlaygroundVoiceSettings,
        previous_text: PlaygroundTts.shape.previousText,
        next_text: PlaygroundTts.shape.nextText,
        seed: PlaygroundTts.shape.seed,
        output_format: PlaygroundTts.shape.outputFormat,
        apply_text_normalization: PlaygroundTts.shape.applyTextNormalization,
        export_transcript: PlaygroundTts.shape.exportTranscript,
      }),
    }),
  })
  .refine(
    (recipe) =>
      recipe.effective.path === `/text-to-speech/${encodeURIComponent(recipe.requested.voiceId)}`,
    "The accepted TTS request must belong to the saved voice",
  );
export const PlaygroundImportRemote = z
  .object({
    taskId: z.string().regex(SAFE_REMOTE_ID_RE, "Invalid taskId"),
    kind: z.enum(["tts", "dialogue", "voice_changer"]).optional(),
    requestedTts: PlaygroundTts.extend({ connection: z.literal("genvoice").optional() }).optional(),
    dialogueRecipe: PlaygroundDialogue.extend({
      connection: z.literal("genvoice").optional(),
    }).optional(),
    dialogueParentId: z.string().max(120).optional(),
  })
  .strict();

export const PlaygroundVoiceFavorite = z.object({
  favorite: z.boolean(),
  voice: z.object({
    connection: PlaygroundConnection.optional(),
    id: z.string().min(1).max(160),
    name: z.string().max(200).optional(),
    creatorId: voiceCreatorId.optional(),
    creatorName: voiceCreatorName.optional(),
    provider: PlaygroundProvider.default("elevenlabs"),
    dubbingVoiceId: z.string().max(200).optional(),
    sourcePlatform: z.string().max(100).optional(),
    emotion: z.string().max(100).optional(),
    category: z.string().max(100).optional(),
    age: z.string().max(100).optional(),
    gender: z.string().max(100).optional(),
    accent: z.string().max(200).optional(),
    descriptive: z.string().max(200).optional(),
    language: z.string().max(100).optional(),
    useCase: z.string().max(200).optional(),
    description: z.string().max(2000).optional(),
    previewUrl: z
      .union([z.literal(""), z.url(), scopedVoicePreviewUrl])
      .describe(
        "Absolute provider preview URL or a saved Playground audio URL with explicit project/global scope",
      )
      .optional(),
    rate: z.number().nonnegative().optional(),
    usage1y: z.number().int().nonnegative().optional(),
    usage7d: z.number().int().nonnegative().optional(),
    clones: z.number().int().nonnegative().optional(),
    addedAt: z.number().int().nonnegative().optional(),
    featured: z.boolean().optional(),
    liveModeration: z.boolean().optional(),
    free: z.boolean().optional(),
    verifiedLanguages: z
      .array(
        z.strictObject({
          code: z.string().max(40),
          name: z.string().max(100).optional(),
          modelId: z.string().max(120).optional(),
          locale: z.string().max(40).optional(),
          accent: z.string().max(100).optional(),
          previewUrl: z.string().max(2048).optional(),
        }),
      )
      .max(100)
      .optional(),
  }),
});
export const PlaygroundVoiceFavoritesBatch = z.strictObject({
  favorite: z.boolean(),
  voices: z.array(PlaygroundVoiceFavorite.shape.voice).min(1).max(100),
});
export const PlaygroundCreatorFavorite = z.strictObject({
  id: voiceCreatorId,
  name: voiceCreatorName.optional(),
  description: voiceCreatorDescription.optional(),
  favorite: z.boolean(),
});
export const PlaygroundCreatorProfile = PlaygroundCreatorFavorite.omit({ favorite: true });
export const PlaygroundFavoriteVoiceQuery = z.strictObject({
  connection: PlaygroundConnection.optional(),
  provider: PlaygroundProvider.optional(),
  creatorId: voiceCreatorId.optional(),
  favoriteCreatorsOnly: z.boolean().optional(),
  q: z.string().trim().min(1).max(250).optional(),
  category: z.string().max(100).optional(),
  gender: z.string().max(100).optional(),
  age: z.string().max(100).optional(),
  accent: z.string().max(200).optional(),
  language: z.string().max(100).optional(),
  useCase: z.string().max(200).optional(),
  descriptive: z.string().max(200).optional(),
  minRating: PlaygroundRecordingQuery.shape.minRating,
  maxRating: PlaygroundRecordingQuery.shape.maxRating,
  page: z.number().int().nonnegative().optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});
export const PlaygroundCachedVoiceQuery = PlaygroundFavoriteVoiceQuery.pick({
  creatorId: true,
  favoriteCreatorsOnly: true,
  q: true,
  category: true,
  gender: true,
  age: true,
  accent: true,
  useCase: true,
  descriptive: true,
  page: true,
  pageSize: true,
}).extend({
  v4Mode: z.enum(["all", "v4", "v4Post", "v4Turbo", "v4Fast"]).optional(),
  access: z.enum(["all", "standard", "free"]).optional(),
  sort: z.enum(["usage1y", "trending", "clones", "newest", "name"]).optional(),
});
export const PlaygroundVoiceProfilePatch = z.strictObject({
  alias: z.string().trim().max(120).optional(),
  description: z.string().trim().max(2000).optional(),
  color: PlaygroundPatch.shape.color,
  rating: PlaygroundPatch.shape.rating,
  tags: PlaygroundPatch.shape.tags,
  rights: PlaygroundPatch.shape.rights,
  archived: z.boolean().optional(),
});
export const PlaygroundVoiceProfileInput = PlaygroundVoiceProfilePatch.extend({
  voice: PlaygroundVoiceFavorite.shape.voice,
});
export const PlaygroundVoiceProfileQuery = PlaygroundRecordingQuery.pick({
  includeGlobal: true,
  q: true,
  connection: true,
  favorite: true,
  archived: true,
  minRating: true,
  maxRating: true,
  tag: true,
  page: true,
  pageSize: true,
}).extend({
  creatorId: voiceCreatorId.optional(),
  favoriteCreatorsOnly: z.boolean().optional(),
  provider: PlaygroundProvider.optional(),
  language: z.string().max(100).optional(),
  category: z.string().max(100).optional(),
  gender: z.string().max(100).optional(),
  age: z.string().max(100).optional(),
  accent: z.string().max(100).optional(),
  useCase: z.string().max(200).optional(),
  sort: z.enum(["relevance", "newest", "name", "rating", "popular", "rare"]).optional(),
});

const stringFields = [
  "title",
  "text",
  "voiceId",
  "voiceName",
  "modelId",
  "languageCode",
  "previousText",
  "nextText",
  "seedText",
  "outputFormat",
  "applyTextNormalization",
  "notes",
  "vcSourceKind",
  "vcSourceFile",
  "vcSourceItemId",
  "vcSourceTakeValue",
  "sttSourceFile",
  "sttSourceLabel",
  "sttSourceKind",
  "sttSourceItemId",
  "sttSourceTakeValue",
  "sttLanguageCode",
  "sttGranularity",
  "sttNumSpeakers",
  "sttDiarizationThreshold",
  "sttSeedText",
  "sttFileFormat",
  "sttKeytermsText",
  "sttEntityDetectionText",
  "sttEntityRedactionText",
  "sttEntityRedactionMode",
];
const numberFields = [
  "stability",
  "similarityBoost",
  "style",
  "speed",
  "variations",
  "pauseBetweenTurns",
  "sttTemperature",
];
const booleanFields = [
  "useSpeakerBoost",
  "exportTranscript",
  "removeBackgroundNoise",
  "sttDiarize",
  "sttTagEvents",
  "sttNoVerbatim",
  "sttExportSrt",
  "sttUseMultiChannel",
];
export const PlaygroundTemplateDraft = z
  .object({
    connection: PlaygroundConnection.optional(),
    speechStyle: z.string().trim().max(2000).optional(),
    creatorId: PlaygroundTts.shape.creatorId,
    provider: PlaygroundProvider.optional(),
    voiceGender: PlaygroundTts.shape.voiceGender,
    voicePreviewUrl: z.union([savedVoicePreviewUrl.unwrap(), scopedVoicePreviewUrl]).optional(),
    recordedSpeech: z
      .object({
        modelId: z.string().max(120),
        settings: PlaygroundVoiceSettings.unwrap(),
        normalization: PlaygroundTts.shape.applyTextNormalization,
      })
      .optional(),
    pitch: z.number().int().min(-12).max(12).optional(),
    vol: z.number().min(0.01).max(10).optional(),
    ...Object.fromEntries(stringFields.map((name) => [name, z.string().max(40_000).optional()])),
    ...Object.fromEntries(numberFields.map((name) => [name, z.number().finite().optional()])),
    ...Object.fromEntries(booleanFields.map((name) => [name, z.boolean().optional()])),
    mode: z.enum(["tts", "dialogue", "voice_changer", "stt", "dubbing"]),
    dubbing: DubbingTemplateDraft.optional(),
    speakers: z
      .array(
        z.object({
          provider: PlaygroundProvider.optional(),
          pitch: z.number().int().min(-12).max(12).optional(),
          vol: z.number().min(0.01).max(10).optional(),
          id: z.string(),
          name: z.string(),
          voiceId: z.string(),
          voiceName: z.string().optional(),
          speechStyle: z.string().trim().max(2000).optional(),
          modelId: z.string(),
          languageCode: z.string().optional(),
          stability: z.number().optional(),
          similarityBoost: z.number().optional(),
          style: z.number().optional(),
          useSpeakerBoost: z.boolean().optional(),
          speed: z.number().optional(),
        }),
      )
      .max(30)
      .optional(),
    sttExtraFormats: z.array(z.string().max(40)).max(10).optional(),
    sourceTakeId: z.string().max(120).optional(),
    fromTemplateId: z.string().max(120).optional(),
  })
  .refine((draft) => JSON.stringify(draft).length <= 200_000, "Keep a template below 200 KB");
export const PlaygroundTemplatePatch = z.strictObject({
  title: z.string().trim().min(1).max(120).optional(),
  favorite: z.boolean().optional(),
  description: z.string().trim().max(2000).optional(),
  tags: PlaygroundPatch.shape.tags,
  rating: PlaygroundPatch.shape.rating,
  archived: z.boolean().optional(),
  draft: PlaygroundTemplateDraft.optional(),
});
export const PlaygroundTemplateInput = PlaygroundTemplatePatch.omit({ archived: true }).extend({
  id: z.string().max(80).optional(),
  title: z.string().trim().min(1).max(120),
  draft: PlaygroundTemplateDraft,
});
export const PlaygroundTemplateFromRecording = PlaygroundTemplateInput.omit({
  draft: true,
  id: true,
}).partial({ title: true });
export const PlaygroundTemplateBatchPatch = PlaygroundRecordingBatchPatch.extend({
  patch: PlaygroundTemplatePatch.omit({ draft: true }),
});
export const PlaygroundTemplateQuery = PlaygroundRecordingQuery.pick({
  includeGlobal: true,
  q: true,
  favorite: true,
  archived: true,
  page: true,
  pageSize: true,
  tag: true,
  minRating: true,
}).extend({
  mode: z.enum(["tts", "dialogue", "voice_changer", "stt", "dubbing"]).optional(),
});

export const PlaygroundCloneSettings = z.strictObject({
  name: z.string().trim().min(1).max(200),
  language: z.string().trim().min(1).max(80).default("English"),
  gender: z.string().trim().min(1).max(40).default("Male"),
  noiseReduction: z.boolean().default(true),
  previewText: z.string().max(200).default("Hello"),
  permissionConfirmed: z.literal(true, "Confirm permission to clone this voice"),
});
export const PlaygroundCloneLink = z.strictObject({
  remoteId: z.string().regex(SAFE_REMOTE_ID_RE, "Invalid cloud voice ID"),
  permissionConfirmed: z.literal(true, "Confirm permission to use this voice"),
});
export const PlaygroundClonePatch = z.strictObject({
  name: z.string().trim().min(1).max(200).optional(),
  favorite: z.boolean().optional(),
});
