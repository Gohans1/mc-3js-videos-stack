import { CircleSlash, LoaderCircle } from "lucide-react";
import { useState } from "react";

import { Callout } from "@/components/ui/callout";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { timing, timingClock } from "../../src/timing-state.mjs";
import { compileTiming, replaceSpeed } from "../../src/timing.mjs";
import type { Velocity } from "../../src/velocity.mjs";
import picture from "../assets/velocity-preview.jpg";
import { FieldRow, Reset, Section, SliderRow } from "../components/inspector";
import { S } from "../core/state";
import { say, useStudio } from "../core/store";
import { stamp } from "../core/time";
import { processSpec } from "../sound/processed";
import {
  allClips,
  audibleName,
  clipBeats,
  clipOf,
  library,
  snapshot as soundSnapshot,
  span,
} from "../sound/sound";
import { setShotVelocity, shotVelocity, sourceShot, timingDoc } from "./timing";

type Status =
  | { kind: "idle" }
  | { kind: "analyzing"; effect: Velocity["effect"] }
  | { kind: "error"; message: string };
const BUILTIN_EFFECTS: { id: Velocity["effect"]; title: string; preview: string }[] = [
  { id: "flash", title: "Flash", preview: "brightness-150" },
  { id: "hitPunch", title: "Hit punch", preview: "scale-115 contrast-125 brightness-110" },
  { id: "blurShake", title: "Blur shake", preview: "blur-[1px] scale-110" },
  {
    id: "shutterStreak",
    title: "Shutter streak",
    preview: "scale-x-115 blur-[0.8px] brightness-110",
  },
  { id: "fadeBlur", title: "Fade blur", preview: "blur-[1px] brightness-75" },
  { id: "retroZoom", title: "Retro zoom", preview: "scale-125" },
  { id: "fringeBeat", title: "Edge fringe", preview: "contrast-125 saturate-150" },
  { id: "rainbow", title: "Rainbow", preview: "hue-rotate-90 saturate-200" },
];

const resolveEffects = (
  filmEffects: readonly (string | { id: string; title?: string; preview?: string })[] | undefined,
  activeEffect?: string,
) => {
  const byBuiltin = new Map(BUILTIN_EFFECTS.map((e) => [e.id, e]));
  const list = filmEffects?.length
    ? filmEffects.map((item) => {
        const id = typeof item === "string" ? item : item.id;
        const known = byBuiltin.get(id);
        return {
          id,
          title: (typeof item === "object" && item.title) || known?.title || id,
          preview:
            (typeof item === "object" && item.preview) ||
            known?.preview ||
            "contrast-110 brightness-110",
        };
      })
    : [...BUILTIN_EFFECTS];
  if (activeEffect && !list.some((e) => e.id === activeEffect)) {
    list.push({ id: activeEffect, title: activeEffect, preview: "contrast-110 brightness-110" });
  }
  return list;
};

