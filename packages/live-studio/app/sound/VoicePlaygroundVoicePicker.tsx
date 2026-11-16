import { Check, ChevronDown, Globe, Pause, Play, Search, Sparkles, Star, User } from "lucide-react";
import { useId, useMemo, useState, useSyncExternalStore } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import type { PlaygroundVoiceOption } from "../../src/voice-playground.mjs";
import { Tip } from "../components/Tip";
import { useStudio } from "../core/store";
import { ALL } from "./library-view";
import { listening, listenUrl, subscribeAudition } from "./sound";
import { useVoiceLibrary } from "./voice-library-client";
import {
  DEFAULT_VOICE_FILTERS,
  filterAndSortVoices,
  isVoiceStarId,
  VOICE_STAR_PREFIX,
  voiceDisplayName,
} from "./voice-library-view";
import { KNOWN_VOICES } from "./voice-view";

type PickerTab = "quick" | "catalog" | "live" | "custom";

const LIVE_SORT_ITEMS = [
  { value: "trending", label: "Trending" },
  { value: "cloned_by_count", label: "Most cloned" },
  { value: "usage_character_count_1y", label: "Top used (1y)" },
  { value: "created_date", label: "Newest" },
];

function VoiceOptionRow({
  voice,
  selected,
  nowPlayingId,
  onSelect,
}: {
  voice: PlaygroundVoiceOption;
  selected: boolean;
  nowPlayingId: string;
  onSelect: (voice: PlaygroundVoiceOption) => void;
}) {
  const auditionId = `gv:${voice.id}`;
  const isPlaying = nowPlayingId === auditionId;
  const display = voiceDisplayName(voice.name);
  const metaParts = [voice.category, voice.gender, voice.accent, voice.useCase]
    .filter(Boolean)
    .slice(0, 3)
    .join(" · ");

  return (
    <div
      className={cn(
        "group flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors",
        selected ? "bg-tint text-primary-text" : "hover:bg-raised-3",
      )}
    >
      {voice.previewUrl ? (
        <Tip label={isPlaying ? "Pause sample" : "Preview voice"}>
          <Button
            type="button"
            variant={isPlaying ? "lit" : "ghost"}
            size="icon-xs"
            aria-label={`${isPlaying ? "Pause" : "Preview"} ${display}`}
            onClick={(e) => {
              e.stopPropagation();
              if (voice.previewUrl) listenUrl(auditionId, voice.previewUrl);
            }}
          >
            {isPlaying ? (
              <Pause className="size-3 fill-current" />
            ) : (
              <Play className="size-3 fill-current" />
            )}
          </Button>
        </Tip>
      ) : (
        <span className="text-muted-foreground flex size-5 flex-none items-center justify-center rounded border border-transparent">
          <User className="size-3 opacity-60" />
        </span>
      )}
      <button
        type="button"
        onClick={() => onSelect(voice)}
        className="focus-visible:ring-ring/40 focus-visible:bg-tint/40 flex min-w-0 flex-1 flex-col rounded px-1 py-0.5 text-start outline-none focus-visible:ring-2"
      >
        <div className="flex items-center gap-1.5">
          <span className="text-ui truncate font-medium">{display}</span>
          {selected && <Check className="text-primary-text size-3 flex-none" />}
        </div>
        <span className="text-muted-foreground truncate text-xs">{metaParts || voice.id}</span>
      </button>
    </div>
  );
}

