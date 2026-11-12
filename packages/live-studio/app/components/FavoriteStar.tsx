import { Star } from "lucide-react";

import { Button } from "@/components/ui/button";
// The star beside a sound or an effect (CapCut's): filled when it is a favorite. Its own button, so it never also plays,
// applies or drags the thing it sits on. reveal: shown on hover or focus only, until it is a favorite; onTile: over a picture
import { cn } from "@/lib/utils";

import { type FavoriteKind, toggleFavorite } from "../core/favorites";
import { useStudio } from "../core/store";
import { Tip } from "./Tip";

export function FavoriteStar({
  kind,
  id,
  name,
  reveal = false,
  onTile = false,
  onCard = false,
  className,
}: {
  kind: FavoriteKind;
  id: string;
  name: string;
  reveal?: boolean;
  onTile?: boolean;
  onCard?: boolean;
  className?: string;
}) {
  const on = useStudio((s) => s.favorites[kind].includes(id));
  const compact = onTile || onCard;
  return (
    <span
      className={cn(
        "flex flex-none",
        reveal &&
          "opacity-0 group-hover:opacity-100 has-focus-visible:opacity-100 pointer-coarse:opacity-100",
        className,
      )}
    >
      <Tip label={on ? "Remove from Favorites" : "Add to Favorites"}>
        <Button
          variant={onTile ? "favorite-tile" : onCard ? "favorite-card" : "favorite"}
          size={compact ? "icon-sm" : "icon-lg"}
          aria-label={`Favorite ${name}`}
          aria-pressed={on}
          className={compact ? "pointer-coarse:size-9" : "pointer-coarse:size-10"}
          onClick={() => toggleFavorite(kind, id, name)}
        >
          <Star className={cn(on && "fill-current")} />
        </Button>
      </Tip>
    </span>
  );
}
