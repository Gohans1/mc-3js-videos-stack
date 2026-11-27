import { useEffect, useRef, useSyncExternalStore } from "react";

import { createToastManager, showUndo } from "@/components/ui/toast";

import type {
  CloneSettings,
  CloudClone,
  PlaygroundClone,
} from "../../src/voice-playground-clones.mjs";
export { cloneVoiceOption } from "../../src/voice-playground-clone-view.mjs";

import { DUBBING_MODELS } from "../../src/voice-playground-dubbing-contract";
import { languageForProvider } from "../../src/voice-playground-providers.mjs";
import type {
  PlaygroundAccountInfo,
  PlaygroundConnection,
  PlaygroundJob,
  PlaygroundModelInfo,
  PlaygroundRegionInfo,
  PlaygroundRights,
  PlaygroundStatus,
  PlaygroundSttResult,
  PlaygroundTemplate,
  PlaygroundTtsBatchInput,
  PlaygroundTtsQuote,
  PlaygroundTtsRequest,
  PlaygroundUsage,
  PlaygroundVoiceOption,
  PlaygroundVoiceProfile,
  PlaygroundVoiceSettings,
  RegionEditInput,
  RemoteHistoryEntry,
  VoicePlaygroundItem,
} from "../../src/voice-playground.mjs";
import { S } from "../core/state";
import { say, set } from "../core/store";
import { auditionTarget, listening, listenUrl, stopAudition } from "./sound";
import { loadVoiceTakes, promoteVoiceTry } from "./voice-client";
import { acceptDubbingJob, loadDubbingJobs, onDubbingNotice } from "./voice-dubbing-client";
import {
  castingAuditionId,
  composeFilmTakeRemixPreset,
  type ComposerDraft,
  DEFAULT_COMPOSER_DRAFT,
  DEFAULT_PLAYGROUND_FILTERS,
  detectTextLanguage,
  dialogueCastForConnection,
  dialogueJobToDraft,
  dialogueServiceModels,
  entryToComposerDraft,
  extractDialogueSpeakerEntries,
  isSafeAudioUrl,
  parseDialogueTurnNames,
  playgroundAuditionId,
  type PlaygroundFilterState,
  resolveModeModelId,
  speechJobToDraft,
  stripDialogueSpeakerBrackets,
  type UnifiedPlaygroundEntry,
  visibleSpeechModel,
  voiceSettingsForModel,
  withComposerVoice,
  withDialogueVoice,
} from "./voice-playground-view";
import type { VoiceTakeItem } from "./voice-view";
import { registerVoiceNames } from "./voice-view";

export type PlaygroundSubTab =
  "create" | "library" | "inspect" | "remote" | "voices" | "jobs" | "compare" | "help";
export type CastingTarget =
  { mode: "tts" | "voice_changer" | "dubbing" } | { mode: "dialogue"; speakerId: string };
onDubbingNotice(say);

export type DirectPlaygroundConnection = Exclude<PlaygroundConnection, "genvoice">;

export type PlaygroundCatalog = {
  models: PlaygroundModelInfo[];
  languages: Array<{ code: string; name: string }>;
  providerLanguages?: Partial<
    Record<NonNullable<PlaygroundVoiceOption["provider"]>, Array<{ code: string; name: string }>>
  >;
  defaultVoices: PlaygroundVoiceOption[];
  liveSynced: boolean;
  error?: string;
};

export type PlaygroundLoadState =
  | { status: "idle" }
  | { status: "loading"; loaded: boolean }
  | { status: "ready" }
  | { status: "error"; loaded: boolean; error: string };

export type ServiceCatalogState =
  | { status: "loading"; seq: number; catalog?: PlaygroundCatalog }
  | { status: "ready"; seq: number; catalog: PlaygroundCatalog }
  | { status: "error"; seq: number; error: string; catalog?: PlaygroundCatalog };

export type RemoteHistoryState = (
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; error: string }
) & {
  items: RemoteHistoryEntry[];
  hasMore: boolean;
  warning?: string | null;
  page: number;
};

export type SharedSearchState = (
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; error: string }
) & {
  voices: PlaygroundVoiceOption[];
  hasMore: boolean;
  queryKey: string;
  page: number;
  nextPageToken?: string;
  params: Record<string, string | number | undefined>;
};

export type ClonesLoadState =
  | { status: "idle"; error: string | null }
  | { status: "loading" };

export type CloneCloudState =
  | { status: "ok" }
  | { status: "error"; error: string };

export type PlaygroundBusyAction =
  | "config"
  | "status-test"
  | "generate"
  | "stt"
  | "source"
  | "duplicate"
  | "template"
  | `delete:${string}`
  | `retry:${string}`
  | `import:${string}`
  | `promote:${string}`
  | `copy:${string}`
  | `archive:${string}`
  | `use:${string}`;

export const isPlaygroundLoaded = (s: Pick<VoicePlaygroundClientState, "loadState">): boolean =>
  s.loadState.status === "ready" || (s.loadState.status !== "idle" && s.loadState.loaded);

export const serviceCatalogDataOf = (
  s: Pick<VoicePlaygroundClientState, "serviceCatalogs">,
  connection: DirectPlaygroundConnection,
): PlaygroundCatalog | undefined => s.serviceCatalogs?.[connection]?.catalog;

export interface VoicePlaygroundClientState {
  castingTarget?: CastingTarget | null;
  clones?: PlaygroundClone[];
  clonesState: ClonesLoadState;
  cloneCloudState: CloneCloudState;
  previewVoice?: PlaygroundVoiceOption;
  regionEditor: {
    item: VoicePlaygroundItem;
    returnToWorkbench: boolean;
    filmSource?: { takeId: string; audioUrl: string };
    openerId?: string;
    initialEdit?: RegionEditInput;
    revisionOf?: string;
    failedJobId?: string;
  } | null;
  scope: "project" | "global";
  libraryScope: "all" | "project" | "global";
  favoriteVoices: PlaygroundVoiceOption[];
  templates: PlaygroundTemplate[];
  usage: PlaygroundUsage[];
  targetTakeId: string;
  compareUids: string[];
  compareVoices?: PlaygroundVoiceOption[];
  recentSpeechBatch?: string;
  speechReviewBatchId?: string;
  previousComposerDraft?: {
    draft: ComposerDraft;
    scope: "project" | "global";
    reason?: "job-review";
  };
  loadState: PlaygroundLoadState;
  status: PlaygroundStatus;
  serviceCatalogs?: Partial<Record<DirectPlaygroundConnection, ServiceCatalogState>>;
  catalog: PlaygroundCatalog;
  items: VoicePlaygroundItem[];
  jobs: PlaygroundJob[];
  workbenchOpener?: HTMLElement | null;
  composerError?: { mode: ComposerDraft["mode"]; message: string };
  remoteHistory: RemoteHistoryState;
  sharedSearch: SharedSearchState;
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
  busyAction: PlaygroundBusyAction | null;
  sttSourceUpload?:
    | { status: "idle" }
    | { status: "uploading"; name: string }
    | { status: "failed"; name: string; error: string };
  lastSttResult: (PlaygroundSttResult & { sourceLabel?: string; taskId?: string }) | null;
}

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

const notifiedJobs = new Set<string>();

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
  clones: [],
  clonesState: { status: "idle", error: null },
  cloneCloudState: { status: "ok" },
  regionEditor: null,
  scope: "project",
  libraryScope: "all",
  favoriteVoices: [],
  templates: [],
  usage: [],
  targetTakeId: "",
  compareUids: [],
  loadState: { status: "idle" },
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
    status: "idle",
    items: [],
    hasMore: false,
    warning: null,
    page: 0,
  },
  sharedSearch: {
    status: "idle",
    voices: [],
    hasMore: false,
    queryKey: "",
    page: 0,
    params: {},
  },
  draft: DEFAULT_COMPOSER_DRAFT,
  draftVersion: 0,
  filters: DEFAULT_PLAYGROUND_FILTERS,
  selectedUid: null,
  starredTakeUids: [],
  workbenchOpen: false,
  everOpened: false,
  inlineOpen: false,
  activeSubTab: "create",
  workbenchMediumTab: "library",
  busyAction: null,
  lastSttResult: null,
};

type BootstrapLoadState =
  | { status: "idle"; seq: number }
  | { status: "loading"; seq: number; promise: Promise<void> };

const subs = new Set<() => void>();
let consumers = 0;
let bootstrapLoad: BootstrapLoadState = { status: "idle", seq: 0 };
const getBootstrapLoad = (): BootstrapLoadState => bootstrapLoad;
let sharedSearchSeq = 0;
let serviceCatalogSeq = 0;
let didAutoVerifyAccount = false;

const activeBusyActions = new Map<symbol, PlaygroundBusyAction>();
const hasBusyAction = (action: PlaygroundBusyAction): boolean => {
  for (const value of activeBusyActions.values()) {
    if (value === action) return true;
  }
  return false;
};
const latestBusyAction = (): PlaygroundBusyAction | null => {
  let last: PlaygroundBusyAction | null = null;
  for (const value of activeBusyActions.values()) last = value;
  return last;
};
const beginBusyAction = (action: PlaygroundBusyAction, extra?: Partial<VoicePlaygroundClientState>) => {
  const token = Symbol(action);
  activeBusyActions.set(token, action);
  patchState({ ...extra, busyAction: action });
  let released = false;
  return (finalPatch?: Partial<VoicePlaygroundClientState>) => {
    if (released) {
      if (finalPatch) patchState(finalPatch);
      return;
    }
    released = true;
    activeBusyActions.delete(token);
    patchState({ ...finalPatch, busyAction: latestBusyAction() });
  };
};
const releaseBusyByKind = (action: PlaygroundBusyAction) => {
  let removed = false;
  for (const [token, value] of activeBusyActions) {
    if (value === action) {
      activeBusyActions.delete(token);
      removed = true;
    }
  }
  if (removed) patchState({ busyAction: latestBusyAction() });
};

const notify = () => {
  for (const fn of subs) fn();
};

const patchState = (partial: Partial<VoicePlaygroundClientState>) => {
  state = {
    ...state,
    ...(partial.draft && partial.draft !== state.draft ? { composerError: undefined } : {}),
    ...partial,
  };
  if (partial.draft?.mode === "tts" && S.film) {
    try {
      localStorage.setItem(`voice-playground:speech:${S.film}`, JSON.stringify(partial.draft));
    } catch {}
  }
  notify();
};
let restoredDraftFor = "";
const restoreSpeechDraft = () => {
  if (!S.film || restoredDraftFor === S.film) return;
  restoredDraftFor = S.film;
  try {
    const saved = JSON.parse(localStorage.getItem(`voice-playground:speech:${S.film}`) ?? "null");
    if (saved?.mode === "tts" && typeof saved.text === "string" && state.draft.mode === "tts")
      patchState({ draft: { ...DEFAULT_COMPOSER_DRAFT, ...saved } });
  } catch {}
};

