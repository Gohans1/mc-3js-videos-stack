import {
  Check,
  CloudDownload,
  CopyPlus,
  Loader2,
  Mars,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Star,
  Timer,
  Venus,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import { Tip } from "../components/Tip";
import { formatSoundDuration } from "./library-view";
import { listening, listenUrl, subscribeAudition } from "./sound";
import {
  comparePlaygroundEntry,
  duplicateEntryToComposer,
  importRemoteHistoryTask,
  loadPlaygroundAll,
  loadRemoteHistory,
  patchPlaygroundSelection,
  recordingRemovalFocus,
  searchPlaygroundRecordings,
  selectPlaygroundUid,
  setPlaygroundFilters,
  setPlaygroundLibraryScope,
  setPlaygroundSubTab,
  toggleUnifiedFavorite,
  type VoicePlaygroundClientState,
} from "./voice-playground-client";
import { PLAYGROUND_MODE_PRESENTATION } from "./voice-playground-presentation";
import {
  castingAuditionId,
  DEFAULT_PLAYGROUND_FILTERS,
  extractDialogueSpeakerEntries,
  extractPlaygroundFacets,
  filterAndSortEntries,
  isSafeAudioUrl,
  nextTabId,
  type PlaygroundKindFilter,
  type PlaygroundSortKey,
  type PlaygroundSourceFilter,
  type UnifiedPlaygroundEntry,
} from "./voice-playground-view";
import { recordedCastSummary } from "./voice-setting-details";
import { VoicePlaybackIcon } from "./VoicePlaybackIcon";
import { VoicePlaygroundCompare } from "./VoicePlaygroundCompare";

const SOURCE_TABS: Array<{ id: PlaygroundSourceFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "playground", label: "Playground" },
  { id: "film_take", label: "AI Takes" },
  { id: "templates", label: "Templates" },
  { id: "favorites", label: "Starred" },
  { id: "archive", label: "Archive" },
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
  { id: "rating", label: "Highest rated" },
  { id: "used", label: "Used in this film" },
  { id: "relevance", label: "Best match" },
];

const SORT_ITEMS = SORT_LABELS.map((s) => ({ value: s.id, label: s.label }));

const KIND_ITEMS: Array<{ value: PlaygroundKindFilter; label: string }> = [
  { value: "all", label: "All modes" },
  { value: "tts", label: "TTS" },
  { value: "dialogue", label: "Dialogue" },
  { value: "voice_changer", label: "Voice Changer" },
  { value: "stt", label: "Transcriptions" },
  { value: "dubbing", label: "Dubbing" },
];

