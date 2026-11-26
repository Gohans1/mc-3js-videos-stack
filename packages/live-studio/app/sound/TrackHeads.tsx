import {
  AudioWaveform,
  Ellipsis,
  Headphones,
  LayoutList,
  Lock,
  LockOpen,
  Mic,
  Music2,
  Sparkles,
  TrendingUp,
  Volume2,
  VolumeX,
  Waves,
  Wind,
  Zap,
} from "lucide-react";
import { type ComponentType, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";

import type { KitCategoryId } from "../../src/sound-kit-classify.d.mts";
import { useLit } from "../activity/activity";
import { Tip } from "../components/Tip";
import { useStudio } from "../core/store";
import { ADD_H, laneLayout, TOP } from "./lane-layout";
import {
  allClips,
  browseKitCategory,
  clipOf,
  customTrackSplitIndex,
  lanes,
  organizeAudioTracks,
  setClips,
  setSolo,
  setTrack,
  trackRoleOf,
} from "./sound";
import { type Track, TRACK_ROLE_META, TRACK_ROLES, type TrackRole } from "./tracks";

const ROLE_TO_KIT_CATEGORY: Partial<Record<TrackRole, KitCategoryId>> = {
  bgm: "bgm",
  whoosh: "whoosh",
  riser: "riser",
  "pop-ui": "pop-ui",
  impact: "impact",
  ambience: "ambience",
};

const ROLE_STRIPE: Record<TrackRole, string> = {
  voice: "bg-track-role-voice",
  bgm: "bg-track-role-bgm",
  whoosh: "bg-track-role-whoosh",
  riser: "bg-track-role-riser",
  "pop-ui": "bg-track-role-pop",
  impact: "bg-track-role-impact",
  ambience: "bg-track-role-ambience",
  custom: "bg-track-role-custom",
};

const ROLE_ICON_COLOR: Record<TrackRole, string> = {
  voice: "text-track-role-voice",
  bgm: "text-track-role-bgm",
  whoosh: "text-track-role-whoosh",
  riser: "text-track-role-riser",
  "pop-ui": "text-track-role-pop",
  impact: "text-track-role-impact",
  ambience: "text-track-role-ambience",
  custom: "text-track-role-custom",
};

const ROLE_ICON: Record<TrackRole, ComponentType<{ className?: string }>> = {
  voice: Mic,
  bgm: Music2,
  whoosh: Wind,
  riser: TrendingUp,
  "pop-ui": Sparkles,
  impact: Zap,
  ambience: Waves,
  custom: AudioWaveform,
};

function Head({ t, height, customDivider }: { t: Track; height: number; customDivider: boolean }) {
  const lit = useLit(`track:sound:${t.id}`);
  const [naming, setNaming] = useState(false);
  const live = useStudio((s) => s.liveLanes),
    solo = useStudio((s) => s.solo.includes(t.id));
  const role = trackRoleOf(t);
  const Icon = ROLE_ICON[role];
  const pickAll = () => setClips(allClips().filter((r) => clipOf(r)?.track === t.id));
  const done = (name: string | null) => {
    setNaming(false);
    if (name?.trim() && name.trim() !== t.name) setTrack(t.id, { name: name.trim() });
  };
  return (
    <li
      data-ai-lit={lit || undefined}
      data-track-role={role}
      data-custom-divider={customDivider || undefined}
      style={{ "--row-h": `${height}px` }}
      className={cn(
        "border-background bg-track-head relative flex h-(--row-h) flex-col justify-center gap-0.5 border-b ps-2 pe-0.5",
        customDivider && "border-t-hairline-strong border-t-2",
        t.mute && "text-muted-foreground",
      )}
    >
      <span
        aria-hidden
        className={cn("absolute inset-y-1.5 left-0.75 w-0.5 rounded-full", ROLE_STRIPE[role])}
      />
      <div className="flex min-w-0 items-center gap-1 pe-1">
        {naming ? (
          <Input
            autoFocus
            size="xs"
            defaultValue={t.name}
            aria-label="Track name"
            maxLength={24}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => done(e.currentTarget.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") done(null);
            }}
            className="min-w-0 flex-1"
          />
        ) : (
          <Tip
            side="right"
            label={
              <>
                {t.name} ({TRACK_ROLE_META[role].label}): click to select clips, double-click (F2)
                to rename
              </>
            }
          >
            <button
              type="button"
              aria-label={t.name}
              onClick={pickAll}
              onDoubleClick={() => setNaming(true)}
              onKeyDown={(e) => {
                if (e.key === "F2") {
                  e.preventDefault();
                  setNaming(true);
                }
              }}
              className={cn(
                "focus-visible:ring-ring hover:text-heading-foreground flex min-w-0 flex-1 items-center gap-1 rounded-xs py-0.5 text-left text-xs leading-none font-medium transition-colors duration-150 outline-none focus-visible:ring-2 motion-reduce:transition-none",
                solo ? "text-primary-text" : t.mute ? "text-muted-foreground" : "text-foreground",
              )}
            >
              <Icon className={cn("size-3 shrink-0", !t.mute && ROLE_ICON_COLOR[role])} />
              <span className="truncate">{t.name}</span>
            </button>
          </Tip>
        )}
        {t.gain ? (
          <span
            className="text-muted-foreground text-tag shrink-0 tabular-nums"
            title={`Track volume ${t.gain > 0 ? "+" : ""}${t.gain} dB`}
          >
            {t.gain > 0 ? "+" : ""}
            {Math.round(t.gain)}
          </span>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-0.5">
        <div className="flex items-center gap-0.5">
          <Tip
            label={
              t.lock
                ? "Unlock track"
                : "Lock track, so its clips can't be moved, trimmed or deleted"
            }
          >
            <Toggle
              variant="quiet"
              size="icon-sm"
              pressed={!!t.lock}
              onPressedChange={(on) => setTrack(t.id, { lock: on || undefined })}
              aria-label={`Lock ${t.name}`}
            >
              {t.lock ? <Lock /> : <LockOpen />}
            </Toggle>
          </Tip>
          {live && (
            <Tip label={solo ? "Unsolo track" : "Solo track"}>
              <Toggle
                variant="quiet-primary"
                size="icon-sm"
                pressed={solo}
                onPressedChange={(on) => setSolo(t.id, on)}
                aria-label={`Solo ${t.name}`}
              >
                <Headphones />
              </Toggle>
            </Tip>
          )}
          <Tip label={t.mute ? "Unmute track" : "Mute track (in the final render too)"}>
            <Toggle
              variant="quiet-warn"
              size="icon-sm"
              pressed={!!t.mute}
              onPressedChange={(on) => setTrack(t.id, { mute: on || undefined })}
              aria-label={`Mute ${t.name}`}
            >
              {t.mute ? <VolumeX /> : <Volume2 />}
            </Toggle>
          </Tip>
        </div>
        <DropdownMenu>
          <Tip label={`${t.name}: track options`}>
            <DropdownMenuTrigger
              render={
                <Button variant="quiet" size="icon-sm" aria-label={`Track options for ${t.name}`} />
              }
            >
              <Ellipsis />
            </DropdownMenuTrigger>
          </Tip>
          <DropdownMenuContent side="right" align="start" className="min-w-52">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t.name}</DropdownMenuLabel>
              <DropdownMenuItem onClick={pickAll}>Select clips</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setNaming(true)}>Rename track</DropdownMenuItem>
              {live && (
                <DropdownMenuCheckboxItem
                  checked={solo}
                  onCheckedChange={(on) => setSolo(t.id, on)}
                >
                  Solo track
                </DropdownMenuCheckboxItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Category</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={role}
                    onValueChange={(v) => setTrack(t.id, { role: v as TrackRole })}
                  >
                    {TRACK_ROLES.map((r) => (
                      <DropdownMenuRadioItem key={r} value={r}>
                        <span
                          aria-hidden
                          className={cn("size-2 shrink-0 rounded-full", ROLE_STRIPE[r])}
                        />
                        {TRACK_ROLE_META[r].label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              {ROLE_TO_KIT_CATEGORY[role] && (
                <DropdownMenuItem onClick={() => browseKitCategory(ROLE_TO_KIT_CATEGORY[role]!)}>
                  <Sparkles />
                  Browse {TRACK_ROLE_META[role].label} in Core Kit
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={organizeAudioTracks}>
                <LayoutList />
                Auto-organize tracks
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

export function TrackHeads() {
  useStudio((s) => s.soundRev);
  const { rows } = laneLayout(lanes);
  const splitIdx = customTrackSplitIndex();
  return (
    <ul
      aria-label="Audio tracks"
      style={{ "--top": `${TOP}px`, "--add-h": `${ADD_H}px` }}
      className="border-track-line bg-background border-e pt-(--top) pb-(--add-h)"
    >
      {rows.map(({ track, index, height }) => (
        <Head key={track.id} t={track} height={height} customDivider={index === splitIdx} />
      ))}
    </ul>
  );
}
