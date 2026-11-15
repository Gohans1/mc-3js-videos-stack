import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "group/badge focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive/50 aria-invalid:ring-destructive/40 inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-[0.625rem] font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow] focus-visible:ring-[3px] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 motion-reduce:transition-none [&>svg]:pointer-events-none [&>svg]:size-2.5!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary: "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/12 text-destructive focus-visible:ring-destructive/30 [a]:hover:bg-destructive/20",
        outline:
          "border-input bg-backdrop/60 text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost: "hover:bg-muted/50 hover:text-muted-foreground",
        link: "text-primary-text underline-offset-4 hover:underline",
        audio: "bg-clip-audio-tag text-clip-label",
        voice: "bg-clip-voice-tag text-clip-label",
        synth: "bg-in-out/18 text-in-out-text h-4 rounded-sm px-1 py-0 font-mono leading-none",
        claim: "bg-warn-bg text-warn-text h-4 rounded-sm px-1 py-0 font-mono leading-none",
        tag: "border-hairline bg-surface-subtle text-tag text-label [button]:hover:bg-hairline [button]:hover:text-foreground h-auto shrink rounded-md px-1.5 py-0.5 font-medium [button]:cursor-pointer",
        refs: "border-hairline bg-surface-subtle hover:border-hairline-strong hover:bg-hairline text-tag text-label hover:text-foreground h-auto min-h-6 shrink cursor-pointer rounded-md px-2 py-0.5 font-medium pointer-coarse:min-h-10",
        inOut:
          "border-in-out/25 bg-in-out/14 text-tag text-in-out-text h-auto rounded-md px-1.5 py-0.5 font-mono tabular-nums",
        ink: "border-ink/25 bg-ink/12 text-tag text-ink-text h-auto shrink rounded-md px-1.5 py-0.5 whitespace-normal",
        alarm:
          "bg-alarm text-picture h-auto rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums",
        snapshot:
          "bg-primary text-primary-foreground h-auto rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums",
        open: "border-primary/25 bg-primary/10 text-primary-text text-tag h-auto px-1.5 py-0.5 font-medium [&>svg]:size-3!",
        check:
          "border-warn/30 bg-warn/10 text-warn-text text-tag h-auto px-1.5 py-0.5 font-medium [&>svg]:size-3!",
        done: "border-ok/25 bg-ok/10 text-ok-text text-tag h-auto px-1.5 py-0.5 font-medium [&>svg]:size-3!",
        ai: "border-ai/28 bg-ai/12 text-ai-text text-tag h-auto px-1.5 py-0.5 font-medium [&>svg]:size-3!",
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
