// A tooltip on a control: shown on hover and on keyboard focus, which a title attribute never is (and never on a phone)
import type { ReactElement, ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function Tip({ label, children, side }: { label: ReactNode; children: ReactElement; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}
