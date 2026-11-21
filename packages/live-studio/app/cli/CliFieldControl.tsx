import { Plus, X } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import type { CliArgDef, CliArgValue, CliContext, CliFlagDef } from "../../src/cli-catalog.ts";
import {
  asTokenArray,
  commitMultiTokens,
  getFieldOptions,
  isFieldValueActive,
  type SelectOptionItem,
  stopCliHotkeyPropagation,
  stopCliInputHotkeyPropagation,
} from "./model";

type AnyFieldDef = CliArgDef | CliFlagDef;
type PendingInput = { value: string; onChange: (value: string) => void };

const UNSET_TOKEN = "__cli_unset__";
const BARE_TOKEN = "__cli_bare__";
const PICK_PRESET_TOKEN = "__cli_pick_preset__";

function isFlagDef(def: AnyFieldDef): def is CliFlagDef {
  return "flag" in def;
}

function MultiTokenInput({
  id,
  ariaLabel,
  fieldLabel,
  value,
  placeholder,
  splitCommas,
  emptyValue,
  descriptionId,
  invalid,
  required,
  pendingInput,
  onChange,
}: {
  id: string;
  ariaLabel?: string;
  fieldLabel?: string;
  value: CliArgValue;
  placeholder?: string;
  splitCommas?: boolean;
  emptyValue?: "" | undefined;
  descriptionId?: string;
  invalid?: boolean;
  required?: boolean;
  pendingInput?: PendingInput;
  onChange: (next: CliArgValue) => void;
}) {
  const [localDraft, setLocalDraft] = useState("");
  const draft = pendingInput?.value ?? localDraft;
  const setDraft = pendingInput?.onChange ?? setLocalDraft;
  const items = asTokenArray(value);

  const commit = () => {
    const raw = draft.trim();
    if (!raw) return;
    const next = commitMultiTokens(raw, items, splitCommas);
    onChange(next.length ? next : emptyValue);
    setDraft("");
  };

  const removeItem = (idx: number) => {
    const next = items.filter((_, i) => i !== idx);
    onChange(next.length ? next : emptyValue);
  };

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
        <Input
          size="comfortable"
          id={id}
          aria-label={ariaLabel}
          aria-describedby={descriptionId}
          aria-invalid={invalid || undefined}
          aria-required={required || undefined}
          value={draft}
          placeholder={placeholder ?? "Type value and press Enter…"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              if (draft) {
                e.stopPropagation();
                setDraft("");
              }
              return;
            }
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
        />
        <Button
          variant="secondary"
          size="icon"
          aria-label={fieldLabel ? `Add ${fieldLabel} item` : "Add item"}
          disabled={!draft.trim()}
          onClick={commit}
        >
          <Plus aria-hidden />
        </Button>
      </div>
      {draft.trim().length > 0 && (
        <p className="text-muted-foreground text-sm">
          Current text is included. Press Enter or + to add another value.
        </p>
      )}
      {items.length > 0 && (
        <div className="flex min-w-0 flex-wrap gap-1">
          {items.map((item, idx) => (
            <span
              key={`${item}-${idx}`}
              className="bg-surface-subtle border-hairline inline-flex max-w-full items-center gap-1 rounded-md border py-0.5 pr-0.5 pl-1.5 font-mono text-sm"
            >
              <span className="min-w-0 wrap-anywhere">{item}</span>
              <button
                type="button"
                aria-label={`Remove ${item}`}
                onClick={() => removeItem(idx)}
                className="text-muted-foreground hover:text-destructive focus-visible:ring-ring inline-flex size-6 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-2 pointer-coarse:size-10"
              >
                <X aria-hidden className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function DetectedChoicesHelper({
  label,
  options,
  multi,
  selectedMulti,
  selectedSingle,
  onPickMulti,
  onPickSingle,
}: {
  label: string;
  options: readonly SelectOptionItem[];
  multi: boolean;
  selectedMulti: readonly string[];
  selectedSingle: string;
  onPickMulti: (val: string) => void;
  onPickSingle: (val: string) => void;
}) {
  if (options.length === 0) return null;

  if (options.length <= 8) {
    return (
      <div className="flex min-w-0 flex-wrap gap-1">
        {options.map((opt) => {
          const pressed = multi ? selectedMulti.includes(opt.value) : selectedSingle === opt.value;
          return (
            <Button
              key={opt.value}
              variant="choice"
              size="wrapping"
              className="max-w-full"
              aria-pressed={pressed}
              onClick={() => (multi ? onPickMulti(opt.value) : onPickSingle(opt.value))}
            >
              <span className="min-w-0 wrap-anywhere">{opt.label}</span>
            </Button>
          );
        })}
      </div>
    );
  }

  const pickItems = [
    { value: PICK_PRESET_TOKEN, label: multi ? "Insert detected…" : "Pick detected…" },
    ...options,
  ];
  return (
    <Select
      items={pickItems}
      value={PICK_PRESET_TOKEN}
      onValueChange={(v) => {
        if (!v || v === PICK_PRESET_TOKEN) return;
        if (multi) onPickMulti(v);
        else onPickSingle(v);
      }}
    >
      <SelectTrigger
        size="comfortable"
        className="w-full"
        aria-label={`Detected choices for ${label}`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        fitContent
        finalFocus
        className="[--text-ui:0.875rem]"
        onKeyDown={stopCliHotkeyPropagation}
      >
        {pickItems.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CliFieldContent({
  def,
  value,
  context,
  requiredOverride,
  invalid,
  errorId,
  pendingInput,
  onChange,
}: {
  def: AnyFieldDef;
  value: CliArgValue;
  context: CliContext | null;
  requiredOverride?: boolean;
  invalid?: boolean;
  errorId?: string;
  pendingInput?: PendingInput;
  onChange: (next: CliArgValue) => void;
}) {
  const id = useId();
  const hintId = def.hint ? `${id}-hint` : undefined;
  const descriptionId = invalid ? [errorId, hintId].filter(Boolean).join(" ") : hintId;
  const flagDef = isFlagDef(def) ? def : null;
  const required = requiredOverride ?? ("required" in def ? Boolean(def.required) : false);
  const multi = "multi" in def ? Boolean(def.multi) : false;
  const optionalValue = Boolean(flagDef?.optionalValue);
  const options = getFieldOptions(def, context);

  const labelText =
    flagDef && !def.label.includes(flagDef.flag) ? `${def.label} (${flagDef.flag})` : def.label;

  // Boolean switch
  if (def.type === "boolean") {
    const checked = value === true || value === "true" || value === 1 || value === "1";
    return (
      <div className="flex min-w-0 flex-col gap-1 py-0.5">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
            <FieldLabel variant="form" htmlFor={id}>
              {labelText}
            </FieldLabel>
            {def.hint && (
              <FieldDescription size="comfortable" id={hintId} className="basis-full">
                {def.hint}
              </FieldDescription>
            )}
          </div>
          <Switch
            data-instant
            size="comfortable"
            id={id}
            aria-describedby={descriptionId}
            aria-invalid={invalid || undefined}
            aria-required={required || undefined}
            checked={checked}
            onCheckedChange={(on) => onChange(on ? true : undefined)}
          />
        </div>
      </div>
    );
  }

  // Optional-value flag: Switch to pass bare flag vs optional picker/input/multi
  if (optionalValue) {
    const enabled = value !== undefined && value !== false && value !== "false";
    const strVal = typeof value === "string" ? value : "";
    const picked = asTokenArray(value);
    const toggleMultiOption = (optVal: string) => {
      const next = picked.includes(optVal)
        ? picked.filter((x) => x !== optVal)
        : [...picked, optVal];
      onChange(next.length ? next : "");
    };
    const flagLabel = flagDef?.flag ?? "flag";
    const bareOptionLabel = flagDef?.bareLabel ?? "Use the default behavior";
    const bareHintText =
      flagDef?.bareHint ??
      `Leave the value empty to use ${flagLabel} by itself, or enter a value to narrow it.`;
    const bareEnumItems = [{ value: BARE_TOKEN, label: bareOptionLabel }, ...options];

    return (
      <Field>
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
            <FieldLabel variant="form" htmlFor={`${id}-sw`}>
              {labelText}
            </FieldLabel>
            <span className="text-muted-foreground text-sm">Optional value</span>
            {def.hint && (
              <FieldDescription size="comfortable" id={hintId} className="basis-full">
                {def.hint}
              </FieldDescription>
            )}
          </div>
          <Switch
            data-instant
            size="comfortable"
            id={`${id}-sw`}
            aria-describedby={descriptionId}
            checked={enabled}
            onCheckedChange={(on) => {
              if (!on) pendingInput?.onChange("");
              onChange(on ? "" : undefined);
            }}
          />
        </div>
        <Collapsible open={enabled} className="contents">
          <CollapsibleContent>
            {def.type === "enum" && options.length > 0 ? (
              <Select
                items={bareEnumItems}
                value={strVal || BARE_TOKEN}
                onValueChange={(v) => onChange(!v || v === BARE_TOKEN ? "" : v)}
              >
                <SelectTrigger
                  size="comfortable"
                  id={id}
                  className="w-full"
                  aria-label={labelText}
                  aria-describedby={descriptionId}
                  aria-invalid={invalid || undefined}
                  aria-required={required || undefined}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent
                  fitContent
                  finalFocus
                  className="[--text-ui:0.875rem]"
                  onKeyDown={stopCliHotkeyPropagation}
                >
                  {bareEnumItems.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : def.type === "csv" || multi ? (
              <div className="flex min-w-0 flex-col gap-1.5">
                <MultiTokenInput
                  pendingInput={pendingInput}
                  descriptionId={descriptionId}
                  invalid={invalid}
                  required={required}
                  id={id}
                  ariaLabel={labelText}
                  fieldLabel={def.label}
                  value={value}
                  placeholder={def.placeholder ?? ""}
                  splitCommas={def.type === "csv"}
                  emptyValue=""
                  onChange={(next) => onChange(next)}
                />
                <DetectedChoicesHelper
                  label={def.label}
                  options={options}
                  multi
                  selectedMulti={picked}
                  selectedSingle=""
                  onPickMulti={toggleMultiOption}
                  onPickSingle={() => {}}
                />
                <FieldDescription size="comfortable">{bareHintText}</FieldDescription>
              </div>
            ) : (
              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="flex min-w-0 items-center gap-1">
                  <Input
                    size="comfortable"
                    id={id}
                    aria-describedby={descriptionId}
                    aria-invalid={invalid || undefined}
                    aria-required={required || undefined}
                    aria-label={labelText}
                    value={strVal}
                    placeholder={def.placeholder ?? "Leave empty for bare flag, or type value…"}
                    onChange={(e) => onChange(e.target.value)}
                    onKeyDown={stopCliInputHotkeyPropagation}
                  />
                  {strVal.trim().length > 0 && (
                    <Button
                      variant="ghost"
                      size="icon-lg"
                      aria-label={`Reset ${def.label} to bare flag`}
                      onClick={() => onChange("")}
                    >
                      <X aria-hidden />
                    </Button>
                  )}
                </div>
                <DetectedChoicesHelper
                  label={def.label}
                  options={options}
                  multi={false}
                  selectedMulti={[]}
                  selectedSingle={strVal}
                  onPickMulti={() => {}}
                  onPickSingle={(val) => onChange(strVal === val ? "" : val)}
                />
                <FieldDescription size="comfortable">{bareHintText}</FieldDescription>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      </Field>
    );
  }

  // Multi enum / choice as toggle pills
  if ((def.type === "enum" || def.type === "choice") && multi && options.length > 0) {
    const picked = asTokenArray(value);
    const toggle = (optVal: string) => {
      const next = picked.includes(optVal)
        ? picked.filter((x) => x !== optVal)
        : [...picked, optVal];
      onChange(next.length ? next : undefined);
    };
    const groupLabelId = `${id}-label`;
    return (
      <Field>
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
          <FieldLabel variant="form" id={groupLabelId}>
            {labelText}
          </FieldLabel>
          {required && <span className="text-warn-text text-sm font-medium">Required</span>}
          {def.hint && (
            <FieldDescription size="comfortable" id={hintId} className="basis-full">
              {def.hint}
            </FieldDescription>
          )}
        </div>
        <div role="group" aria-labelledby={groupLabelId} className="flex min-w-0 flex-wrap gap-1">
          {options.map((opt) => (
            <Button
              key={opt.value}
              variant="choice"
              size="wrapping"
              className="max-w-full"
              aria-pressed={picked.includes(opt.value)}
              onClick={() => toggle(opt.value)}
            >
              <span className="min-w-0 wrap-anywhere">{opt.label}</span>
            </Button>
          ))}
        </div>
      </Field>
    );
  }

  // Single enum / choice with options
  if ((def.type === "enum" || def.type === "choice") && options.length > 0) {
    const strVal = typeof value === "string" || typeof value === "number" ? String(value) : "";
    const selectItems = required
      ? options
      : [{ value: UNSET_TOKEN, label: "Use the default" }, ...options];
    const current = strVal || (required ? null : UNSET_TOKEN);
    return (
      <Field>
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
          <FieldLabel variant="form" htmlFor={id}>
            {labelText}
          </FieldLabel>
          {required && <span className="text-warn-text text-sm font-medium">Required</span>}
          {def.hint && (
            <FieldDescription size="comfortable" id={hintId} className="basis-full">
              {def.hint}
            </FieldDescription>
          )}
        </div>
        <Select
          items={selectItems}
          value={current}
          onValueChange={(v) => onChange(!v || v === UNSET_TOKEN ? undefined : v)}
        >
          <SelectTrigger
            size="comfortable"
            id={id}
            className="w-full"
            aria-label={labelText}
            aria-describedby={descriptionId}
            aria-invalid={invalid || undefined}
            aria-required={required || undefined}
          >
            <SelectValue placeholder={def.placeholder ?? "Select option…"} />
          </SelectTrigger>
          <SelectContent
            fitContent
            finalFocus
            className="[--text-ui:0.875rem]"
            onKeyDown={stopCliHotkeyPropagation}
          >
            {selectItems.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    );
  }

  // Multi string or csv (with optional detected choices)
  if (multi || def.type === "csv") {
    const picked = asTokenArray(value);
    const togglePicked = (optVal: string) => {
      const next = picked.includes(optVal)
        ? picked.filter((x) => x !== optVal)
        : [...picked, optVal];
      onChange(next.length ? next : undefined);
    };
    return (
      <Field>
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
          <FieldLabel variant="form" htmlFor={id}>
            {labelText}
          </FieldLabel>
          {required && <span className="text-warn-text text-sm font-medium">Required</span>}
          {def.hint && (
            <FieldDescription size="comfortable" id={hintId} className="basis-full">
              {def.hint}
            </FieldDescription>
          )}
        </div>
        <MultiTokenInput
          pendingInput={pendingInput}
          descriptionId={descriptionId}
          invalid={invalid}
          required={required}
          id={id}
          fieldLabel={def.label}
          value={value}
          placeholder={def.placeholder}
          splitCommas={def.type === "csv"}
          onChange={(next) => onChange(next)}
        />
        <DetectedChoicesHelper
          label={def.label}
          options={options}
          multi
          selectedMulti={picked}
          selectedSingle=""
          onPickMulti={togglePicked}
          onPickSingle={() => {}}
        />
      </Field>
    );
  }

  // Single string, number, or dynamic choice input (showing detected choices when available)
  const strVal = typeof value === "string" || typeof value === "number" ? String(value) : "";
  const active = isFieldValueActive(value);

  return (
    <Field>
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
        <FieldLabel variant="form" htmlFor={id}>
          {labelText}
        </FieldLabel>
        {required && <span className="text-warn-text text-sm font-medium">Required</span>}
        {def.hint && (
          <FieldDescription size="comfortable" id={hintId} className="basis-full">
            {def.hint}
          </FieldDescription>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-1">
        <Input
          size="comfortable"
          id={id}
          aria-describedby={descriptionId}
          aria-invalid={invalid || undefined}
          aria-required={required || undefined}
          value={strVal}
          className={def.type === "number" ? "max-w-40" : ""}
          inputMode={def.type === "number" ? "decimal" : undefined}
          placeholder={def.placeholder ?? (def.type === "number" ? "0" : "")}
          onChange={(e) => {
            const next = e.target.value;
            onChange(next === "" ? undefined : next);
          }}
          onKeyDown={stopCliInputHotkeyPropagation}
        />
        {active && !required && (
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label={`Clear ${def.label}`}
            onClick={() => onChange(undefined)}
          >
            <X aria-hidden />
          </Button>
        )}
      </div>
      <DetectedChoicesHelper
        label={def.label}
        options={options}
        multi={false}
        selectedMulti={[]}
        selectedSingle={strVal}
        onPickMulti={() => {}}
        onPickSingle={(val) => onChange(!required && strVal === val ? undefined : val)}
      />
      {def.type === "choice" && options.length === 0 && (
        <FieldDescription size="comfortable">
          No suggested values for this film yet. Enter your own value.
        </FieldDescription>
      )}
    </Field>
  );
}
export function CliFieldControl({
  visible = true,
  ...props
}: Parameters<typeof CliFieldContent>[0] & { visible?: boolean }) {
  return (
    <Collapsible open={visible} className="contents">
      <CollapsibleContent
        className={props.def.type === "number" ? "min-w-0" : "col-span-full min-w-0"}
      >
        <CliFieldContent {...props} />
      </CollapsibleContent>
    </Collapsible>
  );
}
