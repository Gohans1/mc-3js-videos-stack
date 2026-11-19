import { useEffect, useState } from "react";

import { activityToast, Toaster, useToastManager } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import { useStudio } from "../core/store";

function RailSync({ onActive }: { onActive: (active: boolean) => void }) {
  const { toasts } = useToastManager();
  useEffect(() => {
    onActive(toasts.length > 0);
  }, [toasts.length, onActive]);
  return null;
}

export function ActivityRail() {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [hasToast, setHasToast] = useState(false);
  const enabled = useStudio((s) => s.aiActivity);
  if (!enabled) return null;
  return (
    <div
      aria-label="Studio activity"
      className={cn(
        "border-hairline-subtle bg-background @container col-span-full row-start-4 flex shrink-0 items-center gap-2 rounded-md",
        hasToast ? "h-10 border-t px-3" : "h-0 min-h-0 overflow-hidden border-t-0 px-0",
      )}
    >
      <div ref={setHost} className="relative ms-auto h-full min-w-0 flex-1">
        {host && (
          <Toaster
            compact
            limit={1}
            toastManager={activityToast}
            portalContainer={host}
            viewportClassName="absolute inset-x-0 bottom-1.5 ms-auto me-0 w-full max-w-lg sm:left-0 sm:right-0"
          >
            <RailSync onActive={setHasToast} />
          </Toaster>
        )}
      </div>
    </div>
  );
}
