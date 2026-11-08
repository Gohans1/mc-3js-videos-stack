// The "?" next to an option that isn't clear from its name: a tap or a click opens the explanation, so it works on a phone too
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function HelpTip({ label, children }: { label: string; children: string }) {
  return (
    <Popover>
      <PopoverTrigger aria-label={`About ${label}`} render={<Button variant="hint" size="hint" className="relative flex-none after:absolute after:-inset-2" />}>
        ?
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-[min(260px,calc(100vw-24px))]">
        {children}
      </PopoverContent>
    </Popover>
  );
}
