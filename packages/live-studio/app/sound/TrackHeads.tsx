// The column beside the sound tracks (sound/lanes.ts draws the tracks): each track's name, mute and lock, row for row.
// A press on the name picks every clip on that track; a double press (or F2) renames it
import { cn } from "cn";
import { Lock, LockOpen, Volume2, VolumeX } from "lucide-react";
import { useState } from "react";
import { Tip } from "../components/Tip";
import { Toggle } from "@/components/ui/toggle";
import { ADD_H, TOP, TRACK_H } from "./lanes";
import { allClips, clipOf, lanes, setClips, setTrack } from "./sound";
import type { Track } from "./tracks";
import { useStudio } from "../core/store";

function Head({ t }: { t: Track }) {
  const [naming, setNaming] = useState(false);
  const pickAll = () => setClips(allClips().filter((r) => clipOf(r)?.track === t.id));
  const done = (name: string | null) => { setNaming(false); if (name?.trim() && name.trim() !== t.name) setTrack(t.id, { name: name.trim() }); };
  return (
    <li style={{ height: TRACK_H }} className={cn("flex items-center gap-0.5 ps-1.5 pe-0.5", t.mute && "text-muted-foreground")}>
      {naming ? (
        <input
          autoFocus
          defaultValue={t.name}
          aria-label="Track name"
          maxLength={24}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => done(e.currentTarget.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") done(null); }}
          className="h-6 min-w-0 flex-1 rounded-sm border border-ring bg-background px-1 text-xs outline-none pointer-coarse:text-base"
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
        <Toggle size="sm" className="size-6 px-0 text-muted-foreground aria-pressed:text-warn" pressed={!!t.mute} onPressedChange={(on) => setTrack(t.id, { mute: on || undefined })} aria-label={`Mute ${t.name}`}>
          {t.mute ? <VolumeX /> : <Volume2 />}
        </Toggle>
      </Tip>
      <Tip label={t.lock ? "Unlock track" : "Lock track, so its clips can't be moved, trimmed or deleted"}>
        <Toggle size="sm" className="size-6 px-0 text-muted-foreground aria-pressed:text-foreground upright:hidden" pressed={!!t.lock} onPressedChange={(on) => setTrack(t.id, { lock: on || undefined })} aria-label={`Lock ${t.name}`}>
          {t.lock ? <Lock /> : <LockOpen />}
        </Toggle>
      </Tip>
    </li>
  );
}

export function TrackHeads() {
  useStudio((s) => s.soundRev);
  return (
    <ul aria-label="Audio tracks" style={{ paddingTop: TOP, paddingBottom: ADD_H }} className="bg-background">
      {(lanes?.tracks ?? []).map((t) => <Head key={t.id} t={t} />)}
    </ul>
  );
}