function CloudScriptPreview({ text, title }: { text: string; title?: string }) {
  const preview = useRef<HTMLParagraphElement>(null);
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const element = preview.current;
    if (!element) return;
    const measure = () => setClipped(element.scrollHeight > element.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text]);
  return (
    <div className="mt-1">
      <p
        ref={preview}
        dir="auto"
        className="text-foreground line-clamp-2 max-w-[60ch] text-sm leading-relaxed wrap-anywhere whitespace-pre-wrap"
      >
        {text}
      </p>
      {clipped && (
        <Popover>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="link"
                size="inline"
                aria-label={title ? `Show full script for ${title}` : "Show full script"}
              />
            }
          >
            Show full script
          </PopoverTrigger>
          <PopoverContent
            align="start"
            motion="none"
            className="w-[30rem] max-w-(--available-width)"
          >
            <PopoverTitle>{title || "Full script"}</PopoverTitle>
            <p
              tabIndex={0}
              dir="auto"
              className="text-reading-foreground focus-visible:outline-ring max-h-[min(20rem,50dvh)] overflow-y-auto rounded-sm text-sm leading-relaxed wrap-anywhere whitespace-pre-wrap focus-visible:outline-2"
            >
              {text}
            </p>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

export function VoicePlaygroundLibrary({
  pg,
  unifiedEntries,
  showCloudTab = false,
  onSelectForInspect,
  sidebarNavigation = false,
}: {
  pg: VoicePlaygroundClientState;
  unifiedEntries: readonly UnifiedPlaygroundEntry[];
  showCloudTab?: boolean;
  onSelectForInspect?: (uid: string) => void;
  sidebarNavigation?: boolean;
}) {
  const { filters, remoteHistory, selectedUid, busyAction } = pg;
  const [failedCloudPreview, setFailedCloudPreview] = useState<string | null>(null);
  const cloudMode = pg.activeSubTab === "remote";
  const configured = pg.status.configured;
  useEffect(() => {
    if (cloudMode && configured) void loadRemoteHistory(0);
  }, [cloudMode, configured]);
  const setCloudMode = (cloud: boolean) => setPlaygroundSubTab(cloud ? "remote" : "library");
  const nowPlaying = useSyncExternalStore(subscribeAudition, listening, listening);
  const comparePanelRef = useRef<HTMLDivElement>(null);
  const [advanced, setAdvanced] = useState(false);
  const [favoriteActors, setFavoriteActors] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const selectingRecordings = selecting && filters.source !== "templates";
  const [selection, setSelection] = useState<string[]>([]);
  const [bulkTags, setBulkTags] = useState("");
  const [updating, setUpdating] = useState(false);
  const filterId = useId();
  const [ranking, setRanking] = useState<{
    key: string;
    ids: Map<string, number>;
    hasMore: boolean;
  } | null>(null);
  const query = filters.query.trim().slice(0, 250);
  const archived = filters.source === "archive";
  const searchKey = query ? JSON.stringify([query, archived, pg.libraryScope]) : "";
  useEffect(() => {
    if (!searchKey) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        scope: pg.libraryScope === "global" ? "global" : "project",
        includeGlobal: pg.libraryScope === "all" ? "1" : "0",
        q: query,
        archived: archived ? "1" : "0",
        sort: "relevance",
        pageSize: "100",
      });
      void searchPlaygroundRecordings(params, abort.signal)
        .then((result) => {
          if (!abort.signal.aborted)
            setRanking({
              key: searchKey,
              ids: new Map(result.items.map((item, index) => [item.id, index])),
              hasMore: result.hasMore,
            });
        })
        .catch(() => {});
    }, 150);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [archived, pg.libraryScope, query, searchKey, unifiedEntries]);
  const useCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of pg.usage ?? []) counts.set(row.itemId, (counts.get(row.itemId) ?? 0) + 1);
    return counts;
  }, [pg.usage]);
  const projects = useMemo(
    () =>
      [
        ...new Set(
          unifiedEntries.flatMap((entry) =>
            entry.playgroundItem?.originProject ? [entry.playgroundItem.originProject] : [],
          ),
        ),
      ].sort(),
    [unifiedEntries],
  );
  const comparisonCount = (pg.compareUids ?? []).filter((uid) =>
    unifiedEntries.some((entry) => entry.uid === uid),
  ).length;

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
  const visible = useMemo(() => {
    const actorIds = new Set((pg.favoriteVoices ?? []).map(castingAuditionId));
    const local = filterAndSortEntries(unifiedEntries, filters, useCount);
    const ranked = ranking?.key === searchKey ? ranking : null;
    const matches = ranked ? new Set(local.map((entry) => entry.uid)) : null;
    const entries = ranked
      ? filterAndSortEntries(unifiedEntries, { ...filters, query: "" }, useCount).filter((entry) =>
          entry.playgroundItem
            ? ranked.ids.has(entry.id) || (ranked.hasMore && matches?.has(entry.uid))
            : matches?.has(entry.uid),
        )
      : local;
    if (ranked && filters.sort === "relevance")
      entries.sort(
        (a, b) => (ranked.ids.get(a.id) ?? Infinity) - (ranked.ids.get(b.id) ?? Infinity),
      );
    return entries.filter((entry) => {
      const item = entry.playgroundItem ?? entry.sourceRecording;
      if (
        filters.source === "favorites" &&
        favoriteActors &&
        !actorIds.has(
          castingAuditionId({
            id: entry.voiceId,
            provider: item?.provider === "google" ? undefined : item?.provider,
            connection: item?.connection,
          }),
        )
      )
        return false;
      return (
        !pg.libraryScope ||
        pg.libraryScope === "all" ||
        (entry.playgroundItem?.scope ?? entry.template?.scope ?? "project") === pg.libraryScope
      );
    });
  }, [
    unifiedEntries,
    filters,
    pg.libraryScope,
    pg.favoriteVoices,
    ranking,
    searchKey,
    useCount,
    favoriteActors,
  ]);
  const selectedRecordings = visible.filter(
    (entry) => entry.playgroundItem && selection.includes(entry.id),
  );
  const titleCounts = new Map<string, number>();
  for (const entry of visible)
    titleCounts.set(entry.title, (titleCounts.get(entry.title) ?? 0) + 1);
  const changeSelected = async (patch: Parameters<typeof patchPlaygroundSelection>[1]) => {
    setUpdating(true);
    try {
      const changed = await patchPlaygroundSelection(
        selectedRecordings.map((entry) => entry.id),
        patch,
      );
      const ids = new Set(changed.map((item) => item.id));
      setSelection((current) => current.filter((id) => !ids.has(id)));
    } finally {
      setUpdating(false);
    }
  };

  const sourceTabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const hasActiveFilters =
    (pg.libraryScope ?? "all") !== "all" ||
    (filters.source === "favorites" && favoriteActors) ||
    filters.kind !== "all" ||
    filters.voiceId !== "all" ||
    filters.modelId !== "all" ||
    filters.tag !== "all" ||
    Boolean(
      filters.minRating ||
      filters.after ||
      filters.before ||
      filters.originProject ||
      filters.gender ||
      filters.length,
    ) ||
    filters.query.trim().length > 0;
  const clearFilters = () => {
    setPlaygroundFilters({ ...DEFAULT_PLAYGROUND_FILTERS, source: filters.source });
    setPlaygroundLibraryScope("all");
    setFavoriteActors(false);
  };
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
    } else {
      setCloudMode(false);
      setPlaygroundFilters({ source: next as PlaygroundSourceFilter });
    }
    sourceTabRefs.current[next]?.focus();
  };

  const recordingFilters = cloudMode ? null : (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <div className="relative flex min-w-0 flex-1 items-center gap-1">
          <Search className="text-muted-foreground pointer-events-none absolute start-2.5 size-3.5" />
          <Input
            size="search"
            value={filters.query}
            maxLength={250}
            onChange={(e) =>
              setPlaygroundFilters({
                query: e.target.value,
                ...(e.target.value && filters.sort === "newest" ? { sort: "relevance" } : {}),
              })
            }
            placeholder="Search prompt, tag, voice, model, note…"
            aria-label="Search voice playground clips"
            data-recording-search=""
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
          <SelectTrigger size="readable" aria-label="Sort voice entries">
            <SelectValue />
          </SelectTrigger>
          <SelectContent finalFocus>
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
          onValueChange={(v) => v && setPlaygroundFilters({ kind: v as PlaygroundKindFilter })}
        >
          <SelectTrigger size="readable" aria-label="Filter by mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent finalFocus>
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
            <SelectTrigger size="readable" aria-label="Filter by voice">
              <SelectValue />
            </SelectTrigger>
            <SelectContent finalFocus>
              <SelectItem value="all">All voices</SelectItem>
              {facets.voices.map((vf) => (
                <SelectItem key={vf.id} value={vf.id}>
                  <bdi>{vf.label}</bdi> <span className="tabular-nums">({vf.count})</span>
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
            <SelectTrigger size="readable" aria-label="Filter by model">
              <SelectValue />
            </SelectTrigger>
            <SelectContent finalFocus>
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
              <SelectTrigger size="readable" aria-label="Filter by audio tag">
                <SelectValue />
              </SelectTrigger>
              <SelectContent finalFocus>
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
          <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </div>
      <div className="flex flex-wrap justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={advanced}
          onClick={() => setAdvanced((open) => !open)}
        >
          <SlidersHorizontal /> More filters
        </Button>
        {filters.source !== "templates" && (
          <Button
            type="button"
            variant={selecting ? "lit" : "ghost"}
            size="sm"
            aria-pressed={selecting}
            onClick={() => {
              setSelecting((open) => !open);
              setSelection([]);
            }}
          >
            {selecting ? "Done selecting" : "Select recordings"}
          </Button>
        )}
      </div>
      {filters.source === "favorites" && (
        <Button
          size="sm"
          variant={favoriteActors ? "secondary" : "ghost"}
          aria-pressed={favoriteActors}
          onClick={() => setFavoriteActors((current) => !current)}
        >
          <Star /> By favorite voices
        </Button>
      )}
      {advanced && (
        <div className="border-hairline grid grid-cols-3 gap-2 border-t pt-2">
          <label htmlFor={`${filterId}-after`} className="text-muted-foreground grid gap-1 text-xs">
            Created from
            <Input
              id={`${filterId}-after`}
              type="date"
              size="sm"
              value={filters.after ?? ""}
              onChange={(event) =>
                setPlaygroundFilters({ after: event.currentTarget.value || undefined })
              }
            />
          </label>
          <label
            htmlFor={`${filterId}-before`}
            className="text-muted-foreground grid gap-1 text-xs"
          >
            Created through
            <Input
              id={`${filterId}-before`}
              type="date"
              size="sm"
              value={filters.before ?? ""}
              onChange={(event) =>
                setPlaygroundFilters({ before: event.currentTarget.value || undefined })
              }
            />
          </label>
          <label
            htmlFor={`${filterId}-rating`}
            className="text-muted-foreground grid gap-1 text-xs"
          >
            Minimum stars
            <Input
              id={`${filterId}-rating`}
              type="number"
              min={1}
              max={5}
              size="sm"
              value={filters.minRating ?? ""}
              onChange={(event) =>
                setPlaygroundFilters({
                  minRating: Number(event.currentTarget.value) || undefined,
                })
              }
            />
          </label>
          <label className="text-muted-foreground grid gap-1 text-xs">
            Created in project
            <select
              className="border-input bg-background text-foreground focus-visible:outline-ring h-8 rounded-md border px-2 text-sm"
              value={filters.originProject ?? ""}
              onChange={(event) =>
                setPlaygroundFilters({
                  originProject: event.currentTarget.value || undefined,
                })
              }
            >
              <option value="">Any project</option>
              {projects.map((project) => (
                <option key={project}>{project}</option>
              ))}
            </select>
          </label>
          <label className="text-muted-foreground grid gap-1 text-xs">
            Voice gender
            <select
              className="border-input bg-background text-foreground focus-visible:outline-ring h-8 rounded-md border px-2 text-sm"
              value={filters.gender ?? ""}
              onChange={(event) =>
                setPlaygroundFilters({ gender: event.currentTarget.value || undefined })
              }
            >
              <option value="">Any gender</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="neutral">Neutral</option>
            </select>
          </label>
          <label className="text-muted-foreground grid gap-1 text-xs">
            Length
            <select
              className="border-input bg-background text-foreground focus-visible:outline-ring h-8 rounded-md border px-2 text-sm"
              value={filters.length ?? ""}
              onChange={(event) =>
                setPlaygroundFilters({
                  length: (event.currentTarget.value || undefined) as typeof filters.length,
                })
              }
            >
              <option value="">Any length</option>
              <option value="short">Short · up to 10 s</option>
              <option value="medium">Medium · 10–30 s</option>
              <option value="long">Long · 30 s and up</option>
            </select>
          </label>
        </div>
      )}
      {selectingRecordings && (
        <div className="border-hairline flex flex-wrap items-center justify-between gap-2 border-t pt-2">
          <span className="text-muted-foreground text-xs">
            {selectedRecordings.length} selected
          </span>
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              type="button"
              variant="ghost"
              disabled={updating}
              onClick={() =>
                setSelection(visible.flatMap((entry) => (entry.playgroundItem ? [entry.id] : [])))
              }
            >
              Select visible
            </Button>
            <Button
              size="sm"
              type="button"
              variant="secondary"
              disabled={updating || !selectedRecordings.length}
              onClick={() => void changeSelected({ favorite: true })}
            >
              <Star /> Star
            </Button>
            <Button
              size="sm"
              type="button"
              variant="secondary"
              disabled={updating || !selectedRecordings.length}
              onClick={() => void changeSelected({ archived: filters.source !== "archive" })}
            >
              {filters.source === "archive" ? "Restore" : "Archive"}
            </Button>
          </div>
          {filters.source !== "archive" && (
            <p className="text-muted-foreground max-w-prose text-xs">
              Studio may permanently delete eligible recordings after 30 days in Archive.
            </p>
          )}
          <div className="flex w-full gap-2">
            <Input
              size="sm"
              aria-label="Tags for selected recordings"
              placeholder="Tags, separated by commas"
              value={bulkTags}
              onChange={(event) => setBulkTags(event.currentTarget.value)}
            />
            <Button
              size="sm"
              type="button"
              variant="secondary"
              disabled={updating || !selectedRecordings.length}
              onClick={() =>
                void changeSelected({
                  tags: bulkTags
                    .split(",")
                    .map((tag) => tag.trim())
                    .filter(Boolean),
                })
              }
            >
              Set tags
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 flex-col gap-2">
        {!sidebarNavigation && (
          <div>
            <h3 className="text-foreground text-sm font-semibold">Saved takes & templates</h3>
            <p className="text-muted-foreground text-xs">
              This project and the monorepo Global library. Saved on disk.
            </p>
          </div>
        )}
        {!cloudMode && (
          <ToggleGroup
            aria-label="Library storage scope"
            value={[pg.libraryScope ?? "all"]}
            onValueChange={(values) => {
              const value = values[0];
              if (value === "all" || value === "project" || value === "global")
                setPlaygroundLibraryScope(value);
            }}
          >
            <ToggleGroupItem value="all">Project + Global</ToggleGroupItem>
            <ToggleGroupItem value="project">Project</ToggleGroupItem>
            <ToggleGroupItem value="global">Global</ToggleGroupItem>
          </ToggleGroup>
        )}
        {sidebarNavigation && recordingFilters}
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pe-0.5">
        {!sidebarNavigation && comparisonCount > 0 && (
          <div
            ref={comparePanelRef}
            tabIndex={-1}
            className="focus-visible:ring-ai-text rounded-lg outline-none focus-visible:ring-2"
          >
            <VoicePlaygroundCompare entries={unifiedEntries} uids={pg.compareUids ?? []} />
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          {!sidebarNavigation && (
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
          )}

          <span className="text-muted-foreground text-xs tabular-nums">
            {cloudMode
              ? remoteHistory.loaded && !remoteHistory.error && !remoteHistory.loading
                ? `${remoteHistory.items.length} found`
                : null
              : `${visible.length} shown`}
          </span>
        </div>

        {cloudMode ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2 text-sm">
              <p className="text-muted-foreground max-w-[60ch] leading-relaxed text-pretty">
                GenVoice keeps Speech and Voice changer audio for 24 hours. Save the recordings you
                need to this project.
              </p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!configured}
                aria-disabled={!configured || remoteHistory.loading}
                onClick={() => {
                  if (configured && !remoteHistory.loading) void loadRemoteHistory(0);
                }}
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
            {!configured ? (
              <p className="text-muted-foreground text-sm">
                Connect GenVoice to check cloud history.
              </p>
            ) : remoteHistory.loading || (!remoteHistory.loaded && !remoteHistory.error) ? (
              <p role="status" className="text-muted-foreground text-sm">
                Checking cloud history…
              </p>
            ) : remoteHistory.loaded && !remoteHistory.error && !remoteHistory.items.length ? (
              <p className="text-muted-foreground text-sm">No recordings in the last 24 hours.</p>
            ) : null}
            {remoteHistory.error && (
              <p
                role="alert"
                className="bg-warn-bg/80 text-warn-text rounded px-2.5 py-1.5 text-sm"
              >
                {remoteHistory.error}
              </p>
            )}
            {remoteHistory.warning && (
              <p className="bg-warn-bg/60 text-warn-text rounded px-2.5 py-1.5 text-sm">
                {remoteHistory.warning}
              </p>
            )}
            <div className="flex flex-col gap-1.5">
              {remoteHistory.items.map((r) => {
                const importing = busyAction === `import:${r.id}`;
                const previewId = `pg-remote:${r.id}`;
                const isPlaying = nowPlaying === previewId;
                const safePreviewUrl = isSafeAudioUrl(r.audioUrl) ? r.audioUrl : "";
                return (
                  <div
                    key={r.id}
                    className="border-hairline bg-card grid grid-cols-1 items-start gap-2 rounded-lg border p-2 sm:grid-cols-[minmax(0,1fr)_auto]"
                  >
                    <div className="min-w-0">
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
                      <CloudScriptPreview text={r.text || r.title} title={r.title || r.voiceName} />
                      <span className="text-muted-foreground mt-0.5 block text-xs tabular-nums">
                        {r.charactersUsed} ch ·{" "}
                        {typeof r.creditsDeducted === "number"
                          ? `${r.creditsDeducted} cr`
                          : "Unknown fee"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 justify-self-end">
                      {safePreviewUrl && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`${isPlaying ? "Pause" : "Preview"} ${r.title || r.voiceName || "cloud recording"}`}
                          aria-pressed={isPlaying}
                          onClick={() => {
                            setFailedCloudPreview(null);
                            listenUrl(previewId, safePreviewUrl, undefined, () =>
                              setFailedCloudPreview(r.id),
                            );
                          }}
                        >
                          <VoicePlaybackIcon playing={isPlaying} className="size-3" />
                        </Button>
                      )}
                      {r.importedItemId ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          aria-label={`Open ${r.title || r.voiceName || "cloud recording"} in Recordings`}
                          onClick={() => {
                            const item = pg.items.find(
                              (entry) => entry.id === r.importedItemId && entry.scope !== "global",
                            );
                            setPlaygroundFilters({
                              ...DEFAULT_PLAYGROUND_FILTERS,
                              source: item?.archivedAt ? "archive" : "all",
                            });
                            setPlaygroundLibraryScope("project");
                            selectPlaygroundUid(`pg:${r.importedItemId}`);
                            setPlaygroundSubTab("inspect");
                          }}
                        >
                          Open recording
                        </Button>
                      ) : r.status === "completed" && safePreviewUrl ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          aria-disabled={importing}
                          aria-label={`Save to this project: ${r.title || r.voiceName || "cloud recording"}`}
                          onClick={() => {
                            if (!importing) void importRemoteHistoryTask(r.id, r.kind);
                          }}
                        >
                          {importing && (
                            <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />
                          )}
                          {importing ? "Saving…" : "Save to this project"}
                        </Button>
                      ) : (
                        <p className="text-muted-foreground max-w-[32ch] text-sm text-pretty">
                          {r.status === "completed"
                            ? "Audio unavailable. Refresh to check for audio."
                            : r.status === "failed"
                              ? "Generation failed. Check Jobs for recovery options."
                              : r.status === "cancelled" || r.status === "canceled"
                                ? "Generation was canceled."
                                : r.status === "expired"
                                  ? "Cloud audio has expired."
                                  : "Still processing. Refresh to check progress."}
                        </p>
                      )}
                    </div>
                    {failedCloudPreview === r.id && (
                      <p role="alert" className="text-warn-text col-span-full max-w-prose text-sm">
                        {r.importedItemId
                          ? "Couldn't play the cloud preview. Listen from Recordings."
                          : r.status === "completed" && safePreviewUrl
                            ? "Couldn't play the cloud preview. Try again or save it to this project to listen from Recordings."
                            : "Couldn't play the cloud preview. Refresh Cloud recovery and try again."}
                      </p>
                    )}
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
              <div className="border-warn/40 bg-warn-bg/80 text-warn-text flex items-start justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                <p
                  role="alert"
                  dir="auto"
                  className="max-w-[58ch] min-w-0 leading-relaxed text-pretty wrap-anywhere"
                >
                  {pg.error}
                </p>
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

            {!sidebarNavigation && recordingFilters}

            <div className="flex flex-col gap-1.5">
              {visible.map((entry) => {
                const excerpt = entry.spoken || entry.text;
                const selected = selectedUid === entry.uid;
                const entryScope =
                  (entry.playgroundItem?.scope ?? entry.template?.scope) === "global"
                    ? "Global"
                    : "Project";
                const controlName =
                  (titleCounts.get(entry.title) ?? 0) > 1
                    ? `${entry.title} · ${entry.voiceName} · ${entryScope}`
                    : entry.title;
                const isPlaying = Boolean(entry.auditionId && nowPlaying === entry.auditionId);
                const isPlayground = entry.origin === "playground";
                const archivedAt = entry.playgroundItem?.archivedAt ?? entry.template?.archivedAt;
                const presentation = PLAYGROUND_MODE_PRESENTATION[entry.kind];
                const inUse =
                  entry.origin === "film_take"
                    ? Boolean(entry.filmTake?.file)
                    : (pg.usage ?? []).some((record) => record.itemId === entry.id);
                return (
                  <div
                    key={entry.uid}
                    data-recording-row=""
                    className={cn(
                      "group border-hairline bg-card flex flex-col gap-1.5 rounded-lg border p-2 transition-colors",
                      selected ? cn(presentation.card, "ring-1") : "hover:bg-raised-2/70",
                      inUse && "border-ok-text/60 bg-ok/5",
                    )}
                  >
                    {selectingRecordings && entry.playgroundItem && (
                      <label className="text-muted-foreground flex items-center gap-2 px-1 text-xs">
                        <input
                          type="checkbox"
                          className="accent-primary size-4"
                          aria-label={`Select ${entry.title}`}
                          checked={selection.includes(entry.id)}
                          onChange={(event) => {
                            const checked = event.currentTarget.checked;
                            setSelection((ids) =>
                              checked ? [...ids, entry.id] : ids.filter((id) => id !== entry.id),
                            );
                          }}
                        />
                        Select
                      </label>
                    )}
                    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1.5">
                      <Button
                        type="button"
                        variant={isPlaying ? "lit" : "cover"}
                        size="icon"
                        disabled={!entry.audioUrl}
                        aria-pressed={isPlaying}
                        aria-label={`${isPlaying ? "Pause" : "Play"} ${controlName}`}
                        onClick={() => {
                          if (!entry.audioUrl) return;
                          selectPlaygroundUid(entry.uid);
                          listenUrl(entry.auditionId, entry.audioUrl);
                        }}
                      >
                        <VoicePlaybackIcon playing={isPlaying} className="size-3.5" />
                      </Button>

                      <button
                        type="button"
                        aria-current={selected ? "true" : undefined}
                        data-recording-select=""
                        onClick={() => {
                          selectPlaygroundUid(entry.uid);
                          onSelectForInspect?.(entry.uid);
                        }}
                        className="focus-visible:ring-ring min-w-0 flex-1 rounded text-start outline-none focus-visible:ring-2"
                      >
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                          {entry.playgroundItem?.color && (
                            <span
                              aria-hidden
                              className="size-3 rounded-full border border-black/15 bg-(--voice-color)"
                              style={
                                { "--voice-color": entry.playgroundItem.color } as CSSProperties
                              }
                            />
                          )}
                          <span className="text-foreground min-w-0 text-sm font-semibold break-words">
                            {entry.title}
                          </span>
                          {entry.isTemplate && (
                            <span className="text-ai-text text-xs">Template</span>
                          )}
                          {inUse && (
                            <span className="text-ok-text inline-flex flex-none items-center gap-1 text-xs font-semibold">
                              <Check className="size-3" />
                              In use
                            </span>
                          )}
                          {entry.srtFile && (
                            <span className="text-muted-foreground text-xs">.srt</span>
                          )}
                          {Boolean(entry.playgroundItem?.rating) && (
                            <span className="text-muted-foreground flex items-center gap-1 text-xs">
                              <Star className="size-3 fill-current" />{" "}
                              {entry.playgroundItem?.rating}/5
                            </span>
                          )}
                        </div>
                        {excerpt && excerpt.trim() !== entry.title.trim() && (
                          <p
                            dir="auto"
                            className="text-muted-foreground mt-0.5 line-clamp-2 max-w-[58ch] text-xs leading-relaxed wrap-anywhere"
                          >
                            {excerpt}
                          </p>
                        )}
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
                            {isPlayground
                              ? `${presentation.shortLabel} / ${entry.playgroundItem?.scope === "global" ? "Global" : "Project"}`
                              : entry.template
                                ? `Template / ${entry.template.scope === "global" ? "Global" : "Project"}`
                                : `Take ${entry.id}`}
                          </span>
                          <span>·</span>
                          <span className="inline-flex min-w-0 items-center gap-1">
                            {entry.playgroundItem?.voiceGender === "female" && (
                              <Venus className="size-3 shrink-0" aria-label="Female" />
                            )}
                            {entry.playgroundItem?.voiceGender === "male" && (
                              <Mars className="size-3 shrink-0" aria-label="Male" />
                            )}
                            <bdi className="truncate">{entry.voiceName}</bdi>
                          </span>
                          <span>·</span>
                          <span className="font-mono">
                            {entry.dialogue
                              ? recordedCastSummary(
                                  extractDialogueSpeakerEntries(entry.dialogue.speakers),
                                ).modelLabel
                              : entry.modelId}
                          </span>
                          {archivedAt && Number.isFinite(Date.parse(archivedAt)) && (
                            <>
                              <span aria-hidden>·</span>
                              <time dateTime={archivedAt} className="tabular-nums">
                                Archived{" "}
                                {new Date(archivedAt).toLocaleDateString(undefined, {
                                  dateStyle: "medium",
                                })}
                              </time>
                            </>
                          )}
                          {entry.durationSeconds > 0 && (
                            <>
                              <span>·</span>
                              <span
                                className="inline-flex items-center gap-1 font-mono tabular-nums"
                                title={
                                  entry.durationSeconds <= 10
                                    ? "Short recording"
                                    : entry.durationSeconds >= 30
                                      ? "Long recording"
                                      : "Medium recording"
                                }
                              >
                                <Timer
                                  className={cn(
                                    "size-3 shrink-0",
                                    entry.durationSeconds >= 30 && "text-primary-text",
                                  )}
                                  aria-hidden
                                />
                                {formatSoundDuration(entry.durationSeconds, "sfx")}
                              </span>
                            </>
                          )}
                        </div>
                      </button>

                      <div className="col-start-3 row-start-1 flex items-center justify-end gap-0.5">
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="tool"
                          aria-label={`Compare ${controlName}`}
                          disabled={!entry.audioUrl || Boolean(busyAction)}
                          aria-pressed={(pg.compareUids ?? []).includes(entry.uid)}
                          onClick={() => void comparePlaygroundEntry(entry)}
                        >
                          <span className="font-mono text-xs">A/B</span>
                        </Button>
                        <Tip label={entry.favorite ? "Unstar" : "Star clip"}>
                          <Button
                            type="button"
                            variant="favorite"
                            size="icon-sm"
                            aria-pressed={entry.favorite}
                            aria-label={`Favorite ${controlName}`}
                            onClick={(event) => {
                              const button = event.currentTarget;
                              const restoreFocus =
                                filters.source === "favorites" && entry.favorite
                                  ? recordingRemovalFocus(button)
                                  : null;
                              void toggleUnifiedFavorite(entry).then(() => {
                                if (!restoreFocus) return;
                                requestAnimationFrame(() => {
                                  if (!button.isConnected) restoreFocus();
                                });
                              });
                            }}
                          >
                            <Star className={cn("size-3.5", entry.favorite && "fill-current")} />
                          </Button>
                        </Tip>
                        <Tip label="Duplicate settings & prompt into Editor">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Duplicate ${controlName} to Editor`}
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
                  <p>
                    {hasActiveFilters
                      ? query
                        ? `No recordings match “${query}” with these filters.`
                        : "No results match these filters."
                      : filters.source === "archive"
                        ? "No archived recordings or templates yet."
                        : filters.source === "templates"
                          ? "No templates yet. Save a draft as a template from Speech."
                          : filters.source === "favorites"
                            ? "No favorites yet. Star a recording or template to keep it here."
                            : "No recordings yet."}
                  </p>
                  {!hasActiveFilters && filters.source === "archive" && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setPlaygroundFilters({ ...DEFAULT_PLAYGROUND_FILTERS, source: "all" });
                        setPlaygroundSubTab("library");
                      }}
                    >
                      Back to Recordings
                    </Button>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
      {!cloudMode && comparisonCount > 0 && (
        <div className="border-ai-text/30 bg-card flex flex-none items-center justify-between gap-2 rounded-lg border px-2.5 py-2">
          <span role="status" className="text-ai-text text-xs font-semibold tabular-nums">
            {comparisonCount} {comparisonCount === 1 ? "take" : "takes"} selected
          </span>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              if (sidebarNavigation) {
                setPlaygroundSubTab("compare");
                return;
              }
              comparePanelRef.current?.scrollIntoView({ block: "start" });
              comparePanelRef.current?.focus({ preventScroll: true });
            }}
          >
            View comparison
          </Button>
        </div>
      )}
    </div>
  );
}