const requestedJobIds = new Map<string, "create" | "jobs">();
const jobMatchesItem = (job: PlaygroundJob, item: VoicePlaygroundItem) =>
  job.id === item.id ||
  job.itemId === item.id ||
  Boolean(item.remoteTaskId && job.remoteTaskId === item.remoteTaskId);

const acceptSubmittedJobs = (
  created: PlaygroundJob[],
  revealFrom: "create" | "jobs" = "create",
) => {
  const jobs = mergeJobsById(state.jobs, created);
  let selectedUid = state.selectedUid;
  let openRetry = false;
  for (const submitted of created) {
    const job = jobs.find((j) => j.id === submitted.id) ?? submitted;
    const item = state.items.find((i) => jobMatchesItem(job, i));
    requestedJobIds.delete(job.id);
    if (item) {
      if (state.activeSubTab === revealFrom) {
        selectedUid = playgroundAuditionId(item.id);
        openRetry = revealFrom === "jobs";
      }
    } else if (job.status !== "failed") {
      requestedJobIds.set(job.id, revealFrom);
    }
  }
  patchState({
    jobs,
    selectedUid,
    ...(openRetry ? { activeSubTab: "inspect", workbenchMediumTab: "inspect" } : {}),
  });
};

const fetchJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const requestScope = state.scope;
  const itemMatch = url.match(/\/(items|templates)\/([^/?]+)/);
  const itemScope = itemMatch
    ? [...state.items, ...state.templates].find(
        (item) => item.id === decodeURIComponent(itemMatch[2]!),
      )?.scope
    : undefined;
  const res = await fetch(playgroundScopedUrl(url, itemScope ?? requestScope), init);
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

export const openRecordingEditor = (
  item: VoicePlaygroundItem,
  recipe: {
    initialEdit?: RegionEditInput;
    revisionOf?: string;
    openerId?: string;
    failedJobId?: string;
    filmSource?: NonNullable<VoicePlaygroundClientState["regionEditor"]>["filmSource"];
  } = {},
) =>
  patchState({
    regionEditor: { item, ...recipe, returnToWorkbench: state.workbenchOpen },
  });
export const openFilmRecordingEditor = (entry: UnifiedPlaygroundEntry, openerId?: string) => {
  const take = entry.filmTake;
  if (!take?.file || !entry.audioUrl) return;
  const linked =
    entry.sourceRecording ??
    state.items.find(
      (item) =>
        item.id === take.playgroundItemId &&
        (item.scope ?? "project") === (take.playgroundScope ?? "project"),
    );
  if (linked) {
    openRecordingEditor(linked, { openerId });
    return;
  }
  const {
    title,
    text,
    tags,
    voiceId,
    voiceName,
    modelId,
    languageCode,
    voiceSettings,
    durationSeconds,
    favorite,
  } = entry;
  openRecordingEditor(
    {
      id: entry.uid,
      scope: "project",
      kind: "tts",
      title,
      text,
      tags,
      voiceId,
      voiceName,
      modelId,
      languageCode,
      voiceSettings,
      durationSeconds,
      favorite,
      audioFile: take.file,
      mimeType: "",
      bytes: 0,
      exportTranscript: false,
      provider: "elevenlabs",
      isTemplate: false,
      sourceTakeId: take.id,
      createdAt: "",
      updatedAt: "",
    },
    { openerId, filmSource: { takeId: take.id, audioUrl: entry.audioUrl } },
  );
};
export const closeRecordingEditor = () =>
  patchState({
    workbenchOpen: state.regionEditor?.returnToWorkbench ?? false,
    regionEditor: null,
  });
const regionUrl = (item: VoicePlaygroundItem, action: string) =>
  `/api/voice/playground/items/${encodeURIComponent(item.id)}/${action}?scope=${item.scope ?? "project"}`;
const filmRegionUrl = (takeId: string, action: string, sourceId?: string) =>
  `/api/voice/playground/film-takes/${encodeURIComponent(takeId)}/${action}${sourceId ? `?source=${encodeURIComponent(sourceId)}` : ""}`;
export const inspectFilmRecordingRegion = (takeId: string) =>
  fetchJson<{ info: PlaygroundRegionInfo; items: VoicePlaygroundItem[] }>(
    filmRegionUrl(takeId, "region"),
  );
export const inspectRecordingRegion = (item: VoicePlaygroundItem) =>
  fetchJson<PlaygroundRegionInfo>(regionUrl(item, "region"));
export const loadRecordingVersions = async (item: VoicePlaygroundItem) =>
  (await fetchJson<{ items: VoicePlaygroundItem[] }>(regionUrl(item, "versions"))).items;
export const saveRecordingVersion = async (
  item: VoicePlaygroundItem,
  input: RegionEditInput,
  film?: { takeId: string; sourceId: string },
) => {
  const url = film
    ? filmRegionUrl(film.takeId, "versions", film.sourceId)
    : regionUrl(item, "versions");
  const result = await fetchJson<{ job: PlaygroundJob }>(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  acceptSubmittedJobs([result.job]);
  return result.job;
};
export const resumeRecordingVersion = async (
  item: VoicePlaygroundItem,
  edit: RegionEditInput,
  replacementItemId: string,
) => {
  const result = await fetchJson<{ job: PlaygroundJob }>(regionUrl(item, "versions/resume"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ edit, replacementItemId }),
  });
  acceptSubmittedJobs([result.job]);
  return result.job;
};
export const previewRecordingRegion = async (
  item: VoicePlaygroundItem,
  input: RegionEditInput,
  signal: AbortSignal,
  film?: { takeId: string; sourceId: string },
) => {
  const url = film
    ? filmRegionUrl(film.takeId, "region-preview", film.sourceId)
    : regionUrl(item, "region-preview");
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) throw new Error((await response.json()).error || "Preview failed; try again");
  return {
    blob: await response.blob(),
    durationSeconds: Number(response.headers.get("x-audio-duration")),
    regionSeconds: Number(response.headers.get("x-region-duration")),
  };
};

const registerCatalogVoices = (voices: readonly PlaygroundVoiceOption[]) => {
  if (!voices.length) return;
  registerVoiceNames(
    voices.filter((voice) => !voice.connection || voice.connection === "genvoice"),
  );
};

const registerRecordingVoices = (items: readonly VoicePlaygroundItem[]) => {
  registerVoiceNames(
    items
      .filter((item) => !item.connection || item.connection === "genvoice")
      .flatMap((item) =>
        item.voicesUsed?.length
          ? item.voicesUsed
              .filter((voice) => !voice.connection || voice.connection === "genvoice")
              .map((voice) => ({ id: voice.voiceId, name: voice.voiceName }))
          : item.kind === "dialogue"
            ? extractDialogueSpeakerEntries(item.dialogue?.speakers).map((speaker) => ({
                id: speaker.voice_id,
                name: speaker.voice_name || speaker.voice_id,
              }))
            : [{ id: item.voiceId, name: item.voiceName }],
      )
      .filter((voice) => voice.name && voice.name !== voice.id),
  );
};

export const getPlaygroundItemByAuditionId = (auditionId: string): VoicePlaygroundItem | null => {
  if (!auditionId.startsWith("pg:")) return null;
  const id = auditionId.slice(3);
  return state.items.find((x) => x.id === id) ?? null;
};

