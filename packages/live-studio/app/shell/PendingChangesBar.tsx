import { Check, RotateCcw } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";

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
  if (isAutoSave() || !pending.length) return null;

  const names = pending.map((p) => p.label).join(", ");
  const handleConfirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await confirmDocs();
      say(ok ? `Confirmed: ${names}` : "Couldn't confirm all changes");
    } finally {
      setBusy(false);
    }
  };
  const handleRevert = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await revertDocs();
      say(`Reverted ${names} back to saved files`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="group"
      aria-label="Unconfirmed Studio changes"
      className="bg-warn-card/85 border-warn/45 flex flex-none items-center gap-1 rounded-full border py-0.5 ps-2.5 pe-1"
    >
      <Tip
        label={`Unconfirmed preview changes (not yet written to files so AI can work freely): ${names}`}
      >
        <span className="text-warn-text text-ui flex items-center gap-1 font-medium whitespace-nowrap">
          {pending.length === 1 ? `${pending[0].label} draft` : `${pending.length} unconfirmed`}
        </span>
      </Tip>
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
  );
}
