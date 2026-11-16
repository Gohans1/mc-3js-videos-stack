import {
  DANGEROUS_KEYS,
  detectTextLanguage,
  parseDialogueTurnNames,
  stripDialogueSpeakerBrackets,
} from "../../src/voice-playground-text.mjs";
// Pure view-model normalization, filtering, sorting, and template/swap-voice cloning for Voice Playground.
import type {
  PlaygroundModelInfo,
  PlaygroundSttResult,
  PlaygroundVoiceSettings,
  VoicePlaygroundItem,
} from "../../src/voice-playground.mjs";
import { matcher } from "../core/search";
import {
  parseTakeScript,
  voiceActorTitle,
  voiceAuditionId,
  type VoiceTakeItem,
} from "./voice-view";

export { detectTextLanguage, parseDialogueTurnNames, stripDialogueSpeakerBrackets };

export type PlaygroundOrigin = "playground" | "film_take";
export type PlaygroundSourceFilter = "all" | "playground" | "film_take" | "templates" | "favorites";
export type PlaygroundKindFilter = "all" | "tts" | "dialogue" | "voice_changer";
export type PlaygroundSortKey =
  "newest" | "oldest" | "favorites" | "longest" | "shortest" | "voice" | "model" | "credits";

export interface UnifiedPlaygroundEntry {
  uid: string;
  origin: PlaygroundOrigin;
  id: string;
  kind: "tts" | "dialogue" | "voice_changer";
  title: string;
  text: string;
  spoken: string;
  tags: string[];
  voiceId: string;
  voiceName: string;
  modelId: string;
  languageCode: string;
  voiceSettings: PlaygroundVoiceSettings;
  exportTranscript: boolean;
  durationSeconds: number;
  charactersUsed: number;
  creditsDeducted: number;
  favorite: boolean;
  isTemplate: boolean;
  templateName?: string;
  notes?: string;
  auditionId: string;
  audioUrl: string;
  srtFile?: string;
  srtText?: string;
  remoteTaskId?: string;
  createdAt: string;
  playgroundItem?: VoicePlaygroundItem;
  filmTake?: VoiceTakeItem;
}

export interface PlaygroundFilterState {
  source: PlaygroundSourceFilter;
  kind: PlaygroundKindFilter;
  voiceId: string;
  modelId: string;
  tag: string;
  query: string;
  sort: PlaygroundSortKey;
}

export const DEFAULT_PLAYGROUND_FILTERS: PlaygroundFilterState = {
  source: "all",
  kind: "all",
  voiceId: "all",
  modelId: "all",
  tag: "all",
  query: "",
  sort: "newest",
};

export interface ComposerDialogueSpeaker {
  id: string;
  name: string;
  voiceId: string;
  voiceName: string;
  modelId: string;
  languageCode: string;
  stability: number;
  similarityBoost: number;
  style: number;
  useSpeakerBoost: boolean;
  speed: number;
}

export const snapToDiscreteValue = (val: number, values: readonly number[]): number => {
  if (!values.length) return val;
  let best = values[0]!;
  let dist = Math.abs(val - best);
  for (const v of values) {
    const d = Math.abs(val - v);
    if (d < dist) {
      best = v;
      dist = d;
    }
  }
  return best;
};

