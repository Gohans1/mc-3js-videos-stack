import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "group/button focus-visible:border-ring focus-visible:ring-ring/30 aria-invalid:border-destructive/50 aria-invalid:ring-destructive/40 inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-xs/relaxed font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,scale] duration-150 ease-out outline-none select-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 aria-disabled:opacity-50 aria-invalid:ring-2 motion-safe:enabled:active:not-aria-[haspopup]:scale-[0.96] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/85 font-semibold",
        outline:
          "border-border bg-input/30 hover:bg-input/50 hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary-hover aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted/50 hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        destructive:
          "bg-destructive/12 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/30",
        link: "text-primary underline-offset-4 hover:underline",
        // CapCut's grey tool button: lights white on hover, cyan on a tint while it is on (aria-pressed) or its menu is open
        quiet:
          "text-muted-foreground hover:bg-muted/50 hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground aria-pressed:bg-tint aria-pressed:text-primary aria-pressed:hover:text-primary data-popup-open:bg-tint data-popup-open:text-primary",
        tab: "text-muted-foreground hover:bg-muted/45 hover:text-foreground aria-expanded:bg-muted/60 aria-expanded:text-foreground aria-pressed:bg-card aria-pressed:text-primary aria-pressed:ring-primary/35 aria-pressed:hover:bg-card aria-pressed:hover:text-primary aria-pressed:shadow-xs aria-pressed:ring-1",
        remove: "text-muted-foreground hover:bg-destructive/15 hover:text-destructive",
        lit: "text-primary-text hover:bg-muted/50", // a quiet button whose thing is there now: a key at the playhead, the sound playing
        tool: "text-foreground/80 hover:bg-muted/50 hover:text-foreground aria-pressed:bg-tint aria-pressed:text-primary", // the bars over the picture
        picture: "text-picture hover:bg-hairline-strong", // an icon on the film itself
        scrim: "text-picture bg-scrim hover:bg-scrim-strong", // a chip on the film itself
        time: "bg-tint text-primary hover:bg-tint-hover font-mono font-semibold tabular-nums", // a note's time, which seeks there
        "in-out":
          "bg-in-out/18 text-in-out-text hover:bg-in-out/30 hover:text-foreground tabular-nums",
        hint: "bg-raised-2 text-foreground hover:bg-raised-3 data-popup-open:bg-tint data-popup-open:text-primary font-semibold", // the "?" beside an option
        favorite:
          "text-muted-foreground hover:bg-muted/50 hover:text-foreground aria-pressed:text-favorite", // CapCut's star, yellow when on
        "favorite-tile":
          "aria-pressed:text-favorite bg-scrim text-picture/90 hover:bg-scrim-strong rounded-full", // the star over an effect's picture
        "favorite-card":
          "bg-backdrop text-foreground/85 hover:bg-raised-3 hover:text-foreground aria-pressed:text-favorite rounded-full", // CapCut's round star well on an audio card
        "card-action":
          "bg-backdrop text-foreground/90 hover:bg-raised-3 hover:text-foreground rounded-full", // CapCut's round + well on an audio card
        cover:
          "bg-backdrop text-foreground/85 hover:bg-raised-3 hover:text-foreground aria-pressed:bg-tint aria-pressed:text-primary-text aria-pressed:hover:bg-tint aria-pressed:hover:text-primary-text aria-pressed:ring-primary rounded-md aria-pressed:ring-1", // CapCut's 36px audio cover tile
        approve: "bg-warn hover:bg-warn/85 text-warn-foreground font-semibold", // the creator's yes to a fix waiting in yellow (To check)
        warn: "border-warn/65 bg-warn-bg/90 text-warn hover:border-warn hover:bg-warn-bg border",
        choice:
          "bg-secondary text-secondary-foreground hover:bg-raised-4 aria-pressed:bg-tint aria-pressed:text-primary-text aria-pressed:hover:bg-tint", // one of a list, picked
      },
      size: {
        default:
          "h-7 gap-1 px-2 text-xs/relaxed has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        xs: "h-5 gap-1 rounded-sm px-2 text-[0.625rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-2.5",
        sm: "h-6 gap-1 px-2 text-xs/relaxed has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        pill: "text-tag h-6 gap-1 rounded-full px-2 [&_svg:not([class*='size-'])]:size-3",
        lg: "h-8 gap-1 px-2.5 text-xs/relaxed has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-4",
        icon: "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-xs": "size-5 rounded-sm [&_svg:not([class*='size-'])]:size-2.5",
        "icon-sm": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-lg": "size-8 [&_svg:not([class*='size-'])]:size-4",
        cover: "size-9 pointer-coarse:size-10 [&_svg:not([class*='size-'])]:size-4",
        filter: "h-8 gap-0.5 px-1.5 pointer-coarse:h-10 [&_svg:not([class*='size-'])]:size-4", // CapCut's funnel + chevron beside search
        // CapCut's 32 px button with its 13 px words; a finger gets 40 px
        md: "text-ui h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 pointer-coarse:h-10 pointer-coarse:text-sm [&_svg:not([class*='size-'])]:size-4",
        xl: "h-11 gap-1.5 px-5 text-sm font-semibold [&_svg:not([class*='size-'])]:size-4", // the note sheet's Save and Cancel
        inline: "text-ui h-auto p-0", // a link inside a sentence
        hint: "size-5 rounded-full text-xs leading-none",
        chip: "text-ui upright:min-h-7 upright:text-xs min-h-7.5 px-2 font-semibold", // beside the option chips on the picture
        row: "h-auto min-h-9 justify-between gap-2 px-2.5 text-left text-sm font-normal whitespace-normal", // a line in a list of choices
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

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
  );
}

export { Button, buttonVariants };
