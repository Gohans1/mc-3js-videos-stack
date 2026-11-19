import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { FieldRow, Section } from "../components/inspector";
import { S } from "../core/state";
import { stored } from "../core/storage";
import { say, useStudio } from "../core/store";
import { type CamKey, edit, keys, snapshot, takeCamera } from "./cam";
import { cameraKeyColors } from "./camera-key-style";

const labels = [
  { value: "none", label: "Default" },
  { value: "amber", label: "Amber" },
  { value: "blue", label: "Blue" },
  { value: "green", label: "Green" },
  { value: "pink", label: "Pink" },
] as const;
export function CameraKeyStyle({ index }: { index: number }) {
  const key = keys[index];
  return (
    <FieldRow label="Key label">
      <Select<(typeof labels)[number]["value"]>
        items={[...labels]}
        value={key.color ?? "none"}
        disabled={!!key.locked}
        onValueChange={(color) => {
          if (color !== null)
            edit((rows) => {
              rows[index].color = color === "none" ? undefined : color;
            });
        }}
      >
        <SelectTrigger aria-label="Keyframe color">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {labels.map(({ value, label }) => (
            <SelectItem key={value} value={value}>
              {value !== "none" && (
                <i
                  className="size-2.5 rounded-full bg-(color:--key-color)"
                  style={{ "--key-color": cameraKeyColors[value] }}
                />
              )}
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        variant={key.muted ? "default" : "quiet"}
        aria-pressed={!!key.muted}
        disabled={index === 0 || !!key.cut || !!key.locked}
        onClick={() =>
          edit((rows) => {
            rows[index].muted = key.muted ? undefined : true;
          })
        }
      >
        Mute key
      </Button>
    </FieldRow>
  );
}

const slots = ["A", "B"] as const;
const storageKey = (slot: (typeof slots)[number]) =>
  "camera-take:" + encodeURIComponent(S.film) + ":" + slot;
export function CameraTakePicker() {
  const [, refresh] = useState(0);
  useStudio((s) => s.ready);
  return (
    <Section title="Camera takes" closed>
      {slots.map((slot) => (
        <FieldRow key={slot} label={"Take " + slot}>
          <Button
            variant="quiet"
            size="sm"
            onClick={() => {
              if (!stored.set(storageKey(slot), snapshot()))
                return say("This browser could not save Take " + slot);
              refresh((n) => n + 1);
              say("Saved camera Take " + slot);
            }}
          >
            Save {slot}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!stored.get(storageKey(slot))}
            onClick={() => {
              const saved = stored.get(storageKey(slot));
              if (!saved) return;
              try {
                const rows = JSON.parse(saved) as CamKey[];
                if (Array.isArray(rows) && takeCamera(rows)) say("Applied camera Take " + slot);
              } catch {
                say("Take " + slot + " could not be read");
              }
            }}
          >
            Use {slot}
          </Button>
        </FieldRow>
      ))}
    </Section>
  );
}