export interface ComposerDraft {
  mode: "tts" | "dialogue" | "voice_changer" | "stt";
  title: string;
  text: string;
  voiceId: string;
  voiceName: string;
  modelId: string;
  languageCode: string;
  stability: number;
  similarityBoost: number;
  style: number;
  useSpeakerBoost: boolean;
  speed: number;
  previousText: string;
  sttLanguageCode: string;
  sttGranularity: "word" | "character" | "none";
  sttDiarize: boolean;
  sttNumSpeakers: string;
  sttDiarizationThreshold: string;
  sttTagEvents: boolean;
  sttNoVerbatim: boolean;
  sttExportSrt: boolean;
  sttTemperature: number;
  sttSeedText: string;
  sttFileFormat: "other" | "pcm_s16le_16";
  sttUseMultiChannel: boolean;
  sttKeytermsText: string;
  sttEntityDetectionText: string;
  sttEntityRedactionText: string;
  sttEntityRedactionMode: "enumerated_entity_type" | "entity_type" | "redacted";
  sttExtraFormats: string[];
  nextText: string;
  seedText: string;
  outputFormat: string;
  applyTextNormalization: "auto" | "on" | "off";
  exportTranscript: boolean;
  variations: number;
  removeBackgroundNoise: boolean;
  vcSourceKind: "upload" | "playground" | "film_take";
  vcSourceFile: string;
  vcSourceItemId: string;
  vcSourceTakeValue: string;
  sttSourceKind: "upload" | "playground" | "film_take";
  sttSourceItemId: string;
  sttSourceTakeValue: string;
  pauseBetweenTurns: number;
  speakers: ComposerDialogueSpeaker[];
  notes: string;
  sourceTakeId?: string;
  fromTemplateId?: string;
}

export const DEFAULT_COMPOSER_DRAFT: ComposerDraft = {
  mode: "tts",
  title: "",
  text: "[hushed] Look closely at what changes [short pause] when you shift the delivery.",
  voiceId: "ZaZosYpkIGmSqOwAlfnk",
  voiceName: "Seff Echo",
  modelId: "eleven_v4",
  languageCode: "en",
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0,
  useSpeakerBoost: false,
  speed: 1,
  previousText: "",
  nextText: "",
  seedText: "",
  outputFormat: "",
  applyTextNormalization: "auto",
  exportTranscript: false,
  variations: 1,
  removeBackgroundNoise: true,
  vcSourceKind: "playground",
  vcSourceFile: "",
  vcSourceItemId: "",
  vcSourceTakeValue: "",
  sttSourceKind: "playground",
  sttSourceItemId: "",
  sttSourceTakeValue: "",
  sttLanguageCode: "en",
  sttGranularity: "word",
  sttDiarize: true,
  sttNumSpeakers: "",
  sttDiarizationThreshold: "0.22",
  sttTagEvents: true,
  sttNoVerbatim: false,
  sttExportSrt: true,
  sttTemperature: 0,
  sttSeedText: "",
  sttFileFormat: "other",
  sttUseMultiChannel: false,
  sttKeytermsText: "",
  sttEntityDetectionText: "",
  sttEntityRedactionText: "",
  sttEntityRedactionMode: "enumerated_entity_type",
  sttExtraFormats: [],
  pauseBetweenTurns: 0.5,
  speakers: [
    {
      id: "sp_alex",
      name: "Alex",
      voiceId: "ZaZosYpkIGmSqOwAlfnk",
      voiceName: "Seff Echo",
      modelId: "eleven_v4",
      languageCode: "en",
      stability: 0.5,
      similarityBoost: 0.75,
      style: 0,
      useSpeakerBoost: false,
      speed: 1,
    },
    {
      id: "sp_riley",
      name: "Riley",
      voiceId: "99Hm6N8psCBzc1JwEVR2",
      voiceName: "Riley",
      modelId: "eleven_v4",
      languageCode: "en",
      stability: 0.5,
      similarityBoost: 0.75,
      style: 0,
      useSpeakerBoost: false,
      speed: 1,
    },
  ],
  notes: "",
};

export const voiceSettingsForModel = (
  model: PlaygroundModelInfo | undefined,
  raw: {
    stability: number;
    similarityBoost: number;
    style: number;
    useSpeakerBoost: boolean;
    speed: number;
  },
): PlaygroundVoiceSettings => {
  const rawStability = Math.min(1, Math.max(0, Number(raw.stability ?? 0.5)));
  const stability =
    Array.isArray(model?.stability_values) && model.stability_values.length
      ? snapToDiscreteValue(rawStability, model.stability_values)
      : rawStability;
  const out: PlaygroundVoiceSettings = { stability: +stability.toFixed(3) };
  if (model?.supports_similarity !== false) out.similarity_boost = raw.similarityBoost;
  if (model?.can_use_style === true) out.style = raw.style;
  if (model?.can_use_speaker_boost === true) out.use_speaker_boost = raw.useSpeakerBoost;
  if (model?.supports_speed === true) {
    out.speed = +Math.min(1.2, Math.max(0.7, Number(raw.speed ?? 1))).toFixed(3);
  }
  return out;
};

