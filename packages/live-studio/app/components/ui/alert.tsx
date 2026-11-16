import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-md border border-s-2 px-2 py-1.5 text-start text-xs/relaxed has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pe-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-1.5 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default:
          "border-hairline-subtle border-s-hairline-strong bg-surface-subtle text-card-foreground",
        destructive:
          "border-destructive/20 border-s-destructive bg-destructive/12 text-destructive *:data-[slot=alert-description]:text-destructive/90 *:[svg]:text-current",
        open: "border-hairline-subtle border-s-primary/75 bg-surface-subtle text-label *:data-[slot=alert-description]:text-foreground/95 *:[svg]:text-primary-text",
        warn: "border-hairline-subtle border-s-warn/80 bg-surface-subtle text-warn-text *:data-[slot=alert-description]:text-foreground/90 *:[svg]:text-current",
        ok: "border-hairline-subtle border-s-ok/70 bg-surface-subtle/80 text-label *:data-[slot=alert-description]:text-foreground/80 *:[svg]:text-ok-text",
        ai: "bg-ai/[0.035] border-hairline-subtle border-s-ai/80 text-foreground *:data-[slot=alert-description]:text-foreground/90 *:[svg]:text-ai-text",
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

const alertDescriptionVariants = cva(
  "text-muted-foreground [&_a]:hover:text-foreground [&_a]:underline [&_a]:underline-offset-3 [&_p:not(:last-child)]:mb-4",
  {
    variants: {
      size: {
        default: "text-xs/relaxed text-balance md:text-pretty",
        ui: "text-ui/relaxed text-pretty",
        prose: "text-sm/relaxed text-pretty",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

function AlertDescription({
  className,
  size,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertDescriptionVariants>) {
  return (
    <div
      data-slot="alert-description"
      className={cn(alertDescriptionVariants({ size }), className)}
      {...props}
    />
  );
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="alert-action" className={cn("absolute end-2 top-1.5", className)} {...props} />
  );
}

export { Alert, AlertTitle, AlertDescription, AlertAction };
