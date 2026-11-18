import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export function JevSafetyBanner({
  enabled,
  onChange,
  onRun,
  busy,
  failed,
  disabled,
  reason,
  children,
}: {
  enabled: boolean;
  onChange: (value: boolean) => void;
  onRun: () => void;
  busy: boolean;
  failed: boolean;
  disabled: boolean;
  reason: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex-none border-b px-4 py-3 transition-colors duration-150 ease-out motion-reduce:transition-none",
        enabled ? "border-warn/30 bg-warn/8" : "border-border bg-card/35",
      )}
    >
      <div className="flex flex-col items-start gap-2">
        <Field orientation="horizontal" className="w-auto">
          <Switch
            id="jev-live"
            checked={enabled}
            disabled={busy}
            aria-describedby="jev-mode-description"
            onCheckedChange={(value) => {
              onChange(value);
              toast.add({
                title: value ? "Jev calls enabled" : "Jev calls off",
                description: value
                  ? "Only Run Jev sends data. Paid routes may charge."
                  : "Editing and previewing remain free.",
                type: value ? "warning" : "info",
              });
            }}
          />
          <div className="flex min-w-0 flex-col gap-0.5">
            <FieldLabel variant="row" htmlFor="jev-live">
              Jev calls
            </FieldLabel>
            <p
              id="jev-mode-description"
              className="text-label flex items-center gap-1 text-xs/relaxed"
            >
              {enabled && <TriangleAlert className="text-warn-text size-3 shrink-0" aria-hidden />}
              <span>
                {!enabled ? "Free preview" : busy ? "180s limit" : reason || "May charge"}
              </span>
            </p>
          </div>
        </Field>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {children}
          <Button
            size="md"
            variant={enabled ? "warn" : "secondary"}
            disabled={!enabled || disabled || busy}
            onClick={onRun}
          >
            {busy ? "Running Jev…" : failed ? "Retry Jev" : "Run Jev"}
          </Button>
        </div>
      </div>
    </div>
  );
}