export interface PlaygroundFacetOption {
  id: string;
  label: string;
  count: number;
}

export interface PlaygroundFacets {
  voices: PlaygroundFacetOption[];
  models: PlaygroundFacetOption[];
  tags: PlaygroundFacetOption[];
}

const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export const playgroundAuditionId = (id: string) => `pg:${id}`;

export const playgroundAudioUrl = (audioFile: string) =>
  `/api/voice/playground/audio/${encodeURIComponent(audioFile)}`;

export const buildUnifiedEntries = (
  playgroundItems: readonly VoicePlaygroundItem[],
  filmTakes: readonly VoiceTakeItem[],
  starredUids: ReadonlySet<string>,
): UnifiedPlaygroundEntry[] => {
  const entries: UnifiedPlaygroundEntry[] = [];

  for (const item of playgroundItems) {
    const parsed = parseTakeScript(item.text || "");
    const tags = item.tags?.length ? item.tags : parsed.tags;
    entries.push({
      uid: `pg:${item.id}`,
      origin: "playground",
      id: item.id,
      kind: item.kind,
      title: item.title || parsed.spoken || item.id,
      text: item.text || "",
      spoken: parsed.spoken || item.text || "",
      tags,
      voiceId: item.voiceId,
      voiceName: item.voiceName || voiceActorTitle(item.voiceId),
      modelId: item.modelId || "eleven_v4",
      languageCode: item.languageCode || "",
      voiceSettings: item.voiceSettings ?? {},
      exportTranscript: Boolean(item.exportTranscript),
      durationSeconds: item.durationSeconds ?? 0,
      charactersUsed: item.charactersUsed ?? item.text?.length ?? 0,
      creditsDeducted: item.creditsDeducted ?? 0,
      favorite: Boolean(item.favorite),
      isTemplate: Boolean(item.isTemplate),
      templateName: item.templateName,
      notes: item.notes,
      auditionId: playgroundAuditionId(item.id),
      audioUrl: item.audioFile ? playgroundAudioUrl(item.audioFile) : "",
      srtFile: item.srtFile,
      srtText: item.srtText,
      remoteTaskId: item.remoteTaskId,
      createdAt: item.createdAt || "",
      playgroundItem: item,
    });
  }

  for (const take of filmTakes) {
    const uid = `take:${take.id}`;
    const parsed = parseTakeScript(take.text || "");
    const vId = take.voice || "ZaZosYpkIGmSqOwAlfnk";
    const spoken = parsed.spoken || take.text || "";
    const voiceSettings: PlaygroundVoiceSettings = {
      ...(typeof take.stability === "number" ? { stability: take.stability } : { stability: 0.5 }),
      ...(typeof take.speed === "number" ? { speed: take.speed } : { speed: 1 }),
    };
    entries.push({
      uid,
      origin: "film_take",
      id: take.id,
      kind: "tts",
      title: `Take ${take.id}: ${spoken}`,
      text: take.text || "",
      spoken,
      tags: parsed.tags,
      voiceId: vId,
      voiceName: voiceActorTitle(vId),
      modelId: take.model || "eleven_v4",
      languageCode: "",
      voiceSettings,
      exportTranscript: false,
      durationSeconds: take.seconds ?? 0,
      charactersUsed: (take.text || "").length,
      creditsDeducted: 0,
      favorite: starredUids.has(uid),
      isTemplate: false,
      notes: take.guide ? `Guide: ${take.guide}` : undefined,
      auditionId: take.file ? voiceAuditionId("takes", take.file) : "",
      audioUrl: take.file ? `/api/voice/audio/takes/${encodeURIComponent(take.file)}` : "",
      createdAt: "",
      filmTake: take,
    });
  }

  return entries;
};

