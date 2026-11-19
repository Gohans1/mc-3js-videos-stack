import type { PracticalState, Vec3 } from "film-stage/lights-meta";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import { FieldRow, Section, SliderRow } from "../components/inspector";
import { NumberField } from "../components/NumberField";
import { ColorKelvinField } from "./ColorKelvinField";
import { addPractical, lightsDocAdapter, mutateLightAt, removePractical } from "./lights";

function Vec3Row({
  label,
  value,
  onSave,
}: {
  label: string;
  value: Vec3;
  onSave: (next: Vec3) => void;
}) {
  const axes = ["X", "Y", "Z"] as const;
  return (
    <FieldRow label={label}>
      <div className="grid grid-cols-3 gap-1">
        {axes.map((axis, idx) => (
          <div key={axis} className="flex items-center gap-0.5">
            <span className="text-muted-foreground text-tag w-3">{axis}</span>
            <NumberField
              name={`${label} ${axis}`}
              size="xs"
              value={value[idx]}
              step={0.1}
              digits={2}
              onSave={(v) => {
                if (v === undefined) return;
                const copy: Vec3 = [...value];
                copy[idx] = v;
                onSave(copy);
              }}
            />
          </div>
        ))}
      </div>
    </FieldRow>
  );
}

interface PracticalSectionProps {
  practicals: PracticalState[];
  t: number;
}

export function PracticalSection({ practicals, t }: PracticalSectionProps) {
  const updatePractical = (id: string, patch: Partial<PracticalState>, keep = true) => {
    mutateLightAt(
      t,
      (s) => {
        const idx = s.practicals.findIndex((p) => p.id === id);
        if (idx >= 0) s.practicals[idx] = { ...s.practicals[idx], ...patch };
      },
      keep,
    );
  };

  const bind = (id: string, patch: (v: number) => Partial<PracticalState>) => ({
    doc: lightsDocAdapter,
    preview: (v: number) => updatePractical(id, patch(v), false),
    save: (v: number) => updatePractical(id, patch(v), true),
  });

  return (
    <Section
      title={`Practicals (${practicals.length})`}
      closed={practicals.length === 0}
      right={
        <div className="flex items-center gap-1">
          <Button type="button" size="xs" variant="ghost" onClick={() => addPractical("point", t)}>
            <Plus className="size-3" />
            Point
          </Button>
          <Button type="button" size="xs" variant="ghost" onClick={() => addPractical("spot", t)}>
            <Plus className="size-3" />
            Spot
          </Button>
        </div>
      }
    >
      {practicals.length === 0 ? (
        <p className="text-muted-foreground px-1 py-1 text-xs">
          No practical lights on this frame. Add a point or spot practical.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {practicals.map((p) => {
            const flickerCfg =
              typeof p.flicker === "object" && p.flicker !== null ? p.flicker : null;
            const flickerOn = !!p.flicker;
            return (
              <div
                key={p.id}
                className="border-hairline bg-card/50 flex flex-col gap-1.5 rounded-md border p-2"
              >
                <div className="flex items-center gap-1.5">
                  <span className="border-hairline text-muted-foreground text-tag rounded border px-1.5 py-0.5 uppercase">
                    {p.kind}
                  </span>
                  <Input
                    size="xs"
                    aria-label={`Practical ${p.name} name`}
                    value={p.name}
                    onKeyDown={(e) => e.stopPropagation()}
                    onChange={(e) => updatePractical(p.id, { name: e.target.value })}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Remove ${p.name}`}
                    onClick={() => removePractical(p.id, t)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>

                <ColorKelvinField
                  label="Color"
                  value={p.color}
                  onChange={(color) => updatePractical(p.id, { color })}
                />

                <SliderRow
                  compact
                  label="Intensity"
                  value={p.intensity}
                  min={0}
                  max={20}
                  step={0.1}
                  digits={1}
                  {...bind(p.id, (intensity) => ({ intensity }))}
                />
                <SliderRow
                  compact
                  label="Distance"
                  value={p.distance}
                  min={0}
                  max={60}
                  step={0.5}
                  digits={1}
                  unit="m"
                  {...bind(p.id, (distance) => ({ distance }))}
                />
                <SliderRow
                  compact
                  label="Decay"
                  value={p.decay}
                  min={0}
                  max={4}
                  step={0.1}
                  digits={1}
                  {...bind(p.id, (decay) => ({ decay }))}
                />

                <Vec3Row label="At" value={p.at} onSave={(at) => updatePractical(p.id, { at })} />

                {p.kind === "spot" && (
                  <>
                    <Vec3Row
                      label="Target"
                      value={p.target ?? [p.at[0], 0, p.at[2]]}
                      onSave={(target) => updatePractical(p.id, { target })}
                    />
                    <SliderRow
                      compact
                      label="Angle"
                      value={p.angle ?? 42}
                      min={1}
                      max={89}
                      step={1}
                      digits={0}
                      unit="°"
                      {...bind(p.id, (angle) => ({ angle }))}
                    />
                    <SliderRow
                      compact
                      label="Penumbra"
                      value={p.penumbra ?? 0.4}
                      min={0}
                      max={1}
                      step={0.02}
                      digits={2}
                      {...bind(p.id, (penumbra) => ({ penumbra }))}
                    />
                  </>
                )}

                <FieldRow label="Flicker">
                  <div className="flex items-center justify-end">
                    <Switch
                      aria-label={`${p.name} flicker`}
                      checked={flickerOn}
                      onCheckedChange={(checked) =>
                        updatePractical(p.id, {
                          flicker: checked
                            ? {
                                rate: flickerCfg?.rate ?? 8,
                                amount: flickerCfg?.amount ?? 0.25,
                                seed: flickerCfg?.seed ?? 1,
                              }
                            : false,
                        })
                      }
                    />
                  </div>
                </FieldRow>

                {flickerOn && (
                  <>
                    <SliderRow
                      compact
                      label="Rate"
                      value={flickerCfg?.rate ?? flickerCfg?.speed ?? 8}
                      min={1}
                      max={30}
                      step={0.5}
                      digits={1}
                      unit="Hz"
                      {...bind(p.id, (rate) => ({
                        flicker: {
                          rate,
                          amount: flickerCfg?.amount ?? 0.25,
                          seed: flickerCfg?.seed ?? 1,
                        },
                      }))}
                    />
                    <SliderRow
                      compact
                      label="Amount"
                      value={flickerCfg?.amount ?? 0.25}
                      min={0}
                      max={1}
                      step={0.02}
                      digits={2}
                      {...bind(p.id, (amount) => ({
                        flicker: {
                          rate: flickerCfg?.rate ?? flickerCfg?.speed ?? 8,
                          amount,
                          seed: flickerCfg?.seed ?? 1,
                        },
                      }))}
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}
