import {
  CloudDownload,
  CopyPlus,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Search,
  Star,
  X,
} from "lucide-react";
import { useMemo, useRef, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { Tip } from "../components/Tip";
import { formatSoundDuration } from "./library-view";
import { listening, listenUrl, subscribeAudition } from "./sound";
import {
  duplicateEntryToComposer,
  importRemoteHistoryTask,
  loadPlaygroundAll,
  loadRemoteHistory,
  selectPlaygroundUid,
  setPlaygroundFilters,
  setPlaygroundSubTab,
  toggleUnifiedFavorite,
  type VoicePlaygroundClientState,
} from "./voice-playground-client";
import { PLAYGROUND_MODE_PRESENTATION } from "./voice-playground-presentation";
import {
  DEFAULT_PLAYGROUND_FILTERS,
  extractPlaygroundFacets,
  filterAndSortEntries,
  isSafeAudioUrl,
  nextTabId,
  type PlaygroundKindFilter,
  type PlaygroundSortKey,
  type PlaygroundSourceFilter,
  type UnifiedPlaygroundEntry,
} from "./voice-playground-view";

const SOURCE_TABS: Array<{ id: PlaygroundSourceFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "playground", label: "Playground" },
  { id: "film_take", label: "AI Takes" },
  { id: "templates", label: "Templates" },
  { id: "favorites", label: "Starred" },
];

const SORT_LABELS: Array<{ id: PlaygroundSortKey; label: string }> = [
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
  { id: "favorites", label: "Favorites first" },
  { id: "longest", label: "Longest" },
  { id: "shortest", label: "Shortest" },
  { id: "voice", label: "Voice A–Z" },
  { id: "model", label: "Model A–Z" },
  { id: "credits", label: "Credits" },
];

const SORT_ITEMS = SORT_LABELS.map((s) => ({ value: s.id, label: s.label }));

const KIND_ITEMS: Array<{ value: PlaygroundKindFilter; label: string }> = [
  { value: "all", label: "All modes" },
  { value: "tts", label: "TTS" },
  { value: "dialogue", label: "Dialogue" },
  { value: "voice_changer", label: "Voice Changer" },
];

/**
 * Filterable, sortable archive of Playground generations, AI film takes, Templates, Starred clips, and 24h Cloud history.
 */
