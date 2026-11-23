import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

const POPUP_MOTION =
  "transition-[opacity,scale] duration-160 ease-studio-out data-starting-style:opacity-0 data-starting-style:scale-[0.96] data-ending-style:opacity-0 data-ending-style:scale-[0.96] data-ending-style:duration-120 motion-reduce:transition-opacity motion-reduce:duration-100 motion-reduce:data-starting-style:scale-100 motion-reduce:data-ending-style:duration-100 motion-reduce:data-ending-style:scale-100";

const popoverContentVariants = cva(
  "bg-popover text-ui/normal text-popover-foreground ring-foreground/10 z-50 flex w-72 origin-(--transform-origin) flex-col rounded-lg border border-transparent shadow-md ring-1 outline-hidden forced-colors:border-[CanvasText]",
  {
    variants: {
      variant: { default: "gap-4 p-2.5", flush: "gap-0 overflow-hidden p-0" },
      motion: {
        default: POPUP_MOTION,
        instant: "transition-none",
        none: "transition-none",
        anchored: POPUP_MOTION,
      },
    },
    defaultVariants: { variant: "default", motion: "default" },
  },
);

function PopoverContent({
  className,
  variant = "default",
  motion = "default",
  align = "center",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<PopoverPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset"> &
  VariantProps<typeof popoverContentVariants>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <PopoverPrimitive.Popup
          finalFocus={(closedBy) => closedBy === "keyboard"}
          data-slot="popover-content"
          className={cn(popoverContentVariants({ variant, motion }), className)}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-1 text-xs", className)}
      {...props}
    />
  );
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn("text-sm font-medium", className)}
      {...props}
    />
  );
}

function PopoverDescription({ className, ...props }: PopoverPrimitive.Description.Props) {
  return (
    <PopoverPrimitive.Description
      data-slot="popover-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  );
}

export { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger };
