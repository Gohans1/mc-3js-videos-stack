// The star beside a sound or an effect (CapCut's): filled when it is a favorite. Its own button, so it never also plays,
// applies or drags the thing it sits on
import { cn } from "cn";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type FavoriteKind, toggleFavorite } from "../core/favorites";
import { useStudio } from "../core/store";
import { Tip } from "./Tip";

export function FavoriteStar({ kind, id, name, className }: { kind: FavoriteKind; id: string; name: string; className?: string }) {
  const on = useStudio((s) => s.favorites[kind].includes(id));
  return (
    <Tip label={on ? "Remove from Favorites" : "Add to Favorites"}>
      <Button
        variant="ghost" size="icon" aria-label={`Favorite ${name}`} aria-pressed={on}
        className={cn("size-8 flex-none text-muted-foreground hover:text-foreground aria-pressed:text-favorite pointer-coarse:size-10", className)}
        onClick={() => toggleFavorite(kind, id, name)}
      >
        <Star className={cn(on && "fill-current")} />
      </Button>
    </Tip>
  );
}
