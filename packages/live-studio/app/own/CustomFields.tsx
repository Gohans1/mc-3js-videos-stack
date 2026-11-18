import { useId } from "react";

import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import { Section, ValueBox } from "../components/inspector";
import { editableFields, type FieldPath } from "./custom-fields";

export function JsonValue({
  name,
  value,
  onChange,
  mode = "json",
}: {
  name: string;
  value: unknown;
  onChange: (value: unknown) => void;
  mode?: "json" | "css";
}) {
  const id = useId();
  if (value && typeof value === "object")
    return (
      <details className="min-w-0" open>
        <summary className="text-ui text-muted-foreground cursor-pointer py-1 wrap-anywhere">
          {name}
        </summary>
        <div className="border-border mt-1 border-s ps-3">
          <FieldGroup>
            {Object.entries(value)
              .filter(([key]) => !["__timing", "timebase"].includes(key))
              .map(([key, child]) => (
                <JsonValue
                  key={key}
                  name={Array.isArray(value) ? `${name} ${Number(key) + 1}` : key}
                  value={child}
                  mode={mode}
                  onChange={(next) => {
                    const copy = structuredClone(value) as Record<string, unknown>;
                    copy[key] = next;
                    onChange(copy);
                  }}
                />
              ))}
          </FieldGroup>
        </div>
      </details>
    );
  const str = typeof value === "string" ? value : JSON.stringify(value);
  const rgb = typeof value === "string" ? /^rgb\((\d+)[, ]+(\d+)[, ]+(\d+)\)$/.exec(value) : null;
  const color = rgb
    ? "#" +
      rgb
        .slice(1)
        .map((x) => Number(x).toString(16).padStart(2, "0"))
        .join("")
    : typeof value === "string" && /^#[\da-f]{6}$/i.test(value)
      ? value
      : null;
  const number =
    mode === "css" && typeof value === "string"
      ? /^(-?\d+(?:\.\d+)?)(px|em|rem|vh|vw|%|s|ms|deg)?$/.exec(value)
      : null;
  return (
    <Field orientation="horizontal" className="min-w-0 items-center">
      <FieldLabel variant="compact" htmlFor={id} className="min-w-0 flex-1 wrap-anywhere">
        {name}
      </FieldLabel>
      {typeof value === "boolean" ? (
        <Switch id={id} checked={value} onCheckedChange={onChange} aria-label={name} />
      ) : typeof value === "number" || number ? (
        <ValueBox
          name={name}
          value={number ? Number(number[1]) : (value as number)}
          step={0.1}
          digits={3}
          unit={number?.[2]}
          onSave={(next) => onChange(number ? `${next}${number[2] ?? ""}` : next)}
        />
      ) : typeof value === "string" ? (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {color && (
            <Input
              type="color"
              size="xsTight"
              aria-label={`${name} picker`}
              value={color}
              onChange={(e) => onChange(e.target.value)}
              className="w-9 shrink-0"
            />
          )}
          {value.includes("\n") ? (
            <Textarea
              id={id}
              aria-label={name}
              key={value}
              defaultValue={value}
              onBlur={(e) => {
                if (e.target.value !== value) onChange(e.target.value);
              }}
            />
          ) : (
            <Input
              id={id}
              aria-label={name}
              key={value}
              defaultValue={value}
              className="h-8 min-w-0"
              onBlur={(e) => {
                if (e.target.value !== value) onChange(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  e.currentTarget.value = value;
                  e.currentTarget.blur();
                }
              }}
            />
          )}
        </div>
      ) : (
        <span className="text-muted-foreground text-ui">{str ?? "Not editable"}</span>
      )}
    </Field>
  );
}

export function CustomFields({
  value,
  known = [],
  onChange,
}: {
  value: Record<string, unknown>;
  known?: readonly string[];
  onChange: (path: FieldPath, value: unknown) => void;
}) {
  const fields = editableFields(value, known);
  if (!fields.length) return null;
  return (
    <Section title="Custom fields" closed>
      <FieldGroup>
        {fields.map(({ path, value: item }) => (
          <JsonValue
            key={JSON.stringify(path)}
            name={path.join(" · ")}
            value={item}
            onChange={(next) => onChange(path, next)}
          />
        ))}
      </FieldGroup>
    </Section>
  );
}
