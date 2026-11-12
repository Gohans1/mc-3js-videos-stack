// The Animation tab, laid out as CapCut's: In | Out | Combo, a search box, category chips, a grid of effects (None first) each with
// its star, and the length (or a Combo's strength) at the bottom. Pointing at an effect plays the shot with it, silently, and
// puts everything back on leaving; a click keeps it (camera/anim.ts). The shot is the block picked on the camera row, else the
// one at the playhead.
import type { AnimCurve } from "film-stage/animate";
import { ANIM_CURVES } from "film-stage/animate";
import type { AnimFx } from "film/scene";
import { SHOTS_OUT } from "film/scene";
import { Ban, ChevronLeft, ChevronRight, Link2, Star } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { FavoriteStar } from "../components/FavoriteStar";
import { ChipGroup, EmptyCard, Segmented, SliderRow } from "../components/inspector";
import { SearchBox } from "../components/SearchBox";
import { Tip } from "../components/Tip";
import { matcher } from "../core/search";
import { S } from "../core/state";
import { set, useStudio } from "../core/store";
import { stamp } from "../core/time";
import {
  animOf,
  anims,
  fxOf,
  lenOf,
  pickShot,
  playSpan,
  previewAnim,
  roomFor,
  setAmount,
  setAnim,
  setOption,
  setStrength,
  shotSpan,
  shownShot,
  type Slot,
  SLOT_NAMES,
  spanOf,
  stopSpan,
} from "./anim";
import { fxSupportsCurve, orderedAnimCategories } from "./anim-math";
import { shotsDoc } from "./shots";

const SLOTS: { id: Slot; title: string }[] = [
  { id: "in", title: "In" },
  { id: "out", title: "Out" },
  { id: "combo", title: "Combo" },
];
const ALL = "All",
  FAV = "Favorites",
  SEAM = "Seam",
  NO_ANIMS: AnimFx[] = [];

// The little scene on each tile, moved the way the effect moves the picture (studio.css .fx-*): --fx for the backdrop, --fx-near
// for the house when the two move apart (parallax). s is the far state: where an In starts, where an Out or a Combo ends
type Far = (s: number) => [string, string?];
const FAR: Record<string, Far> = {
  zoom: (s) => [`scale(${1 + 0.32 * s})`],
  push: (s) => [`scale(${1 + 0.16 * s})`, `scale(${1 + 0.36 * s})`],
  vertigo: (s) => [`scale(${1 - 0.3 * s})`, "none"],
  slide: (s) => [`translateX(${-6 * s}px)`, `translateX(${-14 * s}px)`],
  orbit: (s) => [
    `translateX(${-15 * s}px)`,
    `translateX(${-2 * s}px) scaleX(${1 - 0.12 * Math.abs(s)})`,
  ],
  pan: (s) => [`translateX(${-14 * s}px)`],
  whip: (s) => [`translateX(${-34 * s}px)`],
  rise: (s) => [`translateY(${5 * s}px)`, `translateY(${11 * s}px)`],
  tilt: (s) => [`translateY(${12 * s}px)`],
  roll: (s) => [`rotate(${16 * s}deg)`],
};
const motion = (
  slot: Slot,
  fx: AnimFx,
): { kind: string; fade?: string; far?: string; near?: string } => {
  const fade = fx.black ? (slot === "out" ? "fade-out" : "fade-in") : undefined;
  if (fx.jolt) return { kind: "jolt", fade };
  if (fx.loop) return { kind: fx.loop, fade };
  const f = fx.move ? FAR[fx.move] : undefined;
  if (!f) return { kind: fade ?? "none", fade };
  const [far, near] = f((slot === "in" ? -1 : 1) * (fx.a ?? 1));
  return { kind: slot, fade, far, near };
};
function Scene({ slot, fx }: { slot: Slot; fx: AnimFx }) {
  const m = motion(slot, fx);
  return (
    <svg
      aria-hidden
      viewBox="0 0 48 48"
      className={cn(
        "bg-raised-2 absolute inset-0 size-full",
        `fx-${m.kind}`,
        m.fade && m.fade !== m.kind && `fx-${m.fade}`,
      )}
      style={{ "--fx": m.far, "--fx-near": m.near }}
    >
      <g className="fx-far">
        <rect x="-70" y="30" width="190" height="50" className="fx-ground" />
        <circle cx="37" cy="10" r="3.5" className="fx-sun" />
      </g>
      <g className="fx-near">
        <rect x="16" y="20" width="13" height="12" className="fx-wall" />
        <rect x="15" y="17.5" width="15" height="4" rx="0.5" className="fx-roof" />
        <rect x="20.5" y="25" width="4" height="7" className="fx-door" />
      </g>
      {fx.optics && <path d="M-8 56 L22 -8 H31 L1 56 Z" className="fill-primary/22" />}
      {m.fade && <rect width="48" height="48" className="fx-veil fill-black" />}
    </svg>
  );
}

