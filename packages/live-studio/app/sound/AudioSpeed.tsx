import { useId, useState } from "react";

import { Field, FieldLabel } from "@/components/ui/field";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

import { FieldRow, Reset, Section, ValueBox } from "../components/inspector";
import { AudioStatus } from "./AudioStatus";
import { reverseBeats } from "./beat-marks";
import { retimedLength } from "./retime";
import type { ClipRef } from "./slice";
import { clipOf, clockOf, edit, setRate, span } from "./sound";

export function AudioSpeed({ clip }: { clip: ClipRef }) {
  const [draft, setDraft] = useState<number | null>(null),
    c = clipOf(clip)!,
    pitchId = useId(),
    revId = useId();
  const [from, to] = span(clip),
    rate = c.rate ?? 1,
    shown = draft ?? rate;
  const commit = (v: number) => {
    setDraft(null);
    setRate(clip, v);
  };
  return (
    <Section
      title="Speed"
      right={<Reset label="Reset audio speed" disabled={rate === 1} onClick={() => commit(1)} />}
    >
      <div className="flex items-center gap-2">
        <Slider
          className="min-w-0 flex-1"
          min={0.1}
          max={10}
          step={0.01}
          value={shown}
          aria-label="Audio speed"
          onKeyDown={(e) => {
            if (e.key === "Escape") setDraft(null);
          }}
          onValueChange={(v) => setDraft(typeof v === "number" ? v : v[0])}
          onValueCommitted={(v) => commit(typeof v === "number" ? v : v[0])}
        />
        <ValueBox
          name="Audio speed"
          value={shown}
          min={0.1}
          max={10}
          step={0.01}
          digits={2}
          unit="x"
          onSave={commit}
        />
      </div>
      <p className="text-muted-foreground text-xs tabular-nums">
        Duration {(to - from).toFixed(2)}s
        {draft !== null && ` → ${retimedLength(c, to - from, shown, from, clockOf(c)).toFixed(2)}s`}
      </p>
      <Field orientation="horizontal" className="justify-between">
        <FieldLabel htmlFor={pitchId} variant="inline">
          Change audio pitch
        </FieldLabel>
        <Switch
          id={pitchId}
          checked={!!c.changePitch}
          onCheckedChange={(v) =>
            edit((l) => {
              l[clip.list][clip.i].changePitch = v;
            })
          }
        />
      </Field>
      <FieldRow label="Pitch">
        <ValueBox
          name="Audio pitch"
          value={c.pitch ?? 0}
          min={-24}
          max={24}
          step={1}
          digits={0}
          unit="st"
          onSave={(v) =>
            edit((l) => {
              l[clip.list][clip.i].pitch = v;
            })
          }
        />
      </FieldRow>
      <Field orientation="horizontal" className="justify-between">
        <FieldLabel htmlFor={revId} variant="inline">
          Reverse audio
        </FieldLabel>
        <Switch
          id={revId}
          checked={!!c.reverse}
          onCheckedChange={(v) =>
            edit((l) => {
              const c = l[clip.list][clip.i];
              if (!!c.reverse !== v) reverseBeats(c, to - from);
              c.reverse = v;
            })
          }
        />
      </Field>
      <AudioStatus clip={clip} />
    </Section>
  );
}
