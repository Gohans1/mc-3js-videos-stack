import { DURATION, SHOTS_OUT } from "film/scene";
import { ChevronLeft, ChevronRight, Plus, Star } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { FavoriteStar } from "../components/FavoriteStar";
import { ChipGroup } from "../components/inspector";
import { SearchBox } from "../components/SearchBox";
import { matcher } from "../core/search";
import { useStudio } from "../core/store";
import { stamp } from "../core/time";
import { ownTransition } from "../own/builtins";
import { FILM_MADE, FilmMark } from "../own/FilmMark";
import { pickShot, playSpan, shownShot, stopSpan } from "./anim";
import { shotsDoc } from "./shots";
import {
  transitionCategories,
  transitionCatOf,
  type TransitionMeta,
  transitionPreviewKind,
} from "./transition-math";
import {
  previewTransition,
  setTransition,
  TRANSITION_DRAG,
  transitionOf,
  transitionRoom,
  transitions,
  transitionSpan,
} from "./transitions";

const ALL = "All",
  FAV = "Favorites";

function Look({ fx }: { fx: TransitionMeta }) {
  const kind = transitionPreviewKind(fx);
  let overlay = <path d="M32 0H64V64H32Z" className="fill-primary/30" />;
  if (kind === "dissolve") overlay = <path d="M24 0H64V64H24Z" className="fill-primary/25" />;
  else if (kind === "black") overlay = <path d="M26 0H64V64H26Z" className="fill-black/90" />;
  else if (kind === "white") overlay = <path d="M26 0H64V64H26Z" className="fill-white/90" />;
  else if (kind === "dipGrey")
    overlay = <path d="M26 0H64V64H26Z" className="fill-muted-foreground/85" />;
  else if (kind === "wipe") overlay = <path d="M0 0H36V64H0Z" className="fill-primary/50" />;
  else if (kind === "wipeLeft") overlay = <path d="M28 0H64V64H28Z" className="fill-primary/50" />;
  else if (kind === "wipeDown") overlay = <path d="M0 0H64V34H0Z" className="fill-primary/50" />;
  else if (kind === "wipeUp") overlay = <path d="M0 30H64V64H0Z" className="fill-primary/50" />;
  else if (kind === "softWipe")
    overlay = (
      <>
        <path d="M0 0H28V64H0Z" className="fill-primary/55" />
        <path d="M28 0H44V64H28Z" className="fill-primary/25" />
      </>
    );
  else if (kind === "diagonalWipe")
    overlay = <path d="M0 0H46L18 64H0Z" className="fill-primary/50" />;
  else if (kind === "pushSlide")
    overlay = (
      <>
        <path d="M0 0H32V64H0Z" className="fill-primary/55" />
        <path d="M32 4V60" className="stroke-white/80" strokeWidth="2" />
      </>
    );
  else if (kind === "doorSplit")
    overlay = (
      <>
        <path d="M0 0H18V64H0ZM46 0H64V64H46Z" className="fill-black/65" />
        <path d="M18 0H46V64H18Z" className="fill-primary/40" />
      </>
    );
  else if (kind === "bandWipe")
    overlay = <path d="M0 4H44V16H0ZM0 26H54V38H0ZM0 48H34V60H0Z" className="fill-primary/55" />;
  else if (kind === "irisOpen")
    overlay = (
      <circle
        cx="32"
        cy="32"
        r="17"
        className="fill-primary/50 stroke-white/75"
        strokeWidth="1.5"
      />
    );
  else if (kind === "irisClose")
    overlay = (
      <>
        <rect x="0" y="0" width="64" height="64" className="fill-black/60" />
        <circle
          cx="32"
          cy="32"
          r="14"
          className="fill-primary/45 stroke-white/65"
          strokeWidth="1.5"
        />
      </>
    );
  else if (kind === "lightIris")
    overlay = (
      <>
        <circle cx="32" cy="32" r="17" className="fill-primary/35" />
        <circle cx="32" cy="32" r="17" className="stroke-warn fill-none" strokeWidth="3" />
      </>
    );
  else if (kind === "blobRing")
    overlay = (
      <path
        d="M32 13C40 12 49 18 50 27C52 35 46 47 36 50C27 52 16 46 14 36C12 26 21 15 32 13Z"
        className="fill-primary/45 stroke-white/75"
        strokeWidth="1.5"
      />
    );
  else if (kind === "windowExpand")
    overlay = (
      <rect
        x="8"
        y="12"
        width="48"
        height="40"
        rx="4"
        className="fill-primary/35 stroke-white/80"
        strokeWidth="1.5"
      />
    );
  else if (kind === "mosaicCut")
    overlay = (
      <>
        <rect x="8" y="8" width="14" height="14" className="fill-primary/60" />
        <rect x="25" y="25" width="14" height="14" className="fill-primary/45" />
        <rect x="42" y="10" width="14" height="14" className="fill-white/50" />
        <rect x="12" y="42" width="14" height="14" className="fill-white/40" />
      </>
    );
  else if (kind === "mosaicIris")
    overlay = (
      <>
        <rect x="25" y="10" width="14" height="10" className="fill-primary/65" />
        <rect x="44" y="25" width="10" height="14" className="fill-white/55" />
        <rect x="25" y="44" width="14" height="10" className="fill-primary/50" />
        <rect x="10" y="25" width="10" height="14" className="fill-white/45" />
      </>
    );
  else if (kind === "blurDissolve")
    overlay = <circle cx="32" cy="32" r="22" className="fill-white/30" />;
  else if (kind === "exposureBloom")
    overlay = <circle cx="32" cy="28" r="24" className="fill-warn/75" />;
  else if (kind === "lightSweep")
    overlay = <polygon points="10,64 30,0 44,0 24,64" className="fill-warn/80" />;
  else if (kind === "hueSweep")
    overlay = (
      <>
        <polygon points="8,64 26,0 36,0 18,64" className="fill-accent-hover/65" />
        <polygon points="18,64 36,0 46,0 28,64" className="fill-chart-5/65" />
      </>
    );
  else if (kind === "lumaMelt")
    overlay = <path d="M0 36 Q16 18 32 34 T64 26 V64 H0 Z" className="fill-primary/55" />;
  else if (kind === "whipStreak")
    overlay = (
      <>
        <rect x="6" y="18" width="52" height="5" rx="2.5" className="fill-white/75" />
        <rect x="14" y="30" width="44" height="5" rx="2.5" className="fill-primary/70" />
        <rect x="4" y="42" width="40" height="4" rx="2" className="fill-white/55" />
      </>
    );
  else if (kind === "zoomCross")
    overlay = (
      <>
        <rect
          x="14"
          y="14"
          width="36"
          height="36"
          rx="3"
          className="fill-none stroke-white/75"
          strokeWidth="1.5"
        />
        <rect x="23" y="23" width="18" height="18" rx="2" className="fill-primary/45" />
      </>
    );
  else if (kind === "invertFlash")
    overlay = (
      <>
        <rect x="22" y="0" width="20" height="64" className="fill-white/90" />
        <path d="M22 49 34 26 42 40V64H22Z" className="fill-black/85" />
      </>
    );
  else if (kind === "rgbSplitCut")
    overlay = (
      <>
        <circle cx="28" cy="30" r="14" className="fill-destructive/55" />
        <circle cx="36" cy="30" r="14" className="fill-accent-hover/55" />
      </>
    );
  else if (kind === "topDip")
    overlay = (
      <>
        <path d="M0 0H64V30H0Z" className="fill-black/90" />
        <path d="M0 30H64V44H0Z" className="fill-black/45" />
      </>
    );
  else if (kind === "snapMorph")
    overlay = (
      <>
        <path d="M28 0H64V64H28Z" className="fill-primary/30" />
        <circle cx="32" cy="32" r="12" className="fill-white/85" />
      </>
    );
  else if (kind === "tornPaper")
    overlay = (
      <>
        <path d="M0 0H30L36 9 27 18 35 28 26 38 34 47 28 56 33 64H0Z" className="fill-primary/55" />
        <path
          d="M30 0 36 9 27 18 35 28 26 38 34 47 28 56 33 64"
          className="fill-none stroke-white/90"
          strokeWidth="2"
        />
      </>
    );
  else if (kind === "frameCollapse")
    overlay = (
      <>
        <rect x="0" y="0" width="64" height="64" className="fill-primary/40" />
        <rect
          x="24"
          y="20"
          width="16"
          height="24"
          className="fill-muted-foreground stroke-white/80"
          strokeWidth="1.5"
        />
      </>
    );
  else if (kind === "crossOver")
    overlay = (
      <>
        <path d="M0 0H30V64H0Z" className="fill-primary/40" />
        <path d="M22 0H38V64H22Z" className="fill-white/25" />
        <rect x="4" y="18" width="40" height="28" rx="3" className="fill-white/35" />
      </>
    );
  else if (kind === "heatBleach")
    overlay = (
      <>
        <path d="M0 0H22V64H0Z" className="fill-warn/45" />
        <path d="M22 0H44V64H22Z" className="fill-warn/75" />
        <path d="M44 0H64V64H44Z" className="fill-white/90" />
      </>
    );
  else if (kind === "glitchBreak")
    overlay = (
      <>
        <path d="M0 0H64V16H0Z" className="fill-accent-hover/70" />
        <path d="M0 16H64V32H0Z" className="fill-primary/70" />
        <path d="M6 32H58V48H6Z" className="fill-chart-5/70" />
        <path d="M0 48H64V64H0Z" className="fill-white/85" />
      </>
    );
  else if (kind === "cat:Mask & Iris")
    overlay = <circle cx="32" cy="32" r="16" className="fill-primary/45" />;

  return (
    <svg aria-hidden viewBox="0 0 64 64" className="bg-raised-2 size-full rounded-md">
      <path d="M0 49 22 23 45 49V64H0Z" className="fill-muted-foreground" />
      <circle cx="45" cy="15" r="5" className="fill-foreground/70" />
      {overlay}
    </svg>
  );
}

