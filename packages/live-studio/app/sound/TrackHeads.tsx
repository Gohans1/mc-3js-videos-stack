// The column beside the sound tracks (sound/lanes.ts draws the tracks): each track's name, mute, solo and lock, row for row.
// A press on the name picks every clip on that track; a double press (or F2) renames it
import { cn } from "@/lib/utils";
import { Headphones, Lock, LockOpen, Volume2, VolumeX } from "lucide-react";
import { useState } from "react";
import { Tip } from "../components/Tip";
import { Toggle } from "@/components/ui/toggle";
import { ADD_H, TOP, TRACK_H } from "./lanes";
import { allClips, clipOf, lanes, setClips, setSolo, setTrack } from "./sound";
import type { Track } from "./tracks";
import { useStudio } from "../core/store";

function Head({ t }: { t: Track }) {
  const [naming, setNaming] = useState(false);
  const live = useStudio((s) => s.liveLanes), solo = useStudio((s) => s.solo.includes(t.id));
  const pickAll = () => setClips(allClips().filter((r) => clipOf(r)?.track === t.id));
  const done = (name: string | null) => { setNaming(false); if (name?.trim() && name.trim() !== t.name) setTrack(t.id, { name: name.trim() }); };
  return (
    <li style={{ "--row-h": `${TRACK_H}px` }} className={cn("flex h-(--row-h) items-center gap-0.5 bg-track-head ps-1.5 pe-0.5", t.mute && "text-muted-foreground")}>
      {naming ? (
        <input
          autoFocus
          defaultValue={t.name}
          aria-label="Track name"
          maxLength={24}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => done(e.currentTarget.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") done(null); }}
          className="h-6 min-w-0 flex-1 rounded-sm border border-ring bg-input px-1 text-xs outline-none pointer-coarse:text-base"
        />
      ) : (
        <Tip side="right" label={<>{t.name}: click to select its clips, double-click (F2) to rename</>}>
        <button
          type="button"
          onClick={pickAll}
          onDoubleClick={() => setNaming(true)}
          onKeyDown={(e) => { if (e.key === "F2") { e.preventDefault(); setNaming(true); } }}
          className="h-6 min-w-0 flex-1 truncate rounded-sm px-1 text-start text-xs font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t.name}
        </button>
        </Tip>
      )}
      <Tip label={t.mute ? "Unmute track" : "Mute track (in the final render too)"}>
        <Toggle variant="quiet-warn" size="icon-sm" pressed={!!t.mute} onPressedChange={(on) => setTrack(t.id, { mute: on || undefined })} aria-label={`Mute ${t.name}`}>
          {t.mute ? <VolumeX /> : <Volume2 />}
        </Toggle>
      </Tip>
      {live && (
        <Tip label={solo ? "Stop soloing this track" : "Solo: hear only this track (and other soloed ones), in this page only"}>
          <Toggle variant="quiet-primary" size="icon-sm" pressed={solo} onPressedChange={(on) => setSolo(t.id, on)} aria-label={`Solo ${t.name}`}>
            <Headphones />
          </Toggle>
        </Tip>
      )}
      <Tip label={t.lock ? "Unlock track" : "Lock track, so its clips can't be moved, trimmed or deleted"}>
        <Toggle variant="quiet" size="icon-sm" className="upright:hidden" pressed={!!t.lock} onPressedChange={(on) => setTrack(t.id, { lock: on || undefined })} aria-label={`Lock ${t.name}`}>
          {t.lock ? <Lock /> : <LockOpen />}
        </Toggle>
      </Tip>
    </li>
  );
}

export function TrackHeads() {
  useStudio((s) => s.soundRev);
  return (
    <ul aria-label="Audio tracks" style={{ "--top": `${TOP}px`, "--add-h": `${ADD_H}px` }} className="border-e border-track-line bg-background pt-(--top) pb-(--add-h)">
      {(lanes?.tracks ?? []).map((t) => <Head key={t.id} t={t} />)}
    </ul>
  );
}
