import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { Section } from "../components/inspector";
import { onWake } from "../core/state";
import { JsonValue } from "../own/CustomFields";
import { pageLayers, selectPageElement, updateElement } from "./onpicture";
import { PageProperties } from "./PageProperties";
import { openFilmDoc, useOpenFilm } from "./state";

export function PageInspector({ itemId }: { itemId: string }) {
  const selected = useOpenFilm((s) =>
    s.selection.kind === "element" && s.selection.id === itemId ? s.selection.selector : null,
  );
  useOpenFilm((s) => s.doc.revision);
  const [, refresh] = useState(0);
  useEffect(() => {
    let timer = 0;
    const schedule = () => {
      if (!timer)
        timer = window.setTimeout(() => {
          timer = 0;
          refresh((n) => n + 1);
        }, 120);
    };
    const off = onWake("rendered", schedule);
    schedule();
    return () => {
      off();
      clearTimeout(timer);
    };
  }, []);
  const layer = pageLayers().find((it) => it.id === itemId);
  const item = openFilmDoc.data?.items.find((it) => it.id === itemId);
  const [property, setProperty] = useState("");
  const [propertyError, setPropertyError] = useState("");
  if (!item) return null;
  const element = layer?.elements.find((el) => el.selector === selected);
  const override = item.elements?.find((el) => el.selector === selected);
  const change = (patch: Parameters<typeof updateElement>[2]) =>
    openFilmDoc.edit((data) => {
      const next = data.items.find((it) => it.id === itemId);
      if (next && selected) updateElement(next, selected, patch);
    });
  return (
    <div className="flex flex-col gap-2">
      <Section title="Page elements">
        {selected && (
          <Button size="sm" variant="quiet" onClick={() => selectPageElement(itemId, null)}>
            Back to layer
          </Button>
        )}
        <div
          role="list"
          aria-label="Page elements"
          className="flex max-h-48 flex-col gap-1 overflow-y-auto"
        >
          {(layer?.elements ?? []).map((el) => (
            <Button
              key={el.selector}
              variant="quiet"
              size="row"
              aria-pressed={el.selector === selected}
              onClick={() => selectPageElement(itemId, el.selector)}
              className="w-full justify-start"
            >
              <span className="truncate">{el.label}</span>
            </Button>
          ))}
        </div>
        {!layer && (
          <p className="text-ui text-muted-foreground">
            Move the playhead inside this layer to edit its elements.
          </p>
        )}
      </Section>
      {element && (
        <Section title={element.label}>
          {!element.translateMatrix && (
            <p className="text-ui text-muted-foreground">
              Use Position offset to move this element.
            </p>
          )}
          <FieldGroup>
            {element.text !== undefined && (
              <JsonValue
                name="Text"
                value={override?.text ?? element.text}
                onChange={(text) => change({ text: String(text) })}
              />
            )}
            {(["translate", "scale", "rotate"] as const).map((key) => (
              <JsonValue
                key={key}
                name={
                  key === "translate" ? "Position offset" : key === "scale" ? "Scale" : "Rotation"
                }
                value={override?.[key] ?? (key === "translate" ? [0, 0] : key === "scale" ? 1 : 0)}
                onChange={(value) => {
                  if (key === "scale" && Number(value) <= 0) return;
                  change({ [key]: value });
                }}
              />
            ))}
            {Object.entries(element.style).map(([key, value]) => (
              <JsonValue
                key={key}
                name={key.replaceAll("-", " ")}
                value={override?.style?.[key] ?? value}
                mode="css"
                onChange={(next) => change({ style: { [key]: String(next) } })}
              />
            ))}
          </FieldGroup>
          <div className="mt-3 flex gap-2">
            <Input
              aria-label="CSS property name"
              placeholder="Another CSS property"
              value={property}
              onChange={(e) => {
                setProperty(e.target.value);
                setPropertyError("");
              }}
              aria-invalid={!!propertyError}
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={!property.trim()}
              onClick={() => {
                if (CSS.supports(property.trim(), "initial")) {
                  change({ style: { [property.trim()]: "initial" } });
                  setProperty("");
                  setPropertyError("");
                } else setPropertyError("Enter a valid CSS property name.");
              }}
            >
              Add
            </Button>
          </div>
          {propertyError && (
            <p role="alert" className="text-destructive text-ui">
              {propertyError}
            </p>
          )}
          {Object.entries(override?.style ?? {})
            .filter(([key]) => !(key in element.style))
            .map(([key, value]) => (
              <JsonValue
                key={key}
                name={key}
                value={value}
                mode="css"
                onChange={(next) => change({ style: { [key]: String(next) } })}
              />
            ))}
          <Button
            className="mt-3"
            variant="quiet"
            size="sm"
            disabled={!override}
            onClick={() =>
              openFilmDoc.edit((data) => {
                const it = data.items.find((x) => x.id === itemId)!;
                it.elements = it.elements?.filter((x) => x.selector !== selected);
              })
            }
          >
            Reset element to source
          </Button>
        </Section>
      )}
      {!selected && layer?.vars && Object.keys(layer.vars).length > 0 && (
        <Section title="Page properties">
          <PageProperties
            values={item}
            defaults={{ vars: layer.vars }}
            onChange={(props) =>
              openFilmDoc.edit((data) => {
                Object.assign(
                  data.items.find((it) => it.id === itemId)!,
                  props,
                );
              })
            }
          />
        </Section>
      )}
    </div>
  );
}
