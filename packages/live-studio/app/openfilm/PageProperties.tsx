import type { PageProps } from "film-stage/openfilm-page";

import { FieldGroup } from "@/components/ui/field";

import { JsonValue } from "../own/CustomFields";

export interface PageProperty {
  name: string;
  type: string;
  at?: string;
  var?: string;
}

export function PageProperties({
  definitions = [],
  values,
  defaults = {},
  onChange,
}: {
  definitions?: PageProperty[];
  values: PageProps;
  defaults?: PageProps;
  onChange: (value: PageProps) => void;
}) {
  const declared = definitions.flatMap((p) => {
    const map = p.type === "text" ? "text" : "vars",
      key = map === "text" ? p.at : p.var;
    return key ? [{ name: p.name, map: map as "text" | "vars", key }] : [];
  });
  const fields = [
    ...declared,
    ...(["text", "vars"] as const).flatMap((map) =>
      Object.keys({ ...defaults[map], ...values[map] })
        .filter(
          (key) => key !== "--clip-length" && !declared.some((p) => p.map === map && p.key === key),
        )
        .map((key) => ({ name: key.replace(/^--/, "").replaceAll("-", " "), map, key })),
    ),
  ];
  return (
    <FieldGroup>
      {fields.map(({ name, map, key }) => (
        <JsonValue
          key={map + key}
          name={name}
          value={values[map]?.[key] ?? defaults[map]?.[key] ?? ""}
          mode={map === "vars" ? "css" : "json"}
          onChange={(value) =>
            onChange({ ...values, [map]: { ...values[map], [key]: String(value) } })
          }
        />
      ))}
    </FieldGroup>
  );
}
