import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const inputVariants = cva(
  "border-input bg-input text-ui text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring w-full min-w-0 rounded-md border outline-none focus-visible:ring-1 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:text-[16px]",
  {
    variants: {
      variant: {
        default: "",
        numeric:
          "[appearance:textfield] tabular-nums [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
        scrub: "cursor-ew-resize tabular-nums focus:cursor-text",
        value: "bg-background cursor-ew-resize text-start tabular-nums focus:cursor-text",
        wheel:
          "grade-wheel-value cursor-ew-resize rounded-none border-0 text-center text-xs tabular-nums focus:cursor-text",
        title: "font-semibold",
      },
      size: {
        default: "h-8 px-2 pointer-coarse:h-10 pointer-coarse:text-base",
        tight: "h-8 px-1.5 pointer-coarse:h-10 pointer-coarse:text-base",
        xsTight: "h-8 px-1 pointer-coarse:h-10 pointer-coarse:text-base",
        search: "h-8 ps-8.5 pe-2.5 pointer-coarse:h-10 pointer-coarse:text-base",
        sm: "h-7 px-2",
        smUnit: "h-7 ps-2 pe-7",
        xs: "h-6 px-2 text-xs",
        xsUnit: "h-6 ps-2 pe-7 text-xs",
        wheel: "h-5 px-0.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Input({
  className,
  variant = "default",
  size = "default",
  ...props
}: Omit<React.ComponentProps<"input">, "size"> & VariantProps<typeof inputVariants>) {
  return (
    <input
      data-slot="input"
      className={cn(inputVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Input, inputVariants };