export function VelocityPanel({ shot }: { shot: number }) {
  useStudio((s) => s.soundRev);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const value = shotVelocity(shot),
    busy = status.kind === "analyzing";
  const effects = resolveEffects(S.render?.velocityEffects, value?.effect);
  const [from, to] = sourceShot(shot);
  const sources = allClips().flatMap((ref) => {
    const clip = clipOf(ref),
      [a, b] = span(ref);
    const name = clip && audibleName(clip),
      original = clip?.__timing?.source ?? clip,
      position = original?.from ?? original?.at;
    return clip &&
      !clip.dialogue &&
      name &&
      library.some((item) => item.name === name && item.seconds > 0) &&
      b > timingClock.outputAt(from) &&
      a < timingClock.outputAt(to, "before")
      ? [
          {
            ref,
            clip,
            key: `${ref.list}:${ref.i}`,
            name,
            at: typeof position === "number" ? position : a,
            label: `${name} · ${stamp(a)}`,
          },
        ]
      : [];
  });
  const selected = value
    ? sources.find(
        (s) => s.name === value.music && (value.musicAt === undefined || s.at === value.musicAt),
      )
    : sources[0];
  const change = (patch: Partial<Velocity>, preview = false) => {
    if (value) setShotVelocity(shot, { ...value, ...patch }, preview);
  };
  const apply = async (effect: Velocity["effect"], source = selected) => {
    if (busy) return;
    if (!source) {
      say("Add a music clip to the timeline before applying a velocity effect");
      return;
    }
    if (value?.music === source.name && value.musicAt === source.at) {
      change({ effect });
      return;
    }
    const before = timingDoc.snapshot(),
      audioBefore = soundSnapshot(),
      [a, b] = span(source.ref);
    setStatus({ kind: "analyzing", effect });
    try {
      let beats = source.clip.beatMode === 2 ? clipBeats(source.ref) : [];
      if (!beats.length) {
        const settings = processSpec(
          {
            ...source.clip,
            name: source.name,
            start: source.name === source.clip.name ? source.clip.start : 0,
          },
          b - a,
          source.ref.list === "beds",
        );
        const response = await fetch("/api/sound/beats", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(settings),
          signal: AbortSignal.timeout(255000),
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error ?? "Could not detect beats. Try another music clip");
        beats = result.beats;
      }
      if (before !== timingDoc.snapshot() || audioBefore !== soundSnapshot())
        throw new Error("The timeline changed. Choose the effect again to analyze its new timing");
      const normal = compileTiming(
        { ...timing, speeds: replaceSpeed(timing.speeds ?? [], from, to, null) },
        timingClock.sourceDuration,
      );
      const mapped = [...new Set(beats.map((t) => normal.sourceAt(a + t)))].filter(
        (t) => t >= from && t < to,
      );
      if (!mapped.length)
        throw new Error("No music beats overlap this clip. Move the music or choose another clip");
      setShotVelocity(shot, {
        effect,
        music: source.name,
        musicAt: source.at,
        beats: mapped,
        frequency: value?.frequency ?? 2,
        speed: value?.speed ?? "normal",
        intensity: value?.intensity ?? 50,
        enabled: true,
      });
      setStatus({ kind: "idle" });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not analyze the music. Try again";
      setStatus({ kind: "error", message });
      say(message, 6000);
    }
  };
  if (!S.render?.velocity)
    return (
      <p className="text-ui text-muted-foreground px-3">
        Velocity effects are not available in this film.
      </p>
    );
  return (
    <Section
      title="Velocity effects"
      on={value?.enabled !== false}
      onCheck={(enabled) => change({ enabled })}
      right={
        <Reset
          label="Reset velocity effects"
          disabled={!value || busy}
          onClick={() => setShotVelocity(shot, null)}
        />
      }
    >
      <ul
        aria-label="Velocity effects"
        className="grid grid-cols-[repeat(auto-fit,minmax(3.5rem,1fr))] gap-x-2.5 gap-y-3"
      >
        {[{ id: null, title: "None", preview: "" }, ...effects].map((effect) => (
          <li key={effect.id ?? "none"} className="min-w-0">
            <button
              type="button"
              aria-label={`Velocity ${effect.title}`}
              aria-pressed={(value?.effect ?? null) === effect.id}
              disabled={busy}
              onClick={() => (effect.id ? void apply(effect.id) : setShotVelocity(shot, null))}
              className="group focus-visible:ring-ring block w-full rounded-md outline-none focus-visible:ring-2 disabled:opacity-50"
            >
              <span
                className={cn(
                  "bg-raised-2 group-hover:border-foreground/40 relative grid aspect-square place-items-center overflow-hidden rounded-md border-2 border-transparent",
                  (value?.effect ?? null) === effect.id && "border-primary",
                )}
              >
                {effect.id ? (
                  <img
                    src={picture}
                    alt=""
                    className={cn("size-full object-cover", effect.preview)}
                  />
                ) : (
                  <CircleSlash aria-hidden className="text-muted-foreground size-6" />
                )}
                {status.kind === "analyzing" && status.effect === effect.id && (
                  <LoaderCircle
                    aria-hidden
                    className="absolute size-5 animate-spin motion-reduce:animate-none"
                  />
                )}
              </span>
              <span
                className="text-muted-foreground mt-1 block truncate text-xs"
                title={effect.title}
              >
                {effect.title}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {busy && (
        <p role="status" className="text-ui text-muted-foreground">
          Detecting music beats…
        </p>
      )}
      {status.kind === "error" && <Callout role="alert">{status.message}</Callout>}
      {value && (
        <>
          <FieldRow label="Music source">
            <Select
              value={selected?.key ?? null}
              disabled={busy}
              onValueChange={(key) => {
                const source = sources.find((s) => s.key === key);
                if (source) void apply(value.effect, source);
              }}
            >
              <SelectTrigger aria-label="Velocity music source" className="min-w-0 flex-1">
                <SelectValue>{selected?.label ?? `${value.music} (unavailable)`}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {sources.map((s) => (
                    <SelectItem key={s.key} value={s.key}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </FieldRow>
          <FieldRow label="Beat frequency">
            <Select
              items={{ "1": "Beats 1", "2": "Beats 2" }}
              value={String(value.frequency)}
              disabled={busy}
              onValueChange={(v) => change({ frequency: Number(v) as 1 | 2 })}
            >
              <SelectTrigger aria-label="Velocity beat frequency" className="min-w-0 flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="1">Beats 1</SelectItem>
                  <SelectItem value="2">Beats 2</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </FieldRow>
          <FieldRow label="Speed">
            <Select
              items={{ normal: "Normal", fast: "Fast", veryFast: "Very fast" }}
              value={value.speed}
              disabled={busy}
              onValueChange={(v) => change({ speed: v as Velocity["speed"] })}
            >
              <SelectTrigger aria-label="Velocity speed" className="min-w-0 flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="fast">Fast</SelectItem>
                  <SelectItem value="veryFast">Very fast</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </FieldRow>
          <SliderRow
            label="Intensity"
            value={value.intensity}
            min={0}
            max={100}
            step={1}
            digits={0}
            disabled={busy}
            doc={timingDoc}
            preview={(intensity) => change({ intensity }, true)}
            save={(intensity) => change({ intensity })}
          />
        </>
      )}
    </Section>
  );
}
