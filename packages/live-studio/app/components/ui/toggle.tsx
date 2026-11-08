import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const toggleVariants = cva(
  "group/toggle inline-flex items-center justify-center gap-1 rounded-md text-xs font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,scale] duration-150 ease-out outline-none motion-safe:enabled:active:scale-[0.96] hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 aria-pressed:bg-muted data-[state=on]:bg-muted dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border border-input bg-transparent hover:bg-muted",
        quiet: "text-muted-foreground aria-pressed:text-foreground",
        "quiet-primary": "text-muted-foreground aria-pressed:text-primary",
        "quiet-warn": "text-muted-foreground aria-pressed:text-warn",
        segment: "text-sm text-muted-foreground tabular-nums aria-pressed:font-semibold aria-pressed:text-foreground",
        pick: "border border-transparent text-ui aria-pressed:border-primary aria-pressed:bg-tint",
        chip: "border border-transparent bg-secondary font-semibold tabular-nums aria-pressed:border-primary aria-pressed:bg-tint aria-pressed:text-primary data-[in-use=true]:shadow-[inset_0_-3px_0_var(--warn)]",
      },
      size: {
        default:
          "h-7 min-w-7 px-2 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5",
        sm: "h-6 min-w-6 rounded-[min(var(--radius-md),8px)] px-2 text-[0.625rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        lg: "h-8 min-w-8 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        "icon-sm": "size-6 min-w-6 rounded-[min(var(--radius-md),8px)] px-0 [&_svg:not([class*='size-'])]:size-3",
        chip: "min-h-7.5 min-w-7.5 px-2 text-ui upright:min-h-7 upright:min-w-7 upright:px-1.5 upright:text-xs",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