export const loadPlaygroundAll = async (opts?: { refresh?: boolean; liveStatus?: boolean }) => {
  if (bootstrapLoad.status === "loading" && !opts?.refresh && !opts?.liveStatus) {
    return bootstrapLoad.promise;
  }
  const seq = bootstrapLoad.seq + 1;
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  bootstrapLoad = { status: "loading", seq, promise };
  patchState({ loadState: { status: "loading", loaded: isPlaygroundLoaded(state) } });
  void (async () => {
    try {
      const [status, catalog, itemsPayload, usage] = await Promise.all([
        fetchJson<PlaygroundStatus>(
          opts?.liveStatus ? "/api/voice/playground/status?live=1" : "/api/voice/playground/status",
        ),
        fetchJson<PlaygroundCatalog>(
          opts?.refresh
            ? "/api/voice/playground/catalog?refresh=1"
            : "/api/voice/playground/catalog",
        ),
        fetchJson<{
          items: VoicePlaygroundItem[];
          jobs: PlaygroundJob[];
          templates?: PlaygroundTemplate[];
          favoriteVoices?: PlaygroundVoiceOption[];
          starredTakeUids?: string[];
        }>("/api/voice/playground/items?includeGlobal=1&includeArchived=1&scope=project"),
        fetchJson<{ usage?: PlaygroundUsage[] }>("/api/voice/playground/usage?scope=project")
          .then((result) => result.usage ?? [])
          .catch(() => []),
      ]);
      if (getBootstrapLoad().seq !== seq) return;
      registerCatalogVoices(catalog.defaultVoices ?? []);
      const items = itemsPayload.items ?? [];
      registerRecordingVoices(items);
      const first = items.find((item) => !item.archivedAt);
      const selectedUid = state.selectedUid ?? (first ? playgroundAuditionId(first.id) : null);
      patchState({
        favoriteVoices: itemsPayload.favoriteVoices ?? [],
        usage,
        templates: itemsPayload.templates ?? [],
        starredTakeUids: itemsPayload.starredTakeUids ?? [],
        loadState: { status: "ready" },
        status,
        catalog,
        items,
        jobs: mergeJobsById(state.jobs, itemsPayload.jobs ?? []),
        selectedUid,
      });
      void loadPlaygroundClones();
      if (status.configured && !status.account && !opts?.liveStatus && !didAutoVerifyAccount) {
        didAutoVerifyAccount = true;
        void fetchJson<PlaygroundStatus>("/api/voice/playground/status?live=1")
          .then((liveSt) => {
            if (getBootstrapLoad().seq !== seq) return;
            if (liveSt && (liveSt.account || liveSt.error)) {
              patchState({ status: liveSt });
            }
          })
          .catch((e) => {
            if (getBootstrapLoad().seq !== seq || state.status.account) return;
            patchState({
              status: {
                ...state.status,
                error: e instanceof Error ? e.message : "Could not verify GenVoice API key",
              },
            });
          });
      }
    } catch (e) {
      if (getBootstrapLoad().seq !== seq) return;
      patchState({
        loadState: {
          status: "error",
          loaded: isPlaygroundLoaded(state),
          error: e instanceof Error ? e.message : "Could not load Voice Playground",
        },
      });
    } finally {
      const current = getBootstrapLoad();
      if (current.status === "loading" && current.seq === seq) {
        bootstrapLoad = { status: "idle", seq };
      }
      resolve();
    }
  })();
  return promise;
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
    compareUids: state.compareUids.filter((uid) => uid !== removedUid),
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
    if (consumers > 0 || isPlaygroundLoaded(state)) void loadPlaygroundAll();
    return;
  }
  switch (payload.type) {
    case "dubbing": {
      const job = payload.job as Parameters<typeof acceptDubbingJob>[0] | undefined;
      if (job?.id) acceptDubbingJob(job);
      break;
    }
    case "dubbing-observation": {
      void loadDubbingJobs();
      break;
    }
    case "clones": {
      void loadPlaygroundClones();
      break;
    }

    case "status": {
      if (payload.status && typeof payload.status === "object") {
        const status = payload.status as PlaygroundStatus;
        patchState({
          status: { ...status, connections: status.connections ?? state.status.connections },
        });
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
      if ((job.status === "completed" || job.status === "failed") && !notifiedJobs.has(job.id)) {
        notifiedJobs.add(job.id);
        if (notifiedJobs.size > 200) notifiedJobs.delete(notifiedJobs.values().next().value!);
        const visibleComparison =
          state.workbenchOpen &&
          state.activeSubTab === "compare" &&
          job.batch?.id &&
          job.batch.id === state.recentSpeechBatch;
        if (!visibleComparison) {
          say(
            job.status === "completed"
              ? `${job.title} is ready (${job.voiceName || job.modelId})`
              : `${job.title} failed. Review the error and try again.`,
          );
        }
      }
      if (job.status === "failed") requestedJobIds.delete(job.id);
      patchState({ jobs: mergeJobsById(state.jobs, [job]) });
      break;
    }
    case "item": {
      const item = payload.item as VoicePlaygroundItem | undefined;
      if (!item?.id) break;
      registerRecordingVoices([item]);
      const items = upsertById(state.items, item, true);
      const requestedJob = state.jobs.find(
        (job) => requestedJobIds.has(job.id) && jobMatchesItem(job, item),
      );
      const revealFrom = requestedJob && requestedJobIds.get(requestedJob.id);
      if (requestedJob) requestedJobIds.delete(requestedJob.id);
      const reveal = revealFrom === state.activeSubTab;
      const shouldSelect = !state.selectedUid || reveal;
      patchState({
        items,
        selectedUid: shouldSelect ? playgroundAuditionId(item.id) : state.selectedUid,
        ...(reveal && revealFrom === "jobs"
          ? { activeSubTab: "inspect", workbenchMediumTab: "inspect" }
          : {}),
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
      if (consumers > 0 || isPlaygroundLoaded(state)) void loadPlaygroundAll();
    }
  }
};

export const savePlaygroundConfig = async (cfg: {
  connection?: PlaygroundConnection;
  apiKey?: string;
  apiBase?: string;
  clearOverride?: boolean;
}) => {
  const release = beginBusyAction("config");
  try {
    const status = await fetchJson<PlaygroundStatus>("/api/voice/playground/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cfg),
    });
    release({ status });
    if (cfg.connection && cfg.connection !== "genvoice") {
      if (status.connections?.[cfg.connection]?.configured) void loadSpeechCatalog(cfg.connection);
      say(cfg.clearOverride ? "Reverted to the environment key" : "API key verified and saved");
      return status;
    }
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
    release();
    say(msg);
    throw e;
  }
};

export const testPlaygroundConnection = async (connection: PlaygroundConnection = "genvoice") => {
  const release = beginBusyAction("status-test");
  try {
    if (connection !== "genvoice") {
      const status = await fetchJson<PlaygroundStatus>(
        `/api/voice/playground/status?live=1&connection=${connection}`,
      );
      release({ status });
      const tested = status.connections?.[connection];
      say(tested?.error || (tested?.verified ? "Connection verified" : "API key missing"));
      if (tested?.verified) void loadSpeechCatalog(connection);
      return;
    }
    await loadPlaygroundAll({ refresh: true, liveStatus: true });
    release();
    say(
      state.status.account?.credit_balance != null
        ? `Connected (${state.status.account.credit_balance.toLocaleString()} credits)`
        : state.status.error || "Checked GenVoice connection",
    );
  } catch {
    release();
  }
};

export const loadSpeechCatalog = async (connection: DirectPlaygroundConnection) => {
  const seq = ++serviceCatalogSeq;
  const previous = state.serviceCatalogs?.[connection];
  patchState({
    serviceCatalogs: {
      ...state.serviceCatalogs,
      [connection]: { status: "loading", seq, catalog: previous?.catalog },
    },
  });
  try {
    const catalog = await fetchJson<PlaygroundCatalog>(
      `/api/voice/playground/catalog?refresh=1&connection=${connection}`,
    );
    const current = state.serviceCatalogs?.[connection];
    if (current && current.seq !== seq) return;
    patchState({
      serviceCatalogs: {
        ...state.serviceCatalogs,
        [connection]: { status: "ready", seq, catalog },
      },
    });
  } catch (err) {
    const current = state.serviceCatalogs?.[connection];
    if (current && current.seq !== seq) return;
    const message =
      err instanceof TypeError
        ? "Could not load voices. Reconnect to Studio, then try again."
        : err instanceof Error
          ? err.message
          : "Could not load voices.";
    patchState({
      serviceCatalogs: {
        ...state.serviceCatalogs,
        [connection]: { status: "error", seq, error: message, catalog: current?.catalog },
      },
    });
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
      status: "loading",
      voices: opts?.append ? state.sharedSearch.voices : [],
      hasMore: state.sharedSearch.hasMore,
      nextPageToken: state.sharedSearch.nextPageToken,
      queryKey,
      page: pageNum,
      params: normalized,
    },
  });
  try {
    const res = await fetchJson<{
      voices: PlaygroundVoiceOption[];
      hasMore: boolean;
      nextPageToken?: string;
    }>(`/api/voice/playground/shared-voices?${queryKey}`);
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
        status: "ready",
        voices: mergedVoices,
        hasMore: Boolean(res.hasMore),
        nextPageToken: res.nextPageToken,
        queryKey,
        page: pageNum,
        params: normalized,
      },
    });
  } catch (e) {
    if (reqId !== sharedSearchSeq) return;
    patchState({
      sharedSearch: {
        status: "error",
        voices: state.sharedSearch.voices,
        hasMore: state.sharedSearch.hasMore,
        nextPageToken: state.sharedSearch.nextPageToken,
        queryKey: state.sharedSearch.queryKey,
        page: state.sharedSearch.page,
        params: state.sharedSearch.params,
        error: e instanceof Error ? e.message : "Live voice search failed",
      },
    });
  }
};

export const loadMoreSharedVoices = async () => {
  if (state.sharedSearch.status === "loading" || !state.sharedSearch.hasMore) return;
  const nextPage = state.sharedSearch.page + 1;
  return searchLiveSharedVoices(
    {
      ...state.sharedSearch.params,
      page: nextPage,
      pageToken: state.sharedSearch.nextPageToken,
    },
    { append: true },
  );
};

const toolDrafts = new Map<ComposerDraft["mode"], ComposerDraft>();
const speechDrafts = new Map<string, ComposerDraft>();
export const selectSpeechConnection = (connection: PlaygroundConnection) => {
  const { draft } = state;
  const previous = draft.connection ?? "genvoice";
  if (previous === connection) return;
  speechDrafts.set(`${draft.mode}:${previous}`, draft);
  const saved = speechDrafts.get(`${draft.mode}:${connection}`);
  const differentGeminiCast =
    draft.mode === "dialogue" &&
    (previous === "google" || connection === "google") &&
    saved &&
    saved.fromTemplateId === draft.fromTemplateId &&
    saved.speakers.length !== draft.speakers.length &&
    Math.max(saved.speakers.length, draft.speakers.length) > 2;
  const initial: Partial<ComposerDraft> =
    connection === "google"
      ? {
          provider: undefined,
          modelId: "gemini-3.8-flash-tts",
          voiceId: "Kore",
          voiceName: "Kore",
          languageCode: "",
        }
      : connection === "elevenlabs"
        ? {
            provider: "elevenlabs",
            modelId: "eleven_v4",
            voiceId: "",
            voiceName: "",
            languageCode: "",
          }
        : {};
  patchState({
    draft: {
      ...DEFAULT_COMPOSER_DRAFT,
      ...initial,
      ...saved,
      ...(draft.mode === "dialogue" && !differentGeminiCast
        ? {
            speakers: dialogueCastForConnection(draft.speakers, connection).map((speaker) => ({
              ...speaker,
              ...(saved?.speakers.find((previous) => previous.id === speaker.id) ??
                saved?.speakers.find((previous) => previous.name.trim() === speaker.name.trim())),
              id: speaker.id,
              name: speaker.name,
            })),
          }
        : {}),
      mode: draft.mode,
      connection,
      text: differentGeminiCast ? saved.text : draft.text,
      title: draft.title,
      notes: draft.notes,
      variations: draft.variations,
      templateId: undefined,
      templateScope: undefined,
      fromTemplateId: draft.fromTemplateId,
    },
  });
};
let sourceUploadSeq = 0;
let sttUploadSeq = 0;
const invalidateSttSourceUpload = () => {
  sttUploadSeq++;
  patchState({ sttSourceUpload: { status: "idle" } });
};
const invalidateVoiceSourceUpload = () => {
  sourceUploadSeq++;
  releaseBusyByKind("source");
};
const rememberToolDraft = () => toolDrafts.set(state.draft.mode, structuredClone(state.draft));

export const switchPlaygroundTool = (mode: ComposerDraft["mode"]) => {
  if (mode === state.draft.mode) {
    patchState({ activeSubTab: "create" });
    return;
  }
  rememberToolDraft();
  const cached = toolDrafts.get(mode);
  const draft = cached
    ? structuredClone(cached)
    : {
        ...structuredClone(DEFAULT_COMPOSER_DRAFT),
        mode,
        modelId: resolveModeModelId(
          mode,
          DEFAULT_COMPOSER_DRAFT.modelId,
          state.catalog.models,
          "elevenlabs",
        ),
        ...(mode === "dialogue"
          ? { text: "Alex: [curious] Did you hear that?\nRiley: [hushed] Keep moving." }
          : {}),
      };
  patchState({ draft, draftVersion: state.draftVersion + 1, activeSubTab: "create" });
};

export const setComposerDraft = (
  updater: Partial<ComposerDraft> | ((prev: ComposerDraft) => ComposerDraft),
) => {
  const nextDraft =
    typeof updater === "function" ? updater(state.draft) : { ...state.draft, ...updater };
  if (nextDraft.mode !== state.draft.mode) rememberToolDraft();
  const normalizedDraft =
    nextDraft.mode !== state.draft.mode && nextDraft.mode !== "stt"
      ? {
          ...nextDraft,
          connection: nextDraft.mode === "tts" ? nextDraft.connection : undefined,
          provider:
            nextDraft.mode === "voice_changer" ? ("elevenlabs" as const) : nextDraft.provider,
          ...(nextDraft.mode === "voice_changer" && nextDraft.provider !== "elevenlabs"
            ? { voiceId: "", voiceName: "" }
            : {}),
          modelId: resolveModeModelId(
            nextDraft.mode,
            nextDraft.modelId,
            state.catalog.models,
            nextDraft.mode === "voice_changer" ? "elevenlabs" : nextDraft.provider,
          ),
        }
      : nextDraft;
  const recorded = normalizedDraft.recordedSpeech;
  if (recorded?.modelId === normalizedDraft.modelId) {
    const changes = (
      [
        ["stability", "stability"],
        ["similarityBoost", "similarity_boost"],
        ["style", "style"],
        ["useSpeakerBoost", "use_speaker_boost"],
        ["speed", "speed"],
        ["pitch", "pitch"],
        ["vol", "vol"],
      ] as const
    ).filter(([field]) => normalizedDraft[field] !== state.draft[field]);
    normalizedDraft.recordedSpeech = {
      ...recorded,
      settings: {
        ...recorded.settings,
        ...Object.fromEntries(changes.map(([field, key]) => [key, normalizedDraft[field]])),
      },
      normalization:
        normalizedDraft.applyTextNormalization !== state.draft.applyTextNormalization
          ? normalizedDraft.applyTextNormalization
          : recorded.normalization,
    };
  }
  patchState({ draft: normalizedDraft });
};

