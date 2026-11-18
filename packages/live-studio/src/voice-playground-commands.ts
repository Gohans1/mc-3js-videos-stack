import { z } from "zod";

import {
  PlaygroundArchivePurge,
  PlaygroundCachedVoiceQuery,
  PlaygroundCloneLink,
  PlaygroundClonePatch,
  PlaygroundCloneSettings,
  PlaygroundConfig,
  PlaygroundConnectionQuery,
  PlaygroundCreatorFavorite,
  PlaygroundCreatorProfile,
  PlaygroundDialogue,
  PlaygroundFavoriteVoiceQuery,
  PlaygroundImportRemote,
  PlaygroundLocalEdit,
  PlaygroundPatch,
  PlaygroundPromote,
  PlaygroundRecordingBatchPatch,
  PlaygroundRecordingQuery,
  PlaygroundRegenerateRegion,
  PlaygroundResumeRegion,
  PlaygroundRetry,
  PlaygroundStt,
  PlaygroundTemplateBatchPatch,
  PlaygroundTemplateDraft,
  PlaygroundTemplateFromRecording,
  PlaygroundTemplateInput,
  PlaygroundTemplatePatch,
  PlaygroundTemplateQuery,
  PlaygroundTts,
  PlaygroundTtsBatch,
  PlaygroundVoiceChanger,
  PlaygroundVoiceFavorite,
  PlaygroundVoiceFavoritesBatch,
  PlaygroundVoicePreview,
  PlaygroundVoiceProfileInput,
  PlaygroundVoiceProfilePatch,
  PlaygroundVoiceProfileQuery,
  PlaygroundVoiceSearch,
  PlaygroundVoiceUsageQuery,
} from "./voice-playground-contract";
import {
  DubbingInput,
  DubbingLink,
  DubbingRecordingSource,
  DubbingSourceCopy,
} from "./voice-playground-dubbing-contract";

const empty = z.strictObject({});
const scope = z.enum(["project", "global"]);
const copy = z.strictObject({ scope });
const file = z.string().trim().min(1);
const paging = {
  page: z.number().int().nonnegative().optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
};