export const extractPlaygroundFacets = (
  entries: readonly UnifiedPlaygroundEntry[],
): PlaygroundFacets => {
  const voiceMap = new Map<string, { label: string; count: number }>();
  const modelMap = new Map<string, number>();
  const tagMap = new Map<string, number>();

  for (const e of entries) {
    if (e.voiceId) {
      const cur = voiceMap.get(e.voiceId);
      if (cur) cur.count++;
      else voiceMap.set(e.voiceId, { label: e.voiceName || e.voiceId, count: 1 });
    }
    if (e.modelId) {
      modelMap.set(e.modelId, (modelMap.get(e.modelId) ?? 0) + 1);
    }
    for (const t of e.tags) {
      tagMap.set(t, (tagMap.get(t) ?? 0) + 1);
    }
  }

  return {
    voices: [...voiceMap.entries()]
      .map(([id, v]) => ({ id, label: v.label, count: v.count }))
      .sort((a, b) => COLLATOR.compare(a.label, b.label)),
    models: [...modelMap.entries()]
      .map(([id, count]) => ({ id, label: id, count }))
      .sort((a, b) => b.count - a.count || COLLATOR.compare(a.id, b.id)),
    tags: [...tagMap.entries()]
      .map(([id, count]) => ({ id, label: id, count }))
      .sort((a, b) => b.count - a.count || COLLATOR.compare(a.id, b.id)),
  };
};

export const filterAndSortEntries = (
  entries: readonly UnifiedPlaygroundEntry[],
  filters: PlaygroundFilterState,
): UnifiedPlaygroundEntry[] => {
  const hit = matcher(filters.query);
  const filtered = entries.filter((e) => {
    if (filters.source === "playground" && e.origin !== "playground") return false;
    if (filters.source === "film_take" && e.origin !== "film_take") return false;
    if (filters.source === "templates" && !e.isTemplate) return false;
    if (filters.source === "favorites" && !e.favorite) return false;
    if (filters.kind !== "all" && e.kind !== filters.kind) return false;
    if (filters.voiceId !== "all" && e.voiceId !== filters.voiceId) return false;
    if (filters.modelId !== "all" && e.modelId !== filters.modelId) return false;
    if (filters.tag !== "all" && !e.tags.includes(filters.tag)) return false;
    if (filters.query.trim()) {
      const hay = [
        e.id,
        e.title,
        e.text,
        e.voiceName,
        e.voiceId,
        e.modelId,
        e.templateName ?? "",
        e.notes ?? "",
        e.tags.join(" "),
      ].join(" ");
      if (!hit(hay)) return false;
    }
    return true;
  });

  const sorted = [...filtered];
  sorted.sort((a, b) => {
    switch (filters.sort) {
      case "oldest":
        return (a.createdAt || "9999").localeCompare(b.createdAt || "9999");
      case "favorites":
        if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
        return (b.createdAt || "").localeCompare(a.createdAt || "");
      case "longest":
        return b.durationSeconds - a.durationSeconds;
      case "shortest":
        return a.durationSeconds - b.durationSeconds;
      case "voice":
        return COLLATOR.compare(a.voiceName, b.voiceName);
      case "model":
        return COLLATOR.compare(a.modelId, b.modelId);
      case "credits":
        return b.creditsDeducted - a.creditsDeducted;
      case "newest":
      default:
        // Keep created Playground items sorted newest-first, followed cleanly by film takes in ID order
        if (a.origin !== b.origin) return a.origin === "playground" ? -1 : 1;
        if (a.origin === "playground") return (b.createdAt || "").localeCompare(a.createdAt || "");
        return COLLATOR.compare(a.id, b.id);
    }
  });
  return sorted;
};

