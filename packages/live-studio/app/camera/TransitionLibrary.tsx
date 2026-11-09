import { useEffect, useRef, useState } from "react";
import { DURATION, SHOTS_OUT } from "film/scene";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FavoriteStar } from "../components/FavoriteStar";
import { SearchBox } from "../components/SearchBox";
import { Segmented } from "../components/inspector";
import { useStudio } from "../core/store";
import { stamp } from "../core/time";
import { pickShot, playSpan, shownShot, stopSpan } from "./anim";
import { shotsDoc } from "./shots";
import { setTransition, TRANSITION_DRAG, transitionDuration, transitionOf, transitions } from "./transitions";

function Look({ id }: { id: string }) {
  return <svg aria-hidden viewBox="0 0 64 64" className="size-full rounded-md bg-raised-2">
    <path d="M0 49 22 23 45 49V64H0Z" className="fill-muted-foreground" />
    <circle cx="45" cy="15" r="5" className="fill-foreground/70" />
    {id === "dissolve" || id === "wipe" ? <path d="M32 0H64V64H32Z" className={id === "wipe" ? "fill-primary/50" : "fill-primary/25"} /> : <path d="M32 0H64V64H32Z" className={id === "black" ? "fill-black/90" : "fill-white/90"} />}
  </svg>;
}

export function TransitionLibrary() {
  useStudio((s) => s.ready);
  useStudio((s) => s.shotsRev);
  const picked = useStudio((s) => s.shotPick), key = useStudio((s) => s.camKey);
  useStudio((s) => s.shot);
  const favs = useStudio((s) => s.favorites.effects);
  const [q, setQ] = useState(""), [cat, setCat] = useState("basic");
  const trial = useRef<{ snap: string; timer: number; shot: number } | null>(null);
  const shot = Math.max(1, picked !== null || key !== null ? shownShot() : trial.current?.shot ?? shownShot()), at = SHOTS_OUT[shot]?.t, current = transitionOf(shot);
  const list = transitions().filter((fx) => fx.title.toLowerCase().includes(q.trim().toLowerCase()) && (cat !== "favorites" || favs.includes(`transition:${fx.id}`)));
  const leave = () => {
    if (!trial.current) return;
    clearTimeout(trial.current.timer);
    shotsDoc.restore(trial.current.snap);
    trial.current = null;
    stopSpan();
  };
  const tryOn = (fx: string) => {
    leave();
    if (at === undefined) return;
    const len = transitionDuration(shot);
    trial.current = { snap: shotsDoc.snapshot(), shot, timer: window.setTimeout(() => {
      shotsDoc.preview((rows) => { rows[shot].transition = { fx, len }; });
      playSpan(Math.max(0, at - len / 2 - 0.3), Math.min(DURATION, at + len / 2 + 0.3), true);
    }, 180) };
  };
  useEffect(() => leave, [shot, picked, key, q, cat, favs]);
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="px-3 pb-3"><SearchBox name="transition-search" value={q} onChange={setQ} label="Search transitions" placeholder="Search transitions" /></div>
    <div className="flex min-h-0 flex-1 gap-3 overflow-y-auto px-3 pb-3">
      <Segmented vertical label="Transition categories" value={cat} onChange={setCat} items={[{ id: "favorites", title: "Favorites" }, { id: "basic", title: "Basic" }]} />
      <div className="min-w-0 flex-1">
        <ul aria-label="Transitions" className="grid grid-cols-[repeat(auto-fill,minmax(4rem,1fr))] gap-x-2.5 gap-y-3">
          {list.map((fx) => <li key={fx.id} className="group relative min-w-0" onPointerEnter={(e) => e.pointerType === "mouse" && tryOn(fx.id)} onPointerLeave={leave}>
            <button type="button" draggable aria-label={`Add ${fx.title}`} aria-pressed={current?.fx === fx.id} disabled={at === undefined} title={fx.tip}
              onDragStart={(e) => { leave(); e.dataTransfer.setData(TRANSITION_DRAG, fx.id); e.dataTransfer.effectAllowed = "copy"; }}
              onClick={() => { leave(); setTransition(shot, fx.id); }}
              className="block w-full rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
              <span className={cn("relative block aspect-square overflow-hidden rounded-md border-2 border-transparent group-hover:border-foreground/40", current?.fx === fx.id && "border-primary")}>
                <Look id={fx.id} />
                <span aria-hidden className="absolute end-0.5 bottom-0.5 rounded-sm bg-primary text-primary-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100"><Plus className="size-4" /></span>
              </span>
              <span className="mt-1 block truncate text-xs text-foreground/85">{fx.title}</span>
            </button>
            <FavoriteStar kind="effects" id={`transition:${fx.id}`} name={fx.title} onTile reveal className="absolute start-0.5 bottom-5" />
          </li>)}
        </ul>
        {!list.length && <p className="text-ui text-muted-foreground">{cat === "favorites" && !q ? "No favorites yet. Use the star on a transition to keep it here." : "No transitions match this search."}</p>}
      </div>
    </div>
    <div className="flex flex-none items-center gap-1 border-t px-3 py-2">
      <Button variant="quiet" size="icon" aria-label="Previous cut" disabled={shot <= 1} onClick={() => { leave(); pickShot(shot - 1); }}><ChevronLeft /></Button>
      <span className="min-w-0 flex-1 text-center text-xs text-muted-foreground">{at === undefined ? "No cuts in this film" : `Cut at ${stamp(at)}`}</span>
      <Button variant="quiet" size="icon" aria-label="Next cut" disabled={shot >= SHOTS_OUT.length - 1} onClick={() => { leave(); pickShot(shot + 1); }}><ChevronRight /></Button>
    </div>
  </div>;
}
