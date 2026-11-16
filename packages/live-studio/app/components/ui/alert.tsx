import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-md border border-s-2 px-2 py-1.5 text-left text-xs/relaxed has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-1.5 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default: "text-card-foreground border-white/[0.06] border-s-white/[0.14] bg-white/[0.025]",
        destructive:
          "border-destructive/20 border-s-destructive bg-destructive/10 text-destructive-text *:data-[slot=alert-description]:text-destructive-text/90 *:[svg]:text-current",
        open: "text-label border-s-primary/75 *:data-[slot=alert-description]:text-foreground/95 *:[svg]:text-primary border-white/[0.06] bg-white/[0.025]",
        warn: "text-warn-text border-s-warn/80 *:data-[slot=alert-description]:text-foreground/90 border-white/[0.06] bg-white/[0.025] *:[svg]:text-current",
        ok: "text-label border-s-ok/70 *:data-[slot=alert-description]:text-foreground/80 *:[svg]:text-ok-text border-white/[0.06] bg-white/[0.02]",
        ai: "bg-ai/[0.035] text-foreground border-s-ai/80 *:data-[slot=alert-description]:text-foreground/90 *:[svg]:text-ai-text border-white/[0.06]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "[&_a]:hover:text-foreground font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3",
        className,
      )}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-muted-foreground [&_a]:hover:text-foreground text-xs/relaxed text-balance md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_p:not(:last-child)]:mb-4",
        className,
      )}
      {...props}
    />
  );
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("absolute top-1.5 right-2", className)}
      {...props}
    />
  );
}

export { Alert, AlertTitle, AlertDescription, AlertAction };