function Tile({
  slot,
  fx,
  on,
  onPick,
  onTry,
  onLeave,
  shot,
}: {
  slot: Slot;
  fx: AnimFx | null;
  on: boolean;
  shot: number;
  onPick: () => void;
  onTry: () => void;
  onLeave: () => void;
}) {
  const title = fx?.title ?? "None";
  const fav = useStudio((s) => !!fx && s.favorites.effects.includes(`${slot}:${fx.id}`));
  return (
    <li
      className="group relative flex min-w-0 flex-col items-center gap-1"
      onPointerEnter={(e) => e.pointerType === "mouse" && onTry()}
      onPointerLeave={onLeave}
    >
      <Tip label={fx ? fx.tip : `No ${SLOT_NAMES[slot]} animation on shot ${shot}`}>
        <button
          type="button"
          aria-pressed={on}
          aria-label={fx ? `${title}: ${fx.tip}` : `None: no ${SLOT_NAMES[slot]} animation`}
          onClick={onPick}
          onFocus={onTry}
          onBlur={onLeave}
          className="fx-tile hover:ring-border focus-visible:ring-ring aria-pressed:ring-primary relative block aspect-square w-full overflow-hidden rounded-md ring-2 ring-transparent ring-offset-0 outline-none"
        >
          {fx ? (
            <Scene slot={slot} fx={fx} />
          ) : (
            <span className="bg-raised-2 absolute inset-0 flex items-center justify-center">
              <Ban className="text-muted-foreground size-6" />
            </span>
          )}
          {fx?.pair && (
            <span
              aria-hidden
              className="text-foreground/80 absolute top-1 right-1 rounded-xs bg-black/55 p-0.5"
            >
              <Link2 className="size-2.5" />
            </span>
          )}
        </button>
      </Tip>
      {fx && (
        <FavoriteStar
          kind="effects"
          id={`${slot}:${fx.id}`}
          name={`${SLOT_NAMES[slot]} ${title}`}
          onTile
          reveal={!fav}
          className="absolute top-[calc(100%-2.6rem)] left-0.5"
        />
      )}
      <span
        className={cn(
          "w-full truncate text-center text-xs",
          on ? "text-primary" : "text-foreground/85",
        )}
      >
        {title}
      </span>
    </li>
  );
}

