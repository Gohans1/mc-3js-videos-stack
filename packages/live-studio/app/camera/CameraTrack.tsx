import { useState } from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";

import { DURATION, SHOTS_OUT } from "../core/filmMeta";
import { transitionSelection } from "../core/selection";
import type { Bind } from "../core/state";
import { S } from "../core/state";
import { get, set, useStudio } from "../core/store";
import { SAME } from "../core/time";
import { seek } from "../playback/transport";
import { hasSweeteners, sweeten, SWEETS } from "../sound/sweeten";
import { askPaste, copyAttrs, hasAttrs } from "../timeline/attributes";
import { copy } from "../timeline/clipboard";
import { addFreeze } from "../timeline/timing";
import { animOf, clearAnims, pickShot, shotSpan, type Slot, SLOT_NAMES } from "./anim";
import {
  applyEasyEase,
  canDeleteCameraKey,
  canMatchCameraKey,
  holdAfter,
  isHardCut,
  keys,
  movable,
  removeKey,
  seekCameraKey,
  setCameraKeyMatchSpeed,
  setKey,
  setKeyLocked,
  shotOfCut,
  splitShot,
} from "./cam";
import { SHOT_NAME_ID } from "./CamPanel";
import { cameraKeyAtPointer, cutAtPointer, shotAtPointer } from "./camrow";
import { setTransition, TRANSITION_DRAG, transitionOf } from "./transitions";

const openTab = (i: number, side: "cam" | "anim" | "transition", slot?: Slot) => {
  set({
    ...transitionSelection({ kind: "shot", index: i, side }, get().side),
    ...(slot ? { animSlot: slot } : {}),
    ...(side === "transition" ? { lib: "transition" as const } : {}),
  });
  S.dirty = true;
};