export const selectComposerVoice = (
  voice: Pick<
    PlaygroundVoiceOption,
    "id" | "name" | "provider" | "language" | "connection" | "previewUrl" | "gender"
  >,
) => {
  try {
    if (state.draft.mode === "tts") selectSpeechConnection(voice.connection ?? "genvoice");
    setComposerDraft((draft) => {
      const selected = withComposerVoice(draft, voice, state.catalog);
      return {
        ...selected,
        voicePreviewUrl: voice.previewUrl,
        voiceGender: voice.gender,
        languageCode: draft.mode === "tts" && !draft.languageCode ? "" : selected.languageCode,
      };
    });
  } catch (error) {
    say(error instanceof Error ? error.message : "Choose a compatible voice");
  }
};

export const openCastingVoice = (voice: Parameters<typeof selectComposerVoice>[0]) => {
  switchPlaygroundTool("tts");
  selectComposerVoice(voice);
  setPlaygroundSubTab("create");
  setPlaygroundWorkbenchOpen(true);
};

export const browseCastingVoices = (target: CastingTarget) => {
  patchState({ castingTarget: target, activeSubTab: "voices" });
};

export const cancelCasting = () => patchState({ castingTarget: null, activeSubTab: "create" });
export const startVoiceTemplate = (voice: Parameters<typeof selectComposerVoice>[0]) => {
  resetComposerDraft("tts");
  selectComposerVoice(voice);
  setComposerDraft({ text: "", title: `${voice.name || voice.id} template` });
  patchState({ castingTarget: null, activeSubTab: "create", workbenchOpen: true });
};

export const chooseCastingVoice = (
  voice: Pick<
    PlaygroundVoiceOption,
    "id" | "name" | "provider" | "language" | "dubbingVoiceId" | "connection"
  >,
) => {
  const target = state.castingTarget;
  if (!target) {
    openCastingVoice(voice);
    return;
  }
  if (
    target.mode === "dialogue" &&
    (voice.connection ?? "genvoice") !== (state.draft.connection ?? "genvoice")
  ) {
    say("Pick a voice from the current Dialogue service.");
    return;
  }
  const provider = voice.provider ?? "elevenlabs";
  if (target.mode === "voice_changer" && provider !== "elevenlabs") {
    say("Voice Changer requires an ElevenLabs voice.");
    return;
  }
  const nativeId = provider === "minimax" ? voice.dubbingVoiceId : voice.id;
  if (target.mode === "dubbing" && !nativeId) {
    say(
      "This voice has no verified Dubbing ID. Choose another voice or enter its native ID in Advanced.",
    );
    return;
  }
  switchPlaygroundTool(target.mode);
  if (target.mode === "dialogue") {
    setComposerDraft((draft) => ({
      ...draft,
      speakers: draft.speakers.map((speaker) =>
        speaker.id === target.speakerId
          ? draft.connection && draft.connection !== "genvoice"
            ? { ...speaker, voiceId: voice.id, voiceName: voice.name }
            : { ...speaker, ...withDialogueVoice(speaker, voice, state.catalog) }
          : speaker,
      ),
    }));
  } else if (target.mode === "dubbing") {
    const voiceLanguage =
      voice.language === "Vietnamese" ? "vi" : voice.language === "English" ? "en" : voice.language;
    setComposerDraft((draft) => ({
      ...draft,
      provider,
      voiceId: voice.id,
      voiceName: voice.name,
      modelId: DUBBING_MODELS[provider],
      dubbing: {
        sourceLanguage: "en",
        targetLanguage: "vi",
        ...draft.dubbing,
        provider,
        voiceId: nativeId!,
        voiceName: voice.name,
        voiceLanguage,
        ttsVoiceId: provider === "minimax" ? voice.id : undefined,
      },
    }));
  } else selectComposerVoice(voice);
  patchState({ castingTarget: null, activeSubTab: "create" });
};

export const previewCastingVoice = (voice: PlaygroundVoiceOption) => {
  if (!voice.previewUrl || !isSafeAudioUrl(voice.previewUrl)) return;
  patchState({ previewVoice: voice });
  listenUrl(castingAuditionId(voice), voice.previewUrl);
};

export const openFilmTakeRemix = async (take: VoiceTakeItem) => {
  if (!isPlaygroundLoaded(state)) await loadPlaygroundAll();
  const findSource = () =>
    state.items.find(
      (item) =>
        item.id === take.playgroundItemId &&
        (item.scope ?? "project") === (take.playgroundScope ?? "project"),
    );
  if (take.playgroundItemId && !findSource()) await loadPlaygroundAll({ refresh: true });
  const source = findSource();
  openVoicePlaygroundWith(composeFilmTakeRemixPreset(take, source));
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
  const item = state.items.find((item) => `pg:${item.id}` === uid);
  const template = state.templates.find((template) => `preset:${template.id}` === uid);
  const scope =
    item?.scope ?? template?.scope ?? (uid?.startsWith("take:") ? "project" : undefined);
  patchState({
    selectedUid: uid,
    ...(uid && state.libraryScope !== "all" && scope !== state.libraryScope
      ? { libraryScope: "all" as const }
      : {}),
  });
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
  if (inlineOpen && !isPlaygroundLoaded(state)) void loadPlaygroundAll();
};

export const setPlaygroundWorkbenchOpen = (workbenchOpen: boolean) => {
  if (workbenchOpen && !state.workbenchOpen) {
    restoreSpeechDraft();
    const active = typeof document === "undefined" ? null : document.activeElement;
    patchState({
      workbenchOpener:
        active && active !== document.body && "focus" in active ? (active as HTMLElement) : null,
    });
  }
  patchState({ workbenchOpen, ...(workbenchOpen ? { everOpened: true } : {}) });
  if (workbenchOpen) {
    set({ modal: "voicePlayground" });
    if (!isPlaygroundLoaded(state)) void loadPlaygroundAll();
  } else {
    set((s) => (s.modal === "voicePlayground" ? { modal: null } : {}));
  }
};
export const changePlaygroundWorkbenchOpen = (
  open: boolean,
  details: { reason: string; cancel: () => void },
) => {
  if (!open && details.reason === "escape-key" && state.regionEditor?.returnToWorkbench) {
    details.cancel();
    closeRecordingEditor();
    return;
  }
  if (!open && state.regionEditor) closeRecordingEditor();
  setPlaygroundWorkbenchOpen(open);
};

export const openVoicePlaygroundWith = (
  preset: Partial<ComposerDraft> & { openWorkbench?: boolean; openInline?: boolean },
) => {
  const { openWorkbench = true, openInline = false, ...draftPreset } = preset;
  if (draftPreset.mode === "voice_changer") invalidateVoiceSourceUpload();
  if (draftPreset.mode === "stt") invalidateSttSourceUpload();
  rememberToolDraft();
  patchState({
    draft: { ...DEFAULT_COMPOSER_DRAFT, ...draftPreset },
    draftVersion: state.draftVersion + 1,
    activeSubTab: "create",
    ...(openInline ? { inlineOpen: true } : {}),
  });
  if (openWorkbench) {
    setPlaygroundWorkbenchOpen(true);
  } else if (!isPlaygroundLoaded(state)) {
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

const buildSpeechInput = (d: ComposerDraft): PlaygroundTtsRequest => {
  const parsedSeed = parseOptionalSeed(d.seedText);
  const connection = d.connection ?? "genvoice";
  const google = connection === "google";
  const recorded =
    connection === "genvoice" && d.recordedSpeech?.modelId === d.modelId
      ? d.recordedSpeech
      : undefined;
  const models =
    connection === "genvoice"
      ? state.catalog.models
      : (state.serviceCatalogs?.[connection]?.catalog?.models ?? []);
  const ttsModelId = recorded
    ? d.modelId
    : connection === "genvoice"
      ? resolveModeModelId("tts", d.modelId, models, d.provider)
      : (visibleSpeechModel(models, d.modelId)?.model_id ?? d.modelId);
  const modelMeta = models.find((model) => model.model_id === ttsModelId);
  return {
    connection,
    ...(connection === "genvoice" ? { provider: d.provider } : {}),
    voiceId: d.voiceId,
    voiceName: d.voiceName,
    voiceGender: d.voiceGender,
    ...(connection === "genvoice" &&
    d.voicePreviewUrl &&
    /^https?:\/\//i.test(d.voicePreviewUrl) &&
    isSafeAudioUrl(d.voicePreviewUrl)
      ? { voicePreviewUrl: d.voicePreviewUrl }
      : {}),
    modelId: ttsModelId,
    text: d.text,
    ...(google
      ? { speechStyle: d.speechStyle }
      : {
          languageCode: d.languageCode || detectTextLanguage(d.text),
          voiceSettings: recorded?.settings ?? voiceSettingsForModel(modelMeta, d),
          ...(recorded ? { preserveSettings: true } : {}),
          ...((recorded || modelMeta?.supports_context !== false) && d.previousText.trim()
            ? { previousText: d.previousText.trim() }
            : {}),
          ...((recorded || modelMeta?.supports_context !== false) && d.nextText.trim()
            ? { nextText: d.nextText.trim() }
            : {}),
          ...(parsedSeed !== undefined ? { seed: parsedSeed } : {}),
          ...(d.outputFormat.trim() ? { outputFormat: d.outputFormat.trim() } : {}),
          ...(recorded?.normalization || d.applyTextNormalization !== "auto"
            ? { applyTextNormalization: recorded?.normalization ?? d.applyTextNormalization }
            : {}),
          exportTranscript: d.exportTranscript,
        }),
    variations: d.variations,
    name: d.title.trim() || undefined,
    notes: d.notes.trim() || undefined,
    sourceTakeId: d.sourceTakeId,
    fromTemplateId: d.fromTemplateId,
  };
};

export interface SpeechReview {
  scope: "project" | "global";
  input: PlaygroundTtsBatchInput;
  quote: PlaygroundTtsQuote;
  runId: string;
  comparison: boolean;
}

export const comparisonSpeechDraft = (draft: ComposerDraft = state.draft) =>
  draft.mode === "tts" ? draft : toolDrafts.get("tts");

export const reviewGenVoiceSpeech = async (
  voices: readonly PlaygroundVoiceOption[],
): Promise<SpeechReview> => {
  const { scope, catalog } = state;
  const draft = voices.length ? comparisonSpeechDraft() : state.draft;
  if (draft?.mode !== "tts" || (draft.connection ?? "genvoice") !== "genvoice")
    throw new Error("Choose GenVoice Speech before reviewing a batch");
  const entries = voices.length
    ? voices.map((voice) =>
        buildSpeechInput({
          ...((voice.provider ?? "elevenlabs") === (draft.provider ?? "elevenlabs")
            ? { ...draft, voiceId: voice.id, voiceName: voice.name }
            : withComposerVoice(
                { ...draft, languageCode: draft.languageCode || detectTextLanguage(draft.text) },
                voice,
                catalog,
              )),
          variations: 1,
          voiceGender: voice.gender,
          voicePreviewUrl: voice.previewUrl,
        }),
      )
    : [buildSpeechInput(draft)];
  const input: PlaygroundTtsBatchInput = {
    entries: entries.map((entry) => ({ ...entry, connection: "genvoice" })),
  };
  const quote = await fetchJson<PlaygroundTtsQuote>(
    `/api/voice/playground/tts/quote?scope=${scope}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return { scope, input, quote, runId: crypto.randomUUID(), comparison: voices.length > 0 };
};

export const launchReviewedSpeech = async ({ scope, input, runId, comparison }: SpeechReview) => {
  if (state.busyAction) throw new Error("Wait for the current action to finish.");
  const release = beginBusyAction("generate", { composerError: undefined });
  try {
    const result = await fetchJson<{ batchId: string; jobs: PlaygroundJob[] }>(
      `/api/voice/playground/tts/batch?scope=${scope}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-voice-playground-run": runId },
        body: JSON.stringify(input),
      },
    );
    acceptSubmittedJobs(result.jobs);
    if (comparison) patchState({ recentSpeechBatch: result.batchId, activeSubTab: "compare" });
    if (!state.workbenchOpen || !comparison) {
      say(
        result.jobs.length === 1
          ? "Generating voice…"
          : `Generating ${result.jobs.length} takes. Follow each in Jobs.`,
      );
    }
  } catch (error) {
    const message =
      error instanceof TypeError
        ? "Couldn't confirm whether Studio received the request. Reconnect and check Jobs before trying again."
        : error instanceof Error
          ? error.message
          : "Couldn't start Speech. Check Jobs before trying again.";
    release({ composerError: { mode: "tts", message } });
    throw error instanceof TypeError
      ? new TypeError(message, { cause: error })
      : new Error(message);
  } finally {
    release();
  }
};

