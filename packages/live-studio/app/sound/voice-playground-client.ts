import { useEffect, useRef, useSyncExternalStore } from "react";

import type {
  PlaygroundAccountInfo,
  PlaygroundJob,
  PlaygroundModelInfo,
  PlaygroundStatus,
  PlaygroundSttResult,
  PlaygroundVoiceOption,
  PlaygroundVoiceSettings,
  RemoteHistoryEntry,
  VoicePlaygroundItem,
} from "../../src/voice-playground.mjs";
import { say, set } from "../core/store";
import { auditionTarget, listening, stopAudition } from "./sound";
import { loadVoiceTakes } from "./voice-client";
import {
  type ComposerDraft,
  DEFAULT_COMPOSER_DRAFT,
  DEFAULT_PLAYGROUND_FILTERS,
  detectTextLanguage,
  entryToComposerDraft,
  parseDialogueTurnNames,
  playgroundAuditionId,
  type PlaygroundFilterState,
  resolveModeModelId,
  stripDialogueSpeakerBrackets,
  type UnifiedPlaygroundEntry,
  voiceSettingsForModel,
} from "./voice-playground-view";
import { registerVoiceNames } from "./voice-view";

export type PlaygroundSubTab = "create" | "library" | "inspect" | "remote";

export interface VoicePlaygroundClientState {
  loaded: boolean;
  loading: boolean;
  error: string | null;
  status: PlaygroundStatus;
  catalog: {
    models: PlaygroundModelInfo[];
    languages: Array<{ code: string; name: string }>;
    defaultVoices: PlaygroundVoiceOption[];
    liveSynced: boolean;
    error?: string;
  };
  items: VoicePlaygroundItem[];
  jobs: PlaygroundJob[];
  remoteHistory: {
    items: RemoteHistoryEntry[];
    hasMore: boolean;
    loading: boolean;
    error: string | null;
    warning?: string | null;
    page: number;
  };
  sharedSearch: {
    voices: PlaygroundVoiceOption[];
    hasMore: boolean;
    loading: boolean;
    error: string | null;
    queryKey: string;
    page: number;
    params: Record<string, string | number | undefined>;
  };
  draft: ComposerDraft;
  draftVersion: number;
  filters: PlaygroundFilterState;
  selectedUid: string | null;
  starredTakeUids: string[];
  workbenchOpen: boolean;
  everOpened: boolean;
  inlineOpen: boolean;
  activeSubTab: PlaygroundSubTab;
  workbenchMediumTab: "library" | "inspect";
  busyAction: string | null;
  lastSttResult: (PlaygroundSttResult & { sourceLabel?: string; taskId?: string }) | null;
}

const STAR_STORAGE_KEY = "mc_voice_playground_take_stars_v1";

const FALLBACK_MODELS: PlaygroundModelInfo[] = [
  {
    model_id: "eleven_v4",
    name: "Eleven v4",
    description:
      "Expressive flagship model with inline [audio tags], multi-speaker context & timing",
    can_do_text_to_speech: true,
    can_do_voice_conversion: false,
    can_use_style: false,
    can_use_speaker_boost: false,
    supports_context: true,
    supports_speed: false,
    supports_similarity: true,
    maximum_text_length_per_request: 10000,
    model_rates: { character_cost_multiplier: 1 },
    languages: [{ language_id: "en", name: "English" }],
  },
];

const readStarredTakes = (): string[] => {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(STAR_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

const writeStarredTakes = (uids: readonly string[]) => {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STAR_STORAGE_KEY, JSON.stringify(uids));
  } catch {
    /* ignore quota/private mode errors */
  }
};

const parseSsePayload = (raw?: string): Record<string, unknown> | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const upsertById = <T extends { id: string }>(
  list: readonly T[],
  entry: T,
  prepend = true,
): T[] => {
  const idx = list.findIndex((x) => x.id === entry.id);
  if (idx === -1) return prepend ? [entry, ...list] : [...list, entry];
  const next = [...list];
  next[idx] = entry;
  return next;
};

const JOB_STAGE_ORDER: Record<string, number> = {
  pending: 0,
  processing: 1,
  downloading: 2,
  completed: 3,
  failed: 3,
};

const mergeJobsById = (
  existing: readonly PlaygroundJob[],
  incoming: readonly PlaygroundJob[],
): PlaygroundJob[] => {
  const byId = new Map<string, PlaygroundJob>(existing.map((j) => [j.id, j]));
  for (let i = incoming.length - 1; i >= 0; i--) {
    const job = incoming[i];
    if (!job?.id) continue;
    const prev = byId.get(job.id);
    if (prev) {
      const prevRank = JOB_STAGE_ORDER[prev.status] ?? 0;
      const nextRank = JOB_STAGE_ORDER[job.status] ?? 0;
      if (
        nextRank < prevRank ||
        (nextRank === prevRank && (job.progress ?? 0) < (prev.progress ?? 0))
      ) {
        continue;
      }
    }
    byId.set(job.id, job);
  }
  return Array.from(byId.values())
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 40);
};

