import { AlertTriangle, Coins, ShieldAlert, Terminal } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  getEffectLabel,
  resolveSaveTemplateTargets,
  stopCliHotkeyPropagation,
  stopCliInputHotkeyPropagation,
} from "./model";

export interface CliConfirmRequest {
  title: string;
  reason: string;
  displayCommand: string;
  cwd: string;
  cost: "free" | "optional-paid" | "paid";
  effect: "read" | "write" | "install" | "destructive" | "daemon";
  sourceLabel?: string;
}

export function CliConfirmDialog({
  request,
  submitting,
  onConfirm,
  onCancel,
}: {
  request: CliConfirmRequest | null;
  submitting?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const isDestructive = request?.effect === "destructive";
  const isPaid = request?.cost === "paid" || request?.cost === "optional-paid";

  return (
    <Dialog open={Boolean(request)} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent showCloseButton>
        <DialogHeader>
          <DialogTitle>
            <span className="flex items-center gap-2">
              <ShieldAlert aria-hidden className="text-warn-text size-4 shrink-0" />
              <span>Confirm CLI run</span>
            </span>
          </DialogTitle>
          <DialogDescription>
            {request?.sourceLabel
              ? `Launching saved template "${request.sourceLabel}" needs confirmation.`
              : `Review the exact command and target directory before executing ${request?.title ?? "command"}.`}
          </DialogDescription>
        </DialogHeader>

        {request && (
          <div className="flex min-w-0 flex-col gap-3">
            <Alert variant={isDestructive ? "destructive" : "warn"}>
              {isPaid ? <Coins aria-hidden /> : <AlertTriangle aria-hidden />}
              <AlertTitle>{isPaid ? "Paid or confirmed action" : "High-impact command"}</AlertTitle>
              <AlertDescription>{request.reason}</AlertDescription>
            </Alert>

            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={isDestructive ? "destructive" : "check"}>
                {getEffectLabel(request.effect)}
              </Badge>
              {isPaid && (
                <Badge variant="check">
                  <Coins aria-hidden />
                  {request.cost === "paid" ? "Paid API" : "Optional paid API"}
                </Badge>
              )}
            </div>

            <div className="bg-backdrop border-hairline flex min-w-0 flex-col gap-1 rounded-lg border p-2.5">
              <span className="text-tag text-muted-foreground font-mono break-all">
                cwd: {request.cwd}
              </span>
              <pre className="text-tag text-foreground max-h-36 overflow-auto font-mono break-all whitespace-pre-wrap">
                {request.displayCommand}
              </pre>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" disabled={submitting} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant={isDestructive ? "destructive" : "approve"}
            disabled={submitting}
            onClick={onConfirm}
          >
            <Terminal aria-hidden />
            Confirm &amp; Run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface SaveTemplateFormProps {
  initialName: string;
  initialTargetFilm: string;
  activeFilm: string | null;
  films: readonly string[];
  supportsFilmTarget: boolean;
  supportsRootTarget: boolean;
  displayCommand: string;
  editingExisting: boolean;
  saving?: boolean;
  saveError?: string | null;
  onSave: (data: { name: string; targetFilm: string; asNew: boolean }) => void;
  onClose: () => void;
}

export function SaveTemplatePanel({
  initialName,
  initialTargetFilm,
  activeFilm,
  films,
  supportsFilmTarget,
  supportsRootTarget,
  displayCommand,
  editingExisting,
  saving,
  saveError,
  onSave,
  onClose,
}: SaveTemplateFormProps) {
  const { items: targetItems, defaultTarget } = resolveSaveTemplateTargets({
    initialTargetFilm,
    activeFilm,
    films,
    supportsFilmTarget,
    supportsRootTarget,
  });

  const [name, setName] = useState(initialName);
  const [targetValue, setTargetValue] = useState(defaultTarget);

  const trimmed = name.trim();
  const resolvedTarget = supportsFilmTarget ? targetValue : "root";

  const handleSubmit = (asNew: boolean) => {
    if (!trimmed) return;
    onSave({ name: trimmed, targetFilm: resolvedTarget, asNew });
  };

  return (
    <>
      <div className="flex min-w-0 flex-col gap-3">
        <Field>
          <FieldLabel htmlFor="cli-template-name">Template name</FieldLabel>
          <Input
            id="cli-template-name"
            maxLength={80}
            value={name}
            placeholder="e.g. Find stone textures (--jev)"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              stopCliInputHotkeyPropagation(e);
              if (e.key === "Enter" && trimmed && !saving) handleSubmit(false);
            }}
          />
          {trimmed.length >= 60 && (
            <FieldDescription>{trimmed.length}/80 characters</FieldDescription>
          )}
        </Field>

        {supportsFilmTarget && (
          <Field>
            <FieldLabel htmlFor="cli-template-target">Target film behavior</FieldLabel>
            <Select
              items={targetItems}
              value={targetValue}
              onValueChange={(v) => v && setTargetValue(v)}
            >
              <SelectTrigger id="cli-template-target" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent onKeyDown={stopCliHotkeyPropagation}>
                {targetItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              Follow active film adapts to whichever film is open; pinned or root targets stay
              fixed.
            </FieldDescription>
          </Field>
        )}

        <div className="bg-backdrop border-hairline min-w-0 rounded-lg border p-2">
          <pre className="text-tag text-muted-foreground max-h-24 overflow-auto font-mono break-all whitespace-pre-wrap">
            {displayCommand}
          </pre>
        </div>

        {saveError && (
          <Alert variant="destructive">
            <AlertTriangle aria-hidden />
            <AlertTitle>Could not save template</AlertTitle>
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        )}
      </div>

      <DialogFooter>
        <Button variant="ghost" disabled={saving} onClick={onClose}>
          Cancel
        </Button>
        {editingExisting && (
          <Button
            variant="secondary"
            disabled={!trimmed || saving}
            onClick={() => handleSubmit(true)}
          >
            Save as new
          </Button>
        )}
        <Button disabled={!trimmed || saving} onClick={() => handleSubmit(false)}>
          {editingExisting ? "Update" : "Save template"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function SaveTemplateForm(props: SaveTemplateFormProps) {
  return (
    <DialogContent showCloseButton>
      <DialogHeader>
        <DialogTitle>
          {props.editingExisting ? "Save template changes" : "Save CLI template"}
        </DialogTitle>
        <DialogDescription>
          Save this exact command and flag preset for 1-click re-runs across sessions.
        </DialogDescription>
      </DialogHeader>

      <SaveTemplatePanel {...props} />
    </DialogContent>
  );
}

export function CliSaveTemplateDialog({
  open,
  ...props
}: SaveTemplateFormProps & { open: boolean }) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && props.onClose()}>
      {open && <SaveTemplateForm {...props} />}
    </Dialog>
  );
}
