// Filter dropdown and removable chip bar for the shared English voice library (lazy-loaded on Voices tab).
import { useState } from "react";

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

import { AudioFilterChip } from "./AudioFilterChip";
import { FilterTriggerButton } from "./FilterTriggerButton";
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
          <span className="ml-1 inline-flex max-w-24 items-center gap-1.5">
            <span aria-hidden className="bg-primary size-1.5 flex-none rounded-full" />
            <span className="text-primary-text text-tag truncate font-medium">{activeTitle}</span>
          </span>
        )}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-52 max-w-(--available-width) overflow-hidden">
        <div className="bg-backdrop -m-1 max-h-[min(22rem,calc(var(--available-height)-0.5rem))] overflow-y-auto overscroll-contain rounded-lg p-1">
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
                <span className="text-foreground/70 text-xs tabular-nums">
                  {opt.count.toLocaleString()}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </div>
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
  const modelCounts: Record<VoiceV4Mode, number> = {
    v4: facets.v4Count,
    v4Post: facets.v4PostCount,
    v4Turbo: facets.v4TurboCount,
    v4Fast: facets.v4FastCount,
    all: facets.allCount,
  };

  const activeV4Count = modelCounts[filters.v4Mode];
  const activeV4Label =
    V4_MODES.find((m) => m.id === filters.v4Mode)?.label ?? voiceTitle(filters.v4Mode);
  const activeSortLabel =
    SORT_OPTIONS.find((s) => s.id === filters.sort)?.label ?? voiceTitle(filters.sort);

  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger
        render={
          <FilterTriggerButton
            active={active}
            open={menuOpen}
            aria-label={filterSummary ? `Filter voices: ${filterSummary}` : "Filter voices"}
            title={filterSummary ? `Filter: ${filterSummary}` : "Filter & sort voices"}
          />
        }
      />
      <DropdownMenuContent align="end" className="w-60 max-w-(--available-width) overflow-hidden">
        <div className="bg-backdrop -m-1 max-h-[calc(var(--available-height)-0.5rem)] overflow-y-auto overscroll-contain rounded-lg p-1">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <span className="min-w-0 flex-1 truncate">Model support</span>
              <span className="ml-1 inline-flex max-w-28 items-center gap-1.5">
                {filters.v4Mode !== DEFAULT_VOICE_FILTERS.v4Mode && (
                  <span aria-hidden className="bg-primary size-1.5 flex-none rounded-full" />
                )}
                <span
                  className={
                    filters.v4Mode !== DEFAULT_VOICE_FILTERS.v4Mode
                      ? "text-primary-text text-tag truncate font-medium"
                      : "text-foreground/75 text-tag truncate"
                  }
                >
                  {activeV4Label}
                </span>
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-56 max-w-(--available-width) overflow-hidden">
              <div className="bg-backdrop -m-1 max-h-[min(18rem,calc(var(--available-height)-0.5rem))] overflow-y-auto overscroll-contain rounded-lg p-1">
                <DropdownMenuRadioGroup
                  value={filters.v4Mode}
                  onValueChange={(v) => set("v4Mode", v as VoiceV4Mode)}
                >
                  {V4_MODES.map((m) => (
                    <DropdownMenuRadioItem key={m.id} value={m.id}>
                      <span className="min-w-0 flex-1 truncate">{m.label}</span>
                      <span className="text-foreground/70 text-xs tabular-nums">
                        {modelCounts[m.id].toLocaleString()}
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </div>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <span className="min-w-0 flex-1 truncate">Sort by</span>
              <span className="ml-1 inline-flex max-w-28 items-center gap-1.5">
                {filters.sort !== DEFAULT_VOICE_FILTERS.sort && (
                  <span aria-hidden className="bg-primary size-1.5 flex-none rounded-full" />
                )}
                <span
                  className={
                    filters.sort !== DEFAULT_VOICE_FILTERS.sort
                      ? "text-primary-text text-tag truncate font-medium"
                      : "text-foreground/75 text-tag truncate"
                  }
                >
                  {activeSortLabel}
                </span>
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-48 max-w-(--available-width) overflow-hidden">
              <div className="bg-backdrop -m-1 max-h-[calc(var(--available-height)-0.5rem)] overflow-y-auto overscroll-contain rounded-lg p-1">
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
              </div>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              <span className="text-foreground/70">Credits & access</span>
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={filters.access}
              onValueChange={(v) => set("access", v as VoiceFilters["access"])}
            >
              <DropdownMenuRadioItem value={ALL}>
                <span className="min-w-0 flex-1 truncate">Any credit rate</span>
                <span className="text-foreground/70 text-xs tabular-nums">
                  {activeV4Count.toLocaleString()}
                </span>
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="standard">
                <span className="min-w-0 flex-1 truncate">1× credit only</span>
                <span className="text-foreground/70 text-xs tabular-nums">
                  {facets.standardCount.toLocaleString()}
                </span>
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="free">
                <span className="min-w-0 flex-1 truncate">Free tier</span>
                <span className="text-foreground/70 text-xs tabular-nums">
                  {facets.freeCount.toLocaleString()}
                </span>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              <span className="text-foreground/70">Voice attributes</span>
            </DropdownMenuLabel>
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
        </div>
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
        <AudioFilterChip key={p.id} label={p.label} onClear={() => onChange(p.clear())} />
      ))}
    </>
  );
}
