import { Check, RotateCcw } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";

import { Tip } from "../components/Tip";
import {
  confirmDocs,
  getPendingSnapshot,
  isAutoSave,
  revertDocs,
  subscribePending,
} from "../core/doc";
import { say } from "../core/store";

// Holds experimental timeline/camera/setting tweaks in preview behind explicit Confirm / Revert so AI edits aren't blocked.
export function PendingChangesBar() {
  const pending = useSyncExternalStore(subscribePending, getPendingSnapshot, getPendingSnapshot);
  const [busy, setBusy] = useState(false);
  const active = !isAutoSave() && pending.length > 0;
  const [prevActive, setPrevActive] = useState(active);
  const [rendered, setRendered] = useState(active);
  const [open, setOpen] = useState(active);
  const [shown, setShown] = useState(pending);

  if (active && pending !== shown) setShown(pending);
  if (active !== prevActive) {
    setPrevActive(active);
    if (active) setRendered(true);
    else setOpen(false);
  }

  useEffect(() => {
    if (active) {
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setOpen(true));
      });
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    }
    if (!rendered) return;
    const delay = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 240;
    const timer = window.setTimeout(() => setRendered(false), delay);
    return () => window.clearTimeout(timer);
  }, [active, rendered]);

  if (!active && !rendered) return null;

  const items = active ? pending : shown;
  const names = items.map((p) => p.label).join(", ");
  const draftLabel =
    items.length === 1 ? `${items[0].label} draft` : `${items.length} unconfirmed · ${names}`;
  const handleConfirm = async () => {
    if (busy || !active) return;
    setBusy(true);
    try {
      const ok = await confirmDocs();
      say(ok ? `Confirmed: ${names}` : "Couldn't confirm all changes");
    } finally {
      setBusy(false);
    }
  };
  const handleRevert = async () => {
    if (busy || !active) return;
    setBusy(true);
    try {
      await revertDocs();
      say(`Reverted ${names} back to saved files`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Collapsible open={open}>
      <CollapsibleContent
        variant="animated"
        onTransitionEnd={(e) => {
          if (e.target === e.currentTarget && !active) setRendered(false);
        }}
      >
        <div
          role="group"
          aria-label="Unconfirmed Studio changes"
          aria-hidden={!active || undefined}
          inert={!active || undefined}
          className="border-hairline-subtle bg-warn-card/55 flex items-center justify-between gap-2 border-b px-3 py-1 @max-[380px]:px-2"
        >
          <Tip
            label={`Unconfirmed preview changes (not yet written to files so AI can work freely): ${names}`}
          >
            <span className="text-warn-text text-ui flex min-w-0 items-center gap-1.5 font-medium">
              <span aria-hidden className="bg-warn size-1.5 shrink-0 rounded-full" />
              <span className="truncate">{draftLabel}</span>
            </span>
          </Tip>
          <div className="flex shrink-0 items-center gap-1.5">
            <Tip label={`Discard unconfirmed changes (${names}) and revert to files on disk`}>
              <Button
                variant="subtle"
                size="sm"
                disabled={busy}
                aria-label="Revert pending changes"
                onClick={() => void handleRevert()}
              >
                <RotateCcw data-icon="inline-start" aria-hidden />
                Revert
              </Button>
            </Tip>
            <Tip label={`Confirm and write changes to film files (${names})`}>
              <Button
                size="sm"
                disabled={busy}
                aria-label="Confirm pending changes"
                onClick={() => void handleConfirm()}
              >
                <Check data-icon="inline-start" aria-hidden />
                Confirm
              </Button>
            </Tip>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
