import { cn } from "@/lib/utils";

export const FILM_MADE = "made by this film's code";

export function FilmMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      title="Made by this film's code: see the Film tab"
      className={cn(
        "text-tag bg-scrim-strong text-picture absolute top-1 left-1 rounded-xs px-1 leading-4 font-semibold",
        className,
      )}
    >
      Film
    </span>
  );
}
