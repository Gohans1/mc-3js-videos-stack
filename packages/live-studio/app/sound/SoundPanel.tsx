import {
  ChevronDown,
  ChevronUp,
  ListFilter,
  Pause,
  Play,
  Plus,
  Redo2,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { type PointerEvent as ReactPointerEvent, useDeferredValue, useMemo, useState } from "react";

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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
// The sound tab: the clip picked on the lanes (its level, fades, length, which file), then every sound in the film and vault,
// organized as CapCut 9.7's Audio library (Yours, Music, Sound effects, Minecraft). A library card is dragged onto a lane, or + puts it at
// the playhead; the cover button auditions it with an inline scrubber; pointing lights its clips, clicking selects them.
import { cn } from "@/lib/utils";

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
import { SearchBox } from "../components/SearchBox";
import { Tip } from "../components/Tip";
import { canRedo, canUndo, redo, undo } from "../core/doc";
import { S } from "../core/state";
import { say, useStudio } from "../core/store";
import { FPS, r3, stamp } from "../core/time";
import { useFrame } from "../core/useFrame";
import { seek, setPlaying } from "../playback/transport";
import { AudioSpeed } from "./AudioSpeed";
import { AuditionScrubber } from "./AuditionScrubber";
import { type Band, readEq, type Slope, withBands, withCut, withShelf, withWidth } from "./eq";
import { GAIN_KEY_EPS, gainAt, toggleGainKey, writeGain } from "./gain";
import { startCarry } from "./lanes";
import {
  ALL,
  categoryHeading,
  CONTENT_ID_NOTE,
  type EditionFilter,
  editionOf,
  editionTitle,
  filterAndSortLibrary,
  groupLibraryFamilies,
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
  type YoursLeaf,
} from "./library-view";
import { decoded } from "./mixer";
import { NormalizeClip } from "./NormalizeClip";
import { type ClipRef } from "./slice";
import {
  addClip,
  clipOf,
  cutAfter,
  edit,
  familyItemsOf,
  itemOf,
  kindOf,
  type Lanes,
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
  swapSound,
  useCountOfNames,
} from "./sound";
import { SoundSwapPicker } from "./SoundSwapPicker";
import { playedPart, type SyncMode, syncPoint } from "./sync";
import { cachedVoiceClipLabel, useVoiceTakes } from "./voice-client";
import { filterVoiceTakes } from "./voice-view";
import { VoiceChanger } from "./VoiceChanger";
import { VoiceClipSection } from "./VoiceClipSection";
import { VoiceoverList } from "./VoiceoverList";

const soundDoc = { snapshot, restore };
const PAGE = 80;

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
              <p className="text-warn text-xs">
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

// CapCut 9.7's collapsible left category accordion tree (Yours v, Music ^, Sound effects v)
function CategoryTree({
  tree,
  activeNav,
  open,
  typed,
  onHeader,
  onSelect,
}: {
  tree: readonly NavSection[];
  activeNav: NavPick;
  open: OpenGroups;
  typed: boolean;
  onHeader: (group: NavGroupId) => void;
  onSelect: (pick: NavPick) => void;
}) {
  return (
    <nav
      aria-label="Audio categories"
      className="border-border flex w-[134px] flex-none flex-col gap-1.5 overflow-y-auto border-e px-1.5 py-2.5 @max-[320px]:hidden"
    >
      {tree.map((sec) => {
        const isGroupActive = activeNav.group === sec.id;
        const isOpen = open[sec.id];
        return (
          <div key={sec.id} className="flex flex-col gap-0.5">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => onHeader(sec.id)}
              className={cn(
                "bg-raised-3 hover:bg-raised-4 focus-visible:ring-ring flex h-8 w-full items-center justify-between gap-1 rounded-md px-2 text-start text-xs font-medium transition-colors duration-150 outline-none focus-visible:ring-2 pointer-coarse:h-10",
                isGroupActive ? "text-primary" : "text-foreground",
              )}
            >
              <span className="truncate">{sec.title}</span>
              {typed && (
                <span className="text-tag text-muted-foreground ms-auto pe-0.5 tabular-nums">
                  {sec.count}
                </span>
              )}
              {isOpen ? (
                <ChevronUp
                  aria-hidden
                  className={cn(
                    "size-3 flex-none",
                    isGroupActive ? "text-primary" : "text-muted-foreground",
                  )}
                />
              ) : (
                <ChevronDown
                  aria-hidden
                  className={cn(
                    "size-3 flex-none",
                    isGroupActive ? "text-primary" : "text-muted-foreground",
                  )}
                />
              )}
            </button>
            {isOpen && (
              <div className="flex flex-col gap-0.5 pt-0.5">
                {sec.leaves.map((leaf) => {
                  const isCurrent = isGroupActive && activeNav.leaf === leaf.id;
                  const nextPick: NavPick =
                    sec.id === "yours"
                      ? { group: "yours", leaf: leaf.id as YoursLeaf }
                      : { group: sec.id, leaf: leaf.id };
                  return (
                    <button
                      key={leaf.id}
                      type="button"
                      aria-current={isCurrent ? "true" : undefined}
                      onClick={() => onSelect(nextPick)}
                      className={cn(
                        "focus-visible:ring-ring flex h-7.5 w-full items-center justify-between gap-1 rounded-md px-2 text-start text-xs transition-colors duration-150 outline-none focus-visible:ring-2 pointer-coarse:h-10",
                        isCurrent
                          ? "bg-raised-3 text-primary font-medium"
                          : "text-foreground/90 hover:bg-card hover:text-foreground",
                      )}
                    >
                      <span className="truncate">{leaf.title}</span>
                      {(typed || sec.id === "yours") && (
                        <span
                          className={cn(
                            "text-tag tabular-nums",
                            isCurrent ? "text-primary/80" : "text-muted-foreground",
                          )}
                        >
                          {leaf.count}
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

// side: wide desktop left-column Audio library (CapCut's two-pane layout); !side: compact single-column mode
function Library({ side }: { side: boolean }) {
  useStudio((s) => s.soundRev);
  const favs = useStudio((s) => s.favorites.sounds);
  const voiceTakes = useVoiceTakes();
  const [q, setQ] = useState("");
  const deferredQ = useDeferredValue(q);
  const [nav, setNav] = useState<NavPick>(INITIAL_NAV);
  const [open, setOpen] = useState<OpenGroups>(INITIAL_OPEN_GROUPS);
  const [origin, setOrigin] = useState<OriginFilter>(ALL);
  const [edition, setEdition] = useState<EditionFilter>(ALL);
  const [src, setSrc] = useState(ALL);
  const [limit, setLimit] = useState(PAGE);
  const [variantCursor, setVariantCursor] = useState<Record<string, number>>({});
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const favSet = useMemo(() => new Set(favs), [favs]);
  const now = listening();
  const typed = deferredQ.trim() !== "";
  const matchedVoiceTakes = useMemo(
    () => filterVoiceTakes(voiceTakes, deferredQ),
    [voiceTakes, deferredQ],
  );
  const libraryItems = library;
  const narrationName = lanes?.narration ?? null;

  const {
    tree,
    activeNav,
    origins,
    activeOrigin,
    editions,
    activeEdition,
    sources,
    activeSource,
    shown,
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
    ],
  );
  const isVoiceLeaf = activeNav.group === "yours" && activeNav.leaf === "voice";
  const isFavLeaf = activeNav.group === "yours" && activeNav.leaf === "fav";
  const activeSection = tree.find((s) => s.id === activeNav.group)!;
  const groups: LibraryGroup[] = useMemo(
    () =>
      isFavLeaf
        ? shown.map((x) => ({ key: x.name, primary: x, variants: [x] }))
        : groupLibraryFamilies(shown),
    [isFavLeaf, shown],
  );
  const visibleGroups = groups.slice(0, limit);
  const more = groups.length - visibleGroups.length;
  const heading = categoryHeading(activeNav);
  const showFilter =
    !isVoiceLeaf &&
    (origins.length > 0 ||
      editions.length > 0 ||
      sources.length > 0 ||
      activeOrigin !== ALL ||
      activeEdition !== ALL ||
      activeSource !== ALL);
  const isFiltered =
    !isVoiceLeaf && (activeOrigin !== ALL || activeEdition !== ALL || activeSource !== ALL);
  const filterTitle = isFiltered
    ? `Filter: ${[
        activeOrigin !== ALL && originTitle(activeOrigin),
        activeEdition !== ALL && editionTitle(activeEdition),
        activeSource !== ALL && sourceTitle(activeSource),
      ]
        .filter(Boolean)
        .join(" · ")}`
    : "Filter audio";
  const activeCount = isVoiceLeaf ? matchedVoiceTakes.length : groups.length;

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
    (activeName: string, familyNames: readonly string[], label: string, onCarried?: () => void) =>
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
        if (ev.type === "pointerup" && !carried) pickNamesUses(familyNames, label);
      };
      const move = (ev: PointerEvent) => {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
        carried = true;
        stop(ev);
        onCarried?.();
        startCarry(activeName, ev);
      };
      addEventListener("pointermove", move);
      addEventListener("pointerup", stop);
      addEventListener("pointercancel", stop);
    };

  const compactNav = (
    <div className={cn("flex flex-col gap-1.5", side && "@min-[321px]:hidden")}>
      <Segmented
        label="Audio section"
        value={activeNav.group}
        onChange={(g) => toggleHeader(g)}
        items={[
          {
            id: "bgm" as const,
            title: (
              <>
                <span className="truncate">Music</span>
                {typed && (
                  <span className="text-tag text-muted-foreground tabular-nums">
                    {tree.find((t) => t.id === "bgm")!.count}
                  </span>
                )}
              </>
            ),
          },
          {
            id: "sfx" as const,
            title: (
              <>
                <span className="truncate">SFX</span>
                {typed && (
                  <span className="text-tag text-muted-foreground tabular-nums">
                    {tree.find((t) => t.id === "sfx")!.count}
                  </span>
                )}
              </>
            ),
          },
          {
            id: "mc" as const,
            title: (
              <>
                <span className="truncate">MC</span>
                {typed && (
                  <span className="text-tag text-muted-foreground tabular-nums">
                    {tree.find((t) => t.id === "mc")!.count}
                  </span>
                )}
              </>
            ),
          },
          {
            id: "yours" as const,
            title: (
              <>
                <span className="truncate">Yours</span>
                {typed && (
                  <span className="text-tag text-muted-foreground tabular-nums">
                    {tree.find((t) => t.id === "yours")!.count}
                  </span>
                )}
              </>
            ),
          },
        ]}
      />
      {activeSection.leaves.length > 1 && (
        <ChipGroup
          scroll
          label="Audio category"
          value={activeNav.leaf}
          items={activeSection.leaves}
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

  const listPane = (
    <div className={cn("flex min-w-0 flex-1 flex-col", side ? "min-h-0" : "gap-2 px-3")}>
      <div className={cn("flex flex-none flex-col gap-2", side && "px-3 pt-2.5 pb-2")}>
        {compactNav}
        <div className="flex items-center gap-1.5">
          <SearchBox
            name="sound-search"
            value={q}
            onChange={(v) => {
              setQ(v);
              setLimit(PAGE);
            }}
            label={searchPlaceholder(activeNav)}
            placeholder={searchPlaceholder(activeNav)}
            className="min-w-0 flex-1"
          />
          {showFilter && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="quiet"
                    size="filter"
                    title={filterTitle}
                    aria-label="Filter audio"
                    aria-pressed={isFiltered}
                    className="flex-none"
                  />
                }
              >
                <ListFilter className="size-4" />
                <ChevronDown className="size-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="max-h-80 w-56 overflow-y-auto overscroll-contain"
              >
                {editions.length > 0 && (
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Edition</DropdownMenuLabel>
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
                          <span className="text-muted-foreground text-xs tabular-nums">
                            {ed.count}
                          </span>
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuGroup>
                )}
                {origins.length > 0 && (
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Type</DropdownMenuLabel>
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
                          <span className="text-muted-foreground text-xs tabular-nums">
                            {o.count}
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
                    <DropdownMenuLabel>Source</DropdownMenuLabel>
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
                          <span className="text-muted-foreground text-xs tabular-nums">
                            {s.count}
                          </span>
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuGroup>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <div className="flex min-h-5 items-center gap-1.5">
          <h3 className="text-foreground min-w-0 truncate text-xs font-medium">{heading}</h3>
          {!isVoiceLeaf && activeEdition !== ALL && (
            <button
              type="button"
              onClick={() => changeEdition(ALL)}
              aria-label={`Clear ${editionTitle(activeEdition)} filter`}
              className="bg-tint text-tag text-primary hover:bg-tint-hover focus-visible:ring-ring inline-flex h-5 flex-none items-center gap-1 rounded-full px-2 font-medium outline-none focus-visible:ring-2"
            >
              <span>{editionTitle(activeEdition)}</span>
              <X aria-hidden className="size-2.5" />
            </button>
          )}
          {!isVoiceLeaf && activeOrigin !== ALL && (
            <button
              type="button"
              onClick={() => changeOrigin(ALL)}
              aria-label={`Clear ${originTitle(activeOrigin)} filter`}
              className="bg-tint text-tag text-primary hover:bg-tint-hover focus-visible:ring-ring inline-flex h-5 flex-none items-center gap-1 rounded-full px-2 font-medium outline-none focus-visible:ring-2"
            >
              <span>{originTitle(activeOrigin)}</span>
              <X aria-hidden className="size-2.5" />
            </button>
          )}
          {!isVoiceLeaf && activeSource !== ALL && (
            <button
              type="button"
              onClick={() => {
                setSrc(ALL);
                setLimit(PAGE);
              }}
              aria-label={`Clear ${sourceTitle(activeSource)} filter`}
              className="bg-tint text-tag text-primary hover:bg-tint-hover focus-visible:ring-ring inline-flex h-5 flex-none items-center gap-1 rounded-full px-2 font-medium outline-none focus-visible:ring-2"
            >
              <span>{sourceTitle(activeSource)}</span>
              <X aria-hidden className="size-2.5" />
            </button>
          )}
          <span className="text-muted-foreground ms-auto flex-none text-xs tabular-nums">
            {activeCount}
          </span>
        </div>
      </div>

      {isVoiceLeaf ? (
        <VoiceoverList
          takes={matchedVoiceTakes}
          totalTakes={voiceTakes.length}
          query={deferredQ}
          side={side}
          elsewhere={elsewhere}
          onToggleGroup={toggleHeader}
        />
      ) : (
        <ul
          className={cn(
            "flex flex-col gap-1.5",
            side && "scroll-fade min-h-0 flex-1 overflow-y-auto px-3 pb-3",
          )}
        >
          {visibleGroups.map((g) => {
            const variantCount = g.variants.length;
            const hasVariants = variantCount > 1;
            const playingIdx = now ? g.variants.findIndex((v) => v.name === now) : -1;
            const curIdx =
              playingIdx >= 0 ? playingIdx : (variantCursor[g.key] ?? 0) % variantCount;
            const x = g.variants[curIdx];
            const allNames = hasVariants ? g.variants.map((v) => v.name) : [x.name];
            const starId = hasVariants
              ? (g.variants.find((v) => favSet.has(v.name))?.name ?? x.name)
              : x.name;
            const uses = useCountOfNames(allNames);
            const itemKind = kindOf(x);
            const isSynth = originOf(x) === "synth";
            const isPlaying = playingIdx >= 0;
            const showVariants = hasVariants && (isPlaying || expandedKey === g.key);
            const showCategory = activeNav.group === "yours" || activeNav.leaf === ALL;
            const showSource =
              activeSource === ALL &&
              !(activeNav.group === "yours" && activeNav.leaf === "film") &&
              !(isSynth && showCategory && Boolean(x.category));
            const { title, subtitle, duration } = soundCardText(x, itemKind, {
              showCategory,
              showSource,
              showVariant: !hasVariants,
            });
            const detail = soundCardDetail(x);
            const advanceRoundRobin = () => {
              if (hasVariants) {
                setVariantCursor((prev) => ({ ...prev, [g.key]: (curIdx + 1) % variantCount }));
              }
            };
            return (
              <li
                key={g.key}
                onPointerDown={press(x.name, allNames, title, advanceRoundRobin)}
                onDragStart={(e) => e.preventDefault()}
                onPointerEnter={() => lightSounds(allNames)}
                onPointerLeave={() => lightSounds(null)}
                onFocus={() => lightSounds(allNames)}
                onBlur={() => lightSounds(null)}
                className="group bg-card hover:bg-raised-3/70 flex cursor-grab touch-none flex-col gap-1 rounded-md px-2 py-1.5 transition-colors duration-150 select-none active:cursor-grabbing"
              >
                <div className="flex min-h-9 items-center gap-2">
                  <Tip label={isPlaying ? "Pause preview" : "Preview audio"}>
                    <Button
                      variant="cover"
                      size="cover"
                      aria-pressed={isPlaying}
                      aria-label={`${isPlaying ? "Stop" : "Preview"} ${title}`}
                      onClick={() => {
                        setExpandedKey(hasVariants ? g.key : null);
                        listen(x.name);
                      }}
                    >
                      {isPlaying ? (
                        <Pause className="fill-current" />
                      ) : (
                        <Play className="fill-current" />
                      )}
                    </Button>
                  </Tip>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5" title={detail}>
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="text-ui text-foreground truncate">{title}</span>
                      {hasVariants && (
                        <Tip
                          label={`Variation ${curIdx + 1} of ${variantCount} — click for next take`}
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
                            className="bg-raised-3/85 text-tag text-muted-foreground hover:bg-raised-3 hover:text-foreground focus-visible:ring-ring inline-flex h-4 flex-none items-center rounded px-1 font-mono tabular-nums transition-colors outline-none focus-visible:ring-2"
                          >
                            {curIdx + 1}/{variantCount}
                          </button>
                        </Tip>
                      )}
                    </span>
                    <span className="text-muted-foreground flex min-w-0 items-center gap-1 text-xs">
                      {isSynth && <Badge variant="synth">Code</Badge>}
                      {x.contentId && (
                        <Badge variant="claim" title={CONTENT_ID_NOTE}>
                          Content ID
                        </Badge>
                      )}
                      {subtitle && (
                        <>
                          <span className="truncate">{subtitle}</span>
                          <span aria-hidden className="flex-none">
                            ·
                          </span>
                        </>
                      )}
                      <span className="flex-none tabular-nums">{duration}</span>
                    </span>
                  </span>
                  <span className="flex flex-none items-center gap-0.5">
                    {uses > 0 && (
                      <Tip
                        label={
                          uses > 1
                            ? `Select its ${uses} clips on the tracks`
                            : "Select its clip on the tracks"
                        }
                      >
                        <Button
                          variant="quiet"
                          size="xs"
                          className="flex-none"
                          aria-label={`Select the ${uses > 1 ? `${uses} clips` : "clip"} of ${title}`}
                          onClick={() => pickNamesUses(allNames, title)}
                        >
                          <span className="tabular-nums">{uses}×</span>
                        </Button>
                      </Tip>
                    )}
                    <FavoriteStar kind="sounds" id={starId} name={title} onCard />
                    <Tip
                      label={
                        hasVariants
                          ? `Add take #${x.variant ?? curIdx + 1} to track (auto-cycles)`
                          : "Add to track"
                      }
                    >
                      <Button
                        variant="card-action"
                        size="icon-sm"
                        className="flex-none pointer-coarse:size-9"
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
                {showVariants && (
                  <ChipGroup
                    label={`${title} variations`}
                    value={x.name}
                    items={g.variants.map((v, idx) => ({
                      id: v.name,
                      title: `#${v.variant ?? idx + 1}`,
                    }))}
                    onChange={(vName) => {
                      setExpandedKey(g.key);
                      const idx = g.variants.findIndex((v) => v.name === vName);
                      if (idx >= 0) setVariantCursor((prev) => ({ ...prev, [g.key]: idx }));
                      if (now !== vName) listen(vName);
                    }}
                    className="ps-11 pe-1"
                  />
                )}
                {isPlaying && (
                  <AuditionScrubber
                    id={x.name}
                    label={title}
                    fallbackSeconds={x.seconds}
                    kind={itemKind}
                  />
                )}
              </li>
            );
          })}
          {more > 0 && (
            <li className="pt-1">
              <Button
                variant="secondary"
                size="sm"
                className="h-8 w-full"
                onClick={() => setLimit((n) => n + PAGE)}
              >
                Show more ({more} remaining of {groups.length})
              </Button>
            </li>
          )}
          {!shown.length && (
            <li className="bg-card text-ui text-muted-foreground flex flex-col items-start gap-2 rounded-md p-3">
              <p>
                {!library.length
                  ? "The film's sound folder is empty."
                  : typed
                    ? `No ${activeSection.one}s match "${deferredQ.trim()}".`
                    : activeEdition !== ALL && activeSource !== ALL
                      ? `No ${editionTitle(activeEdition)} ${activeSection.one}s from ${sourceTitle(activeSource)} here.`
                      : activeEdition !== ALL
                        ? `No ${editionTitle(activeEdition)} ${activeSection.one}s here.`
                        : activeOrigin !== ALL && activeSource !== ALL
                          ? `No ${activeOrigin === "synth" ? "code-gen" : "real / studio"} ${activeSection.one}s from ${sourceTitle(activeSource)} here.`
                          : activeOrigin !== ALL
                            ? `No ${activeOrigin === "synth" ? "code-gen" : "real / studio"} ${activeSection.one}s here.`
                            : activeSource !== ALL
                              ? `No ${activeSection.one}s from ${sourceTitle(activeSource)} here.`
                              : activeNav.group === "yours" && activeNav.leaf === "fav"
                                ? "No favorite sounds yet. Click the star on any track to save it here."
                                : activeNav.group === "yours" && activeNav.leaf === "film"
                                  ? "This film has no custom audio files in its own sound/sfx folder yet."
                                  : `No ${activeSection.one}s in this category.`}
              </p>
              {activeEdition !== ALL && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-7"
                  onClick={() => changeEdition(ALL)}
                >
                  Show all editions
                </Button>
              )}
              {activeOrigin !== ALL && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-7"
                  onClick={() => changeOrigin(ALL)}
                >
                  Show all types
                </Button>
              )}
              {activeSource !== ALL && (
                <Button variant="secondary" size="sm" className="h-7" onClick={() => setSrc(ALL)}>
                  Show all sources
                </Button>
              )}
              {elsewhere.map((sec) => (
                <Button
                  key={sec.id}
                  variant="secondary"
                  size="sm"
                  className="h-7"
                  onClick={() => toggleHeader(sec.id)}
                >
                  {sec.count} in {sec.title}
                </Button>
              ))}
            </li>
          )}
        </ul>
      )}
    </div>
  );

  if (side) {
    return (
      <section
        aria-label="Sound library"
        className="@container flex min-h-0 flex-1 overflow-hidden"
      >
        <CategoryTree
          tree={tree}
          activeNav={activeNav}
          open={open}
          typed={typed}
          onHeader={toggleHeader}
          onSelect={selectNav}
        />
        {listPane}
      </section>
    );
  }
  return (
    <section aria-label="Sound library" className="flex flex-col">
      {listPane}
    </section>
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
