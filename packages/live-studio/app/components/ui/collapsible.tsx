"use client";

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

function Collapsible({ ...props }: CollapsiblePrimitive.Root.Props) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

function CollapsibleTrigger({ ...props }: CollapsiblePrimitive.Trigger.Props) {
  return <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />;
}

const contentVariants = cva("", {
  variants: { variant: { default: "", reveal: "cli-reveal" } },
  defaultVariants: { variant: "default" },
});

function CollapsibleContent({
  variant,
  className,
  ...props
}: CollapsiblePrimitive.Panel.Props & VariantProps<typeof contentVariants>) {
  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-content"
      className={cn(contentVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
