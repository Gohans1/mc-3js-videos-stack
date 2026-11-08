import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-xs/relaxed font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,scale] duration-150 ease-out outline-none select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 motion-safe:enabled:active:not-aria-[haspopup]:scale-[0.96] disabled:pointer-events-none disabled:opacity-50 aria-disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline:
          "border-border hover:bg-input/50 hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:bg-input/30",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
        // CapCut's grey tool button: lights white on hover, cyan on a tint while it is on (aria-pressed) or its menu is open
        quiet:
          "text-muted-foreground hover:bg-muted/50 hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground aria-pressed:bg-tint aria-pressed:text-primary aria-pressed:hover:text-primary data-popup-open:bg-tint data-popup-open:text-primary",
        remove: "text-muted-foreground hover:bg-muted/50 hover:text-destructive",
        lit: "text-primary hover:bg-muted/50", // a quiet button whose thing is there now: a key at the playhead, the sound playing
        tool: "text-foreground/80 hover:bg-muted/50 hover:text-foreground aria-pressed:bg-tint aria-pressed:text-primary", // the bars over the picture
        picture: "text-picture hover:bg-white/15", // an icon on the film itself
        scrim: "bg-black/70 text-picture hover:bg-black/85", // a chip on the film itself
        time: "bg-tint font-mono font-semibold text-primary tabular-nums hover:bg-tint-hover", // a note's time, which seeks there
        "in-out": "bg-in-out/18 text-in-out-text tabular-nums hover:bg-in-out/30 hover:text-foreground",
        hint: "bg-raised-2 font-semibold text-foreground hover:bg-raised-3 data-popup-open:bg-tint data-popup-open:text-primary", // the "?" beside an option
        favorite: "text-muted-foreground hover:bg-muted/50 hover:text-foreground aria-pressed:text-favorite", // CapCut's star, yellow when on
        "favorite-tile": "rounded-full bg-black/55 text-white/90 hover:bg-black/70 aria-pressed:text-favorite", // the star over an effect's picture
        choice: "bg-secondary text-secondary-foreground hover:bg-raised-4 aria-pressed:bg-tint aria-pressed:text-primary", // one of a list, picked
      },
      size: {
        default:
          "h-7 gap-1 px-2 text-xs/relaxed has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        xs: "h-5 gap-1 rounded-sm px-2 text-[0.625rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-2.5",
        sm: "h-6 gap-1 px-2 text-xs/relaxed has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        lg: "h-8 gap-1 px-2.5 text-xs/relaxed has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-4",
        icon: "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-xs": "size-5 rounded-sm [&_svg:not([class*='size-'])]:size-2.5",
        "icon-sm": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-lg": "size-8 [&_svg:not([class*='size-'])]:size-4",
        // CapCut's 32 px button with its 13 px words; a finger gets 40 px
        md: "h-8 gap-1.5 px-2.5 text-ui has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 pointer-coarse:h-10 pointer-coarse:text-sm [&_svg:not([class*='size-'])]:size-4",
        xl: "h-11 gap-1.5 px-5 text-sm font-semibold [&_svg:not([class*='size-'])]:size-4", // the note sheet's Save and Cancel
        inline: "h-auto p-0 text-ui", // a link inside a sentence
        hint: "size-5 rounded-full text-xs leading-none",
        chip: "min-h-7.5 px-2 text-ui font-semibold upright:min-h-7 upright:text-xs", // beside the option chips on the picture
        row: "h-auto min-h-9 justify-between gap-2 px-2.5 text-left text-sm font-normal whitespace-normal", // a line in a list of choices
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
