// The mark on a picker's tile whose effect the film's code made rather than the studio: the word, never a colour alone.
// Screen readers get the same through FILM_MADE in the tile's own name
import { cn } from "@/lib/utils";

export const FILM_MADE = "made by this film's code";

export function FilmMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      title="Made by this film's code: see the Film tab"
      className={cn(
        "text-tag absolute top-1 left-1 rounded-xs bg-black/70 px-1 leading-4 font-semibold text-white",
        className,
      )}
    >
      Film
    </span>
  );
}