export const generateFromComposer = async (opts?: {
  audioFile?: File | null;
  sourceItemId?: string;
  sourceTakeKind?: "takes" | "try";
  sourceTakeFile?: string;
}) => {
  const d = state.draft;
  if (d.mode === "stt") return;
  const release = beginBusyAction("generate", { composerError: undefined, activeSubTab: "create" });
  try {
    if (d.mode === "dubbing")
      throw new Error(
        "Dubbing requires its prepared source and quote before submitting. Open the Dubbing workspace.",
      );
    const parsedSeed = parseOptionalSeed(d.seedText);
    if (d.mode === "tts") {
      const res = await fetchJson<{ jobs: PlaygroundJob[] }>("/api/voice/playground/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildSpeechInput(d)),
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
      const connection = d.connection ?? "genvoice";
      const direct = connection !== "genvoice";
      const google = connection === "google";
      const sceneModel = direct
        ? visibleSpeechModel(
            dialogueServiceModels(
              connection,
              state.serviceCatalogs?.[connection]?.catalog?.models ?? [],
            ),
            d.modelId,
          )?.model_id
        : undefined;
      const normalizedText = stripDialogueSpeakerBrackets(d.text).trim();
      const speakers: Record<
        string,
        {
          provider?: PlaygroundVoiceOption["provider"];
          voice_id: string;
          voice_name?: string;
          model_id?: string;
          language_code?: string;
          voice_settings?: PlaygroundVoiceSettings;
          speech_style?: string;
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
        const spModelId = direct
          ? undefined
          : resolveModeModelId(
              "dialogue",
              sp.modelId || d.modelId,
              state.catalog.models,
              sp.provider,
            );
        speakers[key] = {
          voice_id: sp.voiceId.trim(),
          voice_name: sp.voiceName,
          ...(direct
            ? google && sp.speechStyle
              ? { speech_style: sp.speechStyle }
              : {}
            : {
                provider: sp.provider,
                model_id: spModelId,
                language_code: sp.languageCode.trim() || undefined,
                voice_settings: voiceSettingsForModel(activeModelById(spModelId ?? ""), sp),
              }),
        };
      }
      const speakerKeys = Object.keys(speakers);
      const namedTurns = parseDialogueTurnNames(normalizedText);
      if (
        speakerKeys.length < 2 ||
        namedTurns.length < 2 ||
        namedTurns.some((name) => !Object.hasOwn(speakers, name))
      ) {
        const msg =
          'Dialogue requires at least 2 speakers and "SpeakerName: line" turns matching them.';
        release({ composerError: { mode: d.mode, message: msg } });
        say(msg);
        return;
      }
      const res = await fetchJson<{ job: PlaygroundJob }>("/api/voice/playground/dialogue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: normalizedText,
          connection,
          speakers,
          fromTemplateId: d.fromTemplateId,
          ...(direct
            ? {
                modelId: sceneModel ?? d.modelId,
                ...(google
                  ? {}
                  : {
                      languageCode: d.languageCode || undefined,
                      voiceSettings: {
                        stability: d.stability,
                        ...((sceneModel ?? d.modelId) === "eleven_v4"
                          ? { similarity_boost: d.similarityBoost }
                          : {}),
                      },
                      outputFormat: d.outputFormat || undefined,
                      seed: parsedSeed,
                    }),
              }
            : { pause_between_turns: d.pauseBetweenTurns }),
          exportTranscript: !google && d.exportTranscript,
          name: d.title.trim() || undefined,
          notes: d.notes.trim() || undefined,
        }),
      });
      acceptSubmittedJobs(res.job ? [res.job] : []);
      say(`Generating ${speakerKeys.length}-speaker dialogue…`);
      return;
    }

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
    const msg =
      e instanceof TypeError
        ? "Couldn't reach Studio. Reconnect and check Jobs before trying again."
        : e instanceof Error
          ? e.message
          : "Voice generation failed";
    release({ composerError: { mode: d.mode, message: msg } });
    say(msg);
  } finally {
    release();
  }
};

export const runPlaygroundStt = async (opts: {
  background?: boolean;
  file?: File | null;
  sourceFile?: string;
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
  const langCode = languageForProvider(
    "elevenlabs",
    (opts.languageCode ?? "en").trim(),
    state.catalog.languages,
  );
  if (!langCode || langCode.toLowerCase() === "auto") {
    const msg =
      "Speech-to-Text (Scribe v2) requires an explicit language code (e.g. 'en', 'vi'); 'auto' is not supported.";
    patchState({ composerError: { mode: "stt", message: msg } });
    say(msg);
    return null;
  }
  const release = beginBusyAction("stt", { composerError: undefined });
  try {
    let data: {
      taskId: string;
      sttResult: PlaygroundSttResult;
      item?: VoicePlaygroundItem;
      job?: PlaygroundJob;
    };
    const path = opts.background ? "/api/voice/playground/stt/jobs" : "/api/voice/playground/stt";
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
      data = await fetchJson<{ taskId: string; sttResult: PlaygroundSttResult }>(path, {
        method: "POST",
        body: form,
      });
    } else {
      data = await fetchJson<{ taskId: string; sttResult: PlaygroundSttResult }>(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...opts, languageCode: langCode }),
      });
    }
    if (data.job) {
      acceptSubmittedJobs([data.job]);
      release();
      const status = state.jobs.find((job) => job.id === data.job?.id)?.status ?? data.job.status;
      if (!state.workbenchOpen && status !== "completed" && status !== "failed") {
        say("Transcription started. Follow its progress in Jobs while you keep working.");
      }
      return null;
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
    release({
      items: data.item ? upsertById(items, data.item) : items,
      ...(data.item ? { selectedUid: playgroundAuditionId(data.item.id) } : {}),
      lastSttResult: {
        ...data.sttResult,
        taskId: data.taskId,
        sourceLabel: opts.sourceLabel ?? opts.file?.name ?? opts.itemId ?? opts.sourceTakeFile,
      },
    });
    say("Transcription complete");
    return data.sttResult;
  } catch (e) {
    const msg =
      e instanceof TypeError
        ? "Couldn't reach Studio. Reconnect and check Jobs before starting another transcription."
        : e instanceof Error
          ? e.message
          : "Transcription failed";
    release({ composerError: { mode: "stt", message: msg } });
    say(msg);
    return null;
  } finally {
    release();
  }
};

export const loadRecordingArchivePolicy = (
  id: string,
  scope: "project" | "global",
  signal: AbortSignal,
) =>
  fetchJson<{ policy: { deleteAfter: string | null } | null }>(
    `/api/voice/playground/recordings/${encodeURIComponent(id)}/archive-policy?scope=${scope}`,
    { signal },
  );

export const patchPlaygroundItem = async (
  id: string,
  patch: {
    favorite?: boolean;
    isTemplate?: boolean;
    templateName?: string;
    title?: string;
    notes?: string;
    rights?: PlaygroundRights;
    tags?: string[];
    description?: string;
    rating?: number | null;
    color?: string | null;
    archived?: boolean;
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
  if (entry.template) {
    await updatePlaygroundTemplate(entry.template, { favorite: !entry.favorite });
    return;
  }
  if (entry.origin === "playground" && entry.playgroundItem) {
    const nextFav = !entry.playgroundItem.favorite;
    await patchPlaygroundItem(entry.id, { favorite: nextFav });
    say(nextFav ? `Starred ${entry.title}` : `Unstarred ${entry.title}`);
    return;
  }
  const has = state.starredTakeUids.includes(entry.uid);
  try {
    const result = await fetchJson<{ uids: string[] }>("/api/voice/playground/take-favorites", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uid: entry.uid, favorite: !has }),
    });
    patchState({ starredTakeUids: result.uids });
    say(has ? `Unstarred Take ${entry.id}` : `Starred Take ${entry.id}`);
  } catch (error) {
    say(error instanceof Error ? error.message : "Unable to save favorite; try again");
  }
};

export function recordingRemovalFocus(trigger: HTMLButtonElement) {
  const workbench = trigger.closest('[data-slot="dialog-content"]');
  const rows = Array.from(
    workbench?.querySelectorAll<HTMLElement>("[data-recording-select]") ?? [],
  );
  const current =
    trigger
      .closest("[data-recording-row]")
      ?.querySelector<HTMLElement>("[data-recording-select]") ??
    rows.find((row) => row.getAttribute("aria-current") === "true");
  const index = current ? rows.indexOf(current) : -1;
  const nearby = rows[index + 1] ?? rows[index - 1];
  const search = workbench?.querySelector<HTMLElement>("[data-recording-search]");
  const details = workbench?.querySelector<HTMLElement>("[data-recording-details]");
  return () => {
    const active = document.activeElement;
    if (active !== trigger && active !== document.body && active !== workbench) return;
    [nearby, search, details].find((target) => target?.getClientRects().length)?.focus();
  };
}