function Amount({ shot, slot }: { shot: number; slot: Slot }) {
  useStudio((s) => s.shotsRev);
  useStudio((s) => s.timingRev);
  const a = animOf(shot)[slot];
  if (!a) return null;
  const fx = fxOf(slot, a.fx);
  // Changing the curve or mirroring the move alters how the motion plays across time/space, so replay the span once
  const replay = () => {
    const [from, to] = spanOf(shot, slot);
    playSpan(from, to);
  };
  const retime = (patch: { curve?: AnimCurve; flip?: boolean; seam?: boolean }) => {
    setOption(shot, slot, patch);
    replay();
  };
  const curveable = fxSupportsCurve(fx);
  const mirrorable = Boolean(fx?.flip);
  const pairable = Boolean(fx?.pair);
  const curveKey = !a.curve
    ? "auto"
    : typeof a.curve === "string"
      ? a.curve
      : `bezier:${a.curve.join(",")}`;
  const customCurve = curveKey !== "auto" && !ANIM_CURVES.some((c) => c.id === curveKey);
  const customLabel = !a.curve
    ? ""
    : typeof a.curve === "string"
      ? a.curve
      : `Custom (${a.curve.join(", ")})`;
  const curveItems = [
    { value: "auto", label: "Auto" },
    ...ANIM_CURVES.map((c) => ({ value: c.id, label: c.title })),
    ...(customCurve ? [{ value: curveKey, label: customLabel }] : []),
  ];
  return (
    <div className="flex flex-col gap-2">
      {slot !== "combo" && (
        <SliderRow
          label="Duration"
          value={lenOf(shot, slot)}
          min={0.1}
          max={Math.max(0.2, roomFor(shot, slot))}
          step={0.05}
          digits={2}
          unit="s"
          doc={shotsDoc}
          preview={(v) => {
            stopSpan();
            setAmount(shot, slot, v, false);
          }}
          save={(v) => setAmount(shot, slot, v)}
        />
      )}
      <SliderRow
        label="Strength"
        value={a.k ?? 1}
        min={0.25}
        max={3}
        step={0.05}
        digits={2}
        unit="×"
        doc={shotsDoc}
        preview={(v) => {
          stopSpan();
          setStrength(shot, slot, v, false);
        }}
        save={(v) => setStrength(shot, slot, v)}
        hint="How far the move goes (1× is the tuned Cinetic default)"
      />
      {(curveable || mirrorable || pairable) && (
        <div className="flex flex-wrap items-center gap-2">
          {curveable && (
            <>
              <span className="text-ui text-foreground/90 flex-none">Curve</span>
              <Select
                value={curveKey}
                items={curveItems}
                onValueChange={(v) => {
                  if (v !== curveKey)
                    retime({ curve: v === "auto" ? undefined : (v as AnimCurve) });
                }}
              >
                <SelectTrigger aria-label="Motion curve" className="h-7 min-w-24 flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto" title="Each preset's own natural motion curve">
                    Auto (the effect's own)
                  </SelectItem>
                  {ANIM_CURVES.map((c) => (
                    <SelectItem key={c.id} value={c.id} title={c.tip}>
                      {c.title}
                    </SelectItem>
                  ))}
                  {customCurve && (
                    <SelectItem value={curveKey} title="Custom curve written by the film">
                      {curveItems.at(-1)!.label}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </>
          )}
          {mirrorable && (
            <Tip label="Mirror: play the move from the other side">
              <FieldLabel variant="inline" className="flex-none">
                <Checkbox
                  checked={!!a.flip}
                  aria-label="Mirror the move"
                  onCheckedChange={(checked) => retime({ flip: checked })}
                />
                Mirror
              </FieldLabel>
            </Tip>
          )}
          {pairable && (
            <Tip label="Link seam: keep the matching move paired across the cut">
              <FieldLabel variant="inline" className="flex-none">
                <Checkbox
                  checked={a.seam !== false}
                  aria-label="Link paired seam across cut"
                  onCheckedChange={(checked) => retime({ seam: checked })}
                />
                Seam
              </FieldLabel>
            </Tip>
          )}
        </div>
      )}
      {fx?.optics && (
        <SliderRow
          label="Optics"
          value={a.optics ?? 1}
          min={0}
          max={1}
          step={0.05}
          digits={2}
          unit="×"
          doc={shotsDoc}
          preview={(v) => {
            stopSpan();
            setOption(shot, slot, { optics: v }, false);
          }}
          save={(v) => setOption(shot, slot, { optics: v })}
          hint="How much blur, exposure, fringe or distortion the effect adds (1× is the tuned look)"
        />
      )}
    </div>
  );
}

export function AnimPanel() {
  useStudio((s) => s.shotsRev);
  useStudio((s) => s.timingRev);
  useStudio((s) => s.ready);
  const slot = useStudio((s) => s.animSlot),
    picked = useStudio((s) => s.shotPick),
    favs = useStudio((s) => s.favorites.effects);
  const [q, setQ] = useState(""),
    [cat, setCat] = useState(ALL);
  const shot = shownShot(),
    list = anims()?.[slot] ?? NO_ANIMS,
    now = animOf(shot)[slot]?.fx ?? null;
  const cats = useMemo(() => orderedAnimCategories(list), [list]);
  const shown = useMemo(() => {
    const hit = matcher(q);
    return list.filter(
      (x) =>
        hit(`${x.title} ${x.cat} ${x.tip}`) &&
        (cat === ALL ||
          (cat === FAV
            ? favs.includes(`${slot}:${x.id}`)
            : cat === SEAM
              ? Boolean(x.pair)
              : x.cat === cat)),
    );
  }, [list, q, cat, favs, slot]);
  // Trying an effect on: its preview, then the shot plays it until the pointer leaves
  const trial = useRef<{ id: string | null; snap: string; timer: number } | null>(null);
  const leave = useCallback(() => {
    if (!trial.current) return;
    clearTimeout(trial.current.timer);
    shotsDoc.restore(trial.current.snap);
    trial.current = null;
    stopSpan();
  }, []);
  const tryOn = (id: string | null) => {
    leave();
    if (id === now) return;
    const snap = shotsDoc.snapshot();
    trial.current = {
      id,
      snap,
      timer: window.setTimeout(() => {
        previewAnim(shot, slot, id);
        const [a, b] = spanOf(shot, slot);
        playSpan(a, b, true);
      }, 140),
    };
  };
  // A tile taken out of the list under a resting pointer (a search, a category, a star taken off in Favorites) never gets its
  // pointerleave: its trial ends here
  const none = cat === ALL && !q.trim();
  useEffect(() => {
    const id = trial.current?.id;
    if (id !== undefined && !(id === null ? none : shown.some((x) => x.id === id))) leave();
  }, [shown, none, leave]);
  const pick = (id: string | null) => {
    leave();
    setAnim(shot, slot, id);
    if (id) {
      const [a, b] = spanOf(shot, slot);
      playSpan(a, b);
    }
  };
  useEffect(() => leave, [leave, shot, slot]);
  if (!SHOTS_OUT.length) return null;
  const [from, to] = shotSpan(shot),
    name = S.comments[shot] ?? "";
  if (!anims()) {
    return (
      <EmptyCard className="mx-3 mt-2" title="This film draws no shot animations yet">
        Add film-stage/animate to its draw and set draw.anims (docs/film-contract.md), or ask the AI
        in a note.
      </EmptyCard>
    );
  }
  const go = (d: number) => {
    const i = Math.max(0, Math.min(SHOTS_OUT.length - 1, shot + d));
    pickShot(i);
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none flex-col gap-2.5 px-3 pb-2.5">
        <Segmented
          label="Animation part"
          value={slot}
          onChange={(v) => {
            set({ animSlot: v });
            setCat(ALL);
          }}
          items={SLOTS.map((s) => ({
            id: s.id,
            title: (
              <>
                {s.title}
                {animOf(shot)[s.id] && (
                  <>
                    <span aria-hidden className="bg-primary size-1.5 rounded-full" />
                    <span className="sr-only">(set)</span>
                  </>
                )}
              </>
            ),
          }))}
        />
        <div className="flex items-center gap-1">
          <Tip label="Shot before">
            <Button
              variant="quiet"
              size="icon"
              className="pointer-coarse:size-10"
              aria-label="Shot before"
              disabled={shot === 0}
              onClick={() => go(-1)}
            >
              <ChevronLeft />
            </Button>
          </Tip>
          <p className="text-ui min-w-0 flex-1 truncate text-center" title={name}>
            <span className="font-semibold">Shot {shot}</span>{" "}
            <span className="text-muted-foreground">{name}</span>
            <span className="text-muted-foreground block text-xs tabular-nums">
              {stamp(from)} – {stamp(to)}
              {picked === null ? " · at the playhead" : ""}
            </span>
          </p>
          <Tip label="Shot after">
            <Button
              variant="quiet"
              size="icon"
              className="pointer-coarse:size-10"
              aria-label="Shot after"
              disabled={shot >= SHOTS_OUT.length - 1}
              onClick={() => go(1)}
            >
              <ChevronRight />
            </Button>
          </Tip>
        </div>
        <SearchBox
          name="anim-search"
          value={q}
          onChange={setQ}
          label={`Search ${SLOT_NAMES[slot]} animations`}
          placeholder={`Search ${list.length} ${SLOT_NAMES[slot]} animations…`}
        />
        <ChipGroup
          scroll
          label="Category"
          value={cat}
          onChange={setCat}
          items={cats.map((c) => ({
            id: c,
            title: (
              <>
                {c === FAV && <Star aria-hidden className="size-3" />}
                {c === SEAM && <Link2 aria-hidden className="size-3" />}
                {c}
              </>
            ),
          }))}
        />
      </div>
      <ul
        aria-label={`${SLOT_NAMES[slot]} animations`}
        className="scroll-fade grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(4.25rem,1fr))] gap-x-2.5 gap-y-3 overflow-y-auto overscroll-contain px-3 pb-3"
      >
        {none && (
          <Tile
            slot={slot}
            fx={null}
            on={!now}
            shot={shot}
            onPick={() => pick(null)}
            onTry={() => tryOn(null)}
            onLeave={leave}
          />
        )}
        {shown.map((fx) => (
          <Tile
            key={fx.id}
            slot={slot}
            fx={fx}
            on={now === fx.id}
            shot={shot}
            onPick={() => pick(fx.id)}
            onTry={() => tryOn(fx.id)}
            onLeave={leave}
          />
        ))}
        {!shown.length && (
          <li className="text-ui text-muted-foreground col-span-full py-2">
            {cat === FAV && !q.trim()
              ? `No favorite ${SLOT_NAMES[slot]} animations yet. Point at one and click its star.`
              : `No ${SLOT_NAMES[slot]} animations match "${q.trim()}".`}
          </li>
        )}
      </ul>
      {now && (
        <div className="flex-none border-t px-3 py-3">
          <Amount key={`${shot}${slot}`} shot={shot} slot={slot} />
        </div>
      )}
    </div>
  );
}
