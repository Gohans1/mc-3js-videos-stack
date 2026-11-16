import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "group/button focus-visible:border-ring focus-visible:ring-ring/30 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-xs/relaxed font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,scale] duration-150 ease-out outline-none select-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 aria-disabled:opacity-50 aria-invalid:ring-2 motion-safe:enabled:not-aria-disabled:active:not-aria-[haspopup]:scale-[0.96] motion-reduce:transition-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground not-aria-disabled:hover:bg-primary/85 disabled:border-primary/25 disabled:bg-primary/12 disabled:text-muted-foreground aria-disabled:border-primary/25 aria-disabled:bg-primary/12 aria-disabled:text-muted-foreground font-semibold disabled:opacity-100 aria-disabled:opacity-100",
        outline:
          "border-border hover:bg-input/50 hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:bg-input/30",
        secondary:
          "bg-secondary text-secondary-foreground aria-expanded:bg-secondary aria-expanded:text-secondary-foreground disabled:text-muted-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] disabled:border-white/[0.06] disabled:bg-white/[0.02] disabled:opacity-100",
        subtle:
          "text-foreground/90 aria-expanded:text-foreground aria-pressed:text-foreground disabled:text-muted-foreground aria-disabled:text-muted-foreground not-aria-disabled:hover:text-foreground border-white/[0.15] bg-white/[0.06] not-aria-disabled:hover:border-white/[0.22] not-aria-disabled:hover:bg-white/[0.10] disabled:border-dashed disabled:border-white/[0.10] disabled:bg-transparent disabled:opacity-100 aria-disabled:border-dashed aria-disabled:border-white/[0.10] aria-disabled:bg-transparent aria-disabled:opacity-100 aria-expanded:border-white/[0.22] aria-expanded:bg-white/[0.10] aria-pressed:border-white/[0.20] aria-pressed:bg-white/[0.10] disabled:[&_svg]:opacity-50 aria-disabled:[&_svg]:opacity-50",
        ghost:
          "text-label hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive-text hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
        // CapCut's grey tool button: lights white on hover, cyan on a tint while it is on (aria-pressed) or its menu is open
        quiet:
          "text-muted-foreground hover:bg-muted/50 hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground aria-pressed:bg-tint aria-pressed:text-primary aria-pressed:hover:text-primary data-popup-open:bg-tint data-popup-open:text-primary",
        tab: "text-muted-foreground hover:text-foreground aria-expanded:text-foreground focus-visible:ring-ring hover:bg-white/[0.04] focus-visible:border-transparent focus-visible:ring-2 aria-expanded:bg-white/[0.06] aria-pressed:bg-white/[0.13] aria-pressed:font-semibold aria-pressed:text-white aria-pressed:shadow-xs aria-pressed:ring-1 aria-pressed:ring-white/[0.22] aria-pressed:hover:bg-white/[0.16] aria-pressed:hover:text-white",
        remove: "text-muted-foreground hover:bg-destructive/15 hover:text-destructive-text",
        "remove-chip":
          "text-muted-foreground hover:bg-destructive/15 hover:text-destructive-text rounded-none border-s border-white/[0.08]",
        lit: "text-primary border-white/[0.12] bg-white/[0.05] hover:bg-white/[0.08]", // a control whose item is active right now
        tool: "text-foreground/80 hover:bg-muted/50 hover:text-foreground aria-pressed:bg-tint aria-pressed:text-primary", // the bars over the picture
        picture: "text-picture hover:bg-white/15", // an icon on the film itself
        scrim: "text-picture bg-black/70 hover:bg-black/85", // a chip on the film itself
        time: "text-label hover:border-primary/40 hover:bg-primary/10 hover:text-primary border-white/[0.08] bg-white/[0.04] font-mono font-medium tabular-nums", // a note's time, which seeks there
        "in-out":
          "bg-in-out/18 text-in-out-text hover:bg-in-out/30 hover:text-foreground tabular-nums",
        hint: "bg-raised-2 text-foreground hover:bg-raised-3 data-popup-open:bg-tint data-popup-open:text-primary font-semibold", // the "?" beside an option
        favorite:
          "text-muted-foreground hover:bg-muted/50 hover:text-foreground aria-pressed:text-favorite", // CapCut's star, yellow when on
        "favorite-tile":
          "aria-pressed:text-favorite rounded-full bg-black/55 text-white/90 hover:bg-black/70", // the star over an effect's picture
        "favorite-card":
          "bg-backdrop text-foreground/85 hover:bg-raised-3 hover:text-foreground aria-pressed:text-favorite rounded-full", // CapCut's round star well on an audio card
        "card-action":
          "bg-backdrop text-foreground/90 hover:bg-raised-3 hover:text-foreground rounded-full", // CapCut's round + well on an audio card
        cover:
          "bg-backdrop text-foreground/85 hover:bg-raised-3 hover:text-foreground aria-pressed:bg-tint aria-pressed:text-primary aria-pressed:ring-primary rounded-md aria-pressed:ring-1", // CapCut's 36px audio cover tile
        approve:
          "border-warn/45 bg-warn/16 text-warn-text not-aria-disabled:hover:border-warn/75 not-aria-disabled:hover:bg-warn/25 disabled:text-muted-foreground aria-disabled:text-muted-foreground font-semibold disabled:border-white/10 disabled:bg-white/[0.05] disabled:opacity-100 aria-disabled:border-white/10 aria-disabled:bg-white/[0.05] aria-disabled:opacity-100", // refined Linear obsidian-gold approval CTA
        ai: "border-ai/45 bg-ai/16 text-ai-text not-aria-disabled:hover:border-ai/75 not-aria-disabled:hover:bg-ai/25 disabled:text-muted-foreground aria-disabled:text-muted-foreground font-semibold disabled:border-white/10 disabled:bg-white/[0.05] disabled:opacity-100 aria-disabled:border-white/10 aria-disabled:bg-white/[0.05] aria-disabled:opacity-100", // refined Linear lavender answer CTA
        warn: "border-warn/45 bg-warn-bg/70 text-warn-text hover:border-warn hover:bg-warn-bg border",
        choice:
          "bg-secondary text-secondary-foreground hover:bg-raised-4 aria-pressed:bg-tint aria-pressed:text-primary", // one of a list, picked
      },
      size: {
        default:
          "h-7 gap-1 px-2 text-xs/relaxed has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 pointer-coarse:h-10 [&_svg:not([class*='size-'])]:size-3.5",
        xs: "h-6 min-h-6 gap-1 rounded-sm px-2 text-[0.625rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 pointer-coarse:h-10 [&_svg:not([class*='size-'])]:size-2.5",
        sm: "h-6 gap-1 px-2 text-xs/relaxed has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 pointer-coarse:h-10 [&_svg:not([class*='size-'])]:size-3",
        pill: "text-tag h-6 gap-1 rounded-full px-2 pointer-coarse:h-10 [&_svg:not([class*='size-'])]:size-3",
        lg: "h-8 gap-1 px-2.5 text-xs/relaxed has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 pointer-coarse:h-10 [&_svg:not([class*='size-'])]:size-4",
        icon: "size-7 pointer-coarse:size-10 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-xs":
          "size-6 rounded-sm pointer-coarse:size-10 [&_svg:not([class*='size-'])]:size-2.5",
        "icon-sm": "size-6 pointer-coarse:size-10 [&_svg:not([class*='size-'])]:size-3",
        "icon-lg": "size-8 pointer-coarse:size-10 [&_svg:not([class*='size-'])]:size-4",
        cover: "size-9 pointer-coarse:size-10 [&_svg:not([class*='size-'])]:size-4",
        filter: "h-8 gap-0.5 px-1.5 pointer-coarse:h-10 [&_svg:not([class*='size-'])]:size-4", // CapCut's funnel + chevron beside search
        // CapCut's 32 px button with its 13 px words; a finger gets 40 px
        md: "text-ui h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 pointer-coarse:h-10 pointer-coarse:text-sm [&_svg:not([class*='size-'])]:size-4",
        xl: "h-11 gap-1.5 px-5 text-sm font-semibold [&_svg:not([class*='size-'])]:size-4", // the note sheet's Save and Cancel
        inline: "text-ui h-auto p-0", // a link inside a sentence
        hint: "size-5 rounded-full text-xs leading-none pointer-coarse:size-10",
        chip: "text-ui upright:min-h-7 upright:text-xs upright:pointer-coarse:min-h-10 min-h-7.5 px-2 font-semibold pointer-coarse:min-h-10", // beside the option chips on the picture
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
