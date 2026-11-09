// The camera row's canvas (camrow.ts draws it and takes the pointer) and what a right-click on one of its shot blocks offers, as
// a clip's menu does in CapCut: rename, split at the playhead, merge with the shot before, copy and paste its attributes (its
// animations, timeline/attributes.ts), its In / Out / Combo, go to its start.
// Each also sits in the Camera and Animation tabs, which is where a keyboard reaches them
import { cn } from "@/lib/utils";
import { useState } from "react";
import { DURATION, SHOTS_OUT } from "film/scene";
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuShortcut, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from "@/components/ui/context-menu";
import type { Bind } from "../core/state";
import { S } from "../core/state";
import { set, useStudio } from "../core/store";
import { SAME } from "../core/time";
import { seek } from "../playback/transport";
import { SHOT_NAME_ID } from "./CamPanel";
import { animOf, clearAnims, pickShot, type Slot, SLOT_NAMES, shotSpan } from "./anim";
import { keys, removeKey, setKey, splitShot } from "./cam";
import { cutAtPointer, shotAtPointer } from "./camrow";
import { setTransition, TRANSITION_DRAG, transitionOf } from "./transitions";
import { askPaste, copyAttrs, hasAttrs } from "../timeline/attributes";
import { hasSweeteners, sweeten, SWEETS } from "../sound/sweeten";

const openTab = (i: number, side: "cam" | "anim" | "transition", slot?: Slot) => {
  pickShot(i);
  set(slot ? { side, animSlot: slot } : { side });
  if (side === "transition") set({ lib: "transition" });
};

export function CameraTrack({ bind, shown }: { bind: Bind; shown: boolean }) {
  const data = useStudio((s) => s.shots), sound = useStudio((s) => s.sound);
  const [shot, setShot] = useState(-1);
  const [a, b] = shot >= 0 ? shotSpan(shot) : [0, DURATION];
  const cut = shot > 0 ? keys.findIndex((k) => k.cut && Math.abs(k.t - a) < SAME) : -1;
  const inside = S.t > a + SAME * 3 && S.t < b - SAME * 3, anim = shot >= 0 && Object.keys(animOf(shot)).length > 0;
  return (
    <ContextMenu>
      <ContextMenuTrigger
        className={cn(!shown && "hidden")}
        onContextMenu={(e) => { const s = shotAtPointer(e); setShot(s); if (s >= 0) { setKey(null); pickShot(s); } }}
      >
        <canvas
          ref={bind("camrow")}
          aria-label="Camera track: one block per shot holding its camera keyframes (diamonds). Click a block to pick the shot, click a diamond to edit it, drag it to retime, drag the gap between two shots to move the cut, right-click a shot for more. The yellow shape is the camera's speed"
          className="block h-12 w-full touch-none"
          onDragOver={(e) => { if (e.dataTransfer.types.includes(TRANSITION_DRAG) && cutAtPointer(e) > 0) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
          onDrop={(e) => {
            const fx = e.dataTransfer.getData(TRANSITION_DRAG), cut = cutAtPointer(e);
            if (fx && cut > 0) { e.preventDefault(); setTransition(cut, fx); }
          }}
        />
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-52">
        {shot < 0 || !SHOTS_OUT[shot] ? <ContextMenuGroup><ContextMenuLabel>No shot here</ContextMenuLabel></ContextMenuGroup> : (
          <>
            <ContextMenuGroup>
              <ContextMenuLabel>
                <span className="block truncate">Shot {shot}{S.comments[shot] ? ` · ${S.comments[shot]}` : ""}</span>
                {!data && <span className="block">This film keeps its shots in code: ask the AI in a note to change them</span>}
              </ContextMenuLabel>
            </ContextMenuGroup>
            <ContextMenuItem disabled={!data} onClick={() => { openTab(shot, "cam"); requestAnimationFrame(() => { const el = document.getElementById(SHOT_NAME_ID) as HTMLInputElement | null; el?.focus(); el?.select(); }); }}>Rename</ContextMenuItem>
            <ContextMenuItem disabled={!data || !inside} onClick={splitShot}>Split at playhead<ContextMenuShortcut>Ctrl+B</ContextMenuShortcut></ContextMenuItem>
            <ContextMenuItem disabled={!data || cut < 0} onClick={() => removeKey(cut)}>Merge with shot before</ContextMenuItem>
            <ContextMenuItem disabled={!data || shot < 1 || !S.render?.transitions} onClick={() => openTab(shot, "transition")}>Transition at the cut…</ContextMenuItem>
            {transitionOf(shot) && <ContextMenuItem onClick={() => setTransition(shot, null)}>Remove transition</ContextMenuItem>}
            <ContextMenuSeparator />
            <ContextMenuItem disabled={!data} onClick={copyAttrs}>Copy attributes<ContextMenuShortcut>Ctrl+Alt+C</ContextMenuShortcut></ContextMenuItem>
            <ContextMenuItem disabled={!data || !hasAttrs()} onClick={askPaste}>Paste attributes<ContextMenuShortcut>Ctrl+Alt+V</ContextMenuShortcut></ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuGroup>
              <ContextMenuLabel>Animation</ContextMenuLabel>
              {(["in", "out", "combo"] as const).map((slot) => (
                <ContextMenuItem key={slot} disabled={!data} onClick={() => openTab(shot, "anim", slot)}>
                  {SLOT_NAMES[slot]}…{animOf(shot)[slot] && <span className="ms-auto text-muted-foreground">on</span>}
                </ContextMenuItem>
              ))}
              <ContextMenuItem disabled={!anim} onClick={() => clearAnims(shot)}>Remove animations</ContextMenuItem>
            </ContextMenuGroup>
            <ContextMenuSeparator />
            <ContextMenuSub>
              <ContextMenuSubTrigger disabled={shot < 1 || !sound}>Sound at the cut</ContextMenuSubTrigger>
              <ContextMenuSubContent className="min-w-48">
                {hasSweeteners() ? SWEETS.map((p, i) => <ContextMenuItem key={p.label} onClick={() => sweeten(a, i)}>{p.label}</ContextMenuItem>)
                  : <ContextMenuGroup><ContextMenuLabel className="max-w-56">This film has no cut sounds yet: ask the AI in a note to fetch the cut sweeteners</ContextMenuLabel></ContextMenuGroup>}
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => seek(a)}>Go to shot start</ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