let state: VoicePlaygroundClientState = {
  loaded: false,
  loading: false,
  error: null,
  status: {
    configured: false,
    source: "none",
    maskedKey: "",
    apiBase: "https://api.genvoice.pro/v1",
    hasOverride: false,
    account: null,
  },
  catalog: {
    models: FALLBACK_MODELS,
    languages: [{ code: "en", name: "English" }],
    defaultVoices: [],
    liveSynced: false,
  },
  items: [],
  jobs: [],
  remoteHistory: {
    items: [],
    hasMore: false,
    loading: false,
    error: null,
    warning: null,
    page: 0,
  },
  sharedSearch: {
    voices: [],
    hasMore: false,
    loading: false,
    error: null,
    queryKey: "",
    page: 0,
    params: {},
  },
  draft: DEFAULT_COMPOSER_DRAFT,
  draftVersion: 0,
  filters: DEFAULT_PLAYGROUND_FILTERS,
  selectedUid: null,
  starredTakeUids: readStarredTakes(),
  workbenchOpen: false,
  everOpened: false,
  inlineOpen: false,
  activeSubTab: "create",
  workbenchMediumTab: "library",
  busyAction: null,
  lastSttResult: null,
};

const subs = new Set<() => void>();
let consumers = 0;
let inflightLoad: Promise<void> | null = null;
let sharedSearchSeq = 0;
let didAutoVerifyAccount = false;

const notify = () => {
  for (const fn of subs) fn();
};

const patchState = (partial: Partial<VoicePlaygroundClientState>) => {
  state = { ...state, ...partial };
  notify();
};

const requestedJobIds = new Set<string>();
const jobMatchesItem = (job: PlaygroundJob, item: VoicePlaygroundItem) =>
  job.id === item.id ||
  job.itemId === item.id ||
  Boolean(item.remoteTaskId && job.remoteTaskId === item.remoteTaskId);

const acceptSubmittedJobs = (created: PlaygroundJob[]) => {
  const jobs = mergeJobsById(state.jobs, created);
  let selectedUid = state.selectedUid;
  for (const submitted of created) {
    const job = jobs.find((j) => j.id === submitted.id) ?? submitted;
    const item = state.items.find((i) => jobMatchesItem(job, i));
    requestedJobIds.delete(job.id);
    if (item) {
      if (state.activeSubTab === "create") selectedUid = playgroundAuditionId(item.id);
    } else if (job.status !== "failed") {
      requestedJobIds.add(job.id);
    }
  }
  patchState({ busyAction: null, jobs, selectedUid });
};

const fetchJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(url, init);
  const raw = await res.text().catch(() => "");
  let data: (T & { error?: unknown }) | null = null;
  try {
    data = raw ? (JSON.parse(raw) as T & { error?: unknown }) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = data?.error;
    const issueMsg =
      err &&
      typeof err === "object" &&
      "issues" in err &&
      Array.isArray((err as { issues?: Array<{ message?: string }> }).issues)
        ? (err as { issues: Array<{ message?: string }> }).issues[0]?.message
        : undefined;
    const msg =
      typeof err === "string" && err
        ? err
        : issueMsg || (raw.trim() ? raw.trim().slice(0, 200) : `Request failed (${res.status})`);
    throw new Error(msg);
  }
  return (data ?? {}) as T;
};

const registerCatalogVoices = (voices: readonly PlaygroundVoiceOption[]) => {
  if (!voices.length) return;
  registerVoiceNames(voices.map((v) => ({ id: v.id, name: v.name })));
};

export const getPlaygroundItemByAuditionId = (auditionId: string): VoicePlaygroundItem | null => {
  if (!auditionId.startsWith("pg:")) return null;
  const id = auditionId.slice(3);
  return state.items.find((x) => x.id === id) ?? null;
};

let loadSeq = 0;

export const loadPlaygroundAll = async (opts?: { refresh?: boolean; liveStatus?: boolean }) => {
  if (inflightLoad && !opts?.refresh && !opts?.liveStatus) return inflightLoad;
  const seq = ++loadSeq;
  let active: Promise<void> | null = null;
  const run = (async () => {
    patchState({ loading: true, error: null });
    try {
      const [status, catalog, itemsPayload] = await Promise.all([
        fetchJson<PlaygroundStatus>(
          opts?.liveStatus ? "/api/voice/playground/status?live=1" : "/api/voice/playground/status",
        ),
        fetchJson<VoicePlaygroundClientState["catalog"]>(
          opts?.refresh
            ? "/api/voice/playground/catalog?refresh=1"
            : "/api/voice/playground/catalog",
        ),
        fetchJson<{ items: VoicePlaygroundItem[]; jobs: PlaygroundJob[] }>(
          "/api/voice/playground/items",
        ),
      ]);
      if (seq !== loadSeq) return;
      registerCatalogVoices(catalog.defaultVoices ?? []);
      const items = itemsPayload.items ?? [];
      const selectedUid =
        state.selectedUid ?? (items.length > 0 ? playgroundAuditionId(items[0].id) : null);
      patchState({
        loaded: true,
        loading: false,
        error: null,
        status,
        catalog,
        items,
        jobs: mergeJobsById(state.jobs, itemsPayload.jobs ?? []),
        selectedUid,
      });
      if (status.configured && !status.account && !opts?.liveStatus && !didAutoVerifyAccount) {
        didAutoVerifyAccount = true;
        void fetchJson<PlaygroundStatus>("/api/voice/playground/status?live=1")
          .then((liveSt) => {
            if (seq !== loadSeq) return;
            if (liveSt && (liveSt.account || liveSt.error)) {
              patchState({ status: liveSt });
            }
          })
          .catch((e) => {
            if (seq !== loadSeq || state.status.account) return;
            patchState({
              status: {
                ...state.status,
                error: e instanceof Error ? e.message : "Could not verify GenVoice API key",
              },
            });
          });
      }
    } catch (e) {
      if (seq !== loadSeq) return;
      patchState({
        loading: false,
        error: e instanceof Error ? e.message : "Could not load Voice Playground",
      });
    } finally {
      if (inflightLoad === active) inflightLoad = null;
    }
  })();
  active = run;
  inflightLoad = run;
  return run;
};

