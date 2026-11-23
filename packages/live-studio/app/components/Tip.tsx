import type { ReactElement, ReactNode } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function Tip({
  label,
  children,
  side,
  open,
}: {
  label: ReactNode;
  children: ReactElement;
  side?: "top" | "bottom" | "left" | "right";
  open?: boolean;
}) {
  return (
    <Tooltip open={open}>
      <TooltipTrigger render={children} />
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}
