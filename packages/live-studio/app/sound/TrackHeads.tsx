import { cn } from "@/lib/utils";
import { Headphones, Lock, LockOpen, Music2, Ellipsis, Volume2, VolumeX } from "lucide-react";
import { useState } from "react";
import { Tip } from "../components/Tip";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuItem, DropdownMenuCheckboxItem } from "@/components/ui/dropdown-menu";
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
    <li style={{ "--row-h": `${TRACK_H}px` }} className={cn("relative flex h-(--row-h) items-center border-b border-background bg-track-head", t.mute && "text-muted-foreground")}>
      {naming ? (
        <input
          autoFocus
          defaultValue={t.name}
          aria-label="Track name"
          maxLength={24}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => done(e.currentTarget.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") done(null); }}
          className="absolute inset-x-1 z-1 h-6 min-w-0 rounded-sm border border-ring bg-input px-1 text-xs outline-none pointer-coarse:text-base"
        />
      ) : (
        <Tip side="right" label={<>{t.name}: click to select its clips, double-click (F2) to rename</>}>
        <Button
          variant={solo ? "lit" : "quiet"} size="icon-sm" aria-label={t.name}
          onClick={pickAll}
          onDoubleClick={() => setNaming(true)}
          onKeyDown={(e) => { if (e.key === "F2") { e.preventDefault(); setNaming(true); } }}
        >
          {solo ? <Headphones /> : <Music2 />}
        </Button>
        </Tip>
      )}
      <Tip label={t.lock ? "Unlock track" : "Lock track, so its clips can't be moved, trimmed or deleted"}>
        <Toggle variant="quiet" size="icon-sm" pressed={!!t.lock} onPressedChange={(on) => setTrack(t.id, { lock: on || undefined })} aria-label={`Lock ${t.name}`}>
          {t.lock ? <Lock /> : <LockOpen />}
        </Toggle>
      </Tip>
      <span className="min-w-0 flex-1" />
      <Tip label={t.mute ? "Unmute track" : "Mute track (in the final render too)"}>
        <Toggle variant="quiet-warn" size="icon-sm" pressed={!!t.mute} onPressedChange={(on) => setTrack(t.id, { mute: on || undefined })} aria-label={`Mute ${t.name}`}>
          {t.mute ? <VolumeX /> : <Volume2 />}
        </Toggle>
      </Tip>
      <DropdownMenu>
        <Tip label={`${t.name}: track options`}>
          <DropdownMenuTrigger render={<Button variant="quiet" size="icon-sm" aria-label={`Track options for ${t.name}`} />}><Ellipsis /></DropdownMenuTrigger>
        </Tip>
        <DropdownMenuContent side="right" align="start">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t.name}</DropdownMenuLabel>
            <DropdownMenuItem onClick={pickAll}>Select clips</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setNaming(true)}>Rename track</DropdownMenuItem>
            {live && <DropdownMenuCheckboxItem checked={solo} onCheckedChange={(on) => setSolo(t.id, on)}>Solo track</DropdownMenuCheckboxItem>}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
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
