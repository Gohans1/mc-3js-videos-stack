import { ChevronDown, ListFilter } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function FilterTriggerButton({
  active,
  open,
  className,
  ...props
}: ComponentProps<"button"> & {
  active: boolean;
  open: boolean;
}) {
  return (
    <button
      type="button"
      data-active={active ? "true" : undefined}
      {...props}
      className={cn(
        "focus-visible:ring-ring studio-press inline-flex h-8 flex-none items-center justify-center gap-0.5 rounded-md border px-1.5 text-sm transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none pointer-coarse:h-10 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        active || open
          ? "border-primary/45 bg-tint text-primary-text hover:bg-tint-hover"
          : "text-foreground/80 hover:bg-muted/50 hover:text-foreground border-transparent bg-transparent",
        className,
      )}
    >
      <ListFilter className="size-4" />
      <ChevronDown className="size-3" />
    </button>
  );
}