const stopDeletedAudition = (id: string) => {
  const removedUid = playgroundAuditionId(id);
  if (auditionTarget() === removedUid || listening() === removedUid) {
    stopAudition();
  }
};

const removeItemState = (id: string) => {
  const nextItems = state.items.filter((x) => x.id !== id);
  const removedUid = playgroundAuditionId(id);
  return {
    items: nextItems,
    selectedUid:
      state.selectedUid === removedUid
        ? nextItems[0]
          ? playgroundAuditionId(nextItems[0].id)
          : null
        : state.selectedUid,
    remoteHistory: {
      ...state.remoteHistory,
      items: state.remoteHistory.items.map((r) =>
        r.importedItemId === id ? { ...r, importedItemId: null } : r,
      ),
    },
  };
};

export const handleVoicePlaygroundEvent = (raw?: string) => {
  const payload = parseSsePayload(raw);
  if (!payload) {
    if (consumers > 0 || state.loaded) void loadPlaygroundAll();
    return;
  }
  switch (payload.type) {
    case "status": {
      if (payload.status && typeof payload.status === "object") {
        patchState({ status: payload.status as PlaygroundStatus });
      }
      break;
    }
    case "account": {
      patchState({
        status: {
          ...state.status,
          account: (payload.account as PlaygroundAccountInfo | null) ?? state.status.account,
        },
      });
      break;
    }
    case "job": {
      const job = payload.job as PlaygroundJob | undefined;
      if (!job?.id) break;
      if (job.status === "failed") requestedJobIds.delete(job.id);
      patchState({ jobs: mergeJobsById(state.jobs, [job]) });
      break;
    }
    case "item": {
      const item = payload.item as VoicePlaygroundItem | undefined;
      if (!item?.id) break;
      const items = upsertById(state.items, item, true);
      const requestedJob = state.jobs.find(
        (job) => requestedJobIds.has(job.id) && jobMatchesItem(job, item),
      );
      if (requestedJob) requestedJobIds.delete(requestedJob.id);
      const shouldSelect =
        !state.selectedUid || Boolean(requestedJob && state.activeSubTab === "create");
      patchState({
        items,
        selectedUid: shouldSelect ? playgroundAuditionId(item.id) : state.selectedUid,
      });
      break;
    }
    case "deleted": {
      const id = typeof payload.id === "string" ? payload.id : "";
      if (!id) break;
      stopDeletedAudition(id);
      patchState(removeItemState(id));
      break;
    }
    default: {
      if (consumers > 0 || state.loaded) void loadPlaygroundAll();
    }
  }
};

export const savePlaygroundConfig = async (cfg: {
  apiKey?: string;
  apiBase?: string;
  clearOverride?: boolean;
}) => {
  patchState({ busyAction: "config" });
  try {
    const status = await fetchJson<PlaygroundStatus>("/api/voice/playground/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cfg),
    });
    patchState({ status, busyAction: null });
    if (status.error) {
      say(status.error);
      return status;
    }
    if (status.configured) void loadPlaygroundAll({ refresh: true });
    say(
      cfg.clearOverride
        ? "Reverted to automatic GenVoice environment key"
        : status.configured
          ? "GenVoice Playground key verified"
          : "GenVoice Playground config saved",
    );
    return status;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not save API config";
    patchState({ busyAction: null });
    say(msg);
    throw e;
  }
};

export const testPlaygroundConnection = async () => {
  patchState({ busyAction: "status-test" });
  try {
    await loadPlaygroundAll({ refresh: true, liveStatus: true });
    patchState({ busyAction: null });
    say(
      state.status.account
        ? `Connected (${state.status.account.credit_balance.toLocaleString()} credits)`
        : state.status.error || "Checked GenVoice connection",
    );
  } catch {
    patchState({ busyAction: null });
  }
};

