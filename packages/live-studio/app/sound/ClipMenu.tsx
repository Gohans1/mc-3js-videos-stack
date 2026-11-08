// The sound tracks' canvas (lanes.ts draws it and takes the pointer) and its right-click menu, as CapCut's on a clip: copy,
// cut, paste, delete, split at the playhead, copy and paste attributes. A right-click on a clip not yet picked picks it alone
// first; on empty space the menu only pastes. Every item is a key too (Settings, Shortcuts)
import { useState } from "react";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from "@/components/ui/context-menu";
import type { Bind } from "../core/state";
import { S } from "../core/state";
import { get, useStudio } from "../core/store";
import { askPaste, copyAttrs, hasAttrs } from "../timeline/attributes";
import { copy, cut, hasCopy, paste } from "../timeline/clipboard";
import { clipAtPointer } from "./lanes";
import { picked, removeClips, setClips, span, splitClips } from "./sound";

export function ClipMenu({ bind }: { bind: Bind }) {
  const picks = useStudio((s) => s.clips), [onClip, setOnClip] = useState(false);
  const inside = picks.some((c) => { const [a, b] = span(c); return a + 0.05 < S.t && S.t < b - 0.05; });
  const pasteItem = <ContextMenuItem disabled={!hasCopy()} onClick={paste}>Paste<ContextMenuShortcut>Ctrl+V</ContextMenuShortcut></ContextMenuItem>;
  return (
    <ContextMenu>
      <ContextMenuTrigger className="min-w-0" onContextMenu={(e) => { const r = clipAtPointer(e); setOnClip(!!r); if (r && !picked(r)) setClips([r]); }}>
        <canvas
          ref={bind("lanes")}
          aria-label="Audio tracks: drag a clip to move it, drag its edge to trim, drag on empty space to select several, right-click a clip for more"
          className="block w-full touch-none"
        />
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-56">
        {!onClip ? pasteItem : <>
          <ContextMenuItem onClick={copy}>Copy<ContextMenuShortcut>Ctrl+C</ContextMenuShortcut></ContextMenuItem>
          <ContextMenuItem onClick={cut}>Cut<ContextMenuShortcut>Ctrl+X</ContextMenuShortcut></ContextMenuItem>
          {pasteItem}
          <ContextMenuItem onClick={() => removeClips(get().clips)}>Delete<ContextMenuShortcut>Del</ContextMenuShortcut></ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem disabled={!inside} onClick={() => splitClips(get().clips)}>Split at playhead<ContextMenuShortcut>Ctrl+B</ContextMenuShortcut></ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={copyAttrs}>Copy attributes<ContextMenuShortcut>Ctrl+Alt+C</ContextMenuShortcut></ContextMenuItem>
          <ContextMenuItem disabled={!hasAttrs()} onClick={askPaste}>Paste attributes<ContextMenuShortcut>Ctrl+Alt+V</ContextMenuShortcut></ContextMenuItem>
        </>}
      </ContextMenuContent>
    </ContextMenu>
  );
}