export function TransitionLibrary() {
  useStudio((s) => s.ready);
  useStudio((s) => s.shotsRev);
  useStudio((s) => s.timingRev);
  const picked = useStudio((s) => s.shotPick),
    key = useStudio((s) => s.camKey);
  useStudio((s) => s.shot);
  const favs = useStudio((s) => s.favorites.effects);
  const [q, setQ] = useState(""),
    [cat, setCat] = useState(ALL),
    [trialShot, setTrialShot] = useState<number | null>(null);
  const trial = useRef<{ snap: string; timer: number } | null>(null);
  const shot = Math.max(
      1,
      picked !== null || key !== null ? shownShot() : (trialShot ?? shownShot()),
    ),
    at = SHOTS_OUT[shot]?.t,
    current = transitionOf(shot);
  const all = transitions();
  const cats = useMemo(() => transitionCategories(all), [all]);
  const list = useMemo(() => {
    const hit = matcher(q);
    return all.filter((fx) => {
      const fxCat = transitionCatOf(fx);
      return (
        hit(`${fx.title} ${fxCat} ${fx.tip}`) &&
        (cat === ALL || (cat === FAV ? favs.includes(`transition:${fx.id}`) : fxCat === cat))
      );
    });
  }, [all, q, cat, favs]);
  const leave = useCallback(() => {
    if (!trial.current) return;
    clearTimeout(trial.current.timer);
    shotsDoc.restore(trial.current.snap);
    trial.current = null;
    setTrialShot(null);
    stopSpan();
  }, []);
  const tryOn = (fx: string) => {
    leave();
    if (at === undefined || !transitionRoom(shot)) return;
    setTrialShot(shot);
    trial.current = {
      snap: shotsDoc.snapshot(),
      timer: window.setTimeout(() => {
        previewTransition(shot, fx);
        const [from, to] = transitionSpan(shot);
        playSpan(Math.max(0, from - 0.3), Math.min(DURATION, to + 0.3), true);
      }, 180),
    };
  };
  useEffect(() => leave, [leave, shot, picked, key, q, cat, favs]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none flex-col gap-2.5 px-3 pb-2.5">
        <SearchBox
          name="transition-search"
          value={q}
          onChange={setQ}
          label="Search transitions"
          placeholder={`Search ${all.length} transitions…`}
        />
        <ChipGroup
          scroll
          label="Transition categories"
          value={cat}
          onChange={setCat}
          items={cats.map((c) => ({
            id: c,
            title: (
              <>
                {c === FAV && <Star aria-hidden className="size-3" />}
                {c}
              </>
            ),
          }))}
        />
      </div>
      <div className="scroll-fade min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
        <ul
          aria-label="Transitions"
          className="grid grid-cols-[repeat(auto-fill,minmax(4.25rem,1fr))] gap-x-2.5 gap-y-3"
        >
          {list.map((fx) => (
            <li
              key={fx.id}
              className="group relative min-w-0"
              onPointerEnter={(e) => e.pointerType === "mouse" && tryOn(fx.id)}
              onPointerLeave={leave}
            >
              <button
                type="button"
                draggable
                aria-label={`Add ${fx.title}${ownTransition(fx) ? `, ${FILM_MADE}` : ""}`}
                aria-pressed={current?.fx === fx.id}
                disabled={at === undefined || !transitionRoom(shot)}
                title={fx.tip}
                onDragStart={(e) => {
                  leave();
                  e.dataTransfer.setData(TRANSITION_DRAG, fx.id);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => {
                  leave();
                  setTransition(shot, fx.id);
                }}
                className="focus-visible:ring-ring block w-full rounded-md outline-none focus-visible:ring-2 disabled:opacity-50"
              >
                <span
                  className={cn(
                    "group-hover:border-foreground/40 relative block aspect-square overflow-hidden rounded-md border-2 border-transparent",
                    current?.fx === fx.id && "border-primary",
                  )}
                >
                  <Look fx={fx} />
                  {ownTransition(fx) && <FilmMark />}
                  <span
                    aria-hidden
                    className="bg-primary text-primary-foreground absolute end-0.5 bottom-0.5 rounded-sm opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
                  >
                    <Plus className="size-4" />
                  </span>
                </span>
                <span className="text-foreground/85 mt-1 block truncate text-xs">{fx.title}</span>
              </button>
              <FavoriteStar
                kind="effects"
                id={`transition:${fx.id}`}
                name={fx.title}
                onTile
                reveal
                className="absolute start-0.5 bottom-5"
              />
            </li>
          ))}
        </ul>
        {!list.length && (
          <p className="text-ui text-muted-foreground py-2">
            {cat === FAV && !q.trim()
              ? "No favorites yet. Use the star on a transition to keep it here."
              : "No transitions match this search."}
          </p>
        )}
      </div>
      <div className="flex flex-none items-center gap-1 border-t px-3 py-2">
        <Button
          variant="quiet"
          size="icon"
          aria-label="Previous cut"
          disabled={shot <= 1}
          onClick={() => {
            leave();
            pickShot(shot - 1);
          }}
        >
          <ChevronLeft />
        </Button>
        <span className="text-muted-foreground min-w-0 flex-1 text-center text-xs">
          {at === undefined ? "No cuts in this film" : `Cut at ${stamp(at)}`}
        </span>
        <Button
          variant="quiet"
          size="icon"
          aria-label="Next cut"
          disabled={shot >= SHOTS_OUT.length - 1}
          onClick={() => {
            leave();
            pickShot(shot + 1);
          }}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