export const searchLiveSharedVoices = async (
  params: Record<string, string | number | undefined>,
  opts?: { append?: boolean },
) => {
  const normalized: Record<string, string | number | undefined> = { ...params };
  if (normalized.page_size !== undefined && normalized.pageSize === undefined) {
    normalized.pageSize = normalized.page_size;
  }
  delete normalized.page_size;
  if (normalized.pageSize === undefined) normalized.pageSize = 40;
  const pageNum = Math.max(0, Math.trunc(Number(normalized.page ?? 0) || 0));
  normalized.page = pageNum;

  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(normalized)) {
    if (v !== undefined && String(v).trim() !== "") sp.set(k, String(v).trim());
  }
  const queryKey = sp.toString();
  const reqId = ++sharedSearchSeq;
  patchState({
    sharedSearch: {
      ...state.sharedSearch,
      ...(opts?.append ? {} : { voices: [] }),
      loading: true,
      error: null,
      queryKey,
      page: pageNum,
      params: normalized,
    },
  });
  try {
    const res = await fetchJson<{ voices: PlaygroundVoiceOption[]; hasMore: boolean }>(
      `/api/voice/playground/shared-voices?${queryKey}`,
    );
    if (reqId !== sharedSearchSeq) return;
    registerCatalogVoices(res.voices ?? []);
    const incoming = res.voices ?? [];
    const mergedVoices = opts?.append
      ? [
          ...state.sharedSearch.voices,
          ...incoming.filter((v) => !state.sharedSearch.voices.some((x) => x.id === v.id)),
        ]
      : incoming;
    patchState({
      sharedSearch: {
        voices: mergedVoices,
        hasMore: Boolean(res.hasMore),
        loading: false,
        error: null,
        queryKey,
        page: pageNum,
        params: normalized,
      },
    });
  } catch (e) {
    if (reqId !== sharedSearchSeq) return;
    patchState({
      sharedSearch: {
        ...state.sharedSearch,
        loading: false,
        error: e instanceof Error ? e.message : "Live voice search failed",
      },
    });
  }
};

export const loadMoreSharedVoices = async () => {
  if (state.sharedSearch.loading || !state.sharedSearch.hasMore) return;
  const nextPage = state.sharedSearch.page + 1;
  return searchLiveSharedVoices({ ...state.sharedSearch.params, page: nextPage }, { append: true });
};

export const setComposerDraft = (
  updater: Partial<ComposerDraft> | ((prev: ComposerDraft) => ComposerDraft),
) => {
  const nextDraft =
    typeof updater === "function" ? updater(state.draft) : { ...state.draft, ...updater };
  const normalizedDraft =
    nextDraft.mode !== state.draft.mode && nextDraft.mode !== "stt"
      ? {
          ...nextDraft,
          modelId: resolveModeModelId(nextDraft.mode, nextDraft.modelId, state.catalog.models),
        }
      : nextDraft;
  patchState({ draft: normalizedDraft });
};

export const setPlaygroundFilters = (
  updater:
    Partial<PlaygroundFilterState> | ((prev: PlaygroundFilterState) => PlaygroundFilterState),
) => {
  const nextFilters =
    typeof updater === "function" ? updater(state.filters) : { ...state.filters, ...updater };
  patchState({ filters: nextFilters });
};

export const selectPlaygroundUid = (uid: string | null) => {
  patchState({ selectedUid: uid });
};

export const setPlaygroundSubTab = (activeSubTab: PlaygroundSubTab) => {
  patchState({
    activeSubTab,
    ...(activeSubTab === "library" || activeSubTab === "remote" || activeSubTab === "inspect"
      ? { workbenchMediumTab: activeSubTab === "inspect" ? "inspect" : "library" }
      : {}),
  });
};

export const setWorkbenchMediumTab = (workbenchMediumTab: "library" | "inspect") => {
  patchState({ workbenchMediumTab });
};

export const setPlaygroundInlineOpen = (inlineOpen: boolean) => {
  patchState({ inlineOpen });
  if (inlineOpen && !state.loaded) void loadPlaygroundAll();
};

export const setPlaygroundWorkbenchOpen = (workbenchOpen: boolean) => {
  patchState({ workbenchOpen, ...(workbenchOpen ? { everOpened: true } : {}) });
  if (workbenchOpen) {
    set({ modal: "voicePlayground" });
    if (!state.loaded) void loadPlaygroundAll();
  } else {
    set((s) => (s.modal === "voicePlayground" ? { modal: null } : {}));
  }
};

export const openVoicePlaygroundWith = (
  preset: Partial<ComposerDraft> & { openWorkbench?: boolean; openInline?: boolean },
) => {
  const { openWorkbench = true, openInline = false, ...draftPreset } = preset;
  patchState({
    draft: { ...DEFAULT_COMPOSER_DRAFT, ...draftPreset },
    draftVersion: state.draftVersion + 1,
    activeSubTab: "create",
    ...(openInline ? { inlineOpen: true } : {}),
  });
  if (openWorkbench) {
    setPlaygroundWorkbenchOpen(true);
  } else if (!state.loaded) {
    void loadPlaygroundAll();
  }
};

const activeModelById = (modelId: string): PlaygroundModelInfo | undefined =>
  state.catalog.models.find((m) => m.model_id === modelId);

