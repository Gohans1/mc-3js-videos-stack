import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { cva, type VariantProps } from "class-variance-authority";
import { Check, Minus } from "lucide-react";

import { cn } from "@/lib/utils";

const checkboxVariants = cva(
  "peer bg-raised-4 text-primary-foreground focus-visible:ring-ring focus-visible:ring-offset-background data-checked:bg-primary data-indeterminate:bg-primary grid shrink-0 place-items-center outline-none focus-visible:ring-2 focus-visible:ring-offset-2 in-disabled:pointer-events-none in-disabled:opacity-50 data-disabled:cursor-not-allowed data-disabled:opacity-50 pointer-coarse:size-5",
  {
    variants: {
      size: {
        default: "size-4 rounded-xs [&_svg]:size-3",
        sm: "size-3 rounded-xs [&_svg]:size-2.5",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

function Checkbox({
  className,
  size = "default",
  indeterminate,
  ...props
}: CheckboxPrimitive.Root.Props & VariantProps<typeof checkboxVariants>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      indeterminate={indeterminate}
      className={cn(checkboxVariants({ size }), className)}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-items-center text-current"
      >
        {indeterminate ? <Minus strokeWidth={3} /> : <Check strokeWidth={3} />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox, checkboxVariants };
