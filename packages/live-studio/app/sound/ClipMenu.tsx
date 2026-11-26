import { useState } from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

import type { Bind } from "../core/state";
import { S } from "../core/state";
import { get, useStudio } from "../core/store";
import { askPaste, copyAttrs, hasAttrs } from "../timeline/attributes";
import { copy, cut, hasCopy, paste } from "../timeline/clipboard";
import { clipAtPointer } from "./lanes";
import { resolveClipMenuRevealCounts } from "./library-view";
import {
  allClipsMuted,
  applyJCut,
  applyLCut,
  audibleName,
  clipCutBounds,
  clipOf,
  lanes,
  locked,
  picked,
  removeClips,
  revealSoundInAudio,
  setClips,
  span,
  splitClips,
  toggleMuteClips,
} from "./sound";

export function ClipMenu({ bind }: { bind: Bind }) {
  const picks = useStudio((s) => s.clips),
    [onClip, setOnClip] = useState(false);
  useStudio((s) => s.soundRev);
  useStudio((s) => s.timingRev);
  const inside = picks.some((c) => {
    const [a, b] = span(c);
    return a + 0.05 < S.t && S.t < b - 0.05;
  });
  const isLocked = onClip && picks.length === 1 && locked(picks[0]);
  const allLocked = picks.length > 0 && picks.every((c) => locked(c));
  const allMuted = allClipsMuted(picks);
  const distinctNames = [
    ...new Set(
      picks
        .map((c) => {
          const row = clipOf(c);
          return row ? (audibleName(row) ?? row.name) : undefined;
        })
        .filter((n): n is string => Boolean(n)),
    ),
  ];
  const { kitCount, allCount } = resolveClipMenuRevealCounts(distinctNames, lanes?.narration);
  const cutInfo = onClip && picks.length === 1 ? clipCutBounds(picks[0]) : null;
  const pasteItem = (
    <ContextMenuItem disabled={!hasCopy()} onClick={paste}>
      Paste<ContextMenuShortcut>Ctrl+V</ContextMenuShortcut>
    </ContextMenuItem>
  );
  return (
    <ContextMenu>
      <ContextMenuTrigger
        className="min-w-0"
        onContextMenu={(e) => {
          const r = clipAtPointer(e);
          setOnClip(!!r);
          if (r && !picked(r)) setClips([r]);
        }}
      >
        <canvas
          ref={bind("lanes")}
          aria-label="Audio tracks: click to move the playhead, drag a clip to move it, drag its edge to trim, drag on empty space to select several, right-click a clip for more"
          className="block w-full touch-none"
        />
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-56">
        {!onClip ? (
          pasteItem
        ) : (
          <>
            <ContextMenuItem onClick={copy}>
              Copy<ContextMenuShortcut>Ctrl+C</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onClick={cut}>
              Cut<ContextMenuShortcut>Ctrl+X</ContextMenuShortcut>
            </ContextMenuItem>
            {pasteItem}
            <ContextMenuItem disabled={allLocked} onClick={() => toggleMuteClips(get().clips)}>
              {allMuted
                ? picks.length > 1
                  ? `Enable ${picks.length} clips`
                  : "Enable"
                : picks.length > 1
                  ? `Disable ${picks.length} clips`
                  : "Disable"}
              <ContextMenuShortcut>D</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onClick={() => removeClips(get().clips)}>
              Delete<ContextMenuShortcut>Del</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              disabled={!kitCount}
              onClick={() => revealSoundInAudio(get().clips, "kit")}
            >
              {kitCount > 1 ? `Reveal ${kitCount} sounds in Core Kit` : "Reveal in Core Kit"}
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!allCount}
              onClick={() => revealSoundInAudio(get().clips, "all")}
            >
              {allCount > 1 ? `Reveal ${allCount} sounds in All Library` : "Reveal in All Library"}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem disabled={!inside} onClick={() => splitClips(get().clips)}>
              Split at playhead<ContextMenuShortcut>Ctrl+B</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem
              disabled={isLocked || !cutInfo?.jCut.changed}
              onClick={() => picks.length === 1 && applyJCut(picks[0])}
            >
              J-Cut (Lead In)
              <ContextMenuShortcut>
                {isLocked
                  ? "locked"
                  : cutInfo?.jCut.changed
                    ? `-${cutInfo.jCut.delta}s`
                    : cutInfo?.jCut.blockedBy === "source"
                      ? "trimIn=0"
                      : cutInfo?.jCut.blockedBy === "cut"
                        ? "no cut"
                        : "blocked"}
              </ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem
              disabled={isLocked || !cutInfo?.lCut.changed}
              onClick={() => picks.length === 1 && applyLCut(picks[0])}
            >
              L-Cut (Trail Out)
              <ContextMenuShortcut>
                {isLocked
                  ? "locked"
                  : cutInfo?.lCut.changed
                    ? `+${cutInfo.lCut.delta}s`
                    : cutInfo?.lCut.blockedBy === "source"
                      ? "at end"
                      : cutInfo?.lCut.blockedBy === "cut"
                        ? "no cut"
                        : "blocked"}
              </ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={copyAttrs}>
              Copy attributes<ContextMenuShortcut>Ctrl+Alt+C</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem disabled={!hasAttrs()} onClick={askPaste}>
              Paste attributes<ContextMenuShortcut>Ctrl+Alt+V</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