const isPlainRecord = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);

export const nextTabId = <T extends string>(
  tabs: readonly T[],
  current: T,
  key: string,
): T | null => {
  if (!tabs.length) return null;
  const idx = tabs.indexOf(current);
  const base = idx >= 0 ? idx : 0;
  if (key === "ArrowRight") return tabs[(base + 1) % tabs.length]!;
  if (key === "ArrowLeft") return tabs[(base - 1 + tabs.length) % tabs.length]!;
  if (key === "Home") return tabs[0]!;
  if (key === "End") return tabs[tabs.length - 1]!;
  return null;
};

export const composeFilmTakeRemixPreset = (take: VoiceTakeItem): Partial<ComposerDraft> => ({
  mode: "tts",
  title: `Take ${take.id} remix`,
  text: take.text,
  voiceId: take.voice || "ZaZosYpkIGmSqOwAlfnk",
  voiceName: voiceActorTitle(take.voice),
  modelId: take.model || "eleven_v4",
  languageCode: detectTextLanguage(take.text || ""),
  stability: take.stability ?? 0.5,
  speed: take.speed ?? 1,
  sourceTakeId: take.id,
});

export interface SafeDialogueSpeakerEntry {
  name: string;
  voice_id: string;
  voice_name?: string;
  model_id?: string;
  language_code?: string;
  voice_settings?: PlaygroundVoiceSettings;
}

export const extractDialogueSpeakerEntries = (raw: unknown): SafeDialogueSpeakerEntry[] => {
  if (!isPlainRecord(raw)) return [];
  const out: SafeDialogueSpeakerEntry[] = [];
  for (const [rawName, sp] of Object.entries(raw)) {
    const name = rawName.trim();
    if (!name || DANGEROUS_KEYS.has(name) || !isPlainRecord(sp)) continue;
    const voiceId = typeof sp.voice_id === "string" ? sp.voice_id.trim() : "";
    if (!voiceId) continue;
    const rawSettings = isPlainRecord(sp.voice_settings) ? sp.voice_settings : {};
    const numOpt = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
    out.push({
      name,
      voice_id: voiceId,
      ...(typeof sp.voice_name === "string" && sp.voice_name.trim()
        ? { voice_name: sp.voice_name.trim() }
        : {}),
      ...(typeof sp.model_id === "string" && sp.model_id.trim()
        ? { model_id: sp.model_id.trim() }
        : {}),
      ...(typeof sp.language_code === "string" && sp.language_code.trim()
        ? { language_code: sp.language_code.trim() }
        : {}),
      voice_settings: {
        stability: numOpt(rawSettings.stability),
        similarity_boost: numOpt(rawSettings.similarity_boost),
        style: numOpt(rawSettings.style),
        use_speaker_boost:
          typeof rawSettings.use_speaker_boost === "boolean"
            ? rawSettings.use_speaker_boost
            : undefined,
        speed: numOpt(rawSettings.speed),
      },
    });
  }
  return out;
};

