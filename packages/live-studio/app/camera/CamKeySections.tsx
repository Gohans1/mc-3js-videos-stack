import { fromSource, toSource } from "film/edit";
import { Activity, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";

import { FieldRow } from "../components/inspector";
import { NumberField } from "../components/NumberField";
import { Tip } from "../components/Tip";
import { S } from "../core/state";
import { stamp } from "../core/time";
import { useFrame } from "../core/useFrame";
import { addShotHit, removeShotHit, shotHitsOf, shotsDoc, updateShotHit } from "./shots";

function LivePlayheadLabel() {
  useFrame();
  return <span className="tabular-nums">{stamp(S.t)}</span>;
}

export function ShotHitsSection({ shot }: { shot: number }) {
  const hits = shotHitsOf(shot);
  return (
    <div className="flex flex-col gap-2">
      <FieldRow label="Impacts">
        <Tip label="Add an Eiserloh camera trauma hit on this shot at the current playhead">
          <Button variant="outline" size="sm" onClick={() => addShotHit(shot, toSource(S.t), 0.6)}>
            <Activity data-icon="inline-start" aria-hidden />
            Add at <LivePlayheadLabel />
          </Button>
        </Tip>
      </FieldRow>
      {hits.map((h, j) => (
        <div
          key={`${shot}-${j}`}
          className="border-input bg-backdrop/50 flex flex-col gap-1.5 rounded-md border p-2"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-ui font-medium">Impact {j + 1}</span>
            <Button
              variant="remove"
              size="icon"
              aria-label={`Delete impact ${j + 1}`}
              onClick={() => removeShotHit(shot, j)}
            >
              <Trash2 />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground w-10 text-xs">At</span>
              <NumberField
                name={`Impact ${j + 1} time`}
                size="xs"
                value={fromSource(h.t)}
                step={0.05}
                digits={2}
                onSave={(v) => v !== undefined && updateShotHit(shot, j, { t: toSource(v) })}
              />
              <span className="text-muted-foreground text-xs">s</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground w-10 text-xs">Strength</span>
              <NumberField
                name={`Impact ${j + 1} strength`}
                size="xs"
                value={Number(h.amount ?? 0.6)}
                min={0}
                max={5}
                step={0.05}
                digits={2}
                live={(v) => updateShotHit(shot, j, { amount: v }, shotsDoc.preview)}
                onCancel={() => shotsDoc.restore(shotsDoc.snapshot())}
                onSave={(v) => v !== undefined && updateShotHit(shot, j, { amount: v })}
              />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground w-10 text-xs">Decay</span>
              <NumberField
                name={`Impact ${j + 1} decay`}
                size="xs"
                value={Number(h.decay ?? 1.5)}
                min={0.1}
                max={10}
                step={0.1}
                digits={1}
                onSave={(v) => v !== undefined && updateShotHit(shot, j, { decay: v })}
              />
              <span className="text-muted-foreground text-xs">s</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground w-10 text-xs">Freq</span>
              <NumberField
                name={`Impact ${j + 1} frequency`}
                size="xs"
                value={Number(h.freq ?? 14)}
                min={1}
                max={60}
                step={1}
                digits={0}
                onSave={(v) => v !== undefined && updateShotHit(shot, j, { freq: v })}
              />
              <span className="text-muted-foreground text-xs">Hz</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