const parseOptionalSeed = (seedText: string): number | undefined => {
  const trimmed = seedText.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 0 && n <= 4294967295 ? n : undefined;
};

export const generateFromComposer = async (opts?: {
  audioFile?: File | null;
  sourceItemId?: string;
  sourceTakeKind?: "takes" | "try";
  sourceTakeFile?: string;
}) => {
  const d = state.draft;
  if (d.mode === "stt") return;
  patchState({ busyAction: "generate", error: null, activeSubTab: "create" });
  try {
    const parsedSeed = parseOptionalSeed(d.seedText);
    if (d.mode === "tts") {
      const ttsModelId = resolveModeModelId("tts", d.modelId, state.catalog.models);
      const modelMeta = activeModelById(ttsModelId);
      const res = await fetchJson<{ jobs: PlaygroundJob[] }>("/api/voice/playground/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          voiceId: d.voiceId,
          voiceName: d.voiceName,
          modelId: ttsModelId,
          languageCode: d.languageCode || detectTextLanguage(d.text),
          text: d.text,
          voiceSettings: voiceSettingsForModel(modelMeta, d),
          ...(modelMeta?.supports_context !== false && d.previousText.trim()
            ? { previousText: d.previousText.trim() }
            : {}),
          ...(modelMeta?.supports_context !== false && d.nextText.trim()
            ? { nextText: d.nextText.trim() }
            : {}),
          ...(parsedSeed !== undefined ? { seed: parsedSeed } : {}),
          ...(d.outputFormat.trim() ? { outputFormat: d.outputFormat.trim() } : {}),
          ...(d.applyTextNormalization !== "auto"
            ? { applyTextNormalization: d.applyTextNormalization }
            : {}),
          exportTranscript: d.exportTranscript,
          variations: d.variations,
          name: d.title.trim() || undefined,
          notes: d.notes.trim() || undefined,
          sourceTakeId: d.sourceTakeId,
          fromTemplateId: d.fromTemplateId,
        }),
      });
      acceptSubmittedJobs(res.jobs ?? []);
      say(
        d.variations > 1
          ? `Generating ${d.variations} voice variations…`
          : `Generating voice with ${d.voiceName}…`,
      );
      return;
    }

    if (d.mode === "dialogue") {
      const normalizedText = stripDialogueSpeakerBrackets(d.text).trim();
      const defaultLang = detectTextLanguage(normalizedText);
      const speakers: Record<
        string,
        {
          voice_id: string;
          voice_name?: string;
          model_id?: string;
          language_code?: string;
          voice_settings: PlaygroundVoiceSettings;
        }
      > = Object.create(null);
      for (const sp of d.speakers) {
        const key = sp.name.trim();
        if (
          !key ||
          key === "__proto__" ||
          key === "constructor" ||
          key === "prototype" ||
          !sp.voiceId.trim()
        ) {
          continue;
        }
        const spModelId = resolveModeModelId(
          "dialogue",
          sp.modelId || d.modelId,
          state.catalog.models,
        );
        speakers[key] = {
          voice_id: sp.voiceId.trim(),
          voice_name: sp.voiceName,
          model_id: spModelId,
          language_code: sp.languageCode || d.languageCode || defaultLang,
          voice_settings: voiceSettingsForModel(activeModelById(spModelId), sp),
        };
      }
      const speakerKeys = Object.keys(speakers);
      const matchedTurns = parseDialogueTurnNames(normalizedText).filter((n) =>
        Object.prototype.hasOwnProperty.call(speakers, n),
      );
      if (speakerKeys.length < 2 || matchedTurns.length < 2) {
        const msg =
          'GenVoice Dialogue requires at least 2 speakers and "SpeakerName: line" turns matching them.';
        patchState({ busyAction: null, error: msg });
        say(msg);
        return;
      }
      const res = await fetchJson<{ job: PlaygroundJob }>("/api/voice/playground/dialogue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: normalizedText,
          speakers,
          pause_between_turns: d.pauseBetweenTurns,
          exportTranscript: d.exportTranscript,
          name: d.title.trim() || undefined,
          notes: d.notes.trim() || undefined,
        }),
      });
      acceptSubmittedJobs(res.job ? [res.job] : []);
      say(`Generating ${speakerKeys.length}-speaker dialogue…`);
      return;
    }

    // Voice Changer (STS)
    const stsModel = resolveModeModelId("voice_changer", d.modelId, state.catalog.models);
    const stsSettings = voiceSettingsForModel(activeModelById(stsModel), d);
    const resolvedTakeParts = d.vcSourceTakeValue ? d.vcSourceTakeValue.split(":") : [];
    const fallbackTakeKind =
      d.vcSourceKind === "film_take" &&
      (resolvedTakeParts[0] === "takes" || resolvedTakeParts[0] === "try")
        ? (resolvedTakeParts[0] as "takes" | "try")
        : undefined;
    const fallbackTakeFile = fallbackTakeKind ? resolvedTakeParts.slice(1).join(":") : undefined;
    const sourceItemId =
      opts?.sourceItemId ??
      (d.vcSourceKind === "playground" && d.vcSourceItemId ? d.vcSourceItemId : undefined);
    const sourceTakeKind = opts?.sourceTakeKind ?? fallbackTakeKind;
    const sourceTakeFile = opts?.sourceTakeFile ?? fallbackTakeFile;

    let res: { job: PlaygroundJob };
    if (opts?.audioFile) {
      const form = new FormData();
      form.set("audio", opts.audioFile);
      form.set("voiceId", d.voiceId);
      form.set("voiceName", d.voiceName);
      form.set("modelId", stsModel);
      form.set("removeBackgroundNoise", String(d.removeBackgroundNoise));
      form.set("voiceSettings", JSON.stringify(stsSettings));
      if (parsedSeed !== undefined) form.set("seed", String(parsedSeed));
      if (d.title.trim()) form.set("name", d.title.trim());
      if (d.notes.trim()) form.set("notes", d.notes.trim());
      res = await fetchJson<{ job: PlaygroundJob }>("/api/voice/playground/voice-changer", {
        method: "POST",
        body: form,
      });
    } else {
      res = await fetchJson<{ job: PlaygroundJob }>("/api/voice/playground/voice-changer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceItemId,
          sourceFile: d.vcSourceKind === "upload" ? d.vcSourceFile || undefined : undefined,
          sourceTakeKind,
          sourceTakeFile,
          voiceId: d.voiceId,
          voiceName: d.voiceName,
          modelId: stsModel,
          removeBackgroundNoise: d.removeBackgroundNoise,
          voiceSettings: stsSettings,
          ...(parsedSeed !== undefined ? { seed: parsedSeed } : {}),
          name: d.title.trim() || undefined,
          notes: d.notes.trim() || undefined,
        }),
      });
    }
    acceptSubmittedJobs(res.job ? [res.job] : []);
    say(`Converting voice to ${d.voiceName}…`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Voice generation failed";
    patchState({ busyAction: null, error: msg });
    say(msg);
  }
};

