// Filter dropdown and removable chip bar for the shared English voice library (lazy-loaded on Voices tab).
import { ChevronDown, ListFilter, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { ALL } from "./library-view";
import {
  DEFAULT_VOICE_FILTERS,
  hasActiveVoiceFilters,
  type VoiceFacetOption,
  type VoiceFacetSummary,
  voiceFilterPills,
  type VoiceFilters,
  type VoiceSortKey,
  voiceTitle,
  type VoiceV4Mode,
} from "./voice-library-view";

const V4_MODES: ReadonlyArray<{ id: VoiceV4Mode; label: string }> = [
  { id: "v4", label: "ElevenLabs v4" },
  { id: "v4Post", label: "v4 Post-trained" },
  { id: "v4Turbo", label: "v4 Turbo" },
  { id: "v4Fast", label: "v4 Fast" },
  { id: "all", label: "All English (incl. v2)" },
];

const SORT_OPTIONS: ReadonlyArray<{ id: VoiceSortKey; label: string }> = [
  { id: "usage1y", label: "Most used" },
  { id: "trending", label: "Trending (7d)" },
  { id: "clones", label: "Most cloned" },
  { id: "newest", label: "Newest" },
  { id: "name", label: "Name (A–Z)" },
];

function VoiceFacetSubmenu({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly VoiceFacetOption[];
  onChange: (next: string) => void;
}) {
  if (!options.length && value === ALL) return null;
  const activeTitle = value === ALL ? null : voiceTitle(value);
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {activeTitle && (
          <span className="text-primary-text text-tag ml-1 max-w-22 truncate font-medium">
            {activeTitle}
          </span>
        )}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-[min(22rem,var(--available-height))] w-52 overflow-y-auto overscroll-contain">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          <DropdownMenuRadioItem value={ALL}>
            <span className="min-w-0 flex-1 truncate">Any {label.toLowerCase()}</span>
          </DropdownMenuRadioItem>
          {options.map((opt) => (
            <DropdownMenuRadioItem
              key={opt.id}
              value={opt.id}
              disabled={opt.count === 0 && value !== opt.id}
            >
              <span className="min-w-0 flex-1 truncate">{opt.title}</span>
              <span className="text-muted-foreground text-xs tabular-nums">
                {opt.count.toLocaleString()}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

export function VoiceFilterMenu({
  filters,
  facets,
  onChange,
}: {
  filters: VoiceFilters;
  facets: VoiceFacetSummary;
  onChange: (next: VoiceFilters) => void;
}) {
  const active = hasActiveVoiceFilters(filters) || filters.sort !== DEFAULT_VOICE_FILTERS.sort;
  const set = <K extends keyof VoiceFilters>(key: K, val: VoiceFilters[K]) =>
    onChange({ ...filters, [key]: val });

  const filterSummary = voiceFilterPills(filters)
    .map((p) => p.label)
    .join(" · ");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="quiet"
            size="filter"
            aria-label={filterSummary ? `Filter voices: ${filterSummary}` : "Filter voices"}
            title={filterSummary ? `Filter: ${filterSummary}` : "Filter & sort voices"}
            aria-pressed={active}
            className="flex-none"
          />
        }
      >
        <ListFilter className="size-4" />
        <ChevronDown className="size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60 overflow-y-auto overscroll-contain">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Model support</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={filters.v4Mode}
            onValueChange={(v) => set("v4Mode", v as VoiceV4Mode)}
          >
            {V4_MODES.map((m) => (
              <DropdownMenuRadioItem key={m.id} value={m.id}>
                <span className="min-w-0 flex-1 truncate">{m.label}</span>
                {m.id === "v4" && (
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {facets.v4Count.toLocaleString()}
                  </span>
                )}
                {m.id === "all" && (
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {facets.allCount.toLocaleString()}
                  </span>
                )}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Sort by</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={filters.sort}
            onValueChange={(v) => set("sort", v as VoiceSortKey)}
          >
            {SORT_OPTIONS.map((s) => (
              <DropdownMenuRadioItem key={s.id} value={s.id}>
                <span className="min-w-0 flex-1 truncate">{s.label}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Credits & access</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={filters.access}
            onValueChange={(v) => set("access", v as VoiceFilters["access"])}
          >
            <DropdownMenuRadioItem value={ALL}>
              <span className="min-w-0 flex-1 truncate">Any credit rate</span>
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="standard">
              <span className="min-w-0 flex-1 truncate">1× credit only</span>
              <span className="text-muted-foreground text-xs tabular-nums">
                {facets.standardCount.toLocaleString()}
              </span>
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="free">
              <span className="min-w-0 flex-1 truncate">Free tier allowed</span>
              <span className="text-muted-foreground text-xs tabular-nums">
                {facets.freeCount.toLocaleString()}
              </span>
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Voice attributes</DropdownMenuLabel>
          <VoiceFacetSubmenu
            label="Gender"
            value={filters.gender}
            options={facets.genders}
            onChange={(v) => set("gender", v)}
          />
          <VoiceFacetSubmenu
            label="Age"
            value={filters.age}
            options={facets.ages}
            onChange={(v) => set("age", v)}
          />
          <VoiceFacetSubmenu
            label="Accent"
            value={filters.accent}
            options={facets.accents}
            onChange={(v) => set("accent", v)}
          />
          <VoiceFacetSubmenu
            label="Tone"
            value={filters.descriptive}
            options={facets.descriptives}
            onChange={(v) => set("descriptive", v)}
          />
          <VoiceFacetSubmenu
            label="Quality tier"
            value={filters.category}
            options={facets.categories}
            onChange={(v) => set("category", v)}
          />
        </DropdownMenuGroup>

        {active && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onChange(DEFAULT_VOICE_FILTERS)}>
              Reset voice filters
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function VoiceFilterChips({
  filters,
  onChange,
}: {
  filters: VoiceFilters;
  onChange: (next: VoiceFilters) => void;
}) {
  const pills = voiceFilterPills(filters);
  if (!pills.length) return null;

  return (
    <>
      {pills.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onChange(p.clear())}
          aria-label={`Clear ${p.label} filter`}
          className="bg-tint text-tag text-primary hover:bg-tint-hover focus-visible:ring-ring inline-flex h-5 flex-none items-center gap-1 rounded-full px-2 font-medium outline-none focus-visible:ring-2"
        >
          <span>{p.label}</span>
          <X aria-hidden className="size-2.5" />
        </button>
      ))}
    </>
  );
}