export function VoicePlaygroundLibrary({
  pg,
  unifiedEntries,
  showCloudTab = false,
  onSelectForInspect,
}: {
  pg: VoicePlaygroundClientState;
  unifiedEntries: readonly UnifiedPlaygroundEntry[];
  showCloudTab?: boolean;
  onSelectForInspect?: (uid: string) => void;
}) {
  const { filters, remoteHistory, selectedUid, busyAction } = pg;
  const cloudMode = pg.activeSubTab === "remote";
  const setCloudMode = (cloud: boolean) => setPlaygroundSubTab(cloud ? "remote" : "library");
  const nowPlaying = useSyncExternalStore(subscribeAudition, listening, listening);

  const facets = useMemo(() => extractPlaygroundFacets(unifiedEntries), [unifiedEntries]);
  const voiceItems = useMemo(
    () => [
      { value: "all", label: "All voices" },
      ...facets.voices.map((vf) => ({ value: vf.id, label: `${vf.label} (${vf.count})` })),
    ],
    [facets.voices],
  );
  const modelItems = useMemo(
    () => [
      { value: "all", label: "All models" },
      ...facets.models.map((mf) => ({ value: mf.id, label: `${mf.label} (${mf.count})` })),
    ],
    [facets.models],
  );
  const tagItems = useMemo(
    () => [
      { value: "all", label: "All tags" },
      ...facets.tags.map((tf) => ({ value: tf.id, label: `[${tf.label}] (${tf.count})` })),
    ],
    [facets.tags],
  );
  const visible = useMemo(
    () => filterAndSortEntries(unifiedEntries, filters),
    [unifiedEntries, filters],
  );

  const sourceTabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const hasActiveFilters =
    filters.source !== "all" ||
    filters.kind !== "all" ||
    filters.voiceId !== "all" ||
    filters.modelId !== "all" ||
    filters.tag !== "all" ||
    filters.query.trim().length > 0;
  const sourceTabOrder = useMemo(
    () =>
      showCloudTab ? [...SOURCE_TABS.map((t) => t.id), "cloud"] : SOURCE_TABS.map((t) => t.id),
    [showCloudTab],
  );
  const activeSourceTab = cloudMode ? "cloud" : filters.source;
  const handleSourceTabKeyDown = (e: { key: string; preventDefault(): void }) => {
    const next = nextTabId(sourceTabOrder, activeSourceTab, e.key);
    if (!next) return;
    e.preventDefault();
    if (next === "cloud") {
      setCloudMode(true);
      if (!remoteHistory.items.length && !remoteHistory.loading) void loadRemoteHistory(0);
    } else {
      setCloudMode(false);
      setPlaygroundFilters({ source: next as PlaygroundSourceFilter });
    }
    sourceTabRefs.current[next]?.focus();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* Source Tabs + Optional Cloud 24h Switch */}
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div
          role="tablist"
          aria-label="Playground clip sources"
          className="flex flex-wrap items-center gap-1"
        >
          {SOURCE_TABS.map((t) => {
            const active = !cloudMode && filters.source === t.id;
            return (
              <button
                key={t.id}
                ref={(el) => {
                  sourceTabRefs.current[t.id] = el;
                }}
                type="button"
                role="tab"
                tabIndex={active ? 0 : -1}
                aria-selected={active}
                onKeyDown={handleSourceTabKeyDown}
                onClick={() => {
                  setCloudMode(false);
                  setPlaygroundFilters({ source: t.id });
                }}
                className={cn(
                  "focus-visible:ring-ring rounded-md px-2 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-2",
                  active
                    ? "bg-tint text-primary-text"
                    : "bg-raised-2 text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            );
          })}
          {showCloudTab && (
            <button
              ref={(el) => {
                sourceTabRefs.current.cloud = el;
              }}
              type="button"
              role="tab"
              tabIndex={cloudMode ? 0 : -1}
              aria-selected={cloudMode}
              onKeyDown={handleSourceTabKeyDown}
              onClick={() => {
                setCloudMode(true);
                if (!remoteHistory.items.length && !remoteHistory.loading) {
                  void loadRemoteHistory(0);
                }
              }}
              className={cn(
                "focus-visible:ring-ring inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-2",
                cloudMode
                  ? "bg-tint text-primary-text"
                  : "bg-raised-2 text-muted-foreground hover:text-foreground",
              )}
            >
              <CloudDownload className="size-3" />
              <span>24h Cloud</span>
            </button>
          )}
        </div>

        <span className="text-muted-foreground text-xs tabular-nums">
          {cloudMode ? `${remoteHistory.items.length} cloud` : `${visible.length} shown`}
        </span>
      </div>

      {/* Cloud 24h GenVoice Remote History View */}
      {cloudMode ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">
              GenVoice purges remote audio after 24h — archive any clip locally here.
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={remoteHistory.loading}
              onClick={() => void loadRemoteHistory(0)}
            >
              <RefreshCw
                className={cn(
                  "size-3",
                  remoteHistory.loading && "animate-spin motion-reduce:animate-none",
                )}
              />
              <span>Refresh</span>
            </Button>
          </div>
          {remoteHistory.error && (
            <p className="bg-warn-bg/80 text-warn-text rounded px-2.5 py-1.5 text-sm">
              {remoteHistory.error}
            </p>
          )}
          {remoteHistory.warning && (
            <p className="bg-warn-bg/60 text-warn-text rounded px-2.5 py-1.5 text-sm">
              {remoteHistory.warning}
            </p>
          )}
          <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overscroll-contain pe-0.5">
            {remoteHistory.items.map((r) => {
              const importing = busyAction === `import:${r.id}`;
              const previewId = `pg-remote:${r.id}`;
              const isPlaying = nowPlaying === previewId;
              const safePreviewUrl = isSafeAudioUrl(r.audioUrl) ? r.audioUrl : "";
              return (
                <div
                  key={r.id}
                  className="border-hairline bg-card flex flex-wrap items-start gap-2 rounded-lg border p-2"
                >
                  <div className="min-w-0 flex-1 basis-40">
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      <span
                        className={cn(
                          "text-xs font-medium",
                          PLAYGROUND_MODE_PRESENTATION[r.kind].text,
                        )}
                      >
                        {PLAYGROUND_MODE_PRESENTATION[r.kind].label}
                      </span>
                      <span
                        className="text-foreground max-w-full truncate text-sm font-medium"
                        title={r.voiceName || r.voiceId}
                      >
                        {r.voiceName || r.voiceId}
                      </span>
                      <span className="text-muted-foreground max-w-full font-mono text-xs wrap-anywhere">
                        {r.modelId}
                      </span>
                    </div>
                    <p className="text-foreground/85 mt-1 line-clamp-2 text-sm">
                      {r.text || r.title}
                    </p>
                    <span className="text-muted-foreground mt-0.5 block text-xs tabular-nums">
                      {r.charactersUsed} ch · {r.creditsDeducted} cr
                    </span>
                  </div>
                  <div className="ms-auto flex flex-none items-center gap-1">
                    {safePreviewUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`${isPlaying ? "Pause" : "Preview"} remote clip ${r.id}`}
                        aria-pressed={isPlaying}
                        onClick={() => listenUrl(previewId, safePreviewUrl)}
                      >
                        {isPlaying ? <Pause className="size-3" /> : <Play className="size-3" />}
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant={r.importedItemId ? "lit" : "secondary"}
                      size="sm"
                      disabled={
                        importing ||
                        Boolean(r.importedItemId) ||
                        r.status !== "completed" ||
                        !safePreviewUrl
                      }
                      onClick={() => void importRemoteHistoryTask(r.id, r.kind)}
                    >
                      {importing ? (
                        <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />
                      ) : r.importedItemId ? (
                        "Saved ✓"
                      ) : r.status !== "completed" ? (
                        r.status
                      ) : (
                        "Archive"
                      )}
                    </Button>
                  </div>
                </div>
              );
            })}
            {remoteHistory.hasMore && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={remoteHistory.loading}
                onClick={() => void loadRemoteHistory(remoteHistory.page + 1)}
              >
                {remoteHistory.loading ? "Loading…" : "Load more remote history"}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <>
          {pg.error && !pg.loading && (
            <div className="border-warn/40 bg-warn-bg/80 text-warn-text flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm">
              <span className="min-w-0 truncate">{pg.error}</span>
              <Button
                type="button"
                variant="warn"
                size="sm"
                onClick={() => void loadPlaygroundAll({ refresh: true })}
              >
                Retry load
              </Button>
            </div>
          )}

          {/* Search + Multi-Facet Filter & Sort Row */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <div className="relative flex min-w-0 flex-1 items-center gap-1">
                <Search className="text-muted-foreground pointer-events-none absolute left-2.5 size-3.5" />
                <Input
                  size="search"
                  value={filters.query}
                  onChange={(e) => setPlaygroundFilters({ query: e.target.value })}
                  placeholder="Search prompt, tag, voice, model, note…"
                  aria-label="Search voice playground clips"
                />
                {filters.query && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Clear search"
                    onClick={() => setPlaygroundFilters({ query: "" })}
                  >
                    <X className="size-3.5" />
                  </Button>
                )}
              </div>

              <Select
                items={SORT_ITEMS}
                value={filters.sort}
                onValueChange={(v) => v && setPlaygroundFilters({ sort: v as PlaygroundSortKey })}
              >
                <SelectTrigger size="sm" aria-label="Sort voice entries">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_LABELS.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap items-center gap-1">
              <Select
                items={KIND_ITEMS}
                value={filters.kind}
                onValueChange={(v) =>
                  v && setPlaygroundFilters({ kind: v as PlaygroundKindFilter })
                }
              >
                <SelectTrigger size="sm" aria-label="Filter by mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KIND_ITEMS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="max-w-36 min-w-0">
                <Select
                  items={voiceItems}
                  value={filters.voiceId}
                  onValueChange={(v) => v && setPlaygroundFilters({ voiceId: v })}
                >
                  <SelectTrigger size="sm" aria-label="Filter by voice">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All voices</SelectItem>
                    {facets.voices.map((vf) => (
                      <SelectItem key={vf.id} value={vf.id}>
                        {vf.label} ({vf.count})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="max-w-36 min-w-0">
                <Select
                  items={modelItems}
                  value={filters.modelId}
                  onValueChange={(v) => v && setPlaygroundFilters({ modelId: v })}
                >
                  <SelectTrigger size="sm" aria-label="Filter by model">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All models</SelectItem>
                    {facets.models.map((mf) => (
                      <SelectItem key={mf.id} value={mf.id}>
                        {mf.label} ({mf.count})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {facets.tags.length > 0 && (
                <div className="max-w-36 min-w-0">
                  <Select
                    items={tagItems}
                    value={filters.tag}
                    onValueChange={(v) => v && setPlaygroundFilters({ tag: v })}
                  >
                    <SelectTrigger size="sm" aria-label="Filter by audio tag">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All tags</SelectItem>
                      {facets.tags.map((tf) => (
                        <SelectItem key={tf.id} value={tf.id}>
                          [{tf.label}] ({tf.count})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {hasActiveFilters && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setPlaygroundFilters(DEFAULT_PLAYGROUND_FILTERS)}
                >
                  Clear filters
                </Button>
              )}
            </div>
          </div>

          {/* Unified Entry List */}
          <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overscroll-contain pe-0.5">
            {visible.map((entry) => {
              const selected = selectedUid === entry.uid;
              const isPlaying = Boolean(entry.auditionId && nowPlaying === entry.auditionId);
              const isPlayground = entry.origin === "playground";
              const presentation = PLAYGROUND_MODE_PRESENTATION[entry.kind];
              return (
                <div
                  key={entry.uid}
                  className={cn(
                    "group border-hairline bg-card flex flex-col gap-1.5 rounded-lg border p-2 transition-colors",
                    selected ? cn(presentation.card, "ring-1") : "hover:bg-raised-2/70",
                  )}
                >
                  <div className="flex items-start gap-2">
                    <Button
                      type="button"
                      variant={isPlaying ? "lit" : "cover"}
                      size="icon"
                      disabled={!entry.audioUrl}
                      aria-pressed={isPlaying}
                      aria-label={`${isPlaying ? "Pause" : "Play"} ${entry.title}`}
                      onClick={() => {
                        if (entry.audioUrl) listenUrl(entry.auditionId, entry.audioUrl);
                      }}
                    >
                      {isPlaying ? (
                        <Pause className="size-3.5 fill-current" />
                      ) : (
                        <Play className="size-3.5 translate-x-[0.5px] fill-current" />
                      )}
                    </Button>

                    <button
                      type="button"
                      aria-current={selected ? "true" : undefined}
                      onClick={() => {
                        selectPlaygroundUid(entry.uid);
                        onSelectForInspect?.(entry.uid);
                      }}
                      className="focus-visible:ring-ring/40 min-w-0 flex-1 rounded text-start outline-none focus-visible:ring-2"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-foreground truncate text-sm font-semibold">
                          {entry.title}
                        </span>
                        {entry.isTemplate && <span className="text-ai-text text-xs">Template</span>}
                        {entry.srtFile && (
                          <span className="text-muted-foreground text-xs">.srt</span>
                        )}
                      </div>
                      <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                        {entry.spoken || entry.text}
                      </p>
                      <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 font-medium",
                            presentation.text,
                          )}
                        >
                          <span
                            aria-hidden
                            className={cn("size-1.5 rounded-full", presentation.dot)}
                          />
                          {isPlayground ? presentation.shortLabel : `Take ${entry.id}`}
                        </span>
                        <span>·</span>
                        <span className="truncate">{entry.voiceName}</span>
                        <span>·</span>
                        <span className="font-mono">{entry.modelId}</span>
                        {entry.durationSeconds > 0 && (
                          <>
                            <span>·</span>
                            <span className="font-mono tabular-nums">
                              {formatSoundDuration(entry.durationSeconds, "sfx")}
                            </span>
                          </>
                        )}
                      </div>
                    </button>

                    <div className="flex flex-none items-center gap-0.5">
                      <Tip label={entry.favorite ? "Unstar" : "Star clip"}>
                        <Button
                          type="button"
                          variant="favorite"
                          size="icon-xs"
                          aria-pressed={entry.favorite}
                          aria-label={`Favorite ${entry.title}`}
                          onClick={() => void toggleUnifiedFavorite(entry)}
                        >
                          <Star className={cn("size-3.5", entry.favorite && "fill-current")} />
                        </Button>
                      </Tip>
                      <Tip label="Duplicate settings & prompt into Editor">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`Duplicate ${entry.title} to Editor`}
                          onClick={() => duplicateEntryToComposer(entry)}
                        >
                          <CopyPlus className="size-3.5" />
                        </Button>
                      </Tip>
                    </div>
                  </div>

                  {entry.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 ps-9">
                      {entry.tags.slice(0, 4).map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() =>
                            setPlaygroundFilters({
                              tag: filters.tag === tag ? "all" : tag,
                            })
                          }
                          className={cn(
                            "focus-visible:ring-ring rounded px-1.5 py-0.5 text-xs font-medium transition-colors outline-none focus-visible:ring-2",
                            filters.tag === tag
                              ? "bg-primary text-primary-foreground"
                              : "bg-surface-subtle text-label hover:bg-tint hover:text-primary-text",
                          )}
                        >
                          [{tag}]
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {visible.length === 0 && (
              <div className="text-muted-foreground flex flex-col items-center justify-center gap-2 py-8 text-center text-sm">
                <p>No voice clips match these filters yet.</p>
                {hasActiveFilters && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setPlaygroundFilters(DEFAULT_PLAYGROUND_FILTERS)}
                  >
                    Show all clips
                  </Button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