export interface PlaygroundCommand {
  name: string;
  description: string;
  effect: "read" | "write" | "paid" | "delete";
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  argument?: string;
  input: z.ZodType;
  example?: Record<string, unknown>;
}
export const PLAYGROUND_COMMANDS: PlaygroundCommand[] = [
  {
    name: "dubbing source-add",
    description:
      "Save/probe a file, recording or source copy for free (2 GB, 2.5 h). Use file with optional sourceId; itemId with asset audio/source; or sourceId with sourceScope to copy between Project and Global.",
    effect: "write",
    method: "POST",
    path: "dubbing/sources",
    input: z.union([
      z.strictObject({ file, sourceId: file.optional() }),
      DubbingRecordingSource,
      DubbingSourceCopy,
    ]),
  },
  {
    name: "dubbing source-info",
    description: "Inspect confirmed upload chunks and measured source duration without generating.",
    effect: "read",
    method: "GET",
    path: "dubbing/sources/:id",
    argument: "SOURCE_ID",
    input: empty,
  },
  {
    name: "dubbing export-source",
    description: "Stream the prepared original source to --out FILE; ID is a sourceId.",
    effect: "read",
    method: "GET",
    path: "dubbing/sources/:id/file",
    argument: "SOURCE_ID",
    input: empty,
  },
  {
    name: "dubbing prepare",
    description:
      "Create a free saved quote at 50 credits/source second. MiniMax voiceId is uniq_id/clone UUID; ttsVoiceId is its separate TTS identity.",
    effect: "write",
    method: "POST",
    path: "dubbing",
    input: DubbingInput,
  },
  {
    name: "dubbing list",
    description:
      "Durable Dubbing jobs and versions in Project/Global, including interrupted uploads.",
    effect: "read",
    method: "GET",
    path: "dubbing",
    input: z.strictObject({ includeGlobal: z.boolean().optional() }),
  },
  {
    name: "dubbing info",
    description:
      "Inspect the saved source, settings, estimate, actual fee, progress and captured cloud task.",
    effect: "read",
    method: "GET",
    path: "dubbing/:id",
    argument: "JOB_ID",
    input: empty,
  },
  {
    name: "dubbing submit",
    description:
      "Upload a prepared job and start paid Dubbing. The final upload session is consumed even if its completion fails; never blindly resubmit.",
    effect: "paid",
    method: "POST",
    path: "dubbing/:id/submit",
    argument: "JOB_ID",
    input: empty,
  },
  {
    name: "dubbing refresh",
    description:
      "Observe/download a saved task for free, continuing partial downloads without generating again.",
    effect: "write",
    method: "POST",
    path: "dubbing/:id/refresh",
    argument: "JOB_ID",
    input: empty,
  },
  {
    name: "dubbing cloud",
    description:
      "Read native Dubbing history; known private tasks from other projects stay hidden.",
    effect: "read",
    method: "GET",
    path: "dubbing/cloud",
    input: z.strictObject(paging),
  },
  {
    name: "dubbing import",
    description:
      "Archive an existing cloud Dubbing and its original/video/audio/subtitles without generating.",
    effect: "write",
    method: "POST",
    path: "dubbing/import",
    input: DubbingLink,
  },
  {
    name: "dubbing link",
    description:
      "Recover a lost acknowledgement using an existing cloud task, without repeating the charge.",
    effect: "write",
    method: "POST",
    path: "dubbing/:id/link",
    argument: "JOB_ID",
    input: DubbingLink,
  },
  {
    name: "dubbing retry",
    description:
      "Pay the original fee again to rerun the same cloud task. Keeps the previous local recording and creates a separate saved attempt.",
    effect: "paid",
    method: "POST",
    path: "dubbing/:id/retry",
    argument: "JOB_ID",
    input: empty,
  },
  {
    name: "dubbing delete-cloud",
    description:
      "Delete the shared provider task/files; local sources and archived versions stay intact.",
    effect: "delete",
    method: "DELETE",
    path: "dubbing/:id/cloud",
    argument: "JOB_ID",
    input: empty,
  },
  {
    name: "clones list",
    description:
      "Saved MiniMax clones in this Project/Global library, including processing and interrupted submissions.",
    effect: "read",
    method: "GET",
    path: "clones",
    input: z.strictObject({
      includeGlobal: z.boolean().optional(),
      refresh: z.boolean().optional(),
    }),
  },
  {
    name: "clones info",
    description:
      "Original clone settings, source, permission, processing state and captured cloud ID.",
    effect: "read",
    method: "GET",
    path: "clones/:id",
    argument: "ID",
    input: empty,
  },
  {
    name: "clones cloud",
    description:
      "Existing account clones visible to this project; importing/linking never creates a clone.",
    effect: "read",
    method: "GET",
    path: "clones/cloud",
    input: empty,
  },
  {
    name: "clones create",
    description:
      "Clone your own permitted 10-second to 5-minute sample (up to 80 MB); fee unverified, --yes required.",
    effect: "paid",
    method: "POST",
    path: "clones",
    input: PlaygroundCloneSettings.extend({ file }),
    example: {
      file: "my-voice.wav",
      name: "My Vietnamese narrator",
      language: "Vietnamese",
      gender: "Female",
      noiseReduction: true,
      previewText: "Xin chao",
      permissionConfirmed: true,
    },
  },
  {
    name: "clones refresh",
    description:
      "Observe one saved clone and archive its preview; never sends another paid clone request.",
    effect: "read",
    method: "POST",
    path: "clones/:id/refresh",
    argument: "ID",
    input: empty,
  },
  {
    name: "clones adopt",
    description:
      "Save an existing cloud voice to the selected library after permission confirmation, without cloning again.",
    effect: "write",
    method: "POST",
    path: "clones/adopt",
    input: PlaygroundCloneLink,
  },
  {
    name: "clones link",
    description:
      "Recover a response-lost submission by linking its saved source to an existing cloud voice.",
    effect: "write",
    method: "POST",
    path: "clones/:id/link",
    argument: "ID",
    input: PlaygroundCloneLink,
  },
  {
    name: "clones update",
    description:
      "Change a library name or favorite; Project favorites remain private unless the voice is saved to Global.",
    effect: "write",
    method: "PATCH",
    path: "clones/:id",
    argument: "ID",
    input: PlaygroundClonePatch,
  },
  {
    name: "clones copy",
    description:
      "Copy source, preview, settings and permission to the other library; reuses the same cloud ID without a paid clone.",
    effect: "write",
    method: "POST",
    path: "clones/:id/copies",
    argument: "ID",
    input: copy,
  },
  {
    name: "clones retry",
    description:
      "Recreate a failed/completed cloud clone with its original sample/settings; charges again and affects future use of this cloud ID everywhere.",
    effect: "paid",
    method: "POST",
    path: "clones/:id/retry",
    argument: "ID",
    input: empty,
  },
  {
    name: "clones delete",
    description:
      "Delete the cloud voice for every project; existing recordings and local source files are kept. Requires --yes.",
    effect: "delete",
    method: "DELETE",
    path: "clones/:id/cloud",
    argument: "ID",
    input: empty,
  },
  {
    name: "clones export-source",
    description: "Export the original local clone sample to --out FILE.",
    effect: "read",
    method: "GET",
    path: "clones/:id/source",
    argument: "ID",
    input: empty,
  },
  {
    name: "clones submit",
    description:
      "Submit an already saved prepared sample; --yes required, refuses any previously submitted clone.",
    effect: "paid",
    method: "POST",
    path: "clones/:id/submit",
    argument: "ID",
    input: empty,
  },
  {
    name: "status",
    description: "Connection source, masked API key and cached account balance.",
    effect: "read",
    method: "GET",
    path: "status",
    input: PlaygroundConnectionQuery.extend({ live: z.boolean().optional() }).strict(),
  },
  {
    name: "config",
    description: "Set a manual key/API base or clear the override; secrets are never printed.",
    effect: "write",
    method: "POST",
    path: "config",
    input: PlaygroundConfig.strict(),
  },
  {
    name: "catalog",
    description:
      "Model capabilities, language codes and default voices; refresh fetches live metadata without generating.",
    effect: "read",
    method: "GET",
    path: "catalog",
    input: PlaygroundConnectionQuery.extend({ refresh: z.boolean().optional() }).strict(),
  },
  {
    name: "voices search",
    description:
      "Search cloud voices. GenVoice also supports creator/descriptive filters across up to scanPages pages; follow nextPage when hasMore is true.",
    effect: "read",
    method: "GET",
    path: "voices/search",
    input: PlaygroundVoiceSearch,
  },
  {
    name: "voices cached",
    description:
      "Search the cached English Audio voice catalog using its UI facets and sorts. Use useCase=fav for Audio favorites or v4Mode=all for all models.",
    effect: "read",
    method: "GET",
    path: "voices/cached",
    input: PlaygroundCachedVoiceQuery,
    example: { useCase: "fav", v4Mode: "all", sort: "name" },
  },
  {
    name: "voices preview",
    description:
      "Export a catalog demo or saved clone preview using its previewUrl and --out FILE. The current Project/Global archive serves scoped previews. Free.",
    effect: "read",
    method: "POST",
    path: "voices/preview",
    input: PlaygroundVoicePreview,
  },
  {
    name: "voices usage",
    description:
      "Rank GenVoice actors by active slots in the selected film or saved recordings. Add includeGlobal to include its shared library. Counts your work only.",
    effect: "read",
    method: "GET",
    path: "voices/usage",
    input: PlaygroundVoiceUsageQuery,
    example: { includeGlobal: true, sort: "in-film", pageSize: 10 },
  },
  {
    name: "profiles list",
    description:
      "Find shortlisted voice profiles with Project/Global aliases, favorites, ratings, tags and source metadata.",
    effect: "read",
    method: "GET",
    path: "profiles",
    input: PlaygroundVoiceProfileQuery,
    example: { q: "co mai", minRating: 4, includeGlobal: true },
  },
  {
    name: "profiles info",
    description: "Read one shortlisted profile and its original provider voice name and ID.",
    effect: "read",
    method: "GET",
    path: "profiles/:id",
    argument: "ID",
    input: empty,
  },
  {
    name: "profiles save",
    description:
      "Shortlist a catalog voice in this library and save its alias, description, rating or color.",
    effect: "write",
    method: "POST",
    path: "profiles",
    input: PlaygroundVoiceProfileInput,
    example: {
      voice: { id: "VOICE_ID", name: "Provider name", provider: "elevenlabs" },
      alias: "Cô Mai",
    },
  },
  {
    name: "profiles update",
    description: "Edit profile metadata or set archived true to hide it, false to restore it.",
    effect: "write",
    method: "PATCH",
    path: "profiles/:id",
    argument: "ID",
    input: PlaygroundVoiceProfilePatch,
  },
  {
    name: "profiles copy",
    description:
      "Copy a profile to the other Project/Global library. Existing aliases stay intact.",
    effect: "write",
    method: "POST",
    path: "profiles/:id/copies",
    argument: "ID",
    input: copy,
  },
  {
    name: "items list",
    description:
      "Saved recordings and jobs in the selected library; includeGlobal adds Global to the current project.",
    effect: "read",
    method: "GET",
    path: "items",
    input: z.strictObject({ includeGlobal: z.boolean().optional() }),
  },
  {
    name: "items info",
    description: "Full prompt, settings, actual cost, source and rights for one recording.",
    effect: "read",
    method: "GET",
    path: "items/:id",
    argument: "ID",
    input: empty,
  },
  {
    name: "items find",
    description:
      "Filter recordings by batchId, voiceId, creatorId, origin project name, inclusive dates, tags and stars. For rated under 2 use minRating=1 and maxRating=1. Use --project for a different film's private archive.",
    effect: "read",
    method: "GET",
    path: "recordings",
    input: PlaygroundRecordingQuery,
    example: { q: "viet nam", favorite: true, minRating: 4, includeGlobal: true },
  },
  {
    name: "items recipe",
    description:
      "Return the generation command and reusable input for a saved recording, including prompt, voices and settings.",
    effect: "read",
    method: "GET",
    path: "items/:id/recipe",
    argument: "ID",
    input: empty,
  },
  {
    name: "items media",
    description:
      "Measure the saved file's codec, sample rate, channels and bit rate. A recipe records the request; the saved media can differ.",
    effect: "read",
    method: "GET",
    path: "items/:id/media",
    argument: "ID",
    input: empty,
  },
  {
    name: "items captions",
    description:
      "Read a recording's full transcript and available word or subtitle cue timestamps. Reads saved data only.",
    effect: "read",
    method: "GET",
    path: "items/:id/captions",
    argument: "ID",
    input: empty,
  },
  {
    name: "items update",
    description:
      "Edit a title, notes, tags, star rating, color, favorite, template marker or rights evidence.",
    effect: "write",
    method: "PATCH",
    path: "items/:id",
    argument: "ID",
    input: PlaygroundPatch.strict(),
  },
  {
    name: "items bulk",
    description:
      "Apply rating, color, tags, favorite or archive/restore changes to selected IDs in this library.",
    effect: "write",
    method: "PATCH",
    path: "recordings",
    input: PlaygroundRecordingBatchPatch,
    example: { ids: ["RECORDING_ID"], patch: { rating: 5, tags: ["finalist"] } },
  },
  {
    name: "items delete",
    description:
      "Archive a saved recording and retain its media. To restore it use items update with archived false.",
    effect: "delete",
    method: "DELETE",
    path: "items/:id",
    argument: "ID",
    input: empty,
  },
  {
    name: "items copy",
    description: "Copy a complete recording and all versions to the other Project/Global library.",
    effect: "write",
    method: "POST",
    path: "items/:id/copies",
    argument: "ID",
    input: copy,
  },
  {
    name: "items restore",
    description: "Restore an archived recording and its media to the active library.",
    effect: "write",
    method: "POST",
    path: "items/:id/restore",
    argument: "ID",
    input: empty,
  },
  {
    name: "items expired",
    description:
      "Preview archived recordings eligible for removal after 30 days and count protected recordings.",
    effect: "read",
    method: "GET",
    path: "recordings/expired",
    input: empty,
  },
  {
    name: "items purge-expired",
    description:
      "Permanently remove selected expired, unreferenced recordings. Review items expired before using --yes.",
    effect: "delete",
    method: "POST",
    path: "recordings/purge-expired",
    input: PlaygroundArchivePurge,
  },
  {
    name: "items retry",
    description:
      "Generate a fresh take with the original settings plus explicit overrides; spends credits only with --yes.",
    effect: "paid",
    method: "POST",
    path: "items/:id/retry",
    argument: "ID",
    input: PlaygroundRetry.strict(),
  },
  {
    name: "items export",
    description:
      "Export audio/SRT or saved transcript TXT/JSON/HTML/DOCX/PDF to --out FILE; Dubbing also retains original source and native result.",
    effect: "read",
    method: "GET",
    path: "items/:id",
    argument: "ID",
    input: z.strictObject({
      format: z
        .enum(["audio", "srt", "source", "result", "txt", "segmented_json", "html", "docx", "pdf"])
        .default("audio"),
    }),
  },
  {
    name: "sources add",
    description:
      "Archive an upload for Voice Changer or transcription reuse, up to 90 MB; Voice Changer generation accepts up to 50 MB. File is a local path.",
    effect: "write",
    method: "POST",
    path: "sources",
    input: z.strictObject({ file }),
  },
  {
    name: "generate tts",
    description:
      "Generate 1–3 Speech takes using connection genvoice, elevenlabs or google. Gemini accepts speechStyle for delivery direction.",
    effect: "paid",
    method: "POST",
    path: "tts",
    input: PlaygroundTts.strict(),
    example: {
      voiceId: "VOICE_ID",
      modelId: "eleven_v4",
      text: "[hushed] Listen closely.",
      voiceSettings: { stability: 0.5, speed: 0.9 },
      variations: 2,
    },
  },
  {
    name: "generate quote",
    description:
      "Get the GenVoice balance and per-voice model estimate for up to 12 takes. Same input as generate batch. Unknown fees remain null.",
    effect: "read",
    method: "POST",
    path: "tts/quote",
    input: PlaygroundTtsBatch,
    example: { entries: [{ voiceId: "VOICE_ID", modelId: "eleven_v4", text: "[hushed] Listen." }] },
  },
  {
    name: "generate batch",
    description:
      "Compare up to 12 GenVoice takes. Use text + voices to lock the same script to explicit voiceIds. Label marks each take in Audio > Recordings; use items find with batchId to retrieve it.",
    effect: "paid",
    method: "POST",
    path: "tts/batch",
    input: PlaygroundTtsBatch,
    example: {
      label: "Forest audition",
      text: "Good morning.",
      voices: [
        { voiceId: "VOICE_A", voiceName: "Narrator A", creatorId: "CREATOR_A" },
        { voiceId: "VOICE_B", voiceName: "Narrator B" },
      ],
    },
  },
  {
    name: "generate dialogue",
    description:
      "Generate a scene with at least two named speakers. GenVoice supports per-role models, ElevenLabs uses one scene model, and Gemini uses two prebuilt voices with optional speech_style per role.",
    effect: "paid",
    method: "POST",
    path: "dialogue",
    input: PlaygroundDialogue.strict(),
    example: {
      text: "Narrator: Listen.\nActor: I hear it.",
      speakers: {
        Narrator: { voice_id: "VOICE_A", model_id: "eleven_v4" },
        Actor: { voice_id: "VOICE_B", model_id: "eleven_v4" },
      },
    },
  },
  {
    name: "generate voice-changer",
    description: "Convert an archived source, Playground recording or film take to another voice.",
    effect: "paid",
    method: "POST",
    path: "voice-changer",
    input: PlaygroundVoiceChanger.strict(),
    example: {
      sourceItemId: "ITEM_ID",
      voiceId: "VOICE_ID",
      modelId: "eleven_multilingual_sts_v2",
    },
  },
  {
    name: "transcribe",
    description:
      "Scribe v2 with real word timings, speakers and requested document formats; languageCode is required. Use file for a local upload.",
    effect: "paid",
    method: "POST",
    path: "stt/jobs",
    input: PlaygroundStt.extend({ file: file.optional() }).strict(),
    example: {
      itemId: "ITEM_ID",
      languageCode: "en",
      timestampsGranularity: "word",
      diarize: true,
      additionalFormats: ["srt", "txt"],
    },
  },
  {
    name: "history list",
    description: "Read provider history while it remains available (usually 24 hours).",
    effect: "read",
    method: "GET",
    path: "remote-history",
    input: z.strictObject({ ...paging, kind: z.enum(["all", "tts", "voice_changer"]).optional() }),
  },
  {
    name: "history import",
    description: "Archive a completed remote task locally, including audio and available SRT.",
    effect: "write",
    method: "POST",
    path: "remote-history/import",
    input: PlaygroundImportRemote.strict(),
  },
  {
    name: "templates list",
    description: "Editable settings templates in Project/Global; no generation is needed.",
    effect: "read",
    method: "GET",
    path: "templates",
    input: z.strictObject({ includeGlobal: z.boolean().optional() }),
  },
  {
    name: "templates save",
    description:
      "Create a template from scratch or update it using id; keeps complete settings and reusable sources.",
    effect: "write",
    method: "POST",
    path: "templates",
    input: PlaygroundTemplateInput.extend({ draft: PlaygroundTemplateDraft.strict() }),
  },
  {
    name: "templates from-recording",
    description:
      "Save an original GenVoice Speech, Dialogue or Voice Changer recording as an editable template in this library. Free.",
    effect: "write",
    method: "POST",
    path: "templates/from-recording/:id",
    argument: "RECORDING_ID",
    input: PlaygroundTemplateFromRecording,
    example: { title: "Quiet narrator", tags: ["casting"] },
  },
  {
    name: "templates recipe",
    description:
      "Get the generation command and editable input from a GenVoice Speech, Dialogue or Voice Changer template. Free.",
    effect: "read",
    method: "GET",
    path: "templates/:id/recipe",
    argument: "TEMPLATE_ID",
    input: empty,
  },
  {
    name: "templates find",
    description:
      "Search reusable prompt and settings templates by name, mode, favorite, tag or rating.",
    effect: "read",
    method: "GET",
    path: "template-library",
    input: PlaygroundTemplateQuery,
  },
  {
    name: "templates info",
    description: "Read one template and its complete saved draft in this library.",
    effect: "read",
    method: "GET",
    path: "templates/:id",
    argument: "ID",
    input: empty,
  },
  {
    name: "templates update",
    description:
      "Edit metadata or supply a complete draft to edit generation settings. Use archived false to restore.",
    effect: "write",
    method: "PATCH",
    path: "templates/:id",
    argument: "ID",
    input: PlaygroundTemplatePatch.extend({ draft: PlaygroundTemplateDraft.strict().optional() }),
  },
  {
    name: "templates bulk",
    description:
      "Edit, archive or restore template metadata for up to 100 IDs in the selected library. Reports missing IDs.",
    effect: "write",
    method: "PATCH",
    path: "templates",
    input: PlaygroundTemplateBatchPatch,
    example: { ids: ["pt_1", "pt_2"], patch: { archived: true } },
  },
  {
    name: "templates delete",
    description:
      "Archive a saved template. To restore it, use templates update with archived false.",
    effect: "delete",
    method: "DELETE",
    path: "templates/:id",
    argument: "ID",
    input: empty,
  },
  {
    name: "templates copy",
    description: "Copy a template and its source into the other library.",
    effect: "write",
    method: "POST",
    path: "templates/:id/copies",
    argument: "ID",
    input: copy,
  },
  {
    name: "favorites voices",
    description:
      "Filter favorite voice identities (including Audio favorites) by creator, category and profile rating. Current Project ratings take precedence over Global. Use minRating=1 and maxRating=1 for rated under 2.",
    effect: "read",
    method: "GET",
    path: "voice-favorite-search",
    input: PlaygroundFavoriteVoiceQuery,
    example: { favoriteCreatorsOnly: true, category: "professional", minRating: 5 },
  },
  {
    name: "favorites voices-set",
    description:
      "Set the same favorite state on up to 100 voices. Accepts voice records from voices search; supplied metadata is saved and existing fields are preserved.",
    effect: "write",
    method: "PUT",
    path: "voice-favorite-batch",
    input: PlaygroundVoiceFavoritesBatch,
    example: {
      favorite: true,
      voices: [{ id: "VOICE_A", creatorId: "CREATOR_A" }, { id: "VOICE_B" }],
    },
  },
  {
    name: "favorites creators",
    description: "List the favorite GenVoice creators available for casting filters.",
    effect: "read",
    method: "GET",
    path: "voice-creator-favorites",
    input: empty,
  },
  {
    name: "favorites creator",
    description:
      "Favorite or unfavorite a creator by creatorId from voices search. Optional name is your alias for this creator.",
    effect: "write",
    method: "PUT",
    path: "voice-creator-favorites",
    input: PlaygroundCreatorFavorite,
    example: { id: "CREATOR_A", name: "Casting shortlist", favorite: true },
  },
  {
    name: "creators list",
    description: "List saved GenVoice creators, their aliases, descriptions and favorite states.",
    effect: "read",
    method: "GET",
    path: "voice-creators",
    input: empty,
  },
  {
    name: "creators save",
    description:
      "Save a creator alias or description independently of its favorite state. Takes the creatorId from voices search.",
    effect: "write",
    method: "PUT",
    path: "voice-creators",
    input: PlaygroundCreatorProfile,
    example: { id: "CREATOR_A", name: "Narrator studio", description: "Strong on quiet delivery" },
  },
  {
    name: "favorites voice",
    description: "Favorite or unfavorite a demo/catalog voice even before generating it.",
    effect: "write",
    method: "PUT",
    path: "voice-favorites",
    input: PlaygroundVoiceFavorite.strict(),
  },
  {
    name: "favorites takes",
    description: "List favorite film recordings in the current project.",
    effect: "read",
    method: "GET",
    path: "take-favorites",
    input: empty,
  },
  {
    name: "favorites take",
    description: "Favorite or unfavorite a film take; recordings in Playground use items update.",
    effect: "write",
    method: "PUT",
    path: "take-favorites",
    input: z.strictObject({
      uid: z.string().regex(/^take:[A-Za-z0-9_-]{1,120}$/),
      favorite: z.boolean(),
    }),
  },
  {
    name: "film archive",
    description: "Make an immutable archive of an existing film take in Project or Global.",
    effect: "write",
    method: "POST",
    path: "film-takes/:id/copies",
    argument: "TAKE_ID",
    input: z.strictObject({ scope, voiceName: z.string().optional(), name: z.string().optional() }),
  },
  {
    name: "film usage",
    description:
      "List saved recordings currently selected in this film and the take IDs using them.",
    effect: "read",
    method: "GET",
    path: "usage",
    input: empty,
  },
  {
    name: "film alternatives",
    description:
      "Copy a saved recording into a film take's alternatives without changing the active take.",
    effect: "write",
    method: "POST",
    path: "promote",
    input: PlaygroundPromote.strict(),
  },
  {
    name: "film use",
    description:
      "Apply a recording, preserve previous audio, resize its narration brick and update In use marks.",
    effect: "write",
    method: "POST",
    path: "apply",
    input: PlaygroundPromote.strict(),
  },
  {
    name: "region info",
    description: "Measured duration, waveform and actual word timings for choosing a section.",
    effect: "read",
    method: "GET",
    path: "items/:id/region",
    argument: "ID",
    input: empty,
  },
  {
    name: "region preview",
    description:
      "Render a free local section edit to --out FILE; no archive changes or GenVoice credits.",
    effect: "write",
    method: "POST",
    path: "items/:id/region-preview",
    argument: "ID",
    input: PlaygroundLocalEdit.strict(),
    example: { mode: "local", from: 1, to: 2, rate: 0.85, pitch: 0, gainDb: 0, pause: 0.15 },
  },
  {
    name: "region edit",
    description:
      "Save an immutable section edit. Local mode is free; regenerate mode previews unless --yes.",
    effect: "write",
    method: "POST",
    path: "items/:id/versions",
    argument: "ID",
    input: z.discriminatedUnion("mode", [
      PlaygroundLocalEdit.strict(),
      PlaygroundRegenerateRegion.strict(),
    ]),
  },
  {
    name: "region resume",
    description:
      "Finish a phrase edit using its already archived replacementItemId; no new GenVoice request or fee.",
    effect: "write",
    method: "POST",
    path: "items/:id/versions/resume",
    argument: "ID",
    input: PlaygroundResumeRegion,
  },
  {
    name: "versions list",
    description:
      "Original and every saved version in this library; restore by selecting an old version for the film.",
    effect: "read",
    method: "GET",
    path: "items/:id/versions",
    argument: "ID",
    input: empty,
  },
];

export const commandSchema = (command: PlaygroundCommand) => ({
  command: command.name,
  description: command.description,
  argument: command.argument ?? null,
  effect: command.effect,
  input: z.toJSONSchema(command.input, { io: "input" }),
  example: command.example ?? null,
});