export const voicePlaygroundToast = createToastManager();

export const deletePlaygroundItem = async (id: string) => {
  if (hasBusyAction(`delete:${id}`)) return;
  const release = beginBusyAction(`delete:${id}`);
  try {
    const archived = await patchPlaygroundItem(id, { archived: true });
    if (!archived) return;
    stopDeletedAudition(id);
    patchState({
      selectedUid: state.selectedUid === playgroundAuditionId(id) ? null : state.selectedUid,
      compareUids: state.compareUids.filter((uid) => uid !== playgroundAuditionId(id)),
    });
    showUndo(
      "Recording archived",
      async () => {
        if (await patchPlaygroundItem(id, { archived: false })) say("Recording restored");
      },
      10000,
      state.workbenchOpen ? voicePlaygroundToast : undefined,
    );
    return archived;
  } catch (e) {
    say(e instanceof Error ? e.message : "Could not archive clip");
  } finally {
    release();
  }
};

export const patchPlaygroundSelection = async (
  ids: readonly string[],
  patch: Parameters<typeof patchPlaygroundItem>[1],
) => {
  const chosen = state.items.filter((item) => ids.includes(item.id));
  const updated: VoicePlaygroundItem[] = [];
  let skipped = ids.length - chosen.length;
  for (const scope of ["project", "global"] as const) {
    const scoped = chosen.filter((item) => (item.scope ?? "project") === scope);
    for (let offset = 0; offset < scoped.length; offset += 100) {
      const group = scoped.slice(offset, offset + 100);
      try {
        const response = await fetchJson<{ items: VoicePlaygroundItem[] }>(
          `/api/voice/playground/recordings?scope=${scope}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ids: group.map((item) => item.id), patch }),
          },
        );
        updated.push(...response.items);
        skipped += group.length - response.items.length;
      } catch {
        skipped += group.length;
      }
    }
  }
  if (updated.length) {
    const byId = new Map(updated.map((item) => [item.id, item]));
    if (patch.archived) updated.forEach((item) => stopDeletedAudition(item.id));
    patchState({
      items: state.items.map((item) => byId.get(item.id) ?? item),
      ...(patch.archived
        ? { compareUids: state.compareUids.filter((uid) => !byId.has(uid.slice(3))) }
        : {}),
    });
  }
  say(`${updated.length} recordings updated${skipped ? ` · ${skipped} could not be updated` : ""}`);
  return updated;
};

export const searchPlaygroundRecordings = (query: URLSearchParams, signal: AbortSignal) =>
  fetchJson<{ items: VoicePlaygroundItem[]; hasMore: boolean }>(
    `/api/voice/playground/recordings?${query}`,
    { signal },
  );

export const duplicateEntryToComposer = async (
  entry: UnifiedPlaygroundEntry,
  opts?: {
    overrideVoice?: Pick<PlaygroundVoiceOption, "id" | "name" | "provider" | "language"> & {
      speakerKey?: string;
    };
    switchToCreate?: boolean;
  },
) => {
  let nextDraft = entryToComposerDraft(entry);
  const recording = entry.playgroundItem ?? entry.sourceRecording;
  if (nextDraft.mode === "dubbing" && recording?.dubbing?.sourceFile && nextDraft.dubbing) {
    const version = state.draftVersion;
    const release = beginBusyAction("duplicate");
    say("Preparing the saved original. No generation charge.");
    try {
      const { source } = await fetchJson<{ source: { id: string } }>(
        `/api/voice/playground/dubbing/sources?scope=${recording.scope ?? "project"}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ itemId: recording.id, asset: "source" }),
        },
      );
      if (state.draftVersion !== version) return;
      nextDraft.dubbing = { ...nextDraft.dubbing, sourceId: source.id };
    } catch (error) {
      say(
        error instanceof Error
          ? error.message
          : "Could not prepare the original; choose its file in Dubbing.",
      );
      return;
    } finally {
      release();
    }
  }
  const voice = opts?.overrideVoice;
  if (voice) {
    if (nextDraft.mode === "dialogue")
      nextDraft = {
        ...nextDraft,
        speakers: nextDraft.speakers.map((speaker, index) =>
          (voice.speakerKey ? speaker.name === voice.speakerKey : index === 0)
            ? withDialogueVoice(speaker, voice, state.catalog)
            : speaker,
        ),
      };
    else nextDraft = withComposerVoice(nextDraft, voice, state.catalog);
    nextDraft.title = `${entry.templateName || entry.title} (${voice.name})`;
  }
  if (nextDraft.mode !== state.draft.mode) rememberToolDraft();
  if (nextDraft.mode === "voice_changer") invalidateVoiceSourceUpload();
  if (nextDraft.mode === "stt") invalidateSttSourceUpload();
  patchState({
    draft: nextDraft,
    ...(nextDraft.mode === "tts" && state.draft.mode === "tts"
      ? { previousComposerDraft: { draft: state.draft, scope: state.scope } }
      : {}),
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
  if (mode === "voice_changer") invalidateVoiceSourceUpload();
  if (mode === "stt") invalidateSttSourceUpload();
  const previous = mode === state.draft.mode ? state.draft : toolDrafts.get(mode);
  if (mode !== state.draft.mode) rememberToolDraft();
  patchState({
    previousComposerDraft: previous ? { draft: previous, scope: state.scope } : undefined,
    draft: {
      ...DEFAULT_COMPOSER_DRAFT,
      mode,
      modelId:
        mode === "voice_changer" ? "eleven_multilingual_sts_v2" : DEFAULT_COMPOSER_DRAFT.modelId,
    },
    draftVersion: state.draftVersion + 1,
  });
};

function draftBeforeJobReview(mode: ComposerDraft["mode"]) {
  const saved = state.previousComposerDraft;
  if (saved?.reason === "job-review" && saved.draft.mode === mode) return saved;
  const draft = state.draft.mode === mode ? state.draft : toolDrafts.get(mode);
  return draft ? { draft, scope: state.scope, reason: "job-review" as const } : undefined;
}

export const reviewSpeechJob = (job: PlaygroundJob) => {
  const draft = speechJobToDraft(job);
  if (!draft) return;
  const previous = draftBeforeJobReview("tts");
  rememberToolDraft();
  patchState({
    draft,
    previousComposerDraft: previous,
    scope: job.scope ?? state.scope,
    speechReviewBatchId: job.batch?.id,
    activeSubTab: "create",
    draftVersion: state.draftVersion + 1,
  });
};

export const restorePreviousComposerDraft = () => {
  if (state.previousComposerDraft?.draft.mode !== state.draft.mode) return;
  const { draft, scope } = state.previousComposerDraft;
  patchState({
    draft,
    scope,
    draftVersion: state.draftVersion + 1,
    previousComposerDraft: undefined,
  });
};

export const reviewDialogueJob = (job: PlaygroundJob) => {
  const draft = dialogueJobToDraft(job);
  if (!draft) return;
  const previous = draftBeforeJobReview("dialogue");
  rememberToolDraft();
  patchState({
    draft,
    previousComposerDraft: previous,
    scope: job.scope ?? state.scope,
    activeSubTab: "create",
    draftVersion: state.draftVersion + 1,
  });
};

export const retryWithVoiceSwap = async (
  itemId: string,
  overrides: {
    provider?: PlaygroundVoiceOption["provider"];
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
  { showJobs }: { showJobs?: boolean } = {},
) => {
  const release = beginBusyAction(`retry:${itemId}`, {
    activeSubTab: showJobs ? "jobs" : "create",
  });
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
    acceptSubmittedJobs(created, showJobs ? "jobs" : "create");
    say(
      overrides.voiceName
        ? `Regenerating with ${overrides.voiceName}…`
        : "Regenerating take with saved settings…",
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Retry failed";
    say(msg);
  } finally {
    release();
  }
};

export const loadRemoteHistory = async (page = 0) => {
  if (state.remoteHistory.status === "loading") return;
  patchState({
    remoteHistory: {
      status: "loading",
      items: state.remoteHistory.items,
      hasMore: state.remoteHistory.hasMore,
      warning: state.remoteHistory.warning,
      page: state.remoteHistory.page,
    },
  });
  try {
    const res = await fetchJson<{
      items: RemoteHistoryEntry[];
      hasMore: boolean;
      warning?: string;
    }>(`/api/voice/playground/remote-history?page=${page}&pageSize=30&scope=project`);
    const incoming = res.items ?? [];
    const seen = new Set(state.remoteHistory.items.map((x) => x.id));
    const items =
      page === 0
        ? incoming
        : [...state.remoteHistory.items, ...incoming.filter((x) => !seen.has(x.id))];
    patchState({
      remoteHistory: {
        status: "ready",
        items,
        hasMore: Boolean(res.hasMore),
        warning: res.warning ?? null,
        page,
      },
    });
  } catch (e) {
    patchState({
      remoteHistory: {
        status: "error",
        items: state.remoteHistory.items,
        hasMore: state.remoteHistory.hasMore,
        warning: state.remoteHistory.warning,
        page: state.remoteHistory.page,
        error:
          e instanceof TypeError
            ? "Couldn't load cloud history. Reconnect to Studio, then select Refresh."
            : e instanceof Error
              ? e.message
              : "Couldn't load cloud history. Select Refresh to try again.",
      },
    });
  }
};

export const importRemoteHistoryTask = async (
  taskId: string,
  kind?: "tts" | "dialogue" | "voice_changer",
  job?: PlaygroundJob,
) => {
  const scope = job?.scope ?? "project";
  const release = beginBusyAction(`import:${taskId}`);
  try {
    const res = await fetchJson<{ item: VoicePlaygroundItem; alreadyImported: boolean }>(
      `/api/voice/playground/remote-history/import?scope=${scope}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId,
          kind,
          ...(job
            ? {
                dialogueRecipe: job.dialogueRecipe,
                dialogueParentId: job.dialogueParentId,
              }
            : {}),
        }),
      },
    );
    const item = res.item ? { ...res.item, scope } : null;
    const items = item ? upsertById(state.items, item, true) : state.items;
    const remoteItems = state.remoteHistory.items.map((r) =>
      scope === "project" && r.id === taskId
        ? { ...r, importedItemId: res.item?.id ?? r.importedItemId }
        : r,
    );
    release({
      items,
      selectedUid: res.item ? playgroundAuditionId(res.item.id) : state.selectedUid,
      ...(job && item && state.activeSubTab === "jobs"
        ? { activeSubTab: "inspect", workbenchMediumTab: "inspect" }
        : {}),
      remoteHistory: { ...state.remoteHistory, items: remoteItems },
    });
    const destination = scope === "global" ? "Global Recordings" : "this project's Recordings";
    say(res.alreadyImported ? `Already in ${destination}` : `Saved to ${destination}`);
    return res.item;
  } catch (e) {
    const msg =
      e instanceof TypeError
        ? "Couldn't confirm the recording was saved. Reconnect to Studio and refresh Cloud recovery."
        : e instanceof Error
          ? e.message
          : "Couldn't save the cloud recording. Refresh and try again.";
    release();
    say(msg);
    return null;
  } finally {
    release();
  }
};

export const recoverDialogueRecording = (job: PlaygroundJob) => {
  const taskId = job.remoteTaskId;
  if (taskId && !state.busyAction) return importRemoteHistoryTask(taskId, "dialogue", job);
};

export const promotePlaygroundToTake = async (itemId: string, takeId: string): Promise<boolean> => {
  const release = beginBusyAction(`promote:${itemId}`);
  try {
    const scope = state.items.find((item) => item.id === itemId)?.scope ?? state.scope;
    const res = await fetchJson<{ ok: true; takeId: string; tryFile: string }>(
      `/api/voice/playground/promote?scope=${scope}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId, takeId }),
      },
    );
    release();
    await loadVoiceTakes();
    say(`Added to Take ${res.takeId} alternatives (${res.tryFile})`);
    return true;
  } catch (e) {
    release();
    say(e instanceof Error ? e.message : "Could not send to film take");
    return false;
  } finally {
    release();
  }
};

