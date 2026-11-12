import { cn } from "@/lib/utils";

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "bg-muted text-muted-foreground in-data-[slot=tooltip-content]:text-label in-data-[slot=button]:text-foreground/60 pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-xs px-1 font-sans text-[0.625rem] font-medium select-none in-data-[slot=button]:bg-white/10 in-data-[slot=tooltip-content]:bg-white/10 [&_svg:not([class*='size-'])]:size-3",
        className,
      )}
      {...props}
    />
  );
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  );
}

export { Kbd, KbdGroup };