export const runPlaygroundStt = async (opts: {
  file?: File | null;
  itemId?: string;
  sourceTakeKind?: "takes" | "try";
  sourceTakeFile?: string;
  languageCode?: string;
  timestampsGranularity?: "none" | "word" | "character";
  diarize?: boolean;
  numSpeakers?: number;
  diarizationThreshold?: number;
  tagAudioEvents?: boolean;
  noVerbatim?: boolean;
  temperature?: number;
  seed?: number;
  fileFormat?: "pcm_s16le_16" | "other";
  useMultiChannel?: boolean;
  keyterms?: string[];
  entityDetection?: string[];
  entityRedaction?: string[];
  entityRedactionMode?: "redacted" | "entity_type" | "enumerated_entity_type";
  additionalFormats?: string[];
  sourceLabel?: string;
}) => {
  const langCode = (opts.languageCode ?? "en").trim();
  if (!langCode || langCode.toLowerCase() === "auto") {
    const msg =
      "Speech-to-Text (Scribe v2) requires an explicit language code (e.g. 'en', 'vi'); 'auto' is not supported.";
    patchState({ busyAction: null, error: msg });
    say(msg);
    return null;
  }
  patchState({ busyAction: "stt", error: null });
  try {
    let data: { taskId: string; sttResult: PlaygroundSttResult };
    if (opts.file) {
      const form = new FormData();
      form.set("file", opts.file);
      form.set("languageCode", langCode);
      if (opts.fileFormat) form.set("fileFormat", opts.fileFormat);
      if (opts.timestampsGranularity) form.set("timestampsGranularity", opts.timestampsGranularity);
      if (opts.diarize !== undefined) form.set("diarize", String(opts.diarize));
      if (opts.useMultiChannel !== undefined)
        form.set("useMultiChannel", String(opts.useMultiChannel));
      if (opts.numSpeakers !== undefined) form.set("numSpeakers", String(opts.numSpeakers));
      if (opts.diarizationThreshold !== undefined)
        form.set("diarizationThreshold", String(opts.diarizationThreshold));
      if (opts.tagAudioEvents !== undefined)
        form.set("tagAudioEvents", String(opts.tagAudioEvents));
      if (opts.noVerbatim !== undefined) form.set("noVerbatim", String(opts.noVerbatim));
      if (opts.temperature !== undefined) form.set("temperature", String(opts.temperature));
      if (opts.seed !== undefined) form.set("seed", String(opts.seed));
      for (const term of opts.keyterms ?? []) {
        const cleanTerm = term.trim().slice(0, 49);
        if (cleanTerm) form.append("keyterms", cleanTerm);
      }
      for (const cat of opts.entityDetection ?? []) {
        const cleanCat = cat.trim();
        if (cleanCat) form.append("entityDetection", cleanCat);
      }
      for (const cat of opts.entityRedaction ?? []) {
        const cleanCat = cat.trim();
        if (cleanCat) form.append("entityRedaction", cleanCat);
      }
      if (opts.entityRedactionMode) form.set("entityRedactionMode", opts.entityRedactionMode);
      if (opts.additionalFormats !== undefined) {
        const cleanFormats = opts.additionalFormats.map((fmt) => fmt.trim()).filter(Boolean);
        if (cleanFormats.length === 0) {
          form.set("additionalFormats", "[]");
        } else {
          for (const cleanFmt of cleanFormats) form.append("additionalFormats", cleanFmt);
        }
      }
      data = await fetchJson<{ taskId: string; sttResult: PlaygroundSttResult }>(
        "/api/voice/playground/stt",
        { method: "POST", body: form },
      );
    } else {
      data = await fetchJson<{ taskId: string; sttResult: PlaygroundSttResult }>(
        "/api/voice/playground/stt",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...opts, languageCode: langCode }),
        },
      );
    }
    const items = opts.itemId
      ? state.items.map((it) =>
          it.id === opts.itemId
            ? {
                ...it,
                sttResult: data.sttResult,
                srtText: data.sttResult.srtText ?? it.srtText,
              }
            : it,
        )
      : state.items;
    patchState({
      busyAction: null,
      items,
      lastSttResult: {
        ...data.sttResult,
        taskId: data.taskId,
        sourceLabel: opts.sourceLabel ?? opts.file?.name ?? opts.itemId ?? opts.sourceTakeFile,
      },
    });
    say("Transcription complete");
    return data.sttResult;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Speech-to-text failed";
    patchState({ busyAction: null, error: msg });
    say(msg);
    return null;
  }
};

