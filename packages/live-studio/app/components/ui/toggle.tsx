import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const toggleVariants = cva(
  "group/toggle hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-ring aria-pressed:focus-visible:ring-ring aria-invalid:border-destructive aria-invalid:ring-destructive/20 aria-pressed:bg-muted data-[state=on]:bg-muted dark:aria-invalid:ring-destructive/40 inline-flex items-center justify-center gap-1 rounded-md text-xs font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,scale] duration-150 ease-out outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 aria-pressed:focus-visible:ring-[3px] motion-safe:enabled:active:scale-[0.96] motion-reduce:transition-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border-input-border hover:bg-muted border bg-transparent",
        quiet: "text-muted-foreground aria-pressed:text-foreground",
        "quiet-primary": "text-muted-foreground aria-pressed:text-primary",
        "quiet-warn": "text-muted-foreground aria-pressed:text-warn-text",
        segment:
          "text-muted-foreground hover:text-foreground text-sm tabular-nums aria-pressed:bg-white/[0.13] aria-pressed:font-semibold aria-pressed:text-white aria-pressed:shadow-xs aria-pressed:ring-1 aria-pressed:ring-white/[0.22]",
        pick: "text-ui aria-pressed:border-primary aria-pressed:bg-tint border border-transparent",
        chip: "bg-secondary aria-pressed:border-primary aria-pressed:bg-tint aria-pressed:text-primary border border-transparent font-semibold tabular-nums data-[in-use=true]:shadow-[inset_0_-3px_0_var(--warn)]",
      },
      size: {
        default:
          "h-7 min-w-7 px-2 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 pointer-coarse:min-h-10",
        sm: "text-tag h-6 min-w-6 rounded-[min(var(--radius-md),8px)] px-2 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 pointer-coarse:min-h-10 [&_svg:not([class*='size-'])]:size-3",
        lg: "h-8 min-w-8 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 pointer-coarse:min-h-10",
        "icon-sm":
          "size-6 min-w-6 rounded-[min(var(--radius-md),8px)] px-0 pointer-coarse:size-10 pointer-coarse:min-w-10 [&_svg:not([class*='size-'])]:size-3",
        chip: "text-ui upright:min-h-7 upright:min-w-7 upright:px-1.5 upright:text-xs min-h-7.5 min-w-7.5 px-2 pointer-coarse:min-h-10 pointer-coarse:min-w-10",
      },
      tone: {
        neutral: "",
        ai: "aria-pressed:bg-ai/20 aria-pressed:text-ai-text aria-pressed:ring-ai/40",
        source: "aria-pressed:bg-primary/15 aria-pressed:text-primary aria-pressed:ring-primary/40",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      tone: "neutral",
    },
  },
);

function Toggle({
  className,
  variant = "default",
  size = "default",
  tone = "neutral",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      data-tone={tone}
      className={cn(toggleVariants({ variant, size, tone, className }))}
      {...props}
    />
  );
}

export { Toggle, toggleVariants };