export const fetchPlaygroundSrt = async (
  itemId: string,
  srtFile: string,
): Promise<string | null> => {
  try {
    const res = await fetch(
      playgroundScopedUrl(
        `/api/voice/playground/srt/${encodeURIComponent(srtFile)}`,
        state.items.find((item) => item.id === itemId)?.scope ?? state.scope,
      ),
    );
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
    if (!isPlaygroundLoaded(state) && state.loadState.status !== "loading") {
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

export const playgroundScopedUrl = (url: string, scope = state.scope) =>
  scope === "global" && url.startsWith("/api/voice/playground/") && !/[?&]scope=/.test(url)
    ? `${url}${url.includes("?") ? "&" : "?"}scope=global`
    : url;

export const setPlaygroundScope = (scope: "project" | "global") => {
  if (state.busyAction) return;
  patchState({ scope });
};
export const setPlaygroundLibraryScope = (libraryScope: "all" | "project" | "global") =>
  patchState({ libraryScope });
export const copyPlaygroundToScope = async (id: string) => {
  const scope =
    (state.items.find((item) => item.id === id)?.scope ?? state.scope) === "global"
      ? "project"
      : "global";
  const release = beginBusyAction(`copy:${id}`);
  try {
    await fetchJson(`/api/voice/playground/items/${encodeURIComponent(id)}/copies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope }),
    });
    say(`Saved a complete copy to ${scope === "global" ? "Global" : "Project"}. Original kept.`);
  } catch (error) {
    say(error instanceof Error ? error.message : "Unable to copy; try again");
  } finally {
    release();
  }
};
export const togglePlaygroundVoiceFavorite = async (
  voice: PlaygroundVoiceOption,
  value?: boolean,
) => {
  const favorite =
    value ??
    !state.favoriteVoices.some(
      (v) =>
        v.id === voice.id &&
        (v.connection ?? "genvoice") === (voice.connection ?? "genvoice") &&
        (v.provider ?? "elevenlabs") === (voice.provider ?? "elevenlabs"),
    );
  try {
    const result = await fetchJson<{ voices: PlaygroundVoiceOption[] }>(
      "/api/voice/playground/voice-favorites",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ voice, favorite }),
      },
    );
    patchState({ favoriteVoices: result.voices });
    return true;
  } catch (error) {
    say(error instanceof Error ? error.message : "Unable to save favorite; try again");
    return false;
  }
};
export const togglePlaygroundCompare = (uid: string) => {
  const current = state.compareUids;
  if (!current.includes(uid) && current.length >= 7) {
    say("Compare up to seven takes. Remove one to add another.");
    return;
  }
  patchState({
    compareUids: current.includes(uid) ? current.filter((id) => id !== uid) : [...current, uid],
  });
};

export const openSpeechComparison = (batchId?: string) => {
  patchState({
    recentSpeechBatch: batchId,
    speechReviewBatchId: undefined,
    activeSubTab: "compare",
  });
};

export const toggleSpeechComparisonVoice = (voice: PlaygroundVoiceOption) => {
  if ((voice.connection ?? "genvoice") !== "genvoice") return;
  const voices = state.compareVoices ?? [];
  const key = castingAuditionId(voice);
  const selected = voices.some((candidate) => castingAuditionId(candidate) === key);
  if (!selected && voices.length >= 7) {
    say("Compare up to seven voices.");
    return;
  }
  patchState({
    compareVoices: selected
      ? voices.filter((candidate) => castingAuditionId(candidate) !== key)
      : [...voices, voice],
  });
};

type ProfileChanges = Partial<
  Pick<PlaygroundVoiceProfile, "alias" | "description" | "color" | "rating" | "tags" | "rights">
> & { archived?: boolean };

export const listPlaygroundProfiles = (query: URLSearchParams, signal: AbortSignal) =>
  fetchJson<{ profiles: PlaygroundVoiceProfile[]; total: number; hasMore: boolean }>(
    `/api/voice/playground/profiles?${query}`,
    { signal },
  );

export const savePlaygroundProfile = async (
  voice: PlaygroundVoiceOption,
  scope: "project" | "global",
) => {
  const result = await fetchJson<{ profile: PlaygroundVoiceProfile }>(
    `/api/voice/playground/profiles?scope=${scope}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ voice }),
    },
  );
  return result.profile;
};

export const patchPlaygroundProfile = async (
  profile: PlaygroundVoiceProfile,
  patch: ProfileChanges,
) => {
  const result = await fetchJson<{ profile: PlaygroundVoiceProfile }>(
    `/api/voice/playground/profiles/${encodeURIComponent(profile.id)}?scope=${profile.scope}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
  return result.profile;
};

export const copyPlaygroundProfile = async (profile: PlaygroundVoiceProfile) => {
  const result = await fetchJson<{ profile: PlaygroundVoiceProfile }>(
    `/api/voice/playground/profiles/${encodeURIComponent(profile.id)}/copies?scope=${profile.scope}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: profile.scope === "project" ? "global" : "project" }),
    },
  );
  return result.profile;
};

export const archiveFilmTake = async (
  entry: UnifiedPlaygroundEntry,
  scope: "project" | "global",
  { reveal = true } = {},
): Promise<VoicePlaygroundItem | null> => {
  if (entry.origin !== "film_take" || !entry.audioUrl) return null;
  const release = beginBusyAction(`archive:${entry.id}`);
  try {
    const { item } = await fetchJson<{ item: VoicePlaygroundItem }>(
      `/api/voice/playground/film-takes/${encodeURIComponent(entry.id)}/copies?scope=project`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope,
          name: entry.title.slice(0, 120),
          voiceName: entry.voiceName,
        }),
      },
    );
    patchState({ items: upsertById(state.items, item, true) });
    if (reveal) {
      selectPlaygroundUid(`pg:${item.id}`);
      setPlaygroundSubTab("inspect");
      say(`Recording saved to ${scope === "global" ? "Global" : "Project"}. The original is kept.`);
    }
    return item;
  } catch (error) {
    say(error instanceof Error ? error.message : "Unable to save recording; try again");
    return null;
  } finally {
    release();
  }
};

export const comparePlaygroundEntry = async (entry: UnifiedPlaygroundEntry) => {
  if (entry.origin !== "film_take") return togglePlaygroundCompare(entry.uid);
  if (state.busyAction) return;
  if (state.compareUids.length >= 7) {
    say("Compare up to seven takes. Remove one to add another.");
    return;
  }
  const saved = await archiveFilmTake(entry, "project", { reveal: false });
  if (saved && !state.compareUids.includes(`pg:${saved.id}`)) {
    togglePlaygroundCompare(`pg:${saved.id}`);
    say("Saved this recording for A/B. It stays unchanged when you replace the film take.");
  }
};

export const savePlaygroundTemplate = async (
  title: string,
  scope: "project" | "global",
  update = false,
) => {
  if (
    state.draft.mode === "stt" &&
    state.draft.sttSourceKind === "upload" &&
    state.sttSourceUpload?.status &&
    state.sttSourceUpload.status !== "idle"
  ) {
    say(
      state.sttSourceUpload.status === "uploading"
        ? "Wait for the source upload before saving this template."
        : "Save the source again before saving this template.",
    );
    return false;
  }
  const release = beginBusyAction("template");
  try {
    const id = update ? state.draft.templateId : undefined;
    const draft = { ...state.draft, templateId: undefined, templateScope: undefined };
    const url = `${id ? `/api/voice/playground/templates/${encodeURIComponent(id)}` : "/api/voice/playground/templates"}?scope=${scope}`;
    const res = await fetchJson<{ template: PlaygroundTemplate }>(url, {
      method: id ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, draft }),
    });
    patchState({
      templates: upsertById(state.templates, res.template),
      draft: { ...state.draft, templateId: res.template.id, templateScope: res.template.scope },
    });
    say(`Template saved to ${scope === "global" ? "Global" : "Project"}. No generation charge.`);
    return true;
  } catch (error) {
    say(error instanceof Error ? error.message : "Unable to save template; try again");
    return false;
  } finally {
    release();
  }
};
export const updatePlaygroundTemplate = async (
  template: PlaygroundTemplate,
  change: Partial<PlaygroundTemplate> & { archived?: boolean },
) => {
  try {
    const res = await fetchJson<{ template: PlaygroundTemplate }>(
      `/api/voice/playground/templates/${encodeURIComponent(template.id)}?scope=${template.scope}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(change),
      },
    );
    patchState({ templates: upsertById(state.templates, res.template) });
    return res.template;
  } catch (error) {
    say(error instanceof Error ? error.message : "Unable to save template; try again");
  }
};

export const setPlaygroundTargetTake = (targetTakeId: string) => patchState({ targetTakeId });
export const loadPlaygroundUsage = async () => {
  try {
    const result = await fetchJson<{ usage: PlaygroundUsage[] }>("/api/voice/playground/usage");
    patchState({ usage: result.usage });
  } catch {
    patchState({ usage: [] });
  }
};
export const usePlaygroundTakeInFilm = async (entry: UnifiedPlaygroundEntry, takeId: string) => {
  if (!takeId || !entry.playgroundItem) return false;
  const release = beginBusyAction(`use:${entry.id}`);
  try {
    const scope = entry.playgroundItem.scope ?? "project";
    const result = await fetchJson<{ ok: boolean; tryFile: string }>(
      `/api/voice/playground/promote?scope=${scope}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId: entry.id, takeId }),
      },
    );
    if (!(await promoteVoiceTry(takeId, result.tryFile, { showNotice: false }))) return false;
    const selected = await fetchJson<{ usage: PlaygroundUsage[] }>(
      `/api/voice/playground/usage?scope=${scope}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId: entry.id, takeId, tryFile: result.tryFile }),
      },
    );
    patchState({ usage: selected.usage, targetTakeId: takeId });
    await loadVoiceTakes();
    say(`Now using ${entry.voiceName} for Take ${takeId}. Previous audio kept in alternatives.`);
    return true;
  } catch (error) {
    say(error instanceof Error ? error.message : "Unable to switch take; try again");
    return false;
  } finally {
    release();
  }
};

export const copyPlaygroundTemplate = async (template: PlaygroundTemplate) => {
  try {
    const scope = template.scope === "global" ? "project" : "global";
    const result = await fetchJson<{ template: PlaygroundTemplate }>(
      `/api/voice/playground/templates/${encodeURIComponent(template.id)}/copies?scope=${template.scope}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope }),
      },
    );
    patchState({ templates: upsertById(state.templates, result.template) });
    say(`Template copied to ${scope === "global" ? "Global" : "Project"}`);
  } catch (error) {
    say(error instanceof Error ? error.message : "Unable to copy template; try again");
  }
};
export const deletePlaygroundTemplate = async (template: PlaygroundTemplate) => {
  const archived = await updatePlaygroundTemplate(template, { archived: true });
  if (archived) {
    showUndo(
      "Template archived",
      async () => {
        if (await updatePlaygroundTemplate(archived, { archived: false })) say("Template restored");
      },
      10000,
      state.workbenchOpen ? voicePlaygroundToast : undefined,
    );
  }
  return archived;
};

