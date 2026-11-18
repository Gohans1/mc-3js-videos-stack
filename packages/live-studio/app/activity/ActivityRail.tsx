import { useState } from "react";

import { activityToast, Toaster } from "@/components/ui/toast";

import { useStudio } from "../core/store";
import { AiPresence } from "./AiPresence";

export function ActivityRail() {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const enabled = useStudio((s) => s.aiActivity);
  if (!enabled) return null;
  return (
    <div
      aria-label="Studio activity"
      className="border-hairline-subtle bg-background @container col-span-full row-start-4 flex h-10 shrink-0 items-center gap-2 rounded-md border-t px-3"
    >
      <AiPresence />
      <div ref={setHost} className="relative ms-auto h-full min-w-0 flex-1">
        {host && (
          <Toaster
            compact
            limit={1}
            toastManager={activityToast}
            portalContainer={host}
            viewportClassName="absolute inset-x-0 bottom-1.5 ms-auto me-0 w-full max-w-lg sm:left-0 sm:right-0"
          />
        )}
      </div>
    </div>
  );
}