export function CameraTrack({ bind, shown }: { bind: Bind; shown: boolean }) {
  const data = useStudio((s) => s.shots),
    sound = useStudio((s) => s.sound),
    timing = useStudio((s) => s.timing);
  const [shot, setShot] = useState(-1);
  const [keyIndex, setKeyIndex] = useState(-1);
  useStudio((s) => s.camRev);
  useStudio((s) => s.shotsRev);
  const key = keys[keyIndex];
  const hardCut = isHardCut(keyIndex);
  const canMatch = canMatchCameraKey(keyIndex);
  const [a, b] = shot >= 0 ? shotSpan(shot) : [0, DURATION];
  const cut = shot > 0 ? keys.findIndex((_, i) => shotOfCut(i) === shot) : -1;
  const inside = S.t > a + SAME * 3 && S.t < b - SAME * 3,
    anim = shot >= 0 && Object.keys(animOf(shot)).length > 0;
  return (
    <ContextMenu>
      <ContextMenuTrigger
        className={cn(!shown && "hidden")}
        onContextMenu={(e) => {
          const i = cameraKeyAtPointer(e);
          setKeyIndex(i);
          if (i >= 0) {
            setKey(i);
            return;
          }
          const s = shotAtPointer(e);
          setShot(s);
          if (s >= 0) pickShot(s);
        }}
      >
        <canvas
          ref={bind("camrow")}
          aria-label="Camera track: diamonds are keyframes, circles match speed, and double bars are hard cuts within a shot. Click a shot or keyframe to edit it. Drag to retime movable keyframes or roll shot boundaries. Right-click for more. The yellow shape is camera speed"
          className="block h-12 w-full touch-none"
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(TRANSITION_DRAG) && cutAtPointer(e) > 0) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }
          }}
          onDrop={(e) => {
            const fx = e.dataTransfer.getData(TRANSITION_DRAG),
              cut = cutAtPointer(e);
            if (fx && cut > 0) {
              e.preventDefault();
              setTransition(cut, fx);
            }
          }}
        />
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-52">
        {key ? (
          <>
            <ContextMenuGroup>
              <ContextMenuLabel>
                {hardCut ? "Hard cut" : key.cut ? "Shot cut" : "Camera keyframe " + (keyIndex + 1)}
              </ContextMenuLabel>
            </ContextMenuGroup>
            <ContextMenuItem onClick={() => seekCameraKey(keyIndex)}>
              Go to keyframe
            </ContextMenuItem>
            <ContextMenuItem disabled={!movable(keyIndex)} onClick={copy}>
              Copy keyframe<ContextMenuShortcut>Ctrl+C</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onClick={copyAttrs}>
              Copy attributes<ContextMenuShortcut>Ctrl+Alt+C</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem disabled={!hasAttrs() || key.locked} onClick={askPaste}>
              Paste attributes<ContextMenuShortcut>Ctrl+Alt+V</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              disabled={!movable(keyIndex)}
              onClick={() => applyEasyEase([keyIndex])}
            >
              Easy Ease<ContextMenuShortcut>F9</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!movable(keyIndex)}
              onClick={() => applyEasyEase([keyIndex], true)}
            >
              Easy Ease In<ContextMenuShortcut>Shift+F9</ContextMenuShortcut>
            </ContextMenuItem>
            {canMatch && (
              <ContextMenuItem
                disabled={!!key.locked}
                onClick={() => setCameraKeyMatchSpeed(keyIndex, !key.matchSpeed)}
              >
                Match speed
                {key.matchSpeed && <span className="text-muted-foreground ms-auto">on</span>}
              </ContextMenuItem>
            )}
            <ContextMenuItem onClick={() => holdAfter(keyIndex)}>Hold 1 s</ContextMenuItem>
            <ContextMenuItem onClick={() => setKeyLocked(keyIndex, !key.locked)}>
              {key.locked ? "Unlock keyframe" : "Lock keyframe"}
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!canDeleteCameraKey(keyIndex)}
              onClick={() => removeKey(keyIndex)}
            >
              {hardCut
                ? "Delete hard cut"
                : key.cut
                  ? "Delete cut and merge shots"
                  : "Delete keyframe"}
            </ContextMenuItem>
          </>
        ) : shot < 0 || !SHOTS_OUT[shot] ? (
          <ContextMenuGroup>
            <ContextMenuLabel>No shot here</ContextMenuLabel>
          </ContextMenuGroup>
        ) : (
          <>
            <ContextMenuGroup>
              <ContextMenuLabel>
                <span className="block truncate">
                  Shot {shot}
                  {S.comments[shot] ? ` · ${S.comments[shot]}` : ""}
                </span>
                {!data && (
                  <span className="block">
                    This film keeps its shots in code: ask the AI in a note to change them
                  </span>
                )}
              </ContextMenuLabel>
            </ContextMenuGroup>
            <ContextMenuItem
              disabled={!data}
              onClick={() => {
                openTab(shot, "cam");
                requestAnimationFrame(() => {
                  const el = document.getElementById(SHOT_NAME_ID) as HTMLInputElement | null;
                  el?.focus();
                  el?.select();
                });
              }}
            >
              Rename
            </ContextMenuItem>
            <ContextMenuItem disabled={!data || !inside} onClick={splitShot}>
              Split at playhead<ContextMenuShortcut>Ctrl+B</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem disabled={!timing} onClick={addFreeze}>
              Freeze at playhead
            </ContextMenuItem>
            <ContextMenuItem disabled={!canDeleteCameraKey(cut)} onClick={() => removeKey(cut)}>
              Merge with shot before
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!data || shot < 1 || !S.render?.transitions}
              onClick={() => openTab(shot, "transition")}
            >
              Transition at the cut…
            </ContextMenuItem>
            {transitionOf(shot) && (
              <ContextMenuItem onClick={() => setTransition(shot, null)}>
                Remove transition
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem disabled={!data} onClick={copyAttrs}>
              Copy attributes<ContextMenuShortcut>Ctrl+Alt+C</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem disabled={!data || !hasAttrs()} onClick={askPaste}>
              Paste attributes<ContextMenuShortcut>Ctrl+Alt+V</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuGroup>
              <ContextMenuLabel>Animation</ContextMenuLabel>
              {(["in", "out", "combo"] as const).map((slot) => (
                <ContextMenuItem
                  key={slot}
                  disabled={!data}
                  onClick={() => openTab(shot, "anim", slot)}
                >
                  {SLOT_NAMES[slot]}…
                  {animOf(shot)[slot] && <span className="text-muted-foreground ms-auto">on</span>}
                </ContextMenuItem>
              ))}
              <ContextMenuItem disabled={!anim} onClick={() => clearAnims(shot)}>
                Remove animations
              </ContextMenuItem>
            </ContextMenuGroup>
            <ContextMenuSeparator />
            <ContextMenuSub>
              <ContextMenuSubTrigger disabled={shot < 1 || !sound}>
                Sound at the cut
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="min-w-48">
                {hasSweeteners() ? (
                  SWEETS.map((p, i) => (
                    <ContextMenuItem key={p.label} onClick={() => sweeten(a, i)}>
                      {p.label}
                    </ContextMenuItem>
                  ))
                ) : (
                  <ContextMenuGroup>
                    <ContextMenuLabel className="max-w-56">
                      This film has no cut sounds yet: ask the AI in a note to fetch the cut
                      sweeteners
                    </ContextMenuLabel>
                  </ContextMenuGroup>
                )}
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
