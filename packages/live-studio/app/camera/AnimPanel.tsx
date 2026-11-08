// The Animation tab, laid out as CapCut's: In | Out | Combo, a search box, category chips, a grid of effects (None first) each with
// its star, and the length (or a Combo's strength) at the bottom. Pointing at an effect plays the shot with it, silently, and
// puts everything back on leaving; a click keeps it (camera/anim.ts). The shot is the block picked on the camera row, else the
// one at the playhead.
import type { AnimFx } from "film/scene";
import { cn } from "cn";
import { Ban, ChevronLeft, ChevronRight, Star } from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FavoriteStar } from "../components/FavoriteStar";
import { Segmented, SliderRow } from "../components/inspector";
import { SearchBox } from "../components/SearchBox";
import { Tip } from "../components/Tip";
import { matcher } from "../core/search";
import { S } from "../core/state";
import { set, useStudio } from "../core/store";
import { stamp } from "../core/time";
import { SHOTS_OUT } from "film/scene";
import { anims, animOf, lenOf, pickShot, playSpan, previewAnim, roomFor, setAmount, setAnim, shotSpan, shownShot, type Slot, SLOT_NAMES, spanOf, stopSpan } from "./anim";
import { shotsDoc } from "./shots";

const SLOTS: { id: Slot; title: string }[] = [{ id: "in", title: "In" }, { id: "out", title: "Out" }, { id: "combo", title: "Combo" }];
const ALL = "All", FAV = "Favorites";

// The little scene on each tile, moved the way the effect moves the picture (studio.css .fx-*): --fx for the backdrop, --fx-near
// for the house when the two move apart (parallax). s is the far state: where an In starts, where an Out or a Combo ends
type Far = (s: number) => [string, string?];
const FAR: Record<string, Far> = {
  zoom: (s) => [`scale(${1 + 0.32 * s})`],
  push: (s) => [`scale(${1 + 0.16 * s})`, `scale(${1 + 0.36 * s})`],
  vertigo: (s) => [`scale(${1 - 0.3 * s})`, "none"],
  slide: (s) => [`translateX(${-6 * s}px)`, `translateX(${-14 * s}px)`],
  orbit: (s) => [`translateX(${-15 * s}px)`, `translateX(${-2 * s}px) scaleX(${1 - 0.12 * Math.abs(s)})`],
  pan: (s) => [`translateX(${-14 * s}px)`],
  whip: (s) => [`translateX(${-34 * s}px)`],
  rise: (s) => [`translateY(${5 * s}px)`, `translateY(${11 * s}px)`],
  tilt: (s) => [`translateY(${12 * s}px)`],
  roll: (s) => [`rotate(${16 * s}deg)`],
};
type Fx = AnimFx & { move?: string; a?: number; loop?: string; jolt?: boolean };
const motion = (slot: Slot, fx: Fx): { kind: string; style?: CSSProperties } => {
  if (fx.black) return { kind: slot === "out" ? "fade-out" : "fade-in" };
  if (fx.jolt) return { kind: "jolt" };
  if (fx.loop) return { kind: fx.loop };
  const f = fx.move ? FAR[fx.move] : undefined;
  if (!f) return { kind: "none" };
  const [far, near] = f((slot === "in" ? -1 : 1) * (fx.a ?? 1));
  return { kind: slot, style: { "--fx": far, ...(near && { "--fx-near": near }) } as CSSProperties };
};
function Scene({ slot, fx }: { slot: Slot; fx: Fx }) {
  const m = motion(slot, fx);
  return (
    <svg aria-hidden viewBox="0 0 48 48" className={cn("absolute inset-0 size-full bg-raised-2", `fx-${m.kind}`)} style={m.style}>
      <g className="fx-far">
        <rect x="-70" y="30" width="190" height="50" className="fx-ground" />
        <circle cx="37" cy="10" r="3.5" className="fx-sun" />
      </g>
      <g className="fx-near">
        <rect x="16" y="20" width="13" height="12" className="fx-wall" />
        <rect x="15" y="17.5" width="15" height="4" rx="0.5" className="fx-roof" />
        <rect x="20.5" y="25" width="4" height="7" className="fx-door" />
      </g>
      {m.kind.startsWith("fade") && <rect width="48" height="48" className="fx-veil fill-black" />}
    </svg>
  );
}

