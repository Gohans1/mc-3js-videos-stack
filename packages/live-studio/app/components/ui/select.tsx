"use client";

import { Select as SelectPrimitive } from "@base-ui/react/select";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

const Select = SelectPrimitive.Root;

function SelectGroup({ className, ...props }: SelectPrimitive.Group.Props) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("scroll-my-1 p-1", className)}
      {...props}
    />
  );
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("flex flex-1 text-left", className)}
      {...props}
    />
  );
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: SelectPrimitive.Trigger.Props & {
  size?: "sm" | "default" | "readable" | "comfortable";
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "group/select-trigger border-input bg-backdrop/75 hover:border-control-border hover:bg-backdrop data-popup-open:border-ring/70 data-popup-open:bg-backdrop text-ui/relaxed focus-visible:border-ring focus-visible:ring-ring/30 aria-invalid:border-destructive/50 aria-invalid:ring-destructive/40 data-placeholder:text-muted-foreground flex w-fit items-center justify-between gap-1.5 rounded-md border px-2 py-1.5 whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-2 data-[size=default]:h-7 data-[size=sm]:h-6 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 motion-reduce:transition-none pointer-coarse:min-h-10 pointer-coarse:data-[size=default]:h-10 pointer-coarse:data-[size=sm]:h-10 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        size === "readable" && "focus-visible:ring-ring h-9 text-sm focus-visible:ring-inset",
        size === "comfortable" && "h-9 text-base leading-normal sm:text-sm pointer-coarse:h-11",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        render={
          <ChevronDownIcon className="text-muted-foreground ease-studio-out group-hover/select-trigger:text-foreground group-data-popup-open/select-trigger:text-foreground pointer-events-none size-3.5 transition-transform duration-160 group-data-popup-open/select-trigger:rotate-180 motion-reduce:transition-none" />
        }
      />
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  alignItemWithTrigger = true,
  fitContent,
  motion,
  ...props
}: SelectPrimitive.Popup.Props & { fitContent?: boolean } & Pick<
    SelectPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "alignItemWithTrigger"
  > & { motion?: "instant" }) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        className="isolate z-50"
      >
        <SelectPrimitive.Popup
          // Focus goes back to the trigger only after a keyboard close: after a click Space must play the film, not reopen this
          finalFocus={(closedBy) => closedBy === "keyboard"}
          data-slot="select-content"
          data-align-trigger={alignItemWithTrigger}
          data-fit-content={fitContent || undefined}
          className={cn(
            "bg-popover text-popover-foreground ring-foreground/10 relative isolate z-50 max-h-(--available-height) w-(--anchor-width) min-w-32 origin-(--transform-origin) overflow-x-hidden overflow-y-auto overscroll-contain rounded-[calc(var(--radius-md)+5px)] border border-transparent shadow-md ring-1 forced-colors:border-[CanvasText]",
            motion === "instant"
              ? "transition-none"
              : "ease-studio-out transition-[opacity,scale] duration-160 data-ending-style:scale-[0.96] data-ending-style:opacity-0 data-ending-style:duration-120 data-starting-style:scale-[0.96] data-starting-style:opacity-0 motion-reduce:transition-opacity motion-reduce:duration-100 motion-reduce:data-ending-style:scale-100 motion-reduce:data-ending-style:duration-100 motion-reduce:data-starting-style:scale-100",
            className,
          )}
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({ className, ...props }: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn("text-muted-foreground px-2 py-1.5 text-xs", className)}
      {...props}
    />
  );
}

function SelectItem({
  className,
  children,
  size,
  ...props
}: SelectPrimitive.Item.Props & { size?: "readable" }) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "focus:bg-accent focus:text-accent-foreground data-highlighted:bg-accent data-highlighted:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground not-data-[variant=destructive]:data-highlighted:**:text-accent-foreground focus-visible:ring-ring relative flex min-h-7 w-full cursor-default items-center gap-2 rounded-md px-2 py-1 outline-hidden transition-colors duration-100 select-none focus-visible:ring-2 focus-visible:ring-inset data-disabled:pointer-events-none data-disabled:opacity-50 motion-reduce:transition-none pointer-coarse:min-h-10 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        size === "readable" ? "text-sm/relaxed tabular-nums" : "text-ui/relaxed",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText
        data-slot="select-item-text"
        className="flex flex-1 shrink-0 gap-2 whitespace-nowrap"
      >
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute right-2 flex items-center justify-center" />
        }
      >
        <CheckIcon className="pointer-events-none" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({ className, ...props }: SelectPrimitive.Separator.Props) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("bg-border/50 pointer-events-none -mx-1 my-1 h-px", className)}
      {...props}
    />
  );
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(
        "bg-popover top-0 z-10 flex w-full cursor-default items-center justify-center py-1 [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
      {...props}
    >
      <ChevronUpIcon />
    </SelectPrimitive.ScrollUpArrow>
  );
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(
        "bg-popover bottom-0 z-10 flex w-full cursor-default items-center justify-center py-1 [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
      {...props}
    >
      <ChevronDownIcon />
    </SelectPrimitive.ScrollDownArrow>
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
