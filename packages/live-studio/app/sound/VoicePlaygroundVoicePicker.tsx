import { ChevronDown, Globe, Search, Sparkles, Star, User } from "lucide-react";
import { useCallback, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { providerLanguageOptions } from "../../src/voice-playground-providers.mjs";
import type { PlaygroundConnection, PlaygroundVoiceOption } from "../../src/voice-playground.mjs";
import { useStudio } from "../core/store";
import { ALL } from "./library-view";
import { listening, subscribeAudition } from "./sound";
import { useVoiceTakes } from "./voice-client";
import { useVoiceLibrary } from "./voice-library-client";
import {
  buildVoiceUseCaseIndex,
  DEFAULT_VOICE_FILTERS,
  filterAndSortVoices,
  isVoiceStarId,
  VOICE_STAR_PREFIX,
  voiceDisplayName,
  voiceFacetOptions,
  type VoiceFilters,
} from "./voice-library-view";
import {
  cloneVoiceOption,
  loadSpeechCatalog,
  useVoicePlaygroundSelector,
} from "./voice-playground-client";
import {
  activeFilmVoices,
  castingAuditionId,
  filterProviderCastingVoices,
  filterSavedCastingVoices,
  uniqueCastingGroups,
} from "./voice-playground-view";
import { KNOWN_VOICES } from "./voice-view";
import { VoiceFilterChips, VoiceFilterMenu } from "./VoiceLibraryFilters";

const NO_VOICES: PlaygroundVoiceOption[] = [];

import { type PickedVoice, VoiceOptionRow } from "./VoiceCastingRow";
export { VoiceOptionRow } from "./VoiceCastingRow";

import type { PlaygroundProvider } from "../../src/voice-playground.mjs";
import { EMPTY_PROVIDER_FILTERS, VoiceProviderFilters } from "./VoiceProviderFilters";

type PickerTab = "quick" | "catalog" | "live" | "custom";

const LIVE_SORT_ITEMS = [
  { value: "usage_character_count_1y", label: "Most used (1 year)" },
  { value: "trending", label: "Trending" },
  { value: "cloned_by_count", label: "Most cloned" },
  { value: "created_date", label: "Newest" },
];

const CLOUD_FILTERS = [
  {
    key: "age",
    label: "Age",
    items: [
      { value: "young", label: "Young" },
      { value: "middle_aged", label: "Middle aged" },
      { value: "old", label: "Older" },
    ],
  },
  { key: "category", label: "Quality", items: [{ value: "high_quality", label: "High quality" }] },
  {
    key: "useCase",
    label: "Role",
    items: [
      { value: "conversational", label: "Conversation" },
      { value: "narrative_and_story", label: "Narration & stories" },
      { value: "characters_and_animation", label: "Characters & animation" },
      { value: "social_media", label: "Social media" },
      { value: "entertainment_and_tv", label: "Entertainment & TV" },
      { value: "advertisement", label: "Advertising" },
      { value: "informative_and_educational", label: "Education" },
    ],
  },
] as const;

export function VoicePlaygroundVoicePicker({
  connection = "genvoice",
  prebuiltOnly = false,
  selectedId,
  selectedProvider = "elevenlabs",
  inspection,
  allowedProviders = ["elevenlabs", "minimax", "capcut"],
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
  embedded = false,
  initialTab,
  onBrowseAll,
  favoritesOnly = false,
}: {
  connection?: PlaygroundConnection;
  prebuiltOnly?: boolean;
  selectedId: string;
  selectedProvider?: PlaygroundProvider;
  inspection?: { voiceKey: string; draftKey: string };
  allowedProviders?: readonly PlaygroundProvider[];
  selectedName: string;
  defaultVoices: readonly PlaygroundVoiceOption[];
  sharedSearch:
    | {
        status: "idle" | "loading" | "ready";
        voices: PlaygroundVoiceOption[];
        hasMore: boolean;
        queryKey?: string;
        params?: Record<string, string | number | undefined>;
      }
    | {
        status: "error";
        error: string;
        voices: PlaygroundVoiceOption[];
        hasMore: boolean;
        queryKey?: string;
        params?: Record<string, string | number | undefined>;
      };
  onSearchShared: (params: Record<string, string | number | undefined>) => void;
  onLoadMoreShared?: () => void;
  onSelect: (voice: PickedVoice) => void;
  configured?: boolean;
  fullWidth?: boolean;
  compact?: boolean;
  align?: "start" | "center" | "end";
  embedded?: boolean;
  initialTab?: PickerTab;
  onBrowseAll?: () => void;
  favoritesOnly?: boolean;
}) {
  const direct = connection !== "genvoice";
  const liveSearchLabel =
    connection === "google"
      ? "Search Gemini voices"
      : direct
        ? "Search ElevenLabs account voices"
        : "Search shared GenVoice voices";
  const [open, setOpen] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [browseTab, setTab] = useState<PickerTab>(
    initialTab ?? (embedded && !direct ? "catalog" : "quick"),
  );
  const tab = favoritesOnly ? "quick" : browseTab;
  const [q, setQ] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const [requestedCloudProvider, setCloudProvider] = useState<PlaygroundProvider>(
    allowedProviders.includes(selectedProvider) ? selectedProvider : "elevenlabs",
  );
  const cloudProvider = allowedProviders.includes(requestedCloudProvider)
    ? requestedCloudProvider
    : (allowedProviders[0] ?? "elevenlabs");
  const [nativeFilters, setNativeFilters] = useState(EMPTY_PROVIDER_FILTERS);
  const [requestedCustomProvider, setCustomProvider] =
    useState<PlaygroundProvider>(selectedProvider);
  const customProvider = allowedProviders.includes(requestedCustomProvider)
    ? requestedCustomProvider
    : (allowedProviders[0] ?? "elevenlabs");
  const [liveLang, setLiveLang] = useState("");
  const uid = useId();
  const [liveGender, setLiveGender] = useState("");
  const [extraFilters, setExtraFilters] = useState({
    age: "",
    accent: "",
    category: "",
    useCase: "",
  });
  const [favoritesFilter, setOnlyFavorites] = useState(false);
  const onlyFavorites = favoritesOnly || favoritesFilter;
  const [catalogFilters, setCatalogFilters] = useState<VoiceFilters>(DEFAULT_VOICE_FILTERS);
  const [catalogRole, setCatalogRole] = useState(ALL);
  const [catalogLimit, setCatalogLimit] = useState(80);
  const updateCatalogFilters = (filters: VoiceFilters) => {
    setCatalogFilters(filters);
    setCatalogLimit(80);
  };
  const languageCatalog = useVoicePlaygroundSelector((state) => state.catalog, false);
  const serviceCatalogState = useVoicePlaygroundSelector(
    (state) => (direct ? state.serviceCatalogs?.[connection] : undefined),
    false,
  );
  const serviceError =
    serviceCatalogState?.status === "error" ? serviceCatalogState.error : undefined;
  const waitingForVoices =
    direct &&
    configured &&
    (!serviceCatalogState ||
      (serviceCatalogState.status === "loading" && !serviceCatalogState.catalog));
  const ownedClones = useVoicePlaygroundSelector((state) => state.clones, false);
  const ownOptions = useMemo(
    () => ownedClones?.flatMap((clone) => cloneVoiceOption(clone) ?? []) ?? [],
    [ownedClones],
  );
  const savedVoices =
    useVoicePlaygroundSelector((state) => state.favoriteVoices, false) ?? NO_VOICES;

  const [liveSort, setLiveSort] = useState(LIVE_SORT_ITEMS[0]!.value);
  const [showFilters, setShowFilters] = useState(!embedded);
  const [customId, setCustomId] = useState("");
  const [customName, setCustomName] = useState("");

  const effectFavs = useStudio((s) => s.favorites.effects);
  const isFavorite = useCallback(
    (voice: PlaygroundVoiceOption) =>
      savedVoices.some(
        (v) =>
          v.id === voice.id &&
          (v.connection ?? "genvoice") === (voice.connection ?? "genvoice") &&
          (v.provider ?? "elevenlabs") === (voice.provider ?? "elevenlabs"),
      ) ||
      ((voice.connection ?? "genvoice") === "genvoice" &&
        (voice.provider ?? "elevenlabs") === "elevenlabs" &&
        effectFavs.includes(`${VOICE_STAR_PREFIX}${voice.id}`)),
    [savedVoices, effectFavs],
  );
  const currentTakes = useVoiceTakes();
  const currentUsage = useVoicePlaygroundSelector((state) => state.usage, false);
  const voiceLib = useVoiceLibrary(
    !direct && (open || embedded) && (tab === "catalog" || tab === "quick"),
  );
  const nowPlaying = useSyncExternalStore(subscribeAudition, listening, listening);

  const castOptions = useMemo<PlaygroundVoiceOption[]>(() => {
    const byId = new Map<string, PlaygroundVoiceOption>();
    for (const v of [
      ...savedVoices,
      ...sharedSearch.voices,
      ...voiceLib.voices.map((voice) => ({ ...voice, provider: "elevenlabs" as const })),
      ...defaultVoices,
    ])
      if (!byId.has(castingAuditionId(v))) byId.set(castingAuditionId(v), v);
    return activeFilmVoices(currentTakes, currentUsage ?? []).map(
      ({ voiceId: id, voiceName, provider: engine, connection }) => {
        const provider = engine === "google" ? undefined : engine;
        const cat = byId.get(castingAuditionId({ id, provider, connection }));
        return cat
          ? { ...cat, source: "film" as const }
          : {
              id,
              provider,
              connection,
              name: voiceName || KNOWN_VOICES[id] || id,
              category: "Film Cast",
              source: "film" as const,
            };
      },
    );
  }, [
    savedVoices,
    sharedSearch.voices,
    voiceLib.voices,
    defaultVoices,
    currentTakes,
    currentUsage,
  ]);

  const starredOptions = useMemo<PlaygroundVoiceOption[]>(() => {
    const favIds = new Set(
      effectFavs.filter(isVoiceStarId).map((s) => s.slice(VOICE_STAR_PREFIX.length)),
    );
    if (!favIds.size && !savedVoices.length) return [];
    const seen = new Set<string>();
    const merged: PlaygroundVoiceOption[] = [];
    for (const v of [
      ...savedVoices,
      ...voiceLib.voices.map((voice) => ({ ...voice, provider: "elevenlabs" as const })),
      ...defaultVoices,
      ...sharedSearch.voices,
    ]) {
      if (
        ((connection === "genvoice" &&
          (v.provider ?? "elevenlabs") === "elevenlabs" &&
          favIds.has(v.id)) ||
          savedVoices.includes(v)) &&
        (("connection" in v ? v.connection : undefined) ?? "genvoice") === connection &&
        !seen.has(`${v.provider ?? "elevenlabs"}:${v.id}`)
      ) {
        seen.add(`${v.provider ?? "elevenlabs"}:${v.id}`);
        merged.push(v);
      }
    }
    return merged;
  }, [connection, effectFavs, voiceLib.voices, defaultVoices, savedVoices, sharedSearch.voices]);

  const catalogFacets = useMemo(
    () => voiceFacetOptions(voiceLib.voices, catalogRole, catalogFilters, effectFavs, q),
    [voiceLib.voices, catalogRole, catalogFilters, effectFavs, q],
  );
  const catalogRoles = useMemo(
    () => [
      { value: ALL, label: "Any role" },
      ...buildVoiceUseCaseIndex(voiceLib.voices, "all").categoryLeaves.map((leaf) => ({
        value: leaf.id,
        label: leaf.title,
      })),
    ],
    [voiceLib.voices],
  );
  const catalogMatches = useMemo(() => {
    if (tab !== "catalog") return [];
    return filterAndSortVoices(voiceLib.voices, catalogRole, q, catalogFilters, effectFavs).filter(
      (voice) => !onlyFavorites || isFavorite(voice),
    );
  }, [tab, voiceLib.voices, catalogRole, q, catalogFilters, effectFavs, onlyFavorites, isFavorite]);
  const filteredCatalog = catalogMatches.slice(0, catalogLimit);

  const quickFiltered = useMemo(() => {
    const filterList = (list: readonly PlaygroundVoiceOption[]) =>
      filterSavedCastingVoices(
        list.filter(
          (voice) =>
            (voice.connection ?? "genvoice") === connection &&
            (direct || allowedProviders.includes(voice.provider ?? "elevenlabs")) &&
            (!prebuiltOnly || defaultVoices.some((preset) => preset.id === voice.id)),
        ),
        prebuiltOnly && /^(vi|vi-vn|vietnamese|tiếng việt|en|en-us|english)$/i.test(q.trim())
          ? ""
          : q,
        DEFAULT_VOICE_FILTERS,
      );
    const [owned, cast, starred, defaults] = uniqueCastingGroups([
      filterList(ownOptions).filter((voice) => !onlyFavorites || isFavorite(voice)),
      filterList(castOptions).filter((voice) => !onlyFavorites || isFavorite(voice)),
      filterList(starredOptions),
      filterList(defaultVoices).filter((voice) => !onlyFavorites || isFavorite(voice)),
    ]);
    return { owned: owned!, cast: cast!, starred: starred!, defaults: defaults! };
  }, [
    ownOptions,
    q,
    castOptions,
    starredOptions,
    defaultVoices,
    onlyFavorites,
    isFavorite,
    allowedProviders,
    connection,
    direct,
    prebuiltOnly,
  ]);

  const handlePick = (voice: PlaygroundVoiceOption) => {
    onSelect({
      ...voice,
      provider: voice.provider ?? "elevenlabs",
      name: voiceDisplayName(voice.name || voice.id),
    });
    setOpen(false);
  };

  const runCloudQuery = (
    sortOverride = liveSort,
    provider = cloudProvider,
    language = liveLang,
  ) => {
    if (!configured) return;
    onSearchShared({
      search: q || undefined,
      ...(direct ? { connection } : { provider }),
      ...(provider !== "elevenlabs"
        ? Object.fromEntries(
            Object.entries(nativeFilters).map(([key, value]) => [key, value || undefined]),
          )
        : {
            language: language || undefined,
            gender: liveGender || undefined,
            sort: sortOverride || undefined,
            ...Object.fromEntries(
              Object.entries(extraFilters).map(([key, value]) => [key, value || undefined]),
            ),
          }),
      pageSize: 40,
    });
  };

  const submittedSearch =
    sharedSearch.queryKey &&
    sharedSearch.params &&
    (sharedSearch.params.connection ?? "genvoice") === connection &&
    (direct || (sharedSearch.params.provider ?? "elevenlabs") === cloudProvider);
  const submittedName = submittedSearch ? sharedSearch.params?.search : undefined;
  const cloudVoices =
    onlyFavorites && cloudProvider !== "elevenlabs"
      ? filterProviderCastingVoices(starredOptions, cloudProvider, q, nativeFilters)
      : filterSavedCastingVoices(
          (onlyFavorites ? starredOptions : sharedSearch.voices).filter(
            (voice) =>
              (voice.connection ?? "genvoice") === connection &&
              (direct || (voice.provider ?? "elevenlabs") === cloudProvider),
          ),
          onlyFavorites ? q : "",
          {
            ...DEFAULT_VOICE_FILTERS,
            ...(onlyFavorites
              ? {
                  ...Object.fromEntries(Object.entries(extraFilters).filter(([, value]) => value)),
                  gender: liveGender.trim() || "all",
                }
              : {}),
          },
          undefined,
          onlyFavorites ? { language: liveLang, useCase: extraFilters.useCase } : undefined,
        );
  const sourceItems = allowedProviders.map((value) => ({
    value,
    label: value === "elevenlabs" ? "ElevenLabs" : value === "minimax" ? "MiniMax" : "CapCut",
  }));
  const isSelected = (voice: PlaygroundVoiceOption) =>
    inspection
      ? inspection.voiceKey === castingAuditionId(voice)
      : selectedId === voice.id && selectedProvider === (voice.provider ?? "elevenlabs");
  const isInDraft = (voice: PlaygroundVoiceOption) =>
    inspection?.draftKey === castingAuditionId(voice);
  const triggerLabel = voiceDisplayName(selectedName || selectedId || "Select voice");

  const content = (
    <div
      className={cn(
        "flex min-h-0 flex-col gap-3",
        embedded
          ? "flex-1 overflow-y-auto overscroll-contain pe-1 [&>*]:shrink-0"
          : "p-2.5",
      )}
    >
      {!embedded && onBrowseAll && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setOpen(false);
            onBrowseAll();
          }}
        >
          Browse full voice library
        </Button>
      )}
      {!favoritesOnly && !direct && allowedProviders.length > 1 && (
        <p className="text-muted-foreground px-1 text-xs">
          Sources searches ElevenLabs, MiniMax and CapCut through GenVoice.
        </p>
      )}
      {!favoritesOnly && !prebuiltOnly && (
        <div
          className={cn(
            "bg-raised-2 grid gap-1 rounded-md p-0.5",
            direct ? "grid-cols-3" : "grid-cols-4",
          )}
        >
          {(
            [
              { id: "quick", label: "Cast & Core", icon: Sparkles },
              { id: "catalog", label: "Catalog", icon: Star },
              { id: "live", label: "Sources", icon: Globe },
              { id: "custom", label: "ID", icon: User },
            ] as const
          )
            .filter(({ id }) => !direct || id !== "catalog")
            .map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-pressed={tab === id}
                onClick={() => {
                  setTab(id);
                  if (
                    id === "live" &&
                    sharedSearch.status !== "loading" &&
                    (!sharedSearch.voices.length ||
                      (sharedSearch.voices[0]?.connection ?? "genvoice") !== connection ||
                      (sharedSearch.voices[0]?.provider ?? "elevenlabs") !== cloudProvider)
                  ) {
                    runCloudQuery();
                  }
                }}
                className={cn(
                  "focus-visible:ring-ring flex items-center justify-center gap-1 rounded border px-1.5 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-2",
                  tab === id
                    ? "border-primary bg-tint text-foreground font-semibold"
                    : "text-muted-foreground hover:text-foreground border-transparent",
                )}
              >
                <Icon className="size-3" />
                <span>{label}</span>
              </button>
            ))}
        </div>
      )}

      {tab === "live" && !direct && (
        <Field>
          <FieldLabel variant="compact" htmlFor={`${uid}-provider`}>
            Voice source
          </FieldLabel>
          <Select
            items={sourceItems}
            value={cloudProvider}
            onValueChange={(next) => {
              if (!next) return;
              const provider = next as PlaygroundProvider;
              setCloudProvider(provider);
              setNativeFilters(EMPTY_PROVIDER_FILTERS);
              onSearchShared({ provider, pageSize: 40, search: q || undefined });
            }}
          >
            <SelectTrigger id={`${uid}-provider`} size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent finalFocus>
              {sourceItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      {tab !== "custom" && (
        <div className="relative flex items-center gap-1.5">
          <Search className="text-muted-foreground pointer-events-none absolute start-2.5 size-3.5" />
          <Input
            ref={searchInput}
            size="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setCatalogLimit(80);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && tab === "live" && configured) {
                e.preventDefault();
                runCloudQuery();
              }
            }}
            placeholder={
              tab === "live" ? `${liveSearchLabel}…` : "Name, age, gender, accent, language…"
            }
            aria-label={
              tab === "live"
                ? liveSearchLabel
                : prebuiltOnly
                  ? "Search presets by name"
                  : "Search by voice name, age, gender, accent, language, or role"
            }
          />
          {tab === "live" && (
            <Button
              type="button"
              size="sm"
              disabled={!configured || sharedSearch.status === "loading"}
              onClick={() => runCloudQuery()}
            >
              {sharedSearch.status === "loading" ? "…" : "Find"}
            </Button>
          )}
        </div>
      )}
      {tab === "catalog" && (
        <>
          <div className="flex items-center gap-2">
            <Select
              items={catalogRoles}
              value={catalogRole}
              onValueChange={(value) => {
                setCatalogRole(value ?? ALL);
                setCatalogLimit(80);
              }}
            >
              <SelectTrigger size="sm" className="min-w-0 flex-1" aria-label="Catalog voice role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent finalFocus>
                <SelectGroup>
                  {catalogRoles.map((role) => (
                    <SelectItem key={role.value} value={role.value}>
                      {role.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <VoiceFilterMenu
              filters={catalogFilters}
              facets={catalogFacets}
              onChange={updateCatalogFilters}
            />
          </div>
          <VoiceFilterChips filters={catalogFilters} onChange={updateCatalogFilters} />
        </>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {tab === "live" && !direct && cloudProvider === "elevenlabs" && (
          <div className="flex flex-wrap items-center gap-1" aria-label="Voice languages">
            {[
              ["", "All languages"],
              ["vi", "Vietnamese"],
              ["en", "English"],
            ].map(([code, label]) => (
              <Button
                key={code}
                type="button"
                size="sm"
                variant={liveLang === code ? "secondary" : "ghost"}
                aria-pressed={liveLang === code}
                onClick={() => {
                  setLiveLang(code!);
                  runCloudQuery(liveSort, cloudProvider, code);
                }}
              >
                {label}
              </Button>
            ))}
          </div>
        )}
        {!favoritesOnly && tab !== "custom" && (
          <Button
            type="button"
            size="sm"
            variant="favorite"
            aria-pressed={onlyFavorites}
            onClick={() => {
              setOnlyFavorites(!onlyFavorites);
              setCatalogLimit(80);
            }}
          >
            <Star className={onlyFavorites ? "fill-current" : ""} />
            Only favorites
          </Button>
        )}
        {tab === "live" && cloudProvider === "elevenlabs" && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-expanded={showFilters}
            aria-controls={`${uid}-filters`}
            onClick={() => setShowFilters((old) => !old)}
          >
            {showFilters ? "Hide filters" : "Filters"}
          </Button>
        )}
      </div>
      {tab === "live" && cloudProvider !== "elevenlabs" && (
        <VoiceProviderFilters
          provider={cloudProvider}
          languages={providerLanguageOptions(cloudProvider, languageCatalog)}
          voices={sharedSearch.voices.filter((voice) => voice.provider === cloudProvider)}
          value={nativeFilters}
          onChange={setNativeFilters}
        />
      )}
      {tab === "live" && cloudProvider === "elevenlabs" && showFilters && (
        <div id={`${uid}-filters`} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
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
              placeholder={connection === "google" ? "e.g. vi-VN or en-US" : "e.g. vi or en"}
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
          {!direct && (
            <Field className="min-w-0">
              <FieldLabel variant="compact" htmlFor={`${uid}-sort`}>
                Sort
              </FieldLabel>
              <Select
                items={LIVE_SORT_ITEMS}
                value={liveSort}
                onValueChange={(v) => {
                  const next = v ?? LIVE_SORT_ITEMS[0]!.value;
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
                <SelectContent finalFocus>
                  <SelectGroup>
                    {LIVE_SORT_ITEMS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field>
            <FieldLabel variant="compact" htmlFor={`${uid}-accent`}>
              Accent
            </FieldLabel>
            <Input
              id={`${uid}-accent`}
              size="sm"
              list={`${uid}-accents`}
              placeholder="Any accent"
              value={extraFilters.accent}
              onChange={(event) =>
                setExtraFilters((old) => ({ ...old, accent: event.target.value }))
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  runCloudQuery();
                }
              }}
            />
            <datalist id={`${uid}-accents`}>
              <option value="american">American</option>
              <option value="british">British</option>
              <option value="australian">Australian</option>
            </datalist>
          </Field>
          {CLOUD_FILTERS.filter(
            ({ key }) => !direct || (connection === "elevenlabs" && key !== "category"),
          ).map(({ key, label, items }) => (
            <Field key={key}>
              <FieldLabel variant="compact" htmlFor={`${uid}-${key}`}>
                {label}
              </FieldLabel>
              <Select
                items={[{ value: "all", label: `Any ${label.toLowerCase()}` }, ...items]}
                value={extraFilters[key] || "all"}
                onValueChange={(value) =>
                  setExtraFilters((old) => ({
                    ...old,
                    [key]: value === "all" ? "" : (value ?? ""),
                  }))
                }
              >
                <SelectTrigger id={`${uid}-${key}`} size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent finalFocus>
                  <SelectGroup>
                    <SelectItem value="all">Any {label.toLowerCase()}</SelectItem>
                    {items.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          ))}
        </div>
      )}

      {tab === "custom" ? (
        <div className="flex flex-col gap-2 pt-1">
          <p className="text-muted-foreground text-xs">
            {direct
              ? "Paste an ID from this service."
              : "Choose the source, then paste its GenVoice voice ID"}
          </p>
          {!direct && (
            <Select
              items={sourceItems}
              value={customProvider}
              onValueChange={(next) => next && setCustomProvider(next as PlaygroundProvider)}
            >
              <SelectTrigger size="sm" aria-label="Custom voice source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent finalFocus>
                {sourceItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Field className="min-w-0">
            <FieldLabel variant="compact" htmlFor={`${uid}-voice-id`}>
              Voice ID
            </FieldLabel>
            <Input
              id={`${uid}-voice-id`}
              size="md"
              value={customId}
              onChange={(e) => setCustomId(e.target.value)}
              placeholder="e.g. ZaZosYpkIGmSqOwAlfnk"
              aria-label={direct ? "Custom voice ID" : "Custom GenVoice voice ID"}
            />
          </Field>
          <Field className="min-w-0">
            <FieldLabel variant="compact" htmlFor={`${uid}-name`}>
              Display name (optional)
            </FieldLabel>
            <Input
              id={`${uid}-name`}
              dir="auto"
              size="md"
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
                provider: customProvider,
                ...(direct ? { connection } : {}),
                name: customName.trim() || customId.trim(),
              });
              setOpen(false);
            }}
          >
            Use Voice ID
          </Button>
        </div>
      ) : (
        <div
          className={cn(
            "flex flex-col gap-2",
            !embedded && "max-h-64 min-h-0 overflow-y-auto overscroll-contain pe-0.5",
          )}
        >
          {tab === "quick" && (
            <>
              {quickFiltered.owned.length > 0 && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-muted-foreground px-1.5 text-xs font-medium uppercase">
                    My cloned voices · Project + Global
                  </span>
                  {quickFiltered.owned.map((voice) => (
                    <VoiceOptionRow
                      comfortable={embedded}
                      key={`owned:${voice.id}`}
                      voice={voice}
                      selected={isSelected(voice)}
                      inDraft={isInDraft(voice)}
                      nowPlayingId={nowPlaying}
                      onSelect={handlePick}
                    />
                  ))}
                </div>
              )}
              {quickFiltered.cast.length > 0 && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-muted-foreground px-1.5 text-xs font-medium uppercase">
                    Film Cast
                  </span>
                  {quickFiltered.cast.map((v) => (
                    <VoiceOptionRow
                      comfortable={embedded}
                      key={`cast:${v.provider}:${v.id}`}
                      voice={v}
                      selected={isSelected(v)}
                      inDraft={isInDraft(v)}
                      nowPlayingId={nowPlaying}
                      onSelect={handlePick}
                    />
                  ))}
                </div>
              )}
              {quickFiltered.starred.length > 0 && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-muted-foreground px-1.5 text-xs font-medium uppercase">
                    {favoritesOnly ? "Saved voice samples" : "Starred voices"}
                  </span>
                  {quickFiltered.starred.map((v) => (
                    <VoiceOptionRow
                      comfortable={embedded}
                      key={`fav:${v.provider}:${v.id}`}
                      voice={v}
                      selected={isSelected(v)}
                      inDraft={isInDraft(v)}
                      nowPlayingId={nowPlaying}
                      onSelect={handlePick}
                    />
                  ))}
                </div>
              )}
              {(!favoritesOnly || quickFiltered.defaults.length > 0) && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-muted-foreground px-1.5 text-xs font-medium uppercase">
                    {connection === "google"
                      ? "Gemini preset voices"
                      : connection === "elevenlabs"
                        ? "Your ElevenLabs voices"
                        : "GenVoice default voices"}{" "}
                    {!waitingForVoices && !serviceError && `(${quickFiltered.defaults.length})`}
                  </span>
                  {prebuiltOnly && (
                    <p className="text-muted-foreground px-1.5 text-xs">
                      These presets can read English and Vietnamese.
                    </p>
                  )}
                  {quickFiltered.defaults.map((v) => (
                    <VoiceOptionRow
                      comfortable={embedded}
                      key={`def:${v.id}`}
                      voice={v}
                      selected={isSelected(v)}
                      inDraft={isInDraft(v)}
                      nowPlayingId={nowPlaying}
                      onSelect={handlePick}
                    />
                  ))}
                  {quickFiltered.defaults.length === 0 && (
                    <div className="text-muted-foreground space-y-2 px-1.5 py-2 text-xs">
                      {waitingForVoices ? (
                        <p role="status">Loading voices…</p>
                      ) : direct && serviceError ? (
                        <>
                          <p role="alert">{serviceError}</p>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void loadSpeechCatalog(connection)}
                          >
                            Reload voices
                          </Button>
                        </>
                      ) : q.trim() ? (
                        <>
                          <p>No voices match “{q.trim()}”.</p>
                          <Button size="sm" variant="secondary" onClick={() => setQ("")}>
                            Clear search
                          </Button>
                        </>
                      ) : (
                        <p>
                          {direct
                            ? "No voices found for this service."
                            : "No default voices. Try Catalog or Sources."}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
              {favoritesOnly &&
                Object.values(quickFiltered).every((voices) => voices.length === 0) && (
                  <p className="text-muted-foreground px-1.5 py-3 text-sm">
                    {q.trim()
                      ? "No favorite voices match your search."
                      : "Favorite any voice sample to find it here."}
                  </p>
                )}
            </>
          )}

          {tab === "catalog" && (
            <>
              <div className="flex items-center justify-between px-1.5">
                <span className="text-muted-foreground text-xs">
                  Cached English catalog · {filteredCatalog.length.toLocaleString()} of{" "}
                  {catalogMatches.length.toLocaleString()}
                </span>
                {voiceLib.status === "syncing" && <Badge variant="open">Syncing…</Badge>}
              </div>
              {filteredCatalog.map((v) => (
                <VoiceOptionRow
                  comfortable={embedded}
                  key={v.id}
                  voice={v}
                  selected={isSelected(v)}
                  inDraft={isInDraft(v)}
                  nowPlayingId={nowPlaying}
                  onSelect={handlePick}
                />
              ))}
              {filteredCatalog.length < catalogMatches.length && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setCatalogLimit((limit) => limit + 80)}
                >
                  Show 80 more voices
                </Button>
              )}
              {filteredCatalog.length === 0 && (
                <div className="flex flex-wrap items-center gap-2 px-1.5 py-3">
                  <p role="status" className="text-muted-foreground min-w-0 text-xs wrap-anywhere">
                    {!voiceLib.loaded
                      ? "Loading local voice catalog…"
                      : q.trim()
                        ? `No catalog voices match “${q.trim()}”.`
                        : "No catalog voices match these filters."}
                  </p>
                  {voiceLib.loaded && q.trim() && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setQ("");
                        setCatalogLimit(80);
                        searchInput.current?.focus();
                      }}
                    >
                      Clear search
                    </Button>
                  )}
                </div>
              )}
            </>
          )}

          {tab === "live" && (
            <>
              {sharedSearch.status === "error" && (
                <p className="text-warn-text px-1.5 text-xs">{sharedSearch.error}</p>
              )}
              {cloudVoices.map((v) => (
                <VoiceOptionRow
                  comfortable={embedded}
                  key={`live:${v.provider}:${v.id}`}
                  voice={v}
                  selected={isSelected(v)}
                  inDraft={isInDraft(v)}
                  nowPlayingId={nowPlaying}
                  onSelect={handlePick}
                />
              ))}
              {sharedSearch.status === "loading" && !cloudVoices.length && (
                <p className="text-muted-foreground px-1.5 py-3 text-xs">Searching voices…</p>
              )}
              {sharedSearch.status !== "loading" &&
                !cloudVoices.length &&
                sharedSearch.status !== "error" && (
                <p className="text-muted-foreground px-1.5 py-3 text-xs">
                  {onlyFavorites
                    ? "No saved voices match these filters. Turn off Only favorites to browse this source."
                    : !configured
                      ? direct
                        ? "Connect this service to search its catalog."
                        : "Set a GenVoice API key to search shared voices."
                      : submittedSearch
                        ? submittedName
                          ? `No voices found for “${submittedName}”. Try another name or change the filters.`
                          : "No voices match these filters. Change the filters and search again."
                        : "Enter a voice name or choose filters, then select Find."}
                </p>
              )}
              {!onlyFavorites && sharedSearch.hasMore && onLoadMoreShared && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={sharedSearch.status === "loading"}
                  onClick={() => onLoadMoreShared()}
                >
                  {sharedSearch.status === "loading" ? "Loading more…" : "Load more shared voices"}
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
  if (embedded)
    return (
      <section
        aria-label="Voice directory"
        className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col"
      >
        {content}
      </section>
    );
  return (
    <Popover
      open={open}
      onOpenChange={(next, { event }) => {
        if (next) setKeyboardOpen(!(event instanceof MouseEvent) || event.detail === 0);
        setOpen(next);
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`Select voice: ${triggerLabel}`}
            title={triggerLabel}
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
          <bdi className="text-foreground min-w-0 truncate font-medium">{triggerLabel}</bdi>
        </span>
        <ChevronDown className="text-muted-foreground size-3.5 flex-none" />
      </PopoverTrigger>
      <PopoverContent
        aria-label="Choose a voice"
        align={align}
        variant="flush"
        motion={keyboardOpen ? "none" : "anchored"}
        className="max-h-[min(var(--available-height),calc(100dvh-1.5rem))] w-[min(24rem,calc(100vw-1.5rem))] overflow-y-auto overscroll-contain"
      >
        {content}
      </PopoverContent>
    </Popover>
  );
}