function Tile({ slot, fx, on, onPick, onTry, onLeave, shot }: { slot: Slot; fx: Fx | null; on: boolean; shot: number; onPick: () => void; onTry: () => void; onLeave: () => void }) {
  const title = fx?.title ?? "None";
  const fav = useStudio((s) => !!fx && s.favorites.effects.includes(`${slot}:${fx.id}`));
  return (
    <li className="group relative flex min-w-0 flex-col items-center gap-1" onPointerEnter={(e) => e.pointerType === "mouse" && onTry()} onPointerLeave={onLeave}>
      <Tip label={fx ? fx.tip : `No ${SLOT_NAMES[slot]} animation on shot ${shot}`}>
        <button
          type="button" aria-pressed={on} aria-label={fx ? `${title}: ${fx.tip}` : `None: no ${SLOT_NAMES[slot]} animation`}
          onClick={onPick} onFocus={onTry} onBlur={onLeave}
          className="fx-tile relative block aspect-square w-full overflow-hidden rounded-md outline-none ring-2 ring-transparent ring-offset-0 hover:ring-border focus-visible:ring-ring aria-pressed:ring-primary"
        >
          {fx ? <Scene slot={slot} fx={fx} /> : <span className="absolute inset-0 flex items-center justify-center bg-raised-2"><Ban className="size-6 text-muted-foreground" /></span>}
        </button>
      </Tip>
      {fx && (
        <FavoriteStar
          kind="effects" id={`${slot}:${fx.id}`} name={`${SLOT_NAMES[slot]} ${title}`}
          className={cn("absolute top-[calc(100%-2.6rem)] left-0.5 size-6 rounded-full bg-black/55 text-white/90 hover:bg-black/70 [&_svg]:size-3.5 pointer-coarse:size-8", !fav && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100")}
        />
      )}
      <span className={cn("w-full truncate text-center text-xs", on ? "text-primary" : "text-foreground/85")}>{title}</span>
    </li>
  );
}

function Amount({ shot, slot }: { shot: number; slot: Slot }) {
  const a = animOf(shot)[slot];
  if (!a) return null;
  if (slot === "combo") {
    return (
      <SliderRow
        label="Strength" value={a.k ?? 1} min={0.25} max={3} step={0.05} digits={2} unit="×" doc={shotsDoc}
        preview={(v) => setAmount(shot, slot, v, false)} save={(v) => setAmount(shot, slot, v)}
        hint="How far the move goes over the whole shot"
      />
    );
  }
  return (
    <SliderRow
      label="Duration" value={lenOf(shot, slot)} min={0.1} max={Math.max(0.2, roomFor(shot, slot))} step={0.1} digits={1} unit="s" doc={shotsDoc}
      preview={(v) => setAmount(shot, slot, v, false)} save={(v) => setAmount(shot, slot, v)}
    />
  );
}

export function AnimPanel() {
  useStudio((s) => s.shotsRev);
  useStudio((s) => s.ready);
  const slot = useStudio((s) => s.animSlot), picked = useStudio((s) => s.shotPick), favs = useStudio((s) => s.favorites.effects);
  const [q, setQ] = useState(""), [cat, setCat] = useState(ALL);
  const shot = shownShot(), list = (anims()?.[slot] ?? []) as Fx[], now = animOf(shot)[slot]?.fx ?? null;
  const cats = useMemo(() => [ALL, FAV, ...new Set(list.map((x) => x.cat))], [list]);
  const shown = useMemo(() => {
    const hit = matcher(q);
    return list.filter((x) => hit(`${x.title} ${x.cat} ${x.tip}`) && (cat === ALL || (cat === FAV ? favs.includes(`${slot}:${x.id}`) : x.cat === cat)));
  }, [list, q, cat, favs, slot]);
  // Trying an effect on: its preview, then the shot plays it until the pointer leaves
  const trial = useRef<{ id: string | null; snap: string; timer: number } | null>(null);
  const leave = () => {
    if (!trial.current) return;
    clearTimeout(trial.current.timer);
    shotsDoc.restore(trial.current.snap);
    trial.current = null;
    stopSpan();
  };
  const tryOn = (id: string | null) => {
    leave();
    if (id === now) return;
    const snap = shotsDoc.snapshot();
    trial.current = { id, snap, timer: window.setTimeout(() => { previewAnim(shot, slot, id); const [a, b] = spanOf(shot, slot); playSpan(a, b, true); }, 140) };
  };
  // A tile taken out of the list under a resting pointer (a search, a category, a star taken off in Favorites) never gets its
  // pointerleave: its trial ends here
  const none = cat === ALL && !q.trim();
  useEffect(() => {
    const id = trial.current?.id;
    if (id !== undefined && !(id === null ? none : shown.some((x) => x.id === id))) leave();
  }, [shown, none]);
  const pick = (id: string | null) => {
    leave();
    setAnim(shot, slot, id);
    if (id) { const [a, b] = spanOf(shot, slot); playSpan(a, b); }
  };
  useEffect(() => leave, [shot, slot]);
  if (!SHOTS_OUT.length) return null;
  const [from, to] = shotSpan(shot), name = S.comments[shot] ?? "";
  if (!anims()) {
    return (
      <div className="px-3 pt-2 text-[13px]">
        <p className="font-medium">This film draws no shot animations yet</p>
        <p className="text-muted-foreground">Add film-stage/animate to its draw and set draw.anims (docs/film-contract.md), or ask the AI in a note.</p>
      </div>
    );
  }
  const go = (d: number) => { const i = Math.max(0, Math.min(SHOTS_OUT.length - 1, shot + d)); pickShot(i); };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none flex-col gap-2.5 px-3 pb-2.5">
        <Segmented
          label="Animation part" value={slot} onChange={(v) => { set({ animSlot: v }); setCat(ALL); }}
          items={SLOTS.map((s) => ({ id: s.id, title: <>{s.title}{animOf(shot)[s.id] && <><span aria-hidden className="size-1.5 rounded-full bg-primary" /><span className="sr-only">(set)</span></>}</> }))}
        />
        <div className="flex items-center gap-1">
          <Tip label="Shot before"><Button variant="ghost" size="icon" className="size-7 text-muted-foreground pointer-coarse:size-10" aria-label="Shot before" disabled={shot === 0} onClick={() => go(-1)}><ChevronLeft /></Button></Tip>
          <p className="min-w-0 flex-1 truncate text-center text-[13px]" title={name}>
            <span className="font-semibold">Shot {shot}</span> <span className="text-muted-foreground">{name}</span>
            <span className="block text-xs text-muted-foreground tabular-nums">{stamp(from)} – {stamp(to)}{picked === null ? " · at the playhead" : ""}</span>
          </p>
          <Tip label="Shot after"><Button variant="ghost" size="icon" className="size-7 text-muted-foreground pointer-coarse:size-10" aria-label="Shot after" disabled={shot >= SHOTS_OUT.length - 1} onClick={() => go(1)}><ChevronRight /></Button></Tip>
        </div>
        <SearchBox name="anim-search" value={q} onChange={setQ} label={`Search ${SLOT_NAMES[slot]} animations`} placeholder={`Search ${list.length} ${SLOT_NAMES[slot]} animations…`} />
        <div role="radiogroup" aria-label="Category" className="-mx-3 flex gap-1.5 overflow-x-auto px-3 [scrollbar-width:none]">
          {cats.map((c) => (
            <button
              key={c} type="button" role="radio" aria-checked={cat === c} onClick={() => setCat(c)}
              className="flex h-7 flex-none items-center gap-1 rounded-full bg-card px-3 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-checked:bg-raised-3 aria-checked:text-foreground"
            >
              {c === FAV && <Star aria-hidden className="size-3" />}{c}
            </button>
          ))}
        </div>
      </div>
      <ul aria-label={`${SLOT_NAMES[slot]} animations`} className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(4.25rem,1fr))] gap-x-2.5 gap-y-3 overflow-y-auto overscroll-contain px-3 pb-3 scroll-fade">
        {none && <Tile slot={slot} fx={null} on={!now} shot={shot} onPick={() => pick(null)} onTry={() => tryOn(null)} onLeave={leave} />}
        {shown.map((fx) => <Tile key={fx.id} slot={slot} fx={fx} on={now === fx.id} shot={shot} onPick={() => pick(fx.id)} onTry={() => tryOn(fx.id)} onLeave={leave} />)}
        {!shown.length && (
          <li className="col-span-full py-2 text-[13px] text-muted-foreground">
            {cat === FAV && !q.trim() ? `No favorite ${SLOT_NAMES[slot]} animations yet. Point at one and click its star.` : `No ${SLOT_NAMES[slot]} animations match "${q.trim()}".`}
          </li>
        )}
      </ul>
      {now && <div className="flex-none border-t px-3 py-3"><Amount key={`${shot}${slot}`} shot={shot} slot={slot} /></div>}
    </div>
  );
}
