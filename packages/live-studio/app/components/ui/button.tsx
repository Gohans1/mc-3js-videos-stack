import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "group/button focus-visible:border-ring focus-visible:ring-ring aria-invalid:border-destructive/50 aria-invalid:ring-destructive/40 ease-studio-out inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-xs/relaxed font-medium whitespace-nowrap transition-[color,background-color,border-color,scale] duration-150 outline-none select-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 aria-disabled:opacity-50 aria-invalid:ring-2 motion-safe:enabled:not-aria-disabled:active:not-aria-[haspopup]:scale-[0.96] motion-reduce:transition-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground not-aria-disabled:hover:bg-primary/85 disabled:border-primary/40 disabled:bg-primary/20 disabled:text-foreground/75 aria-disabled:border-primary/40 aria-disabled:bg-primary/20 aria-disabled:text-foreground/75 font-semibold disabled:opacity-100 aria-disabled:opacity-100",
        outline:
          "border-input bg-backdrop/60 hover:bg-muted/50 hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary-hover aria-expanded:bg-secondary aria-expanded:text-secondary-foreground disabled:text-muted-foreground disabled:border-hairline-subtle disabled:bg-surface-subtle disabled:opacity-100",
        subtle:
          "text-foreground/90 aria-expanded:text-foreground aria-pressed:text-foreground disabled:text-muted-foreground aria-disabled:text-muted-foreground not-aria-disabled:hover:text-foreground border-hairline-strong bg-hairline-subtle not-aria-disabled:hover:border-hairline-strong not-aria-disabled:hover:bg-hairline disabled:border-hairline aria-disabled:border-hairline aria-expanded:border-hairline-strong aria-expanded:bg-hairline aria-pressed:border-hairline-strong aria-pressed:bg-hairline disabled:border-dashed disabled:bg-transparent disabled:opacity-100 aria-disabled:border-dashed aria-disabled:bg-transparent aria-disabled:opacity-100 disabled:[&_svg]:opacity-50 aria-disabled:[&_svg]:opacity-50",
        ghost:
          "text-label hover:bg-muted/50 hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        destructive: "bg-destructive/12 text-destructive hover:bg-destructive/20",
        link: "text-primary-text underline-offset-4 hover:underline",
        // Tool button: lights foreground on hover, Flexoki blue on a tint while it is on (aria-pressed) or its menu is open
        quiet:
          "text-muted-foreground hover:bg-muted/50 hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground aria-pressed:bg-tint aria-pressed:text-primary-text aria-pressed:hover:bg-tint aria-pressed:hover:text-primary-text data-popup-open:bg-tint data-popup-open:text-primary-text",
        tab: "text-muted-foreground hover:text-foreground aria-expanded:text-foreground focus-visible:ring-ring hover:bg-surface-subtle aria-expanded:bg-hairline-subtle aria-pressed:bg-secondary aria-pressed:text-foreground aria-pressed:ring-hairline-strong aria-pressed:hover:bg-secondary-hover aria-pressed:hover:text-foreground focus-visible:border-transparent focus-visible:ring-2 aria-pressed:font-semibold aria-pressed:shadow-xs aria-pressed:ring-1",
        remove: "text-muted-foreground hover:bg-destructive/15 hover:text-destructive",
        "remove-chip":
          "text-muted-foreground hover:bg-destructive/15 hover:text-destructive border-hairline rounded-none border-s",
        lit: "text-primary-text border-hairline bg-surface-subtle hover:bg-hairline", // a control whose item is active right now
        tool: "text-foreground/80 hover:bg-muted/50 hover:text-foreground aria-pressed:bg-tint aria-pressed:text-primary-text", // the bars over the picture
        picture: "text-picture hover:bg-hairline-strong", // an icon on the film itself
        scrim: "text-picture bg-scrim hover:bg-scrim-strong", // a chip on the film itself
        time: "text-label hover:border-primary/40 hover:bg-primary/10 hover:text-primary-text border-hairline bg-surface-subtle font-mono font-medium tabular-nums", // a note's time, which seeks there
        "in-out":
          "bg-in-out/18 text-in-out-text hover:bg-in-out/30 hover:text-foreground tabular-nums",
        hint: "bg-raised-2 text-foreground hover:bg-raised-3 data-popup-open:bg-tint data-popup-open:text-primary-text font-semibold", // the "?" beside an option
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
        approve:
          "border-warn/45 bg-warn/16 text-warn-text not-aria-disabled:hover:border-warn/75 not-aria-disabled:hover:bg-warn/25 disabled:text-muted-foreground aria-disabled:text-muted-foreground disabled:border-hairline disabled:bg-surface-subtle aria-disabled:border-hairline aria-disabled:bg-surface-subtle font-semibold disabled:opacity-100 aria-disabled:opacity-100", // refined Linear obsidian-gold approval CTA
        ai: "border-ai/45 bg-ai/16 text-ai-text not-aria-disabled:hover:border-ai/75 not-aria-disabled:hover:bg-ai/25 disabled:text-muted-foreground aria-disabled:text-muted-foreground disabled:border-hairline disabled:bg-surface-subtle aria-disabled:border-hairline aria-disabled:bg-surface-subtle font-semibold disabled:opacity-100 aria-disabled:opacity-100", // refined Linear lavender answer CTA
        warn: "border-warn/45 bg-warn-bg/70 text-warn-text hover:border-warn hover:bg-warn-bg border",
        choice:
          "bg-secondary text-secondary-foreground hover:bg-raised-4 aria-pressed:bg-tint aria-pressed:text-primary-text aria-pressed:hover:bg-tint", // one of a list, picked
      },
      size: {
        comfortable:
          "h-9 gap-1.5 px-2 text-sm leading-normal pointer-coarse:h-11 [&_svg:not([class*='size-'])]:size-4",
        default:
          "h-7 gap-1 px-2 text-xs/relaxed has-data-[icon=inline-end]:pe-1.5 has-data-[icon=inline-start]:ps-1.5 pointer-coarse:h-10 [&_svg:not([class*='size-'])]:size-3.5",
        tab: "text-ui/relaxed h-7 gap-1 px-2 has-data-[icon=inline-end]:pe-1.5 has-data-[icon=inline-start]:ps-1.5 pointer-coarse:h-10 [&_svg:not([class*='size-'])]:size-3.5",
        xs: "h-6 min-h-6 gap-1 rounded-sm px-2 text-xs has-data-[icon=inline-end]:pe-1.5 has-data-[icon=inline-start]:ps-1.5 pointer-coarse:h-10 [&_svg:not([class*='size-'])]:size-2.5",
        sm: "h-6 gap-1 px-2 text-xs/relaxed has-data-[icon=inline-end]:pe-1.5 has-data-[icon=inline-start]:ps-1.5 pointer-coarse:h-10 [&_svg:not([class*='size-'])]:size-3",
        pill: "h-6 gap-1 rounded-full px-2 text-xs pointer-coarse:h-10 [&_svg:not([class*='size-'])]:size-3",
        lg: "h-8 gap-1 px-2.5 text-xs/relaxed has-data-[icon=inline-end]:pe-2 has-data-[icon=inline-start]:ps-2 pointer-coarse:h-10 [&_svg:not([class*='size-'])]:size-4",
        icon: "size-7 pointer-coarse:size-10 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-xs":
          "size-6 rounded-sm pointer-coarse:size-10 [&_svg:not([class*='size-'])]:size-2.5",
        "icon-sm": "size-6 pointer-coarse:size-10 [&_svg:not([class*='size-'])]:size-3",
        "icon-lg": "size-8 pointer-coarse:size-10 [&_svg:not([class*='size-'])]:size-4",
        cover: "size-9 pointer-coarse:size-10 [&_svg:not([class*='size-'])]:size-4",
        filter: "h-8 gap-0.5 px-1.5 pointer-coarse:h-10 [&_svg:not([class*='size-'])]:size-4", // CapCut's funnel + chevron beside search
        // CapCut's 32 px button with its 13 px words; a finger gets 40 px
        md: "text-ui h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pe-2 has-data-[icon=inline-start]:ps-2 pointer-coarse:h-10 pointer-coarse:text-sm [&_svg:not([class*='size-'])]:size-4",
        xl: "h-11 gap-1.5 px-5 text-sm font-semibold [&_svg:not([class*='size-'])]:size-4", // the note sheet's Save and Cancel
        inline: "text-ui h-auto p-0", // a link inside a sentence
        hint: "size-5 rounded-full text-xs leading-none pointer-coarse:size-10",
        chip: "text-ui upright:min-h-7 upright:text-xs upright:pointer-coarse:min-h-10 min-h-7.5 px-2 font-semibold pointer-coarse:min-h-10", // beside the option chips on the picture
        row: "h-auto min-h-9 justify-between gap-2 px-2.5 text-start text-sm font-normal whitespace-normal", // a line in a list of choices
        "phone-xs":
          "relative h-6.5 gap-1 rounded px-2 text-xs after:absolute after:inset-x-0 after:-inset-y-1 [&_svg:not([class*='size-'])]:size-3",
        "phone-icon":
          "relative size-6.5 rounded after:absolute after:-inset-x-0.5 after:-inset-y-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        "phone-bar": "size-8 rounded-md [&_svg:not([class*='size-'])]:size-4",
        "phone-cta":
          "h-8.5 gap-1.5 rounded-lg px-4 text-sm font-semibold [&_svg:not([class*='size-'])]:size-3.5",
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