export function VoicePlaygroundVoicePicker({
  selectedId,
  selectedName,
  defaultVoices,
  sharedSearch,
  onSearchShared,
  onLoadMoreShared,
  onSelect,
  configured = true,
  fullWidth = false,
  compact = false,
  align = "start",
}: {
  selectedId: string;
  selectedName: string;
  defaultVoices: readonly PlaygroundVoiceOption[];
  sharedSearch: {
    voices: PlaygroundVoiceOption[];
    hasMore: boolean;
    loading: boolean;
    error: string | null;
  };
  onSearchShared: (params: Record<string, string | number | undefined>) => void;
  onLoadMoreShared?: () => void;
  onSelect: (voice: { id: string; name: string }) => void;
  configured?: boolean;
  fullWidth?: boolean;
  compact?: boolean;
  align?: "start" | "center" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<PickerTab>("quick");
  const [q, setQ] = useState("");
  const [liveLang, setLiveLang] = useState("");
  const uid = useId();
  const [liveGender, setLiveGender] = useState("");
  const [liveSort, setLiveSort] = useState("trending");
  const [customId, setCustomId] = useState("");
  const [customName, setCustomName] = useState("");

  const effectFavs = useStudio((s) => s.favorites.effects);
  const voiceLib = useVoiceLibrary(open && (tab === "catalog" || tab === "quick"));
  const nowPlaying = useSyncExternalStore(subscribeAudition, listening, listening);

  const castOptions = useMemo<PlaygroundVoiceOption[]>(() => {
    const byId = new Map<string, PlaygroundVoiceOption>();
    for (const v of voiceLib.voices) byId.set(v.id, v);
    return Object.entries(KNOWN_VOICES).map(([id, name]) => {
      const cat = byId.get(id);
      return cat
        ? { ...cat, name: `${name} (${cat.name})`, source: "film" }
        : { id, name, category: "Film Cast", source: "film" };
    });
  }, [voiceLib.voices]);

  const starredOptions = useMemo<PlaygroundVoiceOption[]>(() => {
    const favIds = new Set(
      effectFavs.filter(isVoiceStarId).map((s) => s.slice(VOICE_STAR_PREFIX.length)),
    );
    if (!favIds.size) return [];
    const seen = new Set<string>();
    const merged: PlaygroundVoiceOption[] = [];
    for (const v of [...voiceLib.voices, ...defaultVoices]) {
      if (favIds.has(v.id) && !seen.has(v.id)) {
        seen.add(v.id);
        merged.push(v);
      }
    }
    return merged;
  }, [effectFavs, voiceLib.voices, defaultVoices]);

  const filteredCatalog = useMemo(() => {
    if (tab !== "catalog") return [];
    return filterAndSortVoices(voiceLib.voices, ALL, q, DEFAULT_VOICE_FILTERS, effectFavs).slice(
      0,
      80,
    );
  }, [tab, voiceLib.voices, q, effectFavs]);

  const quickFiltered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const filterList = (list: readonly PlaygroundVoiceOption[]) =>
      !term
        ? list
        : list.filter(
            (v) =>
              v.name.toLowerCase().includes(term) ||
              v.id.toLowerCase().includes(term) ||
              (v.accent ?? "").toLowerCase().includes(term) ||
              (v.useCase ?? "").toLowerCase().includes(term),
          );
    return {
      cast: filterList(castOptions),
      starred: filterList(starredOptions),
      defaults: filterList(defaultVoices),
    };
  }, [q, castOptions, starredOptions, defaultVoices]);

  const handlePick = (voice: PlaygroundVoiceOption) => {
    onSelect({ id: voice.id, name: voiceDisplayName(voice.name) });
    setOpen(false);
  };

  const runCloudQuery = (sortOverride = liveSort) => {
    if (!configured) return;
    onSearchShared({
      search: q || undefined,
      language: liveLang || undefined,
      gender: liveGender || undefined,
      sort: sortOverride || undefined,
      pageSize: 40,
    });
  };

  const triggerLabel = voiceDisplayName(selectedName || selectedId || "Select voice");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`Select voice: ${triggerLabel}`}
            className={cn(
              "border-input bg-backdrop/75 hover:bg-backdrop focus-visible:border-ring focus-visible:ring-ring/30 flex items-center justify-between gap-2 rounded-md border px-2.5 text-start text-sm transition-colors outline-none focus-visible:ring-2",
              compact ? "h-6 min-w-28 flex-1" : "h-8",
              fullWidth && "w-full",
            )}
          />
        }
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="bg-tint text-primary-text flex size-5 flex-none items-center justify-center rounded-full text-xs font-semibold">
            {triggerLabel.slice(0, 1).toUpperCase()}
          </span>
          <span className="text-foreground min-w-0 truncate font-medium">{triggerLabel}</span>
          {!compact && (
            <span className="text-muted-foreground hidden truncate font-mono text-xs sm:inline">
              {selectedId.slice(0, 8)}
            </span>
          )}
        </span>
        <ChevronDown className="text-muted-foreground size-3.5 flex-none" />
      </PopoverTrigger>
      <PopoverContent
        aria-label="Choose a voice"
        align={align}
        variant="flush"
        className="w-[min(24rem,calc(100vw-1.5rem))]"
      >
        <div className="flex flex-col gap-2 p-2.5">
          <div className="bg-raised-2 grid grid-cols-4 gap-1 rounded-md p-0.5">
            {(
              [
                { id: "quick", label: "Cast & Core", icon: Sparkles },
                { id: "catalog", label: "10k Catalog", icon: Star },
                { id: "live", label: "Cloud", icon: Globe },
                { id: "custom", label: "ID", icon: User },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-pressed={tab === id}
                onClick={() => {
                  setTab(id);
                  if (id === "live" && !sharedSearch.voices.length && !sharedSearch.loading) {
                    runCloudQuery();
                  }
                }}
                className={cn(
                  "focus-visible:ring-ring flex items-center justify-center gap-1 rounded px-1.5 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-2",
                  tab === id
                    ? "bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-3" />
                <span>{label}</span>
              </button>
            ))}
          </div>

          {tab !== "custom" && (
            <div className="relative flex items-center gap-1.5">
              <Search className="text-muted-foreground pointer-events-none absolute left-2.5 size-3.5" />
              <Input
                size="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && tab === "live" && configured) {
                    e.preventDefault();
                    runCloudQuery();
                  }
                }}
                placeholder={
                  tab === "live"
                    ? "Search GenVoice all languages…"
                    : "Filter voices by name, accent, role…"
                }
                aria-label={
                  tab === "live"
                    ? "Search shared GenVoice voices"
                    : "Filter voices by name, accent, or role"
                }
              />
              {tab === "live" && (
                <Button
                  type="button"
                  size="sm"
                  disabled={!configured || sharedSearch.loading}
                  onClick={() => runCloudQuery()}
                >
                  {sharedSearch.loading ? "…" : "Find"}
                </Button>
              )}
            </div>
          )}

          {tab === "live" && (
            <div className="grid grid-cols-3 gap-1.5">
              <Field className="min-w-0">
                <FieldLabel variant="compact" htmlFor={`${uid}-language`}>
                  Language
                </FieldLabel>
                <Input
                  id={`${uid}-language`}
                  size="sm"
                  value={liveLang}
                  onChange={(e) => setLiveLang(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      runCloudQuery();
                    }
                  }}
                  placeholder="Lang (en, vi…)"
                  aria-label="Shared voice language code"
                />
              </Field>
              <Field className="min-w-0">
                <FieldLabel variant="compact" htmlFor={`${uid}-gender`}>
                  Gender
                </FieldLabel>
                <Input
                  id={`${uid}-gender`}
                  size="sm"
                  value={liveGender}
                  onChange={(e) => setLiveGender(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      runCloudQuery();
                    }
                  }}
                  placeholder="Gender (male/female)"
                  aria-label="Shared voice gender"
                />
              </Field>
              <Field className="min-w-0">
                <FieldLabel variant="compact" htmlFor={`${uid}-sort`}>
                  Sort
                </FieldLabel>
                <Select
                  items={LIVE_SORT_ITEMS}
                  value={liveSort}
                  onValueChange={(v) => {
                    const next = v ?? "trending";
                    setLiveSort(next);
                    if (sharedSearch.voices.length > 0) {
                      runCloudQuery(next);
                    }
                  }}
                >
                  <SelectTrigger
                    id={`${uid}-sort`}
                    size="sm"
                    className="w-full"
                    aria-label="Shared voice sort order"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LIVE_SORT_ITEMS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          )}

          {tab === "custom" ? (
            <div className="flex flex-col gap-2 pt-1">
              <p className="text-muted-foreground text-xs">
                Paste any ElevenLabs / GenVoice voice ID directly:
              </p>
              <Field className="min-w-0">
                <FieldLabel variant="compact" htmlFor={`${uid}-voice-id`}>
                  Voice ID
                </FieldLabel>
                <Input
                  id={`${uid}-voice-id`}
                  size="sm"
                  value={customId}
                  onChange={(e) => setCustomId(e.target.value)}
                  placeholder="e.g. ZaZosYpkIGmSqOwAlfnk"
                  aria-label="Custom GenVoice voice ID"
                />
              </Field>
              <Field className="min-w-0">
                <FieldLabel variant="compact" htmlFor={`${uid}-name`}>
                  Display name (optional)
                </FieldLabel>
                <Input
                  id={`${uid}-name`}
                  size="sm"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="Display label (optional)"
                />
              </Field>
              <Button
                type="button"
                size="sm"
                disabled={!customId.trim()}
                onClick={() => {
                  onSelect({
                    id: customId.trim(),
                    name: customName.trim() || customId.trim(),
                  });
                  setOpen(false);
                }}
              >
                Use Voice ID
              </Button>
            </div>
          ) : (
            <div className="flex max-h-64 flex-col gap-2 overflow-y-auto overscroll-contain pe-0.5">
              {tab === "quick" && (
                <>
                  {quickFiltered.cast.length > 0 && (
                    <div className="flex flex-col gap-0.5">
                      <span className="text-muted-foreground px-1.5 text-xs font-medium uppercase">
                        Film Cast
                      </span>
                      {quickFiltered.cast.map((v) => (
                        <VoiceOptionRow
                          key={`cast:${v.id}`}
                          voice={v}
                          selected={selectedId === v.id}
                          nowPlayingId={nowPlaying}
                          onSelect={handlePick}
                        />
                      ))}
                    </div>
                  )}
                  {quickFiltered.starred.length > 0 && (
                    <div className="flex flex-col gap-0.5">
                      <span className="text-muted-foreground px-1.5 text-xs font-medium uppercase">
                        Starred Catalog Voices
                      </span>
                      {quickFiltered.starred.map((v) => (
                        <VoiceOptionRow
                          key={`fav:${v.id}`}
                          voice={v}
                          selected={selectedId === v.id}
                          nowPlayingId={nowPlaying}
                          onSelect={handlePick}
                        />
                      ))}
                    </div>
                  )}
                  <div className="flex flex-col gap-0.5">
                    <span className="text-muted-foreground px-1.5 text-xs font-medium uppercase">
                      GenVoice Default Voices ({quickFiltered.defaults.length})
                    </span>
                    {quickFiltered.defaults.map((v) => (
                      <VoiceOptionRow
                        key={`def:${v.id}`}
                        voice={v}
                        selected={selectedId === v.id}
                        nowPlayingId={nowPlaying}
                        onSelect={handlePick}
                      />
                    ))}
                    {quickFiltered.defaults.length === 0 && (
                      <p className="text-muted-foreground px-1.5 py-2 text-xs">
                        No matching default voices. Try 10k Catalog or Cloud search.
                      </p>
                    )}
                  </div>
                </>
              )}

              {tab === "catalog" && (
                <>
                  <div className="flex items-center justify-between px-1.5">
                    <span className="text-muted-foreground text-xs">
                      Cached English catalog ({voiceLib.totalEnglish.toLocaleString()})
                    </span>
                    {voiceLib.status === "syncing" && <Badge variant="open">Syncing…</Badge>}
                  </div>
                  {filteredCatalog.map((v) => (
                    <VoiceOptionRow
                      key={v.id}
                      voice={v}
                      selected={selectedId === v.id}
                      nowPlayingId={nowPlaying}
                      onSelect={handlePick}
                    />
                  ))}
                  {filteredCatalog.length === 0 && (
                    <p className="text-muted-foreground px-1.5 py-3 text-xs">
                      {voiceLib.loaded
                        ? "No cached catalog voices matched that search."
                        : "Loading local voice catalog…"}
                    </p>
                  )}
                </>
              )}

              {tab === "live" && (
                <>
                  {sharedSearch.error && (
                    <p className="text-warn-text px-1.5 text-xs">{sharedSearch.error}</p>
                  )}
                  {sharedSearch.voices.map((v) => (
                    <VoiceOptionRow
                      key={`live:${v.id}`}
                      voice={v}
                      selected={selectedId === v.id}
                      nowPlayingId={nowPlaying}
                      onSelect={handlePick}
                    />
                  ))}
                  {sharedSearch.loading && !sharedSearch.voices.length && (
                    <p className="text-muted-foreground px-1.5 py-3 text-xs">
                      Searching GenVoice shared library…
                    </p>
                  )}
                  {!sharedSearch.loading && !sharedSearch.voices.length && !sharedSearch.error && (
                    <p className="text-muted-foreground px-1.5 py-3 text-xs">
                      {configured
                        ? "Search GenVoice shared voices across all languages and press Find."
                        : "Set a GenVoice API key in Config to search shared cloud voices."}
                    </p>
                  )}
                  {sharedSearch.hasMore && onLoadMoreShared && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={sharedSearch.loading}
                      onClick={() => onLoadMoreShared()}
                    >
                      {sharedSearch.loading ? "Loading more…" : "Load more shared voices"}
                    </Button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