export const saveUploadedSttSource = async (file: File) => {
  const sequence = ++sttUploadSeq;
  setComposerDraft({ sttSourceKind: "upload", sttSourceFile: "", sttSourceLabel: file.name });
  patchState({ sttSourceUpload: { status: "uploading", name: file.name } });
  try {
    const form = new FormData();
    form.set("audio", file);
    const source = await fetchJson<{ sourceFile: string }>("/api/voice/playground/sources", {
      method: "POST",
      body: form,
    });
    if (sequence !== sttUploadSeq) return;
    const saved = { sttSourceFile: source.sourceFile, sttSourceLabel: file.name };
    if (state.draft.mode === "stt") setComposerDraft(saved);
    else {
      const cached = toolDrafts.get("stt");
      if (cached) toolDrafts.set("stt", { ...cached, ...saved });
    }
    patchState({ sttSourceUpload: { status: "idle" } });
  } catch (cause) {
    if (sequence !== sttUploadSeq) return;
    patchState({
      sttSourceUpload: {
        status: "failed",
        name: file.name,
        error: cause instanceof Error ? cause.message : "Source upload failed",
      },
    });
  }
};

export const saveUploadedVoiceSource = async (file: File) => {
  const sequence = ++sourceUploadSeq;
  const release = beginBusyAction("source");
  try {
    const form = new FormData();
    form.set("audio", file);
    const source = await fetchJson<{ sourceFile: string }>("/api/voice/playground/sources", {
      method: "POST",
      body: form,
    });
    if (sequence !== sourceUploadSeq) return;
    if (state.draft.mode === "voice_changer") setComposerDraft({ vcSourceFile: source.sourceFile });
    else {
      const cached = toolDrafts.get("voice_changer");
      if (cached) toolDrafts.set("voice_changer", { ...cached, vcSourceFile: source.sourceFile });
    }
    say(`Saved source audio ${file.name}. No generation credits used.`);
  } catch (error) {
    say(error instanceof Error ? error.message : "Unable to save source; choose the file again");
  } finally {
    release();
  }
};

type CloneLoadState =
  | { status: "idle" }
  | { status: "loading"; promise: Promise<void>; rerun: boolean };
type CloneObservationState = { status: "idle" } | { status: "observing" };
type CloneMonitorState =
  | { status: "idle" }
  | { status: "armed"; until: number }
  | { status: "scheduled"; until: number; timer: ReturnType<typeof setTimeout> };

let cloneLoad: CloneLoadState = { status: "idle" };
const getCloneLoad = (): CloneLoadState => cloneLoad;
let cloneObservation: CloneObservationState = { status: "idle" };
let cloneMonitor: CloneMonitorState = { status: "idle" };
const resetCloneMonitor = () => {
  if (cloneMonitor.status === "scheduled") clearTimeout(cloneMonitor.timer);
  cloneMonitor = { status: "idle" };
};
const ensureCloneMonitor = () => {
  const active = state.clones?.some(
    (clone) =>
      ["submitting", "processing"].includes(clone.phase) ||
      (clone.phase === "uncertain" && Boolean(clone.remoteId)) ||
      (clone.phase === "ready" &&
        !clone.previewError &&
        (!clone.lastCheckedAt || clone.previewStale)),
  );
  if (!active) {
    resetCloneMonitor();
    return;
  }
  if (
    !state.status.configured ||
    cloneMonitor.status === "scheduled" ||
    state.cloneCloudState.status === "error"
  )
    return;
  const until = cloneMonitor.status === "armed" ? cloneMonitor.until : Date.now() + 15 * 60_000;
  if (Date.now() >= until) {
    cloneMonitor = { status: "armed", until };
    patchState({
      cloneCloudState: {
        status: "error",
        error:
          "Processing is taking longer. Use Refresh to check the existing voice; nothing was submitted again.",
      },
    });
    return;
  }
  const timer = setTimeout(() => {
    cloneMonitor = { status: "armed", until };
    void loadPlaygroundClones({ observe: true });
  }, 2000);
  cloneMonitor = { status: "scheduled", until, timer };
};
export const loadPlaygroundClones = async ({ observe = false } = {}) => {
  const needsCloud = state.clones?.some(
    (clone) =>
      Boolean(clone.remoteId) &&
      (["processing", "uncertain"].includes(clone.phase) ||
        (clone.phase === "ready" &&
          !clone.previewError &&
          (!clone.lastCheckedAt || clone.previewStale))),
  );
  if (observe && needsCloud && state.status.configured && cloneObservation.status === "idle") {
    cloneObservation = { status: "observing" };
    void (async () => {
      try {
        await fetchJson("/api/voice/playground/clones?scope=project&includeGlobal=1&refresh=1", {
          signal: AbortSignal.timeout(120_000),
        });
        patchState({ cloneCloudState: { status: "ok" } });
        await loadPlaygroundClones();
      } catch (error) {
        patchState({
          cloneCloudState: {
            status: "error",
            error: error instanceof Error ? error.message : "Unable to check GenVoice clone status",
          },
        });
      } finally {
        cloneObservation = { status: "idle" };
      }
    })();
  }
  if (cloneLoad.status === "loading") {
    cloneLoad = { ...cloneLoad, rerun: true };
    return cloneLoad.promise;
  }
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  cloneLoad = { status: "loading", promise, rerun: false };
  patchState({ clonesState: { status: "loading" } });
  void (async () => {
    let nextError: string | null = null;
    try {
      const data = await fetchJson<{
        clones: PlaygroundClone[];
        favoriteVoices: PlaygroundVoiceOption[];
      }>("/api/voice/playground/clones?scope=project&includeGlobal=1", {
        signal: AbortSignal.timeout(15_000),
      });
      if (!Array.isArray(data.clones) || !Array.isArray(data.favoriteVoices))
        throw new Error("The server returned an invalid voice library response");
      registerCatalogVoices(data.favoriteVoices);
      const announced = new Set<string>();
      for (const clone of data.clones) {
        const previous = state.clones?.find(
          (record) => record.id === clone.id && record.scope === clone.scope,
        );
        const key = `${clone.remoteId ?? clone.id}:${clone.phase}`;
        if (!previous || previous.phase === clone.phase || announced.has(key)) continue;
        const name = clone.displayName ?? clone.settings.name;
        if (clone.phase === "ready") say(`${name} is ready`);
        else if (clone.phase === "failed")
          say(`${name} failed. Open My voices to review the error and recover.`, 7000);
        announced.add(key);
      }
      patchState({ clones: data.clones, favoriteVoices: data.favoriteVoices });
      ensureCloneMonitor();
    } catch (error) {
      nextError = error instanceof Error ? error.message : "Unable to load saved voices";
    } finally {
      const current = getCloneLoad();
      const rerun = current.status === "loading" && current.rerun;
      cloneLoad = { status: "idle" };
      patchState({ clonesState: { status: "idle", error: nextError } });
      if (rerun) void loadPlaygroundClones();
      resolve();
    }
  })();
  return promise;
};
export const createPlaygroundClone = async (
  file: File,
  input: CloneSettings & { permissionConfirmed: true },
  scope: "project" | "global",
) => {
  const body = new FormData();
  body.set("file", file);
  body.set("settings", JSON.stringify(input));
  const result = await fetchJson<{ clone: PlaygroundClone }>(
    `/api/voice/playground/clones?scope=${scope}`,
    { method: "POST", body, signal: AbortSignal.timeout(90_000) },
  );
  resetCloneMonitor();
  patchState({ cloneCloudState: { status: "ok" } });
  await loadPlaygroundClones();
  void loadPlaygroundAll({ liveStatus: true });
  return result.clone;
};
export type CloneAction =
  "cloud" | "adopt" | "link" | "copy" | "update" | "refresh" | "submit" | "retry" | "delete";
export const cloneAction = async (
  action: CloneAction,
  id?: string,
  scope: "project" | "global" = "project",
  input?: Record<string, unknown>,
): Promise<{ clone?: PlaygroundClone; voices?: CloudClone[] }> => {
  const root = id ? `clones/${encodeURIComponent(id)}` : "clones";
  const commands: Record<
    CloneAction,
    { path: string; method: "GET" | "POST" | "PATCH" | "DELETE" }
  > = {
    cloud: { path: "clones/cloud", method: "GET" },
    adopt: { path: "clones/adopt", method: "POST" },
    link: { path: `${root}/link`, method: "POST" },
    copy: { path: `${root}/copies`, method: "POST" },
    update: { path: root, method: "PATCH" },
    refresh: { path: `${root}/refresh`, method: "POST" },
    submit: { path: `${root}/submit`, method: "POST" },
    retry: { path: `${root}/retry`, method: "POST" },
    delete: { path: `${root}/cloud`, method: "DELETE" },
  };
  const command = commands[action];
  const result = await fetchJson<{ clone?: PlaygroundClone; voices?: CloudClone[] }>(
    `/api/voice/playground/${command.path}?scope=${scope}`,
    {
      method: command.method,
      signal: AbortSignal.timeout(120_000),
      ...(input
        ? { headers: { "content-type": "application/json" }, body: JSON.stringify(input) }
        : {}),
    },
  );
  if (action !== "cloud") {
    resetCloneMonitor();
    patchState({ cloneCloudState: { status: "ok" } });
    await loadPlaygroundClones();
  }
  if (action === "retry" || action === "submit") void loadPlaygroundAll({ liveStatus: true });
  return result;
};
