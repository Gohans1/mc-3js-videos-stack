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

type PendingSnapshot = ReturnType<typeof getPendingSnapshot>;
type PresenceState =
  | { kind: "hidden" }
  | { kind: "entering"; items: PendingSnapshot }
  | { kind: "open"; items: PendingSnapshot }
  | { kind: "exiting"; items: PendingSnapshot };
type PendingAction = "idle" | "confirming" | "reverting";

export function PendingChangesBar() {
  const pending = useSyncExternalStore(subscribePending, getPendingSnapshot, getPendingSnapshot);
  const [action, setAction] = useState<PendingAction>("idle");
  const active = !isAutoSave() && pending.length > 0;
  const [presence, setPresence] = useState<PresenceState>(() =>
    active ? { kind: "open", items: pending } : { kind: "hidden" },
  );

  if (active) {
    if (presence.kind === "hidden" || presence.kind === "exiting") {
      setPresence({ kind: "entering", items: pending });
    } else if (presence.items !== pending) {
      setPresence({ kind: presence.kind, items: pending });
    }
  } else if (presence.kind === "entering" || presence.kind === "open") {
    setPresence({ kind: "exiting", items: presence.items });
  }

  useEffect(() => {
    if (presence.kind === "entering") {
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() =>
          setPresence((prev) =>
            prev.kind === "entering" ? { kind: "open", items: prev.items } : prev,
          ),
        );
      });
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    }
    if (presence.kind !== "exiting") return;
    const delay = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 240;
    const timer = window.setTimeout(
      () => setPresence((prev) => (prev.kind === "exiting" ? { kind: "hidden" } : prev)),
      delay,
    );
    return () => window.clearTimeout(timer);
  }, [presence.kind]);

  if (presence.kind === "hidden") return null;

  const busy = action !== "idle";
  const items = active ? pending : presence.items;
  const names = items.map((p) => p.label).join(", ");
  const draftLabel =
    items.length === 1 ? `${items[0].label} draft` : `${items.length} unconfirmed · ${names}`;
  const handleConfirm = async () => {
    if (busy || !active) return;
    setAction("confirming");
    try {
      const ok = await confirmDocs();
      say(ok ? `Confirmed: ${names}` : "Couldn't confirm all changes");
    } finally {
      setAction("idle");
    }
  };
  const handleRevert = async () => {
    if (busy || !active) return;
    setAction("reverting");
    try {
      await revertDocs();
      say(`Reverted ${names} back to saved files`);
    } finally {
      setAction("idle");
    }
  };

  return (
    <Collapsible open={presence.kind === "open"}>
      <CollapsibleContent
        variant="animated"
        onTransitionEnd={(e) => {
          if (e.target === e.currentTarget && !active) {
            setPresence((prev) => (prev.kind === "exiting" ? { kind: "hidden" } : prev));
          }
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
