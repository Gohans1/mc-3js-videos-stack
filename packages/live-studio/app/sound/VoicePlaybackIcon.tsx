import { Pause, Play } from "lucide-react";

import { cn } from "@/lib/utils";

export function VoicePlaybackIcon({
  playing,
  className,
}: {
  playing: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      data-voice-playback-icon
      className={cn("pointer-events-none grid size-4 shrink-0 place-items-center", className)}
    >
      <Play data-inactive={playing || undefined} className="size-full translate-x-[0.5px] fill-current" />
      <Pause data-inactive={!playing || undefined} className="size-full fill-current" />
    </span>
  );
}
