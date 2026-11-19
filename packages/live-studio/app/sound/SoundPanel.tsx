import {
  ChevronDown,
  Maximize2,
  Music,
  Pause,
  Play,
  Plus,
  Redo2,
  RefreshCw,
  Search,
  SearchX,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import {
  lazy,
  type PointerEvent as ReactPointerEvent,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TooltipProvider } from "@/components/ui/tooltip";
// The sound tab: the clip picked on the lanes (its level, fades, length, which file), then every sound in the film and vault,
// organized as CapCut 9.7's Audio library (Yours, Music, Sound effects, Minecraft). A library card is dragged onto a lane, or + puts it at
// the playhead; the cover button auditions it with the bottom bar; pointing lights its clips, clicking selects them.
import { cn } from "@/lib/utils";

import type { SharedVoiceEntry } from "../../src/voice-library.mjs";
import { FavoriteStar } from "../components/FavoriteStar";
import {
  ChipGroup,
  EmptyCard,
  FieldRow,
  KeyNav,
  Reset,
  SaveStatus,
  Section,
  Segmented,
  SliderRow,
} from "../components/inspector";
import { Tip } from "../components/Tip";
import { canRedo, canUndo, redo, undo } from "../core/doc";
import { S } from "../core/state";
import { say, useStudio } from "../core/store";
import { FPS, r3, stamp } from "../core/time";
import { useFrame } from "../core/useFrame";
import { seek, setPlaying } from "../playback/transport";
import { AudioFilterChip } from "./AudioFilterChip";
import { AudioSpeed } from "./AudioSpeed";
import { AuditionDock } from "./AuditionDock";
import { type Band, readEq, type Slope, withBands, withCut, withShelf, withWidth } from "./eq";
import { FilterTriggerButton } from "./FilterTriggerButton";
import { GAIN_KEY_EPS, gainAt, toggleGainKey, writeGain } from "./gain";
import { HorizontalScrollRail } from "./HorizontalScrollRail";
import { startCarry } from "./lanes";
import {
  ALL,
  categoryHeading,
  cleanAudioTitle,
  CONTENT_ID_NOTE,
  type EditionFilter,
  editionOf,
  editionTitle,
  filterAndSortLibrary,
  groupLibraryFamilies,
  indexTimelineSounds,
  INITIAL_NAV,
  INITIAL_OPEN_GROUPS,
  itemVariantTitle,
  type LibraryGroup,
  type NavGroupId,
  type NavPick,
  type NavSection,
  type OpenGroups,
  type OriginFilter,
  originOf,
  originTitle,
  searchPlaceholder,
  soundCardDetail,
  soundCardText,
  sourceOf,
  sourceTitle,
  stepNavHeader,
  timelineLibraryView,
  type YoursLeaf,
} from "./library-view";
import { decoded } from "./mixer";
import { NormalizeClip } from "./NormalizeClip";
import { type ClipRef } from "./slice";
import {
  addClip,
  audibleName,
  auditionTarget,
  clipOf,
  cutAfter,
  edit,
  ensureSoundLibrary,
  familyItemsOf,
  itemOf,
  kindOf,
  type Lanes,
  type LibraryItem,
  lanes,
  library,
  lightSounds,
  listen,
  listening,
  locked,
  maxClipLength,
  moveTo,
  moveToTrack,
  type OneShot,
  pickAt,
  pickNamesUses,
  preview,
  removeClip,
  removeClips,
  resetBasic,
  restore,
  setClips,
  setField,
  setTrack,
  snapshot,
  span,
  subscribeAudition,
  swapSound,
  useCountOfNames,
} from "./sound";
import { SoundSwapPicker } from "./SoundSwapPicker";
import { ReverbSection, SpatialSection } from "./SpatialInspector";
import { playedPart, type SyncMode, syncPoint } from "./sync";
import { cachedVoiceClipLabel, useVoiceTakes } from "./voice-client";
import { syncVoiceLibraryNow, useVoiceLibrary } from "./voice-library-client";
import {
  buildVoiceUseCaseIndex,
  DEFAULT_VOICE_FILTERS,
  EMPTY_VOICE_FACETS,
  filterAndSortVoices,
  isVoiceStarId,
  voiceFacetOptions,
  type VoiceFilters,
  voiceLeavesWithFavs,
} from "./voice-library-view";
import {
  setPlaygroundInlineOpen,
  setPlaygroundWorkbenchOpen,
  useVoicePlaygroundSelector,
} from "./voice-playground-client";
import {
  activeFilmVoices,
  buildUnifiedEntries,
  filterSavedCastingVoices,
  savedFavoriteEntries,
} from "./voice-playground-view";
import { filterVoiceTakes } from "./voice-view";
import { VoiceChanger } from "./VoiceChanger";
import { VoiceClipSection } from "./VoiceClipSection";
import { VoiceoverList } from "./VoiceoverList";

const VoicePlaygroundInline = lazy(() =>
  import("./VoicePlaygroundWorkspace").then((m) => ({ default: m.VoicePlaygroundInline })),
);
const VoiceLibraryPane = lazy(() => import("./VoiceLibraryPane"));
const VoiceFilterMenu = lazy(() =>
  import("./VoiceLibraryFilters").then((m) => ({ default: m.VoiceFilterMenu })),
);
const VoiceFilterChips = lazy(() =>
  import("./VoiceLibraryFilters").then((m) => ({ default: m.VoiceFilterChips })),
);

const soundDoc = { snapshot, restore };
const PAGE = 96;
const EMPTY_FAVS: readonly string[] = [];

// real-sound's per-sound EQ: cuts (rumble, hiss) with Butterworth slopes, shelves at Q 0.7071 and peaking bands, written as the
// ffmpeg entries mix.py renders and the mixer previews exactly (eq.ts)
const SLOPES = ["6", "12", "24", "36"] as const;
const MAX_BANDS = 6;
type Filters = string[] | undefined;
const setFilters = (x: { filters?: string[] } | undefined, change: (f: Filters) => Filters) => {
  if (!x) return;
  const next = change(x.filters);
  if (next) x.filters = next;
  else delete x.filters;
};
const writeFilters = (l: Lanes, clip: ClipRef, change: (f: Filters) => Filters) =>
  setFilters(l[clip.list][clip.i] as { filters?: string[] }, change);
// a track's EQ: every clip on it, after the clip's own (mix.py track_chain)
const writeTrackFilters = (l: Lanes, id: string, change: (f: Filters) => Filters) =>
  setFilters(
    l.tracks?.find((t) => t.id === id),
    change,
  );
const NO_EQ = (f: Filters) =>
  withBands(
    withShelf(withShelf(withCut(withCut(f, "low", 0), "high", 0), "low", 0, 0), "high", 0, 0),
    [],
  );

function EqSection({
  title,
  write,
  filters,
}: {
  title: string;
  write: (l: Lanes, change: (f: Filters) => Filters) => void;
  filters: Filters;
}) {
  const eq = readEq(filters);
  const slider = (
    label: string,
    value: number,
    [min, max, step]: [number, number, number],
    unit: string,
    change: (f: Filters, v: number) => Filters,
    more: {
      hint?: string;
      log?: boolean;
      origin?: number;
      digits?: number;
      compact?: boolean;
    } = {},
  ) => (
    <SliderRow
      label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      digits={more.digits ?? 0}
      unit={unit}
      hint={more.hint}
      log={more.log}
      origin={more.origin}
      compact={more.compact}
      doc={soundDoc}
      preview={(v) => preview((l) => write(l, (f) => change(f, v)))}
      save={(v) => edit((l) => write(l, (f) => change(f, v)))}
    />
  );
  const cut = (kind: "low" | "high", label: string, hint: string) => {
    const off = kind === "low" ? 0 : 20000,
      hz = eq[kind],
      slope = eq[kind === "low" ? "lowSlope" : "highSlope"];
    return (
      <>
        {slider(
          label,
          hz || off,
          kind === "low" ? [0, 1000, 10] : [1000, 20000, 100],
          "Hz",
          (f, v) => withCut(f, kind, v === off ? 0 : v),
          { hint },
        )}
        {hz > 0 && (
          <FieldRow label="Slope">
            <Segmented
              label={`${label} slope in dB per octave`}
              value={String(slope) as (typeof SLOPES)[number]}
              items={SLOPES.map((id) => ({ id, title: `${id} dB` }))}
              onChange={(v) =>
                edit((l) => write(l, (f) => withCut(f, kind, hz, Number(v) as Slope)))
              }
              className="flex-1"
            />
          </FieldRow>
        )}
      </>
    );
  };
  const shelf = (kind: "low" | "high", label: string) => {
    const { f: hz, g } = eq[kind === "low" ? "lowShelf" : "highShelf"];
    return (
      <>
        {slider(label, g, [-15, 15, 0.5], "dB", (f, v) => withShelf(f, kind, hz, v), {
          origin: 0,
          digits: 1,
        })}
        {g !== 0 &&
          slider(
            `${label} from`,
            hz,
            kind === "low" ? [20, 1000, 1] : [1000, 20000, 10],
            "Hz",
            (f, v) => withShelf(f, kind, v, g),
            { log: true, compact: true },
          )}
      </>
    );
  };
  const band = (i: number, b: Band) => {
    const change = (f: Filters, patch: Partial<Band>) =>
      withBands(
        f,
        readEq(f).bands.map((x, j) => (j === i ? { ...x, ...patch } : x)),
      );
    return (
      <div key={i} className="flex flex-col gap-1 rounded-md border p-2">
        <div className="flex items-center justify-between">
          <span className="text-ui text-foreground/90">Band {i + 1}</span>
          <Tip label={`Remove band ${i + 1}`}>
            <Button
              variant="quiet"
              size="icon-sm"
              aria-label={`Remove band ${i + 1}`}
              onClick={() =>
                edit((l) =>
                  write(l, (f) =>
                    withBands(
                      f,
                      readEq(f).bands.filter((_, j) => j !== i),
                    ),
                  ),
                )
              }
            >
              <X />
            </Button>
          </Tip>
        </div>
        {slider("Frequency", b.f, [20, 20000, 1], "Hz", (f, v) => change(f, { f: v }), {
          log: true,
          compact: true,
        })}
        {slider("Gain", b.g, [-18, 18, 0.5], "dB", (f, v) => change(f, { g: v }), {
          origin: 0,
          digits: 1,
          compact: true,
        })}
        {slider("Q", b.q, [0.1, 10, 0.05], "", (f, v) => change(f, { q: v }), {
          digits: 2,
          compact: true,
          hint: "High Q notches a ring or whistle; 0.7-1 shapes the tone",
        })}
      </div>
    );
  };
  return (
    <Section
      title={title}
      right={
        <Reset
          label="Remove the cuts, shelves and bands"
          disabled={NO_EQ(filters)?.length === filters?.length}
          onClick={() => edit((l) => write(l, NO_EQ))}
        />
      }
    >
      {cut("low", "Low cut", "High-pass: 80-150 Hz clears rumble from clicks and foley; 0 is off")}
      {cut("high", "High cut", "Low-pass: 9-13 kHz softens hiss and harsh tops; 20 kHz is off")}
      {shelf("low", "Low shelf")}
      {shelf("high", "High shelf")}
      {eq.bands.map((b, i) => band(i, b))}
      {eq.bands.length < MAX_BANDS && (
        <Button
          variant="secondary"
          size="sm"
          className="h-8"
          onClick={() =>
            edit((l) =>
              write(l, (f) => withBands(f, [...readEq(f).bands, { f: 1000, q: 1, g: 0 }])),
            )
          }
        >
          <Plus /> Add band
        </Button>
      )}
    </Section>
  );
}

// Lands the chosen point of the part the clip plays (real-sound's align, sync.ts) on the playhead
const SYNC: { id: SyncMode; label: string; tip: string }[] = [
  { id: "start", label: "Start", tip: "its start" },
  { id: "attack", label: "Attack", tip: "where it hits (impacts, clicks, keys)" },
  { id: "peak", label: "Peak", tip: "its loudest moment (whooshes, swells)" },
  { id: "end", label: "End", tip: "where it dies out (risers into a hit)" },
];
const syncToPlayhead = async (clip: ClipRef, mode: SyncMode) => {
  const c = clipOf(clip);
  if (!c) return;
  const [from, to] = span(clip),
    rate = (c.rate as number | undefined) ?? 1;
  const buf = mode === "start" ? null : await decoded(c.name);
  if (mode !== "start" && !buf) {
    say("This sound hasn't loaded yet. Try again in a moment");
    return;
  }
  let at = 0;
  if (buf) {
    const s0 = Math.round(((c.start as number | undefined) ?? 0) * buf.sampleRate),
      s1 = Math.min(buf.length, s0 + Math.round((to - from) * rate * buf.sampleRate));
    const channels = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
    at = syncPoint(playedPart(channels, s0, s1, !!c.reverse), buf.sampleRate, mode) / rate;
  }
  moveTo(clip, S.t - at);
};

// The picked clip as CapCut's Audio tab: its Basic section (volume, pan, fades, and here ducking or length), then what the app adds
// (which file, which track, where it runs). A drag previews and saves once, when let go: one undo step
function Inspector({ clip, tab }: { clip: ClipRef; tab: "basic" | "voice" | "speed" }) {
  useStudio((s) => s.soundRev);
  useStudio((s) => s.timingRev);
  useVoiceTakes();
  useFrame();
  const c = clipOf(clip);
  if (!c) return null;
  const [from, to] = span(clip),
    bed = clip.list === "beds";
  const isVoiceClip = Boolean(
    !bed && (c.dialogue || (lanes?.narration && c.name === lanes.narration)),
  );
  const u = r3(Math.min(to - from, Math.max(0, Math.round((S.t - from) * FPS) / FPS))),
    volume = gainAt(c, u);
  const keys = (c.gainKeys ?? []).filter((k) => k.t >= 0 && k.t <= to - from);
  const prev = keys.findLast((k) => k.t < u - GAIN_KEY_EPS),
    next = keys.find((k) => k.t > u + GAIN_KEY_EPS);
  const here = keys.some((k) => Math.abs(k.t - u) < GAIN_KEY_EPS);
  const item = itemOf(c.name);
  const track = lanes?.tracks.find((t) => t.id === c.track);
  const siblings = isVoiceClip ? [] : familyItemsOf(c.name);
  const tracks = [
    ...(lanes?.tracks ?? []).map((t) => ({
      value: t.id,
      label: `${t.name}${t.lock ? " (locked)" : ""}`,
    })),
    { value: "new", label: "New track at the bottom" },
  ];
  const live = (key: string, scale: number) => (v: number) =>
    preview((l) => {
      if (key === "length") cutAfter(l.sfx[clip.i], "sfx", from + v);
      else ((bed ? l.beds : l.sfx)[clip.i] as Record<string, unknown>)[key] = v / scale;
    });
  // scale: what the slider shows per stored unit (pan is stored -1..1, shown -100..100)
  const row = (
    label: string,
    key: "gain" | "fadeIn" | "fadeOut" | "duck" | "length" | "pan",
    value: number,
    min: number,
    max: number,
    step: number,
    unit: string,
    digits: number,
    hint?: string,
    scale = 1,
  ) => (
    <SliderRow
      label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      digits={digits}
      unit={unit}
      hint={hint}
      origin={key === "pan" ? 0 : undefined}
      doc={soundDoc}
      preview={live(key, scale)}
      save={(v) => setField(clip, key, v / scale)}
    />
  );
  const hear = () => {
    seek(Math.max(0, from - 0.5));
    setPlaying(true);
  };
  const fadeMax = Math.max(0.05, Math.min(10, to - from)),
    fi = (c.fadeIn as number | undefined) ?? 0,
    fo = (c.fadeOut as number | undefined) ?? 0;
  const headerTitle =
    isVoiceClip && lanes?.narration && c.name === lanes.narration
      ? cachedVoiceClipLabel(c as OneShot)
      : item
        ? itemVariantTitle(item)
        : c.name;

  return (
    <fieldset
      key={`${clip.list}${clip.i}`}
      aria-label="Selected clip"
      disabled={locked(clip)}
      className="flex min-w-0 flex-col"
    >
      {locked(clip) && (
        <p className="text-muted-foreground px-3 pb-2 text-xs">
          Track locked. Unlock it in the track header to edit.
        </p>
      )}
      <div className="flex items-center gap-2 px-3 pb-1">
        <Badge variant={isVoiceClip ? "voice" : "audio"}>
          {isVoiceClip ? "Voice" : bed ? "BED" : "SFX"}
        </Badge>
        {!isVoiceClip && item && originOf(item) === "synth" && <Badge variant="synth">Code</Badge>}
        {!isVoiceClip && item?.contentId && (
          <Badge variant="claim" title={CONTENT_ID_NOTE}>
            Content ID
          </Badge>
        )}
        <span
          className="text-ui text-muted-foreground min-w-0 flex-1 truncate"
          title={isVoiceClip ? headerTitle : item ? soundCardDetail(item) : c.name}
        >
          {headerTitle}
        </span>
        <Tip label="Delete clip (Delete)">
          <Button
            variant="remove"
            size="icon-lg"
            className="-me-1 pointer-coarse:size-10"
            aria-label={`Delete ${c.name}`}
            onClick={() => removeClip(clip)}
          >
            <Trash2 />
          </Button>
        </Tip>
      </div>
      {tab === "voice" ? (
        <VoiceChanger key={`voice:${clip.list}:${clip.i}`} clip={clip} />
      ) : tab === "speed" ? (
        <AudioSpeed key={`speed:${clip.list}:${clip.i}`} clip={clip} />
      ) : (
        <>
          {isVoiceClip && <VoiceClipSection clip={clip} />}
          <Section
            title="Basic"
            right={
              <Reset
                label="Reset volume, pan and fades"
                disabled={!c.gain && !c.gainKeys?.length && !c.pan && !fi && !fo}
                onClick={() => resetBasic(clip)}
              />
            }
          >
            <SliderRow
              label="Volume"
              value={volume}
              min={Math.min(-40, volume)}
              max={Math.max(20, volume)}
              step={0.1}
              digits={1}
              unit="dB"
              doc={soundDoc}
              preview={(v) => preview((l) => writeGain(l[clip.list][clip.i], u, v))}
              save={(v) => edit((l) => writeGain(l[clip.list][clip.i], u, v))}
              nav={
                <KeyNav
                  what="volume"
                  prev={!!prev}
                  next={!!next}
                  here={here}
                  onPrev={() => prev && seek(from + prev.t)}
                  onNext={() => next && seek(from + next.t)}
                  onToggle={() => edit((l) => toggleGainKey(l[clip.list][clip.i], u))}
                />
              }
            />
            {row(
              "Pan",
              "pan",
              Math.round((c.pan ?? 0) * 100),
              -100,
              100,
              1,
              "",
              0,
              "Left −100, right 100: put the sound where it is in the picture",
              100,
            )}
            <SliderRow
              label="Width"
              value={Math.round(readEq(c.filters as Filters).width * 100)}
              min={0}
              max={200}
              step={5}
              digits={0}
              unit="%"
              origin={100}
              hint="0 is mono, 100 as recorded, above 100 wider: narrow a busy bed under the voice"
              doc={soundDoc}
              preview={(v) => preview((l) => writeFilters(l, clip, (f) => withWidth(f, v / 100)))}
              save={(v) => edit((l) => writeFilters(l, clip, (f) => withWidth(f, v / 100)))}
            />
            {row("Fade in", "fadeIn", fi, 0, fadeMax, 0.05, "s", 2)}
            {row("Fade out", "fadeOut", fo, 0, fadeMax, 0.05, "s", 2)}
            {bed &&
              row(
                "Ducking under the voice",
                "duck",
                (c.duck as number | undefined) ?? 0,
                0,
                24,
                1,
                "dB",
                0,
              )}
            {bed && lanes?.voice === false && !lanes.narration && (
              <p className="text-muted-foreground text-xs">
                This film has no narration in its mix yet, so nothing ducks until it does.
              </p>
            )}
            {!bed &&
              row(
                "Duration",
                "length",
                to - from,
                1 / 30,
                Math.max(1 / 30, maxClipLength(c)),
                0.01,
                "s",
                2,
              )}
          </Section>
          <EqSection
            title="EQ"
            write={(l, change) => writeFilters(l, clip, change)}
            filters={c.filters as string[] | undefined}
          />
          <ReverbSection key={`rev:${clip.list}:${clip.i}`} clip={clip} c={c} from={from} to={to} />
          <SpatialSection key={`sp:${clip.list}:${clip.i}`} clip={clip} c={c} />
          <NormalizeClip key={`${clip.list}:${clip.i}`} clip={clip} />
          <Section title="Clip">
            <FieldRow label="Sound">
              <SoundSwapPicker
                value={c.name}
                currentItem={item}
                narrationName={lanes?.narration ?? null}
                disabled={locked(clip)}
                onChange={(v) => swapSound(clip, v)}
              />
            </FieldRow>
            {!isVoiceClip && siblings.length > 1 && (
              <FieldRow label="Variant">
                <ChipGroup
                  label="Sound variation"
                  value={c.name}
                  items={siblings.map((s, idx) => ({
                    id: s.name,
                    title: `#${s.variant ?? idx + 1}`,
                  }))}
                  onChange={(v) => v !== c.name && swapSound(clip, v)}
                  className="min-w-0 flex-1"
                />
              </FieldRow>
            )}
            <FieldRow label="Track">
              <Select
                items={tracks}
                value={c.track ?? ""}
                onValueChange={(v) => v && v !== c.track && moveToTrack(clip, v as string)}
              >
                <SelectTrigger className="h-8 w-full min-w-0" aria-label="Track">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {tracks.map((n) => (
                    <SelectItem key={n.value} value={n.value}>
                      {n.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
            {track && (
              <SliderRow
                label="Track volume"
                value={track.gain ?? 0}
                min={-30}
                max={12}
                step={0.5}
                digits={1}
                unit="dB"
                origin={0}
                hint={`Turns every clip on ${track.name} up or down, after its own volume`}
                doc={soundDoc}
                preview={(v) =>
                  preview((l) => {
                    const t = l.tracks.find((x) => x.id === track.id);
                    if (t) t.gain = v || undefined;
                  })
                }
                save={(v) => setTrack(track.id, { gain: v || undefined })}
              />
            )}
            <FieldRow label="Runs">
              <span className="text-ui min-w-0 flex-1 tabular-nums">
                {stamp(from)} – {stamp(to)}
              </span>
            </FieldRow>
            {!bed && (
              <FieldRow label="Sync">
                {SYNC.map((m) => (
                  <Tip key={m.id} label={`Put ${m.tip} on the playhead`}>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-8 min-w-0 flex-1"
                      onClick={() => void syncToPlayhead(clip, m.id)}
                    >
                      {m.label}
                    </Button>
                  </Tip>
                ))}
              </FieldRow>
            )}
            <div className="flex gap-2">
              {bed && (
                <Tip label="Move the clip's start to the playhead">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-8 flex-1"
                    onClick={() => moveTo(clip, S.t)}
                  >
                    Move to playhead
                  </Button>
                </Tip>
              )}
              <Tip label="Plays from half a second before the clip">
                <Button variant="secondary" size="sm" className="h-8 flex-1" onClick={hear}>
                  Listen
                </Button>
              </Tip>
            </div>
            {c.try?.length ? (
              <p className="text-warn-text text-xs">
                {c.try.length} alternatives to try. Switch them with the chips on the picture; Use
                keeps one.
              </p>
            ) : null}
            {item?.license && (
              <p className="text-muted-foreground text-xs">
                {item.license}
                {item.url && (
                  <>
                    {" "}
                    ·{" "}
                    <a
                      className="hover:text-foreground underline underline-offset-2"
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      source
                    </a>
                  </>
                )}
              </p>
            )}
          </Section>
          {track && (
            <EqSection
              title={`Track EQ: ${track.name}`}
              write={(l, change) => writeTrackFilters(l, track.id, change)}
              filters={track.filters}
            />
          )}
        </>
      )}
    </fieldset>
  );
}

const audioDisplayTitle = cleanAudioTitle;

function AudioSearchBox({
  name,
  value,
  onChange,
  onClear,
  onEscape,
  label,
  placeholder,
  className,
}: {
  name: string;
  value: string;
  onChange: (q: string) => void;
  onClear: () => void;
  onEscape?: () => void;
  label: string;
  placeholder: string;
  className?: string;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cn(
        "border-input bg-backdrop focus-within:border-ring focus-within:ring-ring flex h-8 flex-none items-center gap-1.5 rounded-md border ps-2.5 pe-1 focus-within:ring-1 pointer-coarse:h-10",
        className,
      )}
    >
      <Search aria-hidden className="text-foreground/70 size-4 flex-none" />
      <input
        id={id}
        type="text"
        role="searchbox"
        name={name}
        autoComplete="off"
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        className="text-ui text-foreground placeholder:text-foreground/65 min-w-0 flex-1 bg-transparent pe-1 outline-none pointer-coarse:text-base"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            if (value) {
              e.preventDefault();
              onClear();
            } else {
              onEscape?.();
            }
          }
        }}
      />
      {value && (
        <Button
          type="button"
          variant="tool"
          size="icon-sm"
          className="flex-none pointer-coarse:size-9"
          aria-label="Clear search"
          onClick={onClear}
        >
          <X />
        </Button>
      )}
    </label>
  );
}

function AudioCategoryChips({
  label,
  value,
  items,
  showCounts,
  showActiveCount = false,
  onChange,
}: {
  label: string;
  value: string;
  items: readonly NavSection["leaves"][number][];
  showCounts: boolean;
  showActiveCount?: boolean;
  onChange: (id: string) => void;
}) {
  const edgesKey = `${label}:${items.map((x) => `${x.id}:${x.count}`).join(",")}:${showCounts}:${showActiveCount}`;

  return (
    <HorizontalScrollRail
      label={label}
      leftLabel="Scroll categories left"
      rightLabel="Scroll categories right"
      edgesKey={edgesKey}
      className="gap-1 @[441px]:gap-1.5"
    >
      {items.map((x, idx) => (
        <button
          key={x.id}
          type="button"
          role="radio"
          aria-checked={value === x.id}
          tabIndex={value === x.id ? 0 : -1}
          onClick={() => onChange(x.id)}
          onKeyDown={(e) => {
            let nextIdx: number | null = null;
            if (e.key === "ArrowRight") nextIdx = (idx + 1) % items.length;
            else if (e.key === "ArrowLeft") nextIdx = (idx - 1 + items.length) % items.length;
            else if (e.key === "Home") nextIdx = 0;
            else if (e.key === "End") nextIdx = items.length - 1;
            if (nextIdx === null) return;
            e.preventDefault();
            onChange(items[nextIdx].id);
            (e.currentTarget.parentElement?.children[nextIdx] as HTMLElement | undefined)?.focus();
          }}
          className={cn(
            "focus-visible:ring-ring studio-press flex h-7 flex-none items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none pointer-coarse:h-9",
            value === x.id
              ? "border-primary/45 bg-tint text-primary-text"
              : "border-border/50 text-foreground/80 hover:border-border/80 hover:text-foreground bg-transparent",
          )}
        >
          <span>{x.title}</span>
          {(showCounts || (showActiveCount && value === x.id)) && (
            <span
              className={cn(
                "text-tag tabular-nums",
                value === x.id ? "text-primary-text" : "text-foreground/70",
              )}
            >
              {x.count.toLocaleString()}
            </span>
          )}
        </button>
      ))}
    </HorizontalScrollRail>
  );
}

// CapCut 9.7's collapsible left category accordion tree (Yours v, Music ^, Sound effects v)
function CategoryTree({
  tree,
  activeNav,
  open,
  typed,
  voicesLoaded,
  onHeader,
  onSelect,
}: {
  tree: readonly NavSection[];
  activeNav: NavPick;
  open: OpenGroups;
  typed: boolean;
  voicesLoaded: boolean;
  onHeader: (group: NavGroupId) => void;
  onSelect: (pick: NavPick) => void;
}) {
  const timeline = tree
    .find((section) => section.id === "yours")
    ?.leaves.find((leaf) => leaf.id === "timeline");
  const timelineActive = activeNav.group === "yours" && activeNav.leaf === "timeline";
  return (
    <nav
      aria-label="Audio categories"
      className="border-border/50 flex w-40 flex-none flex-col gap-1 overflow-y-auto overscroll-contain border-e px-2 py-2.5 @max-[440px]:hidden"
    >
      {timeline && (
        <Button
          variant={timelineActive ? "secondary" : "tool"}
          size="sm"
          className="mb-2 min-h-8 w-full justify-start text-start"
          aria-current={timelineActive || undefined}
          onClick={() => onSelect({ group: "yours", leaf: "timeline" })}
        >
          <Music aria-hidden />
          <span className="min-w-0 flex-1 wrap-anywhere">{timeline.title}</span>
          <span className="text-muted-foreground tabular-nums">{timeline.count.toLocaleString()}</span>
        </Button>
      )}
      {tree.map((sec) => {
        const isGroupActive = activeNav.group === sec.id;
        const isOpen = open[sec.id];
        const leaves = sec.id === "yours" ? sec.leaves.filter((leaf) => leaf.id !== "timeline") : sec.leaves;
        return (
          <div key={sec.id} className="flex flex-col gap-0.5">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => onHeader(sec.id)}
              className={cn(
                "hover:bg-card/80 focus-visible:ring-ring studio-press flex h-7 w-full items-center justify-between gap-1 rounded-md px-2 text-start text-xs font-medium transition-colors duration-150 outline-none focus-visible:ring-2 motion-reduce:transition-none pointer-coarse:h-10",
                isGroupActive && !isOpen
                  ? "bg-raised-3/70 text-primary-text"
                  : isGroupActive
                    ? "text-foreground"
                    : "text-foreground/75 hover:text-foreground",
              )}
            >
              <span className="truncate">{sec.title}</span>
              {typed && (sec.id !== "voices" || voicesLoaded) && (
                <span className="text-tag text-foreground/70 ms-auto pe-0.5 tabular-nums">
                  {sec.count.toLocaleString()}
                </span>
              )}
              <ChevronDown
                aria-hidden
                className={cn(
                  "size-3 flex-none transition-transform duration-150 motion-reduce:transition-none",
                  isOpen && "rotate-180",
                  isGroupActive ? "text-primary-text" : "text-foreground/70",
                )}
              />
            </button>
            {isOpen && (
              <div className="border-border/40 ms-1.5 flex flex-col gap-0.5 border-s ps-1.5 pt-0.5 pb-1">
                {leaves.map((leaf) => {
                  const isCurrent = isGroupActive && activeNav.leaf === leaf.id;
                  const nextPick: NavPick =
                    sec.id === "yours"
                      ? { group: "yours", leaf: leaf.id as YoursLeaf }
                      : { group: sec.id, leaf: leaf.id };
                  const showCount =
                    (typed && (sec.id !== "voices" || voicesLoaded)) || sec.id === "yours";
                  return (
                    <button
                      key={leaf.id}
                      type="button"
                      aria-current={isCurrent ? "true" : undefined}
                      onClick={() => onSelect(nextPick)}
                      className={cn(
                        "focus-visible:ring-ring studio-press flex h-7 w-full items-center justify-between gap-1.5 rounded-md px-2 text-start text-xs transition-colors duration-150 outline-none focus-visible:ring-2 motion-reduce:transition-none pointer-coarse:h-9",
                        isCurrent
                          ? "bg-raised-3 text-primary-text font-medium"
                          : "text-foreground/80 hover:bg-card/80 hover:text-foreground",
                      )}
                    >
                      <span className="truncate">{leaf.title}</span>
                      {showCount && (
                        <span
                          className={cn(
                            "text-tag tabular-nums",
                            isCurrent ? "text-primary-text" : "text-foreground/70",
                          )}
                        >
                          {leaf.count.toLocaleString()}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

const singleSoundCard = (item: LibraryItem): LibraryGroup => ({
  key: item.name,
  primary: item,
  variants: [item],
});

// side: wide desktop left-column Audio library (CapCut's two-pane layout); !side: compact single-column mode
function Library({ side }: { side: boolean }) {
  useStudio((s) => s.soundRev);
  useStudio((s) => s.groups);
  useEffect(() => {
    void ensureSoundLibrary();
  }, []);
  const favs = useStudio((s) => s.favorites.sounds);
  const effectFavs = useStudio((s) => s.favorites.effects);
  const voiceTakes = useVoiceTakes();
  const [q, setQ] = useState("");
  const deferredQ = useDeferredValue(q);
  const [nav, setNav] = useState<NavPick>(INITIAL_NAV);
  const [open, setOpen] = useState<OpenGroups>(INITIAL_OPEN_GROUPS);
  const [origin, setOrigin] = useState<OriginFilter>(ALL);
  const [edition, setEdition] = useState<EditionFilter>(ALL);
  const [src, setSrc] = useState(ALL);
  const [voiceFilters, setVoiceFilters] = useState<VoiceFilters>(DEFAULT_VOICE_FILTERS);
  const typed = deferredQ.trim() !== "";
  const now = useSyncExternalStore(subscribeAudition, listening, listening);
  const targetNow = useSyncExternalStore(subscribeAudition, auditionTarget, auditionTarget);
  const activeTarget = targetNow || now;
  const voicesActive =
    open.voices || nav.group === "voices" || typed || activeTarget.startsWith("gv:");
  const voiceLib = useVoiceLibrary(voicesActive);
  const savedCastingVoices = useVoicePlaygroundSelector(
    (state) => state.favoriteVoices,
    voicesActive,
  );
  const playgroundUsage = useVoicePlaygroundSelector((state) => state.usage, voicesActive);
  const savedRecordings = useVoicePlaygroundSelector((state) => state.items, voicesActive);
  const savedTemplates = useVoicePlaygroundSelector((state) => state.templates, voicesActive);
  const starredTakeUids = useVoicePlaygroundSelector(
    (state) => state.starredTakeUids,
    voicesActive,
  );
  const favoriteEntries = useMemo(
    () =>
      savedFavoriteEntries(
        buildUnifiedEntries(savedRecordings, voiceTakes, new Set(starredTakeUids), savedTemplates),
        deferredQ,
      ),
    [savedRecordings, voiceTakes, starredTakeUids, savedTemplates, deferredQ],
  );
  const [limit, setLimit] = useState(PAGE);
  const [variantCursor, setVariantCursor] = useState<Record<string, number>>({});
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [copiedVoiceId, setCopiedVoiceId] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const favSet = useMemo(() => new Set(favs), [favs]);

  useEffect(
    () => () => {
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    },
    [],
  );

  const handleCopyVoiceId = useCallback((voice: SharedVoiceEntry) => {
    const write = navigator.clipboard?.writeText(voice.id);
    if (!write) {
      say(`Voice ID: ${voice.id}`);
      return;
    }
    void write.then(
      () => {
        setCopiedVoiceId(voice.id);
        say(`Copied voice ID for ${voice.name}`);
        if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => {
          setCopiedVoiceId(null);
          copyTimerRef.current = null;
        }, 1400);
      },
      () => {
        say(`Voice ID: ${voice.id}`);
      },
    );
  }, []);
  const matchedVoiceTakes = useMemo(
    () => filterVoiceTakes(voiceTakes, deferredQ),
    [voiceTakes, deferredQ],
  );
  const filmVoiceIds = useMemo(
    () =>
      new Set(
        activeFilmVoices(voiceTakes, playgroundUsage)
          .filter((voice) => voice.provider === "elevenlabs")
          .map((voice) => voice.voiceId),
      ),
    [voiceTakes, playgroundUsage],
  );
  const voiceFavKey = useMemo(() => effectFavs.filter(isVoiceStarId).join("\0"), [effectFavs]);
  const voiceFavs = useMemo(
    () => (voiceFavKey ? voiceFavKey.split("\0") : EMPTY_FAVS),
    [voiceFavKey],
  );
  const facetVoiceFilters = useMemo<VoiceFilters>(
    () => ({
      v4Mode: voiceFilters.v4Mode,
      category: voiceFilters.category,
      gender: voiceFilters.gender,
      age: voiceFilters.age,
      accent: voiceFilters.accent,
      descriptive: voiceFilters.descriptive,
      access: voiceFilters.access,
      sort: "usage1y",
    }),
    [
      voiceFilters.v4Mode,
      voiceFilters.category,
      voiceFilters.gender,
      voiceFilters.age,
      voiceFilters.accent,
      voiceFilters.descriptive,
      voiceFilters.access,
    ],
  );
  const voiceUseCaseIndex = useMemo(
    () => buildVoiceUseCaseIndex(voicesActive ? voiceLib.voices : [], facetVoiceFilters, deferredQ),
    [voicesActive, voiceLib.voices, facetVoiceFilters, deferredQ],
  );
  const savedCastingMatches = useMemo(
    () => filterSavedCastingVoices(savedCastingVoices, deferredQ, voiceFilters),
    [savedCastingVoices, deferredQ, voiceFilters],
  );
  const extraCastingFavorites = useMemo(
    () =>
      savedCastingMatches.filter(
        (voice) =>
          (voice.provider && voice.provider !== "elevenlabs") ||
          !voiceUseCaseIndex.matchingIds.has(voice.id),
      ).length,
    [savedCastingMatches, voiceUseCaseIndex],
  );
  const voiceLeaves = useMemo(
    () =>
      voiceLeavesWithFavs(voiceUseCaseIndex, voiceFavs).map((leaf) =>
        leaf.id === "fav"
          ? { ...leaf, count: leaf.count + extraCastingFavorites + favoriteEntries.length }
          : leaf,
      ),
    [voiceUseCaseIndex, voiceFavs, extraCastingFavorites, favoriteEntries.length],
  );
  const voiceSection = useMemo(
    () => ({ count: voiceLeaves[0]?.count ?? 0, leaves: voiceLeaves }),
    [voiceLeaves],
  );
  const libraryItems = library;
  const narrationName = lanes?.narration ?? null;
  const timelineUses = indexTimelineSounds(lanes, audibleName);
  const unavailableSounds = new Set<string>();
  const timelineItems: LibraryItem[] = [];
  for (const [name, { kind }] of timelineUses) {
    const item = itemOf(name);
    if (!item) unavailableSounds.add(name);
    timelineItems.push(item ?? { name, kind, seconds: 0 });
  }

  const {
    tree: catalogTree,
    activeNav,
    origins,
    activeOrigin,
    editions,
    activeEdition,
    sources,
    activeSource,
    shown: catalogItems,
    elsewhere,
  } = useMemo(
    () =>
      filterAndSortLibrary({
        items: libraryItems,
        favs,
        nav,
        origin,
        edition,
        source: src,
        query: deferredQ,
        kindOf,
        narrationName,
        voiceCount: matchedVoiceTakes.length,
        voiceSection,
      }),
    [
      libraryItems,
      favs,
      nav,
      origin,
      edition,
      src,
      deferredQ,
      narrationName,
      matchedVoiceTakes.length,
      voiceSection,
    ],
  );
  const isVoiceLeaf = activeNav.group === "yours" && activeNav.leaf === "voice";
  const isVoicesGroup = activeNav.group === "voices";
  const isFavLeaf = activeNav.group === "yours" && activeNav.leaf === "fav";
  const isTimelineLeaf = activeNav.group === "yours" && activeNav.leaf === "timeline";
  const { tree, shown: placedItems } = timelineLibraryView(
    catalogTree,
    timelineItems,
    deferredQ,
    isTimelineLeaf,
  );
  const activeVoiceLeafFavs = isVoicesGroup && activeNav.leaf === "fav" ? voiceFavs : EMPTY_FAVS;
  const filteredVoices = useMemo(
    () =>
      isVoicesGroup
        ? filterAndSortVoices(
            voiceLib.voices,
            activeNav.leaf,
            deferredQ,
            voiceFilters,
            activeVoiceLeafFavs,
          )
        : [],
    [isVoicesGroup, voiceLib.voices, activeNav.leaf, deferredQ, voiceFilters, activeVoiceLeafFavs],
  );
  const voiceFacets = useMemo(
    () =>
      isVoicesGroup
        ? voiceFacetOptions(
            voiceLib.voices,
            activeNav.leaf,
            facetVoiceFilters,
            activeVoiceLeafFavs,
            deferredQ,
          )
        : EMPTY_VOICE_FACETS,
    [
      isVoicesGroup,
      voiceLib.voices,
      activeNav.leaf,
      facetVoiceFilters,
      activeVoiceLeafFavs,
      deferredQ,
    ],
  );
  const clearQuery = useCallback(() => {
    setQ("");
    setLimit(PAGE);
  }, []);
  const activeSection = tree.find((s) => s.id === activeNav.group)!;
  const catalogGroups = useMemo(
    () => (isFavLeaf ? catalogItems.map(singleSoundCard) : groupLibraryFamilies(catalogItems)),
    [isFavLeaf, catalogItems],
  );
  const groups = isTimelineLeaf ? placedItems.map(singleSoundCard) : catalogGroups;
  const visibleGroups = groups.slice(0, limit);
  const more = groups.length - visibleGroups.length;
  const heading = categoryHeading(activeNav);
  const showFilter =
    !isVoiceLeaf &&
    !isVoicesGroup &&
    (origins.length > 0 ||
      editions.length > 0 ||
      sources.length > 0 ||
      activeOrigin !== ALL ||
      activeEdition !== ALL ||
      activeSource !== ALL);
  const isFiltered =
    !isVoiceLeaf &&
    !isVoicesGroup &&
    (activeOrigin !== ALL || activeEdition !== ALL || activeSource !== ALL);
  const filterTitle = isFiltered
    ? `Filter: ${[
        activeOrigin !== ALL && originTitle(activeOrigin),
        activeEdition !== ALL && editionTitle(activeEdition),
        activeSource !== ALL && sourceTitle(activeSource),
      ]
        .filter(Boolean)
        .join(" · ")}`
    : "Filter audio";
  const activeCount = isVoicesGroup
    ? filteredVoices.length +
      (activeNav.leaf === "fav" ? extraCastingFavorites + favoriteEntries.length : 0)
    : isVoiceLeaf
      ? matchedVoiceTakes.length
      : groups.length;
  const pgInlineOpen = useVoicePlaygroundSelector((s) => s.inlineOpen, false);

  const changeOrigin = (next: OriginFilter) => {
    setOrigin(next);
    if (
      next !== ALL &&
      src !== ALL &&
      !library.some(
        (x) => x.name !== lanes?.narration && originOf(x) === next && sourceOf(x) === src,
      )
    ) {
      setSrc(ALL);
    }
    setLimit(PAGE);
  };

  const changeEdition = (next: EditionFilter) => {
    setEdition(next);
    if (
      next !== ALL &&
      src !== ALL &&
      !library.some(
        (x) =>
          x.name !== lanes?.narration &&
          kindOf(x) === "mc" &&
          editionOf(x) === next &&
          sourceOf(x) === src,
      )
    ) {
      setSrc(ALL);
    }
    setLimit(PAGE);
  };

  const resetSourceIfAbsentInGroup = (nextGroup: NavGroupId, nextLeaf: string) => {
    if (nextGroup === "yours" && nextLeaf === "timeline") return;
    if (nextGroup === "yours" && (nextLeaf === "film" || nextLeaf === "voice")) {
      setSrc(ALL);
      return;
    }
    if (nextGroup !== activeNav.group && src !== ALL) {
      const hasSrc = library.some(
        (x) =>
          x.name !== lanes?.narration &&
          (nextGroup === "yours" ? favSet.has(x.name) : kindOf(x) === nextGroup) &&
          sourceOf(x) === src,
      );
      if (!hasSrc) setSrc(ALL);
    }
  };

  const selectNav = (next: NavPick) => {
    resetSourceIfAbsentInGroup(next.group, next.leaf);
    setNav(next);
    setExpandedKey(null);
    setLimit(PAGE);
  };
  const toggleHeader = (group: NavGroupId) => {
    const stepped = stepNavHeader(activeNav, open, group, tree);
    resetSourceIfAbsentInGroup(stepped.nav.group, stepped.nav.leaf);
    setNav(stepped.nav);
    setOpen(stepped.open);
    setExpandedKey(null);
    setLimit(PAGE);
  };

  // Dragged: a few pixels of movement turn the press into carrying the sound to a lane. The press must not also start a text
  // selection: Chrome then drags the selection natively, a ghost of half the panel, and cancels the carry (pointercancel).
  // A press let go where it began picks every clip of the sound (or variation family) instead
  const press =
    (activeName: string, onSelectUses: () => void, onCarried: () => void) =>
    (e: ReactPointerEvent) => {
      if (
        e.button !== 0 ||
        (e.target as HTMLElement).closest("button, [role=radio], [data-slot=slider]")
      )
        return;
      e.preventDefault();
      getSelection()?.removeAllRanges();
      const x0 = e.clientX,
        y0 = e.clientY;
      let carried = false;
      const stop = (ev: PointerEvent) => {
        removeEventListener("pointermove", move);
        removeEventListener("pointerup", stop);
        removeEventListener("pointercancel", stop);
        if (ev.type === "pointerup" && !carried) onSelectUses();
      };
      const move = (ev: PointerEvent) => {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
        carried = true;
        stop(ev);
        onCarried();
        startCarry(activeName, ev);
      };
      addEventListener("pointermove", move);
      addEventListener("pointerup", stop);
      addEventListener("pointercancel", stop);
    };

  const compactNav = (
    <div className={cn("flex flex-col gap-1 @[441px]:gap-1.5", side && "@min-[441px]:hidden")}>
      <Segmented
        label="Audio section"
        value={activeNav.group}
        onChange={(g) => toggleHeader(g)}
        items={(
          [
            { id: "yours", label: "Yours" },
            { id: "bgm", label: "Music" },
            { id: "sfx", label: "SFX" },
            { id: "mc", label: "MC" },
            { id: "voices", label: "Voices" },
          ] as const
        ).map(({ id, label }) => {
          const count =
            id === "voices" && isVoicesGroup
              ? filteredVoices.length
              : tree.find((t) => t.id === id)!.count;
          return {
            id,
            title: (
              <>
                <span
                  className={cn(
                    "truncate",
                    activeNav.group === id ? "text-primary-text font-medium" : "text-foreground/75",
                  )}
                >
                  {label}
                </span>
                {typed && (id !== "voices" || voiceLib.loaded) && (
                  <span className="text-tag text-foreground/70 hidden tabular-nums @min-[380px]:inline">
                    {count.toLocaleString()}
                  </span>
                )}
              </>
            ),
          };
        })}
      />
      {activeSection.leaves.length > 1 && (
        <AudioCategoryChips
          label="Audio category"
          value={activeNav.leaf}
          items={activeSection.leaves}
          showCounts={typed || activeNav.group === "yours"}
          showActiveCount
          onChange={(leaf) =>
            selectNav(
              activeNav.group === "yours"
                ? { group: "yours", leaf: leaf as YoursLeaf }
                : { group: activeNav.group, leaf },
            )
          }
        />
      )}
    </div>
  );

  const expandedGroup: LibraryGroup | null = useMemo(
    () =>
      !isVoicesGroup && !isVoiceLeaf && !isTimelineLeaf && expandedKey
        ? (catalogGroups.find((g) => g.key === expandedKey) ?? null)
        : null,
    [expandedKey, catalogGroups, isVoiceLeaf, isVoicesGroup, isTimelineLeaf],
  );

  const expandedVariantsRef = useRef<readonly string[] | null>(null);
  useEffect(() => {
    expandedVariantsRef.current = expandedGroup ? expandedGroup.variants.map((v) => v.name) : null;
  }, [expandedGroup]);

  useEffect(
    () =>
      subscribeAudition(() => {
        const nextTarget = auditionTarget();
        const allowed = expandedVariantsRef.current;
        if (nextTarget && allowed && !allowed.includes(nextTarget)) {
          setExpandedKey(null);
        }
      }),
    [],
  );

  const compactHideRow4 =
    activeSection.leaves.length > 1 &&
    !isTimelineLeaf &&
    !isVoicesGroup &&
    (isVoiceLeaf || (activeEdition === ALL && activeOrigin === ALL && activeSource === ALL));

  const listPane = (
    <div className={cn("flex min-w-0 flex-1 flex-col", side ? "min-h-0" : "gap-2 px-3")}>
      <div
        className={cn(
          "flex flex-none flex-col gap-1.5 @[560px]:gap-2",
          side && "border-border/50 border-b px-3 pt-1.5 pb-1.5 @[560px]:pt-2.5 @[560px]:pb-2",
        )}
      >
        {compactNav}
        <div className="flex items-center gap-1.5">
          <AudioSearchBox
            name="sound-search"
            value={q}
            onChange={(v) => {
              setQ(v);
              setLimit(PAGE);
            }}
            onClear={() => {
              setQ("");
              setLimit(PAGE);
            }}
            label={searchPlaceholder(activeNav)}
            placeholder={searchPlaceholder(activeNav)}
            className="min-w-0 flex-1"
          />
          {isVoicesGroup && (
            <Suspense fallback={<span className="size-7 flex-none" aria-hidden />}>
              <VoiceFilterMenu
                filters={voiceFilters}
                facets={voiceFacets}
                onChange={setVoiceFilters}
              />
            </Suspense>
          )}
          {showFilter && (
            <DropdownMenu open={filterMenuOpen} onOpenChange={setFilterMenuOpen}>
              <DropdownMenuTrigger
                render={
                  <FilterTriggerButton
                    active={isFiltered}
                    open={filterMenuOpen}
                    title={filterTitle}
                    aria-label={filterTitle}
                  />
                }
              />
              <DropdownMenuContent
                align="end"
                className="w-56 max-w-(--available-width) overflow-hidden"
              >
                <div className="bg-backdrop -m-1 max-h-[min(20rem,calc(var(--available-height)-0.5rem))] overflow-y-auto overscroll-contain rounded-lg p-1">
                  {editions.length > 0 && (
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>
                        <span className="text-foreground/70">Edition</span>
                      </DropdownMenuLabel>
                      <DropdownMenuRadioGroup
                        value={activeEdition}
                        onValueChange={(v) => changeEdition(v as EditionFilter)}
                      >
                        {editions.map((ed) => (
                          <DropdownMenuRadioItem
                            key={ed.id}
                            value={ed.id}
                            disabled={ed.count === 0 && activeEdition !== ed.id}
                          >
                            <span className="min-w-0 flex-1 truncate">{ed.title}</span>
                            <span className="text-foreground/70 text-xs tabular-nums">
                              {ed.count.toLocaleString()}
                            </span>
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuGroup>
                  )}
                  {origins.length > 0 && (
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>
                        <span className="text-foreground/70">Type</span>
                      </DropdownMenuLabel>
                      <DropdownMenuRadioGroup
                        value={activeOrigin}
                        onValueChange={(v) => changeOrigin(v as OriginFilter)}
                      >
                        {origins.map((o) => (
                          <DropdownMenuRadioItem
                            key={o.id}
                            value={o.id}
                            disabled={o.count === 0 && activeOrigin !== o.id}
                          >
                            <span className="min-w-0 flex-1 truncate">{o.title}</span>
                            <span className="text-foreground/70 text-xs tabular-nums">
                              {o.count.toLocaleString()}
                            </span>
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuGroup>
                  )}
                  {(origins.length > 0 || editions.length > 0) && sources.length > 0 && (
                    <DropdownMenuSeparator />
                  )}
                  {sources.length > 0 && (
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>
                        <span className="text-foreground/70">Source</span>
                      </DropdownMenuLabel>
                      <DropdownMenuRadioGroup
                        value={activeSource}
                        onValueChange={(v) => {
                          setSrc(v);
                          setLimit(PAGE);
                        }}
                      >
                        {sources.map((s) => (
                          <DropdownMenuRadioItem
                            key={s.id}
                            value={s.id}
                            disabled={s.count === 0 && activeSource !== s.id}
                          >
                            <span className="min-w-0 flex-1 truncate">{s.title}</span>
                            <span className="text-foreground/70 text-xs tabular-nums">
                              {s.count.toLocaleString()}
                            </span>
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuGroup>
                  )}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {compactHideRow4 && (
          <div className="sr-only @min-[441px]:hidden">
            <h3>{heading}</h3>
            <span aria-live="polite">{activeCount.toLocaleString()}</span>
          </div>
        )}
        <div
          className={cn(
            "flex min-h-5 flex-wrap items-center gap-1.5",
            compactHideRow4 && "@max-[440px]:hidden",
          )}
        >
          <h3 className="text-foreground min-w-0 truncate text-xs font-medium">{heading}</h3>
          {isVoicesGroup && (
            <Suspense fallback={null}>
              <VoiceFilterChips filters={voiceFilters} onChange={setVoiceFilters} />
            </Suspense>
          )}
          {!isVoiceLeaf && !isVoicesGroup && activeEdition !== ALL && (
            <AudioFilterChip
              label={editionTitle(activeEdition)}
              onClear={() => changeEdition(ALL)}
            />
          )}
          {!isVoiceLeaf && !isVoicesGroup && activeOrigin !== ALL && (
            <AudioFilterChip label={originTitle(activeOrigin)} onClear={() => changeOrigin(ALL)} />
          )}
          {!isVoiceLeaf && !isVoicesGroup && activeSource !== ALL && (
            <AudioFilterChip
              label={sourceTitle(activeSource)}
              onClear={() => {
                setSrc(ALL);
                setLimit(PAGE);
              }}
            />
          )}
          <div className="ms-auto flex flex-none items-center gap-2">
            <span aria-live="polite" className="text-foreground/70 text-xs tabular-nums">
              {activeCount.toLocaleString()}
              {isVoicesGroup &&
                voiceFilters.v4Mode === "v4" &&
                voiceLib.totalEnglish > activeCount && (
                  <span className="@max-[420px]:hidden">
                    {" "}
                    v4 · {voiceLib.totalEnglish.toLocaleString()} synced
                  </span>
                )}
            </span>
            {(isVoicesGroup || isVoiceLeaf) && (
              <>
                <Tip label="Toggle inline GenVoice ElevenLabs v4 Voice Playground">
                  <Button
                    variant="tool"
                    size="sm"
                    aria-pressed={pgInlineOpen}
                    onClick={() => setPlaygroundInlineOpen(!pgInlineOpen)}
                    className="h-6 flex-none pointer-coarse:min-h-9"
                    aria-label="Toggle Voice Playground"
                  >
                    <Sparkles className="size-3" />
                    <span>Playground</span>
                  </Button>
                </Tip>
                <Tip label="Open full GenVoice Workbench Dialog">
                  <Button
                    variant="tool"
                    size="icon-sm"
                    onClick={() => setPlaygroundWorkbenchOpen(true)}
                    className="h-6 w-6 flex-none pointer-coarse:min-h-9"
                    aria-label="Open Voice Playground Workbench"
                  >
                    <Maximize2 className="size-3" />
                  </Button>
                </Tip>
              </>
            )}
            {isVoicesGroup && (
              <Tip
                label={
                  voiceLib.syncedAt
                    ? `Sync English voice catalog from ElevenLabs (${voiceLib.totalEnglish.toLocaleString()} cached)`
                    : "Sync English voice catalog from ElevenLabs"
                }
              >
                <Button
                  variant="tool"
                  size="sm"
                  className="h-6 flex-none pointer-coarse:min-h-9"
                  disabled={voiceLib.status === "syncing"}
                  onClick={() => void syncVoiceLibraryNow()}
                  aria-label="Sync voices"
                >
                  <RefreshCw
                    aria-hidden
                    className={cn(
                      "size-3",
                      voiceLib.status === "syncing" && "animate-spin motion-reduce:animate-none",
                    )}
                  />
                  <span>{voiceLib.status === "syncing" ? "Syncing" : "Sync"}</span>
                </Button>
              </Tip>
            )}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {(isVoicesGroup || isVoiceLeaf) && pgInlineOpen && (
          <Suspense fallback={null}>
            <VoicePlaygroundInline />
          </Suspense>
        )}
        {isVoicesGroup ? (
          <Suspense
            fallback={
              <div className="text-foreground/70 px-3 py-4 text-xs">Loading English voices…</div>
            }
          >
            <VoiceLibraryPane
              library={voiceLib}
              voices={filteredVoices}
              favoriteEntries={favoriteEntries}
              leaf={activeNav.leaf}
              query={deferredQ}
              filters={voiceFilters}
              onChangeFilters={setVoiceFilters}
              onClearQuery={clearQuery}
              filmVoiceIds={filmVoiceIds}
              hasVoiceFavs={voiceFavs.length > 0}
              copiedId={copiedVoiceId}
              onCopyId={handleCopyVoiceId}
              side={side}
            />
          </Suspense>
        ) : isVoiceLeaf ? (
          <VoiceoverList
            takes={matchedVoiceTakes}
            totalTakes={voiceTakes.length}
            query={deferredQ}
            side={side}
            elsewhere={elsewhere}
            onToggleGroup={toggleHeader}
            onClearQuery={() => {
              setQ("");
              setLimit(PAGE);
            }}
          />
        ) : groups.length === 0 ? (
          <div
            className={cn(
              "flex items-center justify-center px-3 py-6",
              side && "min-h-0 flex-1 overflow-y-auto",
            )}
          >
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  {!library.length || (activeNav.group === "yours" && activeNav.leaf === "film") ? (
                    <Music />
                  ) : (
                    <SearchX />
                  )}
                </EmptyMedia>
                <EmptyTitle>
                  {!library.length && !isTimelineLeaf
                    ? "No audio in library"
                    : typed
                      ? `No matching ${activeSection.one}s`
                      : activeNav.group === "yours" && activeNav.leaf === "fav"
                        ? "No favorites yet"
                        : isTimelineLeaf
                          ? "No audio on the timeline yet"
                          : activeNav.group === "yours" && activeNav.leaf === "film"
                            ? "No film files yet"
                            : `No ${activeSection.one}s found`}
                </EmptyTitle>
                <EmptyDescription>
                  <span className="text-foreground/75">
                    {!library.length && !isTimelineLeaf
                      ? "Add audio files to this film or set up its sound library."
                      : typed
                        ? `No results for "${deferredQ.trim()}". Try another keyword or switch categories.`
                        : activeEdition !== ALL && activeSource !== ALL
                          ? `No ${editionTitle(activeEdition)} ${activeSection.one}s from ${sourceTitle(activeSource)} here.`
                          : activeEdition !== ALL
                            ? `No ${editionTitle(activeEdition)} ${activeSection.one}s here.`
                            : activeOrigin !== ALL && activeSource !== ALL
                              ? `No ${activeOrigin === "synth" ? "code-generated" : "real / studio"} ${activeSection.one}s from ${sourceTitle(activeSource)} here.`
                              : activeOrigin !== ALL
                                ? `No ${activeOrigin === "synth" ? "code-generated" : "real / studio"} ${activeSection.one}s here.`
                                : activeSource !== ALL
                                  ? `No ${activeSection.one}s from ${sourceTitle(activeSource)} here.`
                                  : activeNav.group === "yours" && activeNav.leaf === "fav"
                                    ? "Star a sound to save it here."
                                    : isTimelineLeaf
                                      ? "Add music or a sound effect to the timeline to see it here."
                                      : activeNav.group === "yours" && activeNav.leaf === "film"
                                        ? "Add audio files to this film to find them here."
                                      : `No ${activeSection.one}s in this category.`}
                  </span>
                </EmptyDescription>
              </EmptyHeader>
              {(typed ||
                activeEdition !== ALL ||
                activeOrigin !== ALL ||
                activeSource !== ALL ||
                elsewhere.length > 0) && (
                <EmptyContent>
                  <div className="flex flex-wrap items-center justify-center gap-1.5">
                    {typed && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setQ("");
                          setLimit(PAGE);
                        }}
                      >
                        Clear search
                      </Button>
                    )}
                    {activeEdition !== ALL && (
                      <Button variant="secondary" size="sm" onClick={() => changeEdition(ALL)}>
                        Show all editions
                      </Button>
                    )}
                    {activeOrigin !== ALL && (
                      <Button variant="secondary" size="sm" onClick={() => changeOrigin(ALL)}>
                        Show all types
                      </Button>
                    )}
                    {activeSource !== ALL && (
                      <Button variant="secondary" size="sm" onClick={() => setSrc(ALL)}>
                        Show all sources
                      </Button>
                    )}
                    {elsewhere.map((sec) => (
                      <Button
                        key={sec.id}
                        variant="secondary"
                        size="sm"
                        onClick={() => toggleHeader(sec.id)}
                      >
                        {sec.count.toLocaleString()} in {sec.title}
                      </Button>
                    ))}
                  </div>
                </EmptyContent>
              )}
            </Empty>
          </div>
        ) : (
          <ul
            className={cn(
              "grid auto-rows-max content-start items-stretch gap-2",
              "grid-cols-[repeat(auto-fill,minmax(min(100%,14rem),1fr))]",
              side && "scroll-fade min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3",
            )}
          >
            {visibleGroups.map((g) => {
              const variantCount = g.variants.length;
              const hasVariants = variantCount > 1;
              const activeTarget = targetNow || now;
              const playingIdx = now ? g.variants.findIndex((v) => v.name === now) : -1;
              const targetIdx = activeTarget
                ? g.variants.findIndex((v) => v.name === activeTarget)
                : -1;
              const curIdx =
                playingIdx >= 0
                  ? playingIdx
                  : targetIdx >= 0
                    ? targetIdx
                    : (variantCursor[g.key] ?? 0) % variantCount;
              const x = g.variants[curIdx];
              const allNames = hasVariants ? g.variants.map((v) => v.name) : [x.name];
              const starId = hasVariants
                ? (g.variants.find((v) => favSet.has(v.name))?.name ?? x.name)
                : x.name;
              const timelineClips = isTimelineLeaf ? timelineUses.get(x.name)?.clips : undefined;
              const highlightedNames = isTimelineLeaf ? null : allNames;
              const unavailable = isTimelineLeaf && unavailableSounds.has(x.name);
              const uses = timelineClips?.length ?? useCountOfNames(allNames);
              const itemKind = kindOf(x);
              const isSynth = originOf(x) === "synth";
              const isPlaying = playingIdx >= 0;
              const isTarget = targetIdx >= 0;
              const showCategory = activeNav.group === "yours" || activeNav.leaf === ALL;
              const showSource =
                !unavailable &&
                activeSource === ALL &&
                !(activeNav.group === "yours" && activeNav.leaf === "film") &&
                !(isSynth && showCategory && Boolean(x.category));
              const {
                title: rawTitle,
                subtitle,
                duration,
              } = soundCardText(x, itemKind, {
                showCategory,
                showSource,
                showVariant: !hasVariants,
              });
              const title = audioDisplayTitle(rawTitle, { mc: itemKind === "mc" });
              const detail = soundCardDetail(x);
              const selectUses = () => {
                if (timelineClips) setClips(timelineClips);
                else pickNamesUses(allNames, title);
              };
              const advanceRoundRobin = () => {
                if (hasVariants) {
                  setVariantCursor((prev) => ({ ...prev, [g.key]: (curIdx + 1) % variantCount }));
                }
              };
              return (
                <li
                  key={g.key}
                  onPointerDown={unavailable ? undefined : press(x.name, selectUses, advanceRoundRobin)}
                  onDragStart={(e) => e.preventDefault()}
                  onPointerEnter={() => lightSounds(highlightedNames)}
                  onPointerLeave={() => lightSounds(null)}
                  onFocus={() => lightSounds(highlightedNames)}
                  onBlur={() => lightSounds(null)}
                  className={cn(
                    "group flex min-w-0 flex-col rounded-lg border px-2.5 py-2 transition-colors duration-150 motion-reduce:transition-none",
                    !unavailable && "cursor-grab touch-none active:cursor-grabbing",
                    isPlaying
                      ? "border-primary/75 bg-raised-3"
                      : isTarget
                        ? "border-primary/45 bg-raised-3"
                        : "bg-card/85 hover:border-raised-4/50 hover:bg-raised-3 focus-within:border-raised-4/60 focus-within:bg-raised-3 border-border",
                  )}
                >
                  <div className="flex min-h-11 flex-1 items-start gap-2">
                    <Tip label={unavailable ? "File unavailable" : isPlaying ? "Pause preview" : "Preview audio"}>
                      <Button
                        variant="cover"
                        size="cover"
                        className="mt-0.5 flex-none"
                        aria-pressed={isPlaying}
                        disabled={unavailable}
                        aria-label={`${isPlaying ? "Pause" : "Preview"} ${title}`}
                        onClick={() => {
                          setExpandedKey(hasVariants ? g.key : null);
                          listen(x.name);
                        }}
                      >
                        <span aria-hidden className="grid place-items-center">
                          <Play className={cn("col-start-1 row-start-1 translate-x-[0.5px] fill-current transition-opacity duration-150 motion-reduce:transition-none", isPlaying && "opacity-0")} />
                          <Pause className={cn("col-start-1 row-start-1 fill-current transition-opacity duration-150 motion-reduce:transition-none", !isPlaying && "opacity-0")} />
                        </span>
                      </Button>
                    </Tip>
                    <div
                      className="flex min-w-0 flex-1 flex-col justify-between gap-0.5 self-stretch"
                      title={detail}
                    >
                      <div className="flex min-h-6 flex-wrap items-start gap-1">
                        <span className="text-ui text-foreground min-w-[min(100%,6rem)] flex-1 py-0.5 leading-snug font-medium wrap-anywhere">
                          {title}
                        </span>
                        <span className="ms-auto flex flex-none items-center gap-1">
                          {!unavailable && <FavoriteStar kind="sounds" id={starId} name={title} onCard />}
                          <Tip
                            label={
                              hasVariants
                                ? `Add variation #${x.variant ?? curIdx + 1} to track (auto-cycles)`
                                : "Add to track"
                            }
                          >
                            <Button
                              variant="card-action"
                              size="icon-sm"
                              className="flex-none pointer-coarse:size-9"
                              disabled={unavailable}
                              aria-label={`Add ${title} to track`}
                              onClick={() => {
                                addClip(x.name, S.t);
                                advanceRoundRobin();
                              }}
                            >
                              <Plus />
                            </Button>
                          </Tip>
                        </span>
                      </div>
                      <div className="mt-auto flex min-h-6 flex-wrap items-center justify-between gap-1.5">
                        <span className="text-muted-foreground text-xs flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 leading-snug">
                          {(isSynth || x.contentId || subtitle) && (
                            <span className="flex min-w-0 flex-wrap items-center gap-1">
                              {isSynth && <Badge variant="synth">Code</Badge>}
                              {x.contentId && (
                                <Badge variant="claim" title={CONTENT_ID_NOTE}>
                                  Content ID
                                </Badge>
                              )}
                              {subtitle && <span className="min-w-0 wrap-anywhere">{subtitle}</span>}
                            </span>
                          )}
                          <span className="tabular-nums">
                            {unavailable ? "File unavailable" : duration}
                          </span>
                        </span>
                        {(hasVariants || uses > 0) && (
                          <span className="flex flex-none items-center gap-1">
                            {hasVariants && (
                              <Tip
                                label={`Variation ${curIdx + 1} of ${variantCount} — click for next`}
                              >
                                <button
                                  type="button"
                                  aria-label={`Next variation of ${title} (${curIdx + 1} of ${variantCount})`}
                                  onClick={() => {
                                    const nextIdx = (curIdx + 1) % variantCount;
                                    setExpandedKey(g.key);
                                    setVariantCursor((prev) => ({ ...prev, [g.key]: nextIdx }));
                                    listen(g.variants[nextIdx].name);
                                  }}
                                  className={cn(
                                    "text-tag text-foreground/80 hover:bg-raised-4 hover:text-foreground focus-visible:ring-ring studio-press inline-flex h-6 flex-none items-center rounded-md border px-1.5 font-mono tabular-nums transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none pointer-coarse:min-h-9 pointer-coarse:px-2",
                                    isPlaying || isTarget
                                      ? "bg-raised-4/75 border-border/60"
                                      : "bg-raised-3 group-hover:bg-raised-4/75 border-transparent",
                                  )}
                                >
                                  {curIdx + 1}/{variantCount}
                                </button>
                              </Tip>
                            )}
                            {uses > 0 && (
                              <Tip
                                label={
                                  uses > 1
                                    ? `Select its ${uses} clips on the tracks`
                                    : "Select its clip on the tracks"
                                }
                              >
                                <button
                                  type="button"
                                  className={cn(
                                    "focus-visible:ring-ring studio-press text-tag inline-flex h-6 flex-none items-center rounded-md px-2 font-medium tabular-nums transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none pointer-coarse:min-h-9",
                                    isTarget
                                      ? "bg-tint text-primary-text"
                                      : isPlaying
                                        ? "bg-raised-4/75 text-foreground hover:bg-tint hover:text-primary-text"
                                        : "bg-raised-3 group-hover:bg-raised-4/75 text-foreground/85 hover:bg-tint hover:text-primary-text",
                                  )}
                                  aria-label={`Select the ${uses > 1 ? `${uses} clips` : "clip"} of ${title}`}
                                  onClick={selectUses}
                                >
                                  {uses}×
                                </button>
                              </Tip>
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
            {more > 0 && (
              <li className="col-span-full pt-1">
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 w-full pointer-coarse:min-h-9"
                  onClick={() => setLimit((n) => n + PAGE)}
                >
                  <span className="truncate tabular-nums">
                    Show more ({more.toLocaleString()} remaining of {groups.length.toLocaleString()}
                    )
                  </span>
                </Button>
              </li>
            )}
          </ul>
        )}
      </div>
      <AuditionDock
        libraryItems={libraryItems}
        voices={voiceLib.voices}
        voiceTakes={voiceTakes}
        expandedGroup={expandedGroup}
        variantCursor={variantCursor}
        copiedId={copiedVoiceId}
        sticky={!side}
        onSelectVariant={(groupKey, idx) => {
          setExpandedKey(groupKey);
          setVariantCursor((prev) => ({ ...prev, [groupKey]: idx }));
        }}
        onAdvanceVariant={(groupKey, nextIdx) =>
          setVariantCursor((prev) => ({ ...prev, [groupKey]: nextIdx }))
        }
        onCopyVoiceId={handleCopyVoiceId}
        onClearExpanded={() => setExpandedKey(null)}
      />
    </div>
  );

  if (side) {
    return (
      <TooltipProvider delay={350} closeDelay={100}>
        <section
          aria-label="Sound library"
          className="@container flex min-h-0 flex-1 overflow-hidden"
        >
          <CategoryTree
            tree={tree}
            activeNav={activeNav}
            open={open}
            typed={typed}
            voicesLoaded={voiceLib.loaded}
            onHeader={toggleHeader}
            onSelect={selectNav}
          />
          {listPane}
        </section>
      </TooltipProvider>
    );
  }
  return (
    <TooltipProvider delay={350} closeDelay={100}>
      <section aria-label="Sound library" className="@container flex flex-col">
        {listPane}
      </section>
    </TooltipProvider>
  );
}

// part: the whole tab (one column), or on a wide screen the clip in the right column and the library in the left one
export function SoundPanel({
  part = "all",
  tab = "basic",
}: {
  part?: "all" | "clip" | "library";
  tab?: "basic" | "voice" | "speed";
}) {
  const clip = useStudio((s) => s.clip),
    clips = useStudio((s) => s.clips),
    saved = useStudio((s) => s.soundSaved);
  useStudio((s) => s.soundRev);
  if (part === "library") {
    return (
      <div data-arrow-scroll className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Library side />
      </div>
    );
  }
  return (
    <div data-arrow-scroll className="flex min-h-0 flex-1 flex-col gap-3 pt-1 pb-3 *:shrink-0">
      <div className="flex items-center gap-1 px-3">
        <SaveStatus state={saved} className="min-w-0 flex-1 px-0.5" />
        <Tip label="Select the clip playing at the playhead; click again for the next one there">
          <Button variant="quiet" size="md" onClick={() => pickAt(S.t)}>
            At playhead
          </Button>
        </Tip>
        <Tip label="Undo (Ctrl+Z)">
          <Button
            variant="quiet"
            size="icon-lg"
            className="pointer-coarse:size-10"
            aria-label="Undo"
            disabled={!canUndo()}
            onClick={undo}
          >
            <Undo2 />
          </Button>
        </Tip>
        <Tip label="Redo (Ctrl+Y)">
          <Button
            variant="quiet"
            size="icon-lg"
            className="pointer-coarse:size-10"
            aria-label="Redo"
            disabled={!canRedo()}
            onClick={redo}
          >
            <Redo2 />
          </Button>
        </Tip>
      </div>
      {clip ? (
        <Inspector clip={clip} tab={tab} />
      ) : clips.length > 1 ? (
        <section
          aria-label="Selected clips"
          className="bg-card mx-3 flex items-center gap-2 rounded-xl p-3"
        >
          <p className="text-ui min-w-0 flex-1">
            {clips.length} clips selected
            <span className="text-muted-foreground block text-xs">Drag one to move them all</span>
          </p>
          <Button variant="ghost" size="sm" className="h-8" onClick={() => setClips([])}>
            Deselect
          </Button>
          <Tip label="Delete selected clips (Delete)">
            <Button
              variant="remove"
              size="icon-lg"
              className="-me-1 pointer-coarse:size-10"
              aria-label={`Delete ${clips.length} selected clips`}
              onClick={() => removeClips(clips)}
            >
              <Trash2 />
            </Button>
          </Tip>
        </section>
      ) : (
        <EmptyCard title="No clip selected" className="mx-3">
          Click a clip on an audio track to change its volume, fades and duration.
        </EmptyCard>
      )}
      {part !== "clip" && <Library side={false} />}
    </div>
  );
}