export const entryToComposerDraft = (
  entry: UnifiedPlaygroundEntry,
  overrideVoice?: { id: string; name: string; speakerKey?: string },
): ComposerDraft => {
  const vs = entry.voiceSettings ?? {};
  const dlg = entry.playgroundItem?.dialogue;
  const validSpeakers = dlg
    ? extractDialogueSpeakerEntries(dlg.speakers).map((sp, idx) => {
        const matchSpeaker = overrideVoice
          ? overrideVoice.speakerKey
            ? sp.name === overrideVoice.speakerKey
            : idx === 0
          : false;
        const sVs = sp.voice_settings ?? {};
        return {
          id: `sp_${idx}_${sp.name}`,
          name: sp.name,
          voiceId: matchSpeaker && overrideVoice ? overrideVoice.id : sp.voice_id,
          voiceName:
            matchSpeaker && overrideVoice ? overrideVoice.name : sp.voice_name || sp.voice_id,
          modelId: sp.model_id || "eleven_v4",
          languageCode: sp.language_code || "",
          stability: sVs.stability ?? 0.5,
          similarityBoost: sVs.similarity_boost ?? 0.75,
          style: sVs.style ?? 0,
          useSpeakerBoost: Boolean(sVs.use_speaker_boost),
          speed: sVs.speed ?? 1,
        };
      })
    : [];
  const speakers: ComposerDialogueSpeaker[] =
    validSpeakers.length > 0 ? validSpeakers : DEFAULT_COMPOSER_DRAFT.speakers;

  const vc = entry.playgroundItem?.voiceChanger;
  const vcTakeVal =
    vc?.sourceTakeKind && vc?.sourceTakeFile ? `${vc.sourceTakeKind}:${vc.sourceTakeFile}` : "";
  const pgItem = entry.playgroundItem;

  return {
    mode:
      entry.kind === "dialogue"
        ? "dialogue"
        : entry.kind === "voice_changer"
          ? "voice_changer"
          : "tts",
    title: overrideVoice
      ? `${entry.templateName || entry.title} (${overrideVoice.name})`
      : entry.title,
    text: entry.text,
    voiceId: overrideVoice?.id ?? validSpeakers[0]?.voiceId ?? entry.voiceId,
    voiceName: overrideVoice?.name ?? validSpeakers[0]?.voiceName ?? entry.voiceName,
    modelId: entry.modelId || "eleven_v4",
    languageCode: entry.languageCode || (entry.kind === "dialogue" ? "en" : ""),
    stability: vs.stability ?? 0.5,
    similarityBoost: vs.similarity_boost ?? 0.75,
    style: vs.style ?? 0,
    useSpeakerBoost: Boolean(vs.use_speaker_boost),
    speed: vs.speed ?? 1,
    previousText: pgItem?.previousText ?? "",
    nextText: pgItem?.nextText ?? "",
    seedText: typeof pgItem?.seed === "number" ? String(pgItem.seed) : "",
    outputFormat: pgItem?.outputFormat ?? "",
    applyTextNormalization: pgItem?.applyTextNormalization ?? "auto",
    exportTranscript: entry.exportTranscript,
    variations: 1,
    removeBackgroundNoise: vc?.remove_background_noise ?? true,
    vcSourceKind: vc?.sourceFile ? "upload" : vcTakeVal ? "film_take" : "playground",
    vcSourceFile: vc?.sourceFile ?? "",
    vcSourceItemId:
      entry.kind === "voice_changer"
        ? (vc?.sourceItemId ?? "")
        : entry.origin === "playground"
          ? entry.id
          : "",
    vcSourceTakeValue:
      vcTakeVal ||
      (entry.origin === "film_take" && entry.filmTake?.file ? `takes:${entry.filmTake.file}` : ""),
    sttSourceKind: entry.origin === "film_take" ? "film_take" : "playground",
    sttSourceItemId: entry.origin === "playground" ? entry.id : "",
    sttSourceTakeValue:
      entry.origin === "film_take" && entry.filmTake?.file ? `takes:${entry.filmTake.file}` : "",
    sttLanguageCode: entry.languageCode || DEFAULT_COMPOSER_DRAFT.sttLanguageCode,
    sttGranularity: DEFAULT_COMPOSER_DRAFT.sttGranularity,
    sttDiarize: DEFAULT_COMPOSER_DRAFT.sttDiarize,
    sttNumSpeakers: DEFAULT_COMPOSER_DRAFT.sttNumSpeakers,
    sttDiarizationThreshold: DEFAULT_COMPOSER_DRAFT.sttDiarizationThreshold,
    sttTagEvents: DEFAULT_COMPOSER_DRAFT.sttTagEvents,
    sttNoVerbatim: DEFAULT_COMPOSER_DRAFT.sttNoVerbatim,
    sttExportSrt: DEFAULT_COMPOSER_DRAFT.sttExportSrt,
    sttTemperature: DEFAULT_COMPOSER_DRAFT.sttTemperature,
    sttSeedText: DEFAULT_COMPOSER_DRAFT.sttSeedText,
    sttFileFormat: DEFAULT_COMPOSER_DRAFT.sttFileFormat,
    sttUseMultiChannel: DEFAULT_COMPOSER_DRAFT.sttUseMultiChannel,
    sttKeytermsText: DEFAULT_COMPOSER_DRAFT.sttKeytermsText,
    sttEntityDetectionText: DEFAULT_COMPOSER_DRAFT.sttEntityDetectionText,
    sttEntityRedactionText: DEFAULT_COMPOSER_DRAFT.sttEntityRedactionText,
    sttEntityRedactionMode: DEFAULT_COMPOSER_DRAFT.sttEntityRedactionMode,
    sttExtraFormats: DEFAULT_COMPOSER_DRAFT.sttExtraFormats,
    pauseBetweenTurns: dlg?.pause_between_turns ?? 0.5,
    speakers,
    notes: entry.notes ?? "",
    sourceTakeId: entry.origin === "film_take" ? entry.id : entry.playgroundItem?.sourceTakeId,
    fromTemplateId: entry.origin === "playground" ? entry.id : undefined,
  };
};

