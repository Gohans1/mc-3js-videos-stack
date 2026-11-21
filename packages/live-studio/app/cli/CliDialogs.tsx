import { AlertTriangle, Coins, ShieldAlert, Terminal } from "lucide-react";
import { type RefObject, useRef, useState } from "react";

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

import type { ResolvedCliSpec } from "../../src/cli-catalog.ts";
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

export function CliHelpDialog({
  returnFocusRef,
  open,
  spec,
  helpCommand,
  canRunHelp,
  onClose,
  onRunHelp,
}: {
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  open: boolean;
  spec: ResolvedCliSpec;
  helpCommand: string;
  canRunHelp: boolean;
  onClose: () => void;
  onRunHelp: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const groups = [
    { title: "Arguments", fields: spec.argsDef },
    { title: "Options", fields: spec.flagsDef },
  ];
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        data-cli-dialog
        className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl"
        initialFocus={headingRef}
        finalFocus={returnFocusRef}
        onKeyDown={stopCliHotkeyPropagation}
      >
        <DialogHeader className="mr-8">
          <DialogTitle ref={headingRef} tabIndex={-1} variant="reading">
            Guide to {spec.command.label}
          </DialogTitle>
          <DialogDescription variant="comfortable">
            {spec.subcommands.at(-1)?.summary ?? spec.command.summary}
          </DialogDescription>
        </DialogHeader>
        <p className="text-muted-foreground text-sm leading-normal">
          Reading this guide does not run a command. Use Run command in the workbench when you are
          ready.
        </p>
        {groups
          .filter((group) => group.fields.length)
          .map((group) => (
            <section key={group.title} className="flex min-w-0 flex-col gap-3">
              <h3 className="text-heading-foreground text-base font-semibold">{group.title}</h3>
              <dl className="flex min-w-0 flex-col gap-3 text-sm leading-normal">
                {group.fields.map((field) => (
                  <div key={field.key} className="min-w-0">
                    <dt className="font-medium">
                      {field.label}
                      {"flag" in field &&
                      typeof field.flag === "string" &&
                      !field.label.includes(field.flag)
                        ? ` (${field.flag})`
                        : ""}
                    </dt>
                    <dd className="text-muted-foreground">
                      {field.hint ??
                        (field.type === "boolean"
                          ? "Turn on to include this option in the command."
                          : field.placeholder
                            ? `Example: ${field.placeholder}`
                            : "Set a value to include it in the command.")}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        {spec.meta.helpMode !== "none" && (
          <section className="border-hairline flex min-w-0 flex-col gap-2 border-t pt-3">
            <h3 className="text-heading-foreground text-base font-semibold">Help from the CLI</h3>
            <p className="text-muted-foreground text-sm leading-normal">
              The button below runs this help command and shows its output. It does not run your
              configured task.
            </p>
            <code className="font-mono text-sm break-words">{helpCommand}</code>
            <Button
              size="comfortable"
              variant="secondary"
              disabled={!canRunHelp}
              onClick={onRunHelp}
            >
              <Terminal aria-hidden />
              Run --help
            </Button>
          </section>
        )}
        <DialogFooter>
          <Button size="comfortable" variant="secondary" onClick={onClose}>
            Close guide
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
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
      <DialogContent data-cli-dialog showCloseButton>
        <DialogHeader>
          <DialogTitle>
            <span className="flex items-center gap-2">
              <ShieldAlert aria-hidden className="text-warn-text size-4 shrink-0" />
              <span>Run {request?.title ?? "command"}?</span>
            </span>
          </DialogTitle>
          <DialogDescription variant="comfortable">
            {request?.sourceLabel
              ? `Review the command saved in “${request.sourceLabel}” before running it.`
              : "Check the command, its folder, and the changes it will make."}
          </DialogDescription>
        </DialogHeader>

        {request && (
          <div className="flex min-w-0 flex-col gap-3">
            <Alert variant={isDestructive ? "destructive" : "warn"}>
              {isPaid ? <Coins aria-hidden /> : <AlertTriangle aria-hidden />}
              <AlertTitle>{isPaid ? "Uses paid services" : "Changes files"}</AlertTitle>
              <AlertDescription>{request.reason}</AlertDescription>
            </Alert>

            <div className="flex flex-wrap items-center gap-1.5">
              <Badge
                appearance="text"
                size="comfortable"
                variant={isDestructive ? "destructive" : "check"}
              >
                {getEffectLabel(request.effect)}
              </Badge>
              {isPaid && (
                <Badge appearance="text" size="comfortable" variant="check">
                  <Coins aria-hidden />
                  {request.cost === "paid" ? "Paid API" : "Optional paid API"}
                </Badge>
              )}
            </div>

            <div className="bg-backdrop border-hairline flex min-w-0 flex-col gap-1 rounded-lg border p-2.5">
              <span className="text-muted-foreground font-mono text-sm break-all">
                Runs in: {request.cwd}
              </span>
              <pre className="text-foreground max-h-36 overflow-auto overscroll-contain font-mono text-sm break-all whitespace-pre-wrap">
                {request.displayCommand}
              </pre>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button size="comfortable" variant="ghost" disabled={submitting} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="comfortable"
            variant={isDestructive ? "destructive" : "approve"}
            disabled={submitting}
            onClick={onConfirm}
          >
            <Terminal aria-hidden />
            Run command
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
          <FieldLabel variant="form" htmlFor="cli-template-name">
            Template name
          </FieldLabel>
          <Input
            size="comfortable"
            id="cli-template-name"
            maxLength={80}
            value={name}
            placeholder="Find stone textures"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              stopCliInputHotkeyPropagation(e);
              if (e.key === "Enter" && trimmed && !saving) handleSubmit(false);
            }}
          />
          {trimmed.length >= 60 && (
            <FieldDescription size="comfortable">{trimmed.length}/80 characters</FieldDescription>
          )}
        </Field>

        {supportsFilmTarget && (
          <Field>
            <FieldLabel variant="form" htmlFor="cli-template-target">
              Run in
            </FieldLabel>
            <Select
              items={targetItems}
              value={targetValue}
              onValueChange={(v) => v && setTargetValue(v)}
            >
              <SelectTrigger size="comfortable" id="cli-template-target" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                fitContent
                finalFocus
                className="[--text-ui:0.875rem]"
                onKeyDown={stopCliHotkeyPropagation}
              >
                {targetItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription size="comfortable">
              The template uses this folder when you run it.
            </FieldDescription>
          </Field>
        )}

        <div className="bg-backdrop border-hairline min-w-0 rounded-lg border p-2">
          <pre className="text-muted-foreground max-h-24 overflow-auto overscroll-contain font-mono text-sm break-all whitespace-pre-wrap">
            {displayCommand}
          </pre>
        </div>

        {saveError && (
          <Alert variant="destructive">
            <AlertTriangle aria-hidden />
            <AlertTitle>Could not save template</AlertTitle>
            <AlertDescription size="prose" className="wrap-anywhere">
              <span className="block">{saveError}</span>
              Try saving again. If it still fails, check Studio’s connection and write access.
            </AlertDescription>
          </Alert>
        )}
      </div>

      <DialogFooter>
        <Button size="comfortable" variant="ghost" disabled={saving} onClick={onClose}>
          Cancel
        </Button>
        {editingExisting && (
          <Button
            size="comfortable"
            variant="secondary"
            disabled={!trimmed || saving}
            onClick={() => handleSubmit(true)}
          >
            Save as new
          </Button>
        )}
        <Button
          size="comfortable"
          disabled={!trimmed || saving}
          onClick={() => handleSubmit(false)}
        >
          {saving ? "Saving template…" : editingExisting ? "Update template" : "Save template"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function SaveTemplateForm(props: SaveTemplateFormProps) {
  return (
    <DialogContent data-cli-dialog showCloseButton>
      <DialogHeader>
        <DialogTitle>
          {props.editingExisting ? "Save template changes" : "Save CLI template"}
        </DialogTitle>
        <DialogDescription variant="comfortable">
          Keep this command and its options so you can run it again later.
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
      <SaveTemplateForm {...props} />
    </Dialog>
  );
}

export function CliResetDialog({
  open,
  onConfirm,
  onCancel,
  returnFocus,
}: {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  returnFocus: () => HTMLElement | true;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent data-cli-dialog finalFocus={returnFocus} showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Reset options?</DialogTitle>
          <DialogDescription variant="comfortable">
            Restore the command’s defaults and discard changes to this draft. Saved templates stay
            available.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" size="comfortable" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" size="comfortable" onClick={onConfirm}>
            Reset options
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