export const patchPlaygroundItem = async (
  id: string,
  patch: {
    favorite?: boolean;
    isTemplate?: boolean;
    templateName?: string;
    title?: string;
    notes?: string;
    tags?: string[];
  },
) => {
  try {
    const res = await fetchJson<{ item: VoicePlaygroundItem }>(
      `/api/voice/playground/items/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      },
    );
    if (res.item) {
      patchState({ items: upsertById(state.items, res.item, false) });
    }
    return res.item;
  } catch (e) {
    say(e instanceof Error ? e.message : "Could not update Playground item");
    return null;
  }
};

export const toggleUnifiedFavorite = async (entry: UnifiedPlaygroundEntry) => {
  if (entry.origin === "playground" && entry.playgroundItem) {
    const nextFav = !entry.playgroundItem.favorite;
    await patchPlaygroundItem(entry.id, { favorite: nextFav });
    say(nextFav ? `Starred ${entry.title}` : `Unstarred ${entry.title}`);
    return;
  }
  const has = state.starredTakeUids.includes(entry.uid);
  const next = has
    ? state.starredTakeUids.filter((u) => u !== entry.uid)
    : [...state.starredTakeUids, entry.uid];
  writeStarredTakes(next);
  patchState({ starredTakeUids: next });
  say(has ? `Unstarred Take ${entry.id}` : `Starred Take ${entry.id}`);
};

export const deletePlaygroundItem = async (id: string) => {
  if (state.busyAction === `delete:${id}`) return;
  patchState({ busyAction: `delete:${id}` });
  try {
    await fetchJson<{ ok: boolean }>(`/api/voice/playground/items/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    stopDeletedAudition(id);
    patchState({
      busyAction: null,
      ...removeItemState(id),
    });
    say("Deleted playground voice clip");
  } catch (e) {
    patchState({ busyAction: null });
    say(e instanceof Error ? e.message : "Could not delete clip");
  }
};

export const duplicateEntryToComposer = (
  entry: UnifiedPlaygroundEntry,
  opts?: {
    overrideVoice?: { id: string; name: string; speakerKey?: string };
    switchToCreate?: boolean;
  },
) => {
  const nextDraft = entryToComposerDraft(entry, opts?.overrideVoice);
  patchState({
    draft: nextDraft,
    draftVersion: state.draftVersion + 1,
    ...(opts?.switchToCreate !== false ? { activeSubTab: "create" as const } : {}),
  });
  say(
    opts?.overrideVoice
      ? `Loaded template with voice ${opts.overrideVoice.name}`
      : `Duplicated ${entry.title} to Editor`,
  );
};

export const resetComposerDraft = (mode: ComposerDraft["mode"] = state.draft.mode) => {
  patchState({
    draft: {
      ...DEFAULT_COMPOSER_DRAFT,
      mode,
      modelId:
        mode === "voice_changer" ? "eleven_multilingual_sts_v2" : DEFAULT_COMPOSER_DRAFT.modelId,
    },
    draftVersion: state.draftVersion + 1,
  });
};

export const retryWithVoiceSwap = async (
  itemId: string,
  overrides: {
    voiceId?: string;
    voiceName?: string;
    speakerKey?: string;
    modelId?: string;
    languageCode?: string;
    text?: string;
    voiceSettings?: PlaygroundVoiceSettings;
    exportTranscript?: boolean;
    variations?: number;
    name?: string;
    notes?: string;
  },
) => {
  patchState({ busyAction: `retry:${itemId}`, activeSubTab: "create" });
  try {
    const res = await fetchJson<{ job?: PlaygroundJob; jobs?: PlaygroundJob[] }>(
      `/api/voice/playground/items/${encodeURIComponent(itemId)}/retry`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(overrides),
      },
    );
    const created = res.jobs ?? (res.job ? [res.job] : []);
    acceptSubmittedJobs(created);
    say(
      overrides.voiceName
        ? `Regenerating with ${overrides.voiceName}…`
        : "Regenerating take with saved settings…",
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Retry failed";
    patchState({ busyAction: null });
    say(msg);
  }
};

export const loadRemoteHistory = async (page = 0) => {
  patchState({
    remoteHistory: { ...state.remoteHistory, loading: true, error: null },
  });
  try {
    const res = await fetchJson<{
      items: RemoteHistoryEntry[];
      hasMore: boolean;
      warning?: string;
    }>(`/api/voice/playground/remote-history?page=${page}&pageSize=30`);
    const incoming = res.items ?? [];
    const seen = new Set(state.remoteHistory.items.map((x) => x.id));
    const items =
      page === 0
        ? incoming
        : [...state.remoteHistory.items, ...incoming.filter((x) => !seen.has(x.id))];
    patchState({
      remoteHistory: {
        items,
        hasMore: Boolean(res.hasMore),
        loading: false,
        error: null,
        warning: res.warning ?? null,
        page,
      },
    });
  } catch (e) {
    patchState({
      remoteHistory: {
        ...state.remoteHistory,
        loading: false,
        error: e instanceof Error ? e.message : "Could not load GenVoice 24h history",
      },
    });
  }
};

export const importRemoteHistoryTask = async (
  taskId: string,
  kind?: "tts" | "dialogue" | "voice_changer",
) => {
  patchState({ busyAction: `import:${taskId}` });
  try {
    const res = await fetchJson<{ item: VoicePlaygroundItem; alreadyImported: boolean }>(
      "/api/voice/playground/remote-history/import",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId, kind }),
      },
    );
    const items = res.item ? upsertById(state.items, res.item, true) : state.items;
    const remoteItems = state.remoteHistory.items.map((r) =>
      r.id === taskId ? { ...r, importedItemId: res.item?.id ?? r.importedItemId } : r,
    );
    patchState({
      busyAction: null,
      items,
      selectedUid: res.item ? playgroundAuditionId(res.item.id) : state.selectedUid,
      remoteHistory: { ...state.remoteHistory, items: remoteItems },
    });
    say(res.alreadyImported ? "Already saved in Playground" : "Imported from GenVoice cloud");
    return res.item;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Import failed";
    patchState({ busyAction: null });
    say(msg);
    return null;
  }
};

