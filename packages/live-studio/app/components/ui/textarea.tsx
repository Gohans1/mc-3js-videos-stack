import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const textareaVariants = cva(
  "placeholder:text-muted-foreground focus-visible:border-ring aria-invalid:border-destructive/50 aria-invalid:ring-destructive/40 flex field-sizing-content min-h-16 w-full resize-none rounded-md border transition-colors outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-2 motion-reduce:transition-none",
  {
    variants: {
      variant: {
        default:
          "border-input bg-backdrop text-ui/relaxed focus-visible:ring-ring/30 phone:text-[16px] px-2 py-2 focus-visible:ring-2 pointer-coarse:text-base",
        note: "font-md bg-backdrop/85 text-title/[1.6] border-input focus-visible:border-primary/70 focus-visible:ring-primary/30 sideways:px-2 sideways:py-1.5 phone:text-[16px] px-2.5 py-2 focus-visible:ring-1 pointer-coarse:text-base",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Textarea({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"textarea"> & VariantProps<typeof textareaVariants>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(textareaVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Textarea, textareaVariants };