export const isSafeAudioUrl = (raw: string): boolean => {
  if (!raw) return false;
  if (raw.startsWith("/")) return !raw.startsWith("//");
  try {
    const u = new URL(raw);
    return (
      u.protocol === "https:" ||
      (u.protocol === "http:" &&
        (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "::1"))
    );
  } catch {
    return false;
  }
};

export const resolveModeModelId = (
  mode: ComposerDraft["mode"],
  currentModelId: string,
  models: ReadonlyArray<PlaygroundModelInfo>,
): string => {
  if (mode === "voice_changer") {
    const validVc = models.length
      ? models.some((m) => m.model_id === currentModelId && m.can_do_voice_conversion)
      : currentModelId.includes("_sts_");
    if (validVc) return currentModelId;
    return models.find((m) => m.can_do_voice_conversion)?.model_id ?? "eleven_multilingual_sts_v2";
  }
  const validTts = models.length
    ? models.some((m) => m.model_id === currentModelId && m.can_do_text_to_speech)
    : Boolean(currentModelId && !currentModelId.includes("_sts_"));
  if (validTts) return currentModelId;
  return (
    models.find((m) => m.model_id === "eleven_v4" && m.can_do_text_to_speech)?.model_id ??
    models.find((m) => m.can_do_text_to_speech)?.model_id ??
    "eleven_v4"
  );
};

export interface DiarizedTurn {
  speaker: string;
  start?: number;
  text: string;
}

export const groupDiarizedTranscript = (
  words: PlaygroundSttResult["words"] | undefined,
): DiarizedTurn[] => {
  if (!Array.isArray(words) || !words.length) return [];
  if (!words.some((w) => typeof w?.speaker_id === "string" && w.speaker_id.trim())) return [];
  const turns: DiarizedTurn[] = [];
  for (const w of words) {
    const piece = String(w?.text ?? "");
    if (!piece) continue;
    const isSpacing = w?.type === "spacing" || /^\s+$/.test(piece);
    const speaker = w?.speaker_id?.trim() || turns[turns.length - 1]?.speaker || "speaker_0";
    const last = turns[turns.length - 1];
    if (isSpacing) {
      if (last && !/\s$/.test(last.text)) last.text += " ";
      continue;
    }
    if (last && last.speaker === speaker) {
      if (last.text && !/\s$/.test(last.text) && !/^\s/.test(piece)) last.text += " ";
      last.text += piece;
    } else {
      turns.push({
        speaker,
        ...(typeof w?.start === "number" && Number.isFinite(w.start) ? { start: w.start } : {}),
        text: piece.trimStart(),
      });
    }
  }
  return turns.map((t) => ({ ...t, text: t.text.trim() })).filter((t) => Boolean(t.text));
};
