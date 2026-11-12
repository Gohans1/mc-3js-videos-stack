import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "group/badge focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-[0.625rem] font-medium whitespace-nowrap transition-all focus-visible:ring-[3px] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:pointer-events-none [&>svg]:size-2.5!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary: "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        outline:
          "border-border bg-input/20 text-foreground dark:bg-input/30 [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost: "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
        audio: "bg-clip-audio-tag text-clip-label",
        voice: "bg-clip-voice-tag text-clip-label",
        synth: "bg-in-out/18 text-in-out-text h-4 rounded-sm px-1 py-0 font-mono leading-none",
        claim: "bg-warn-bg text-warn h-4 rounded-sm px-1 py-0 font-mono leading-none",
        tag: "bg-secondary/80 text-tag text-label h-auto shrink rounded-md px-1.5 py-0.5 font-medium",
        inOut:
          "bg-in-out/18 text-tag text-in-out-text h-auto rounded-md px-1.5 py-0.5 font-mono tabular-nums",
        ink: "bg-ink/15 text-tag text-ink h-auto shrink rounded-md px-1.5 py-0.5 whitespace-normal",
        alarm:
          "bg-alarm text-picture h-auto rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums",
        snapshot:
          "bg-primary text-primary-foreground h-auto rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props,
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  });
}

export { Badge, badgeVariants };