export const promotePlaygroundToTake = async (itemId: string, takeId: string): Promise<boolean> => {
  patchState({ busyAction: `promote:${itemId}` });
  try {
    const res = await fetchJson<{ ok: true; takeId: string; tryFile: string }>(
      "/api/voice/playground/promote",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId, takeId }),
      },
    );
    patchState({ busyAction: null });
    await loadVoiceTakes();
    say(`Added to Take ${res.takeId} alternatives (${res.tryFile})`);
    return true;
  } catch (e) {
    patchState({ busyAction: null });
    say(e instanceof Error ? e.message : "Could not send to film take");
    return false;
  }
};

export const fetchPlaygroundSrt = async (
  itemId: string,
  srtFile: string,
): Promise<string | null> => {
  try {
    const res = await fetch(`/api/voice/playground/srt/${encodeURIComponent(srtFile)}`);
    if (!res.ok) return null;
    const srtText = await res.text();
    patchState({
      items: state.items.map((it) => (it.id === itemId ? { ...it, srtText } : it)),
    });
    return srtText;
  } catch {
    return null;
  }
};

export const getPlaygroundSnapshot = (): VoicePlaygroundClientState => state;

const subscribePlayground = (fn: () => void) => {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
};

const identitySelector = (s: VoicePlaygroundClientState): VoicePlaygroundClientState => s;

export const useVoicePlaygroundSelector = <T>(
  selector: (s: VoicePlaygroundClientState) => T,
  enabled = true,
): T => {
  const cacheRef = useRef<{
    hasValue: boolean;
    state: VoicePlaygroundClientState;
    selector: (s: VoicePlaygroundClientState) => T;
    value: T;
  } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    consumers++;
    if (!state.loaded && !state.loading) {
      void loadPlaygroundAll();
    }
    return () => {
      consumers = Math.max(0, consumers - 1);
    };
  }, [enabled]);
  return useSyncExternalStore(
    subscribePlayground,
    () => {
      const cached = cacheRef.current;
      if (cached && cached.hasValue && cached.state === state && cached.selector === selector) {
        return cached.value;
      }
      const nextVal = selector(state);
      if (cached && cached.hasValue && Object.is(nextVal, cached.value)) {
        cacheRef.current = {
          hasValue: true,
          state,
          selector,
          value: cached.value,
        };
        return cached.value;
      }
      cacheRef.current = {
        hasValue: true,
        state,
        selector,
        value: nextVal,
      };
      return nextVal;
    },
    () => selector(state),
  );
};

export const useVoicePlayground = (enabled = true): VoicePlaygroundClientState =>
  useVoicePlaygroundSelector(identitySelector, enabled);
