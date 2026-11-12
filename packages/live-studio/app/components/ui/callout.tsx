import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const calloutVariants = cva("flex rounded-lg", {
  variants: {
    variant: {
      warn: "bg-warn-bg text-ui text-warn items-center gap-2 px-2.5 py-1.5 [&>svg]:size-4 [&>svg]:shrink-0",
      ok: "border-ok/25 bg-ok/10 text-label [&>svg]:text-ok items-start gap-1.5 border px-2 py-1.5 text-xs leading-relaxed [&>svg]:mt-0.5 [&>svg]:size-3.5 [&>svg]:shrink-0",
    },
  },
  defaultVariants: {
    variant: "warn",
  },
});

function Callout({
  className,
  variant = "warn",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof calloutVariants>) {
  return (
    <div
      data-slot="callout"
      data-variant={variant}
      className={cn(calloutVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Callout, calloutVariants };
