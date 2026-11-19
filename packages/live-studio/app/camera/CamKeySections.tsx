import { type FocusTargetSpec, type ShakeName, SHAKES } from "film-stage/camera";
import { fromSource, toSource } from "film/edit";
import { Activity, Crosshair, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { FieldRow, Reset, Section, Segmented, SliderRow } from "../components/inspector";
import { NumberField } from "../components/NumberField";
import { Tip } from "../components/Tip";
import { S } from "../core/state";
import { set, useStudio } from "../core/store";
import { stamp } from "../core/time";
import { useFrame } from "../core/useFrame";
import {
  type CamKey,
  focusTargetNames,
  type HandheldSpec,
  type Point,
  preview,
  resetLensField,
  restore,
  setFocus,
  setFstop,
  setHandheld,
  setKeyPoint,
  setLens,
  snapshot,
} from "./cam";
import { addShotHit, removeShotHit, shotHitsOf, shotsDoc, updateShotHit } from "./shots";

const camDoc = { snapshot, restore };
const AXES = ["X", "Y", "Z"] as const;
const SHAKE_SET = new Map<string, ShakeName>(SHAKES.map((s) => [s.toUpperCase(), s]));

const formatShakeTitle = (id: ShakeName) =>
  id
    .toLowerCase()
    .split("_")
    .map((w) => (w === "2d" ? "2D" : `${w[0]?.toUpperCase() ?? ""}${w.slice(1)}`))
    .join(" ");

interface FocusState {
  mode: "auto" | "meters" | "target";
  meters: number;
  target: string;
  offset: [number, number, number];
}

const readFocusState = (raw: unknown): FocusState => {
  if (raw == null) return { mode: "auto", meters: 3, target: "", offset: [0, 0, 0] };
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return { mode: "meters", meters: Math.max(0.05, raw), target: "", offset: [0, 0, 0] };
  }
  if (typeof raw === "string") {
    return { mode: "target", meters: 3, target: raw, offset: [0, 0, 0] };
  }
  if (typeof raw === "object" && "target" in raw) {
    const obj = raw as { target?: unknown; offset?: unknown };
    const off =
      Array.isArray(obj.offset) && obj.offset.length === 3
        ? ([Number(obj.offset[0]) || 0, Number(obj.offset[1]) || 0, Number(obj.offset[2]) || 0] as [
            number,
            number,
            number,
          ])
        : ([0, 0, 0] as [number, number, number]);
    return {
      mode: "target",
      meters: 3,
      target: typeof obj.target === "string" ? obj.target : "",
      offset: off,
    };
  }
  return { mode: "auto", meters: 3, target: "", offset: [0, 0, 0] };
};

interface HandheldState {
  mode: "inherit" | "off" | ShakeName;
  amount: number;
  move: number;
  speed: number;
  offset: number;
  useKindKey: boolean;
}

const readHandheldState = (raw: unknown): HandheldState => {
  const base: HandheldState = {
    mode: "inherit",
    amount: 1,
    move: 1,
    speed: 1,
    offset: 0,
    useKindKey: false,
  };
  if (raw === undefined) return base;
  if (raw === false) return { ...base, mode: "off" };
  if (typeof raw === "string") {
    const clean = raw.trim().toUpperCase();
    if (!clean || clean === "OFF" || clean === "NONE") return { ...base, mode: "off" };
    return { ...base, mode: SHAKE_SET.get(clean) ?? "THE_CLOSEUP" };
  }
  if (raw && typeof raw === "object") {
    const h = raw as {
      preset?: unknown;
      kind?: unknown;
      amount?: unknown;
      move?: unknown;
      speed?: unknown;
      offset?: unknown;
    };
    const rawCandidate =
      typeof h.preset === "string" ? h.preset : typeof h.kind === "string" ? h.kind : "THE_CLOSEUP";
    const rawName = rawCandidate.trim().toUpperCase();
    if (!rawName || rawName === "OFF" || rawName === "NONE") return { ...base, mode: "off" };
    return {
      mode: SHAKE_SET.get(rawName) ?? "THE_CLOSEUP",
      amount: Number.isFinite(Number(h.amount)) ? Math.max(0, Number(h.amount)) : 1,
      move: Number.isFinite(Number(h.move)) ? Math.max(0, Number(h.move)) : 1,
      speed: Number.isFinite(Number(h.speed)) ? Math.max(0.05, Number(h.speed)) : 1,
      offset: Number.isFinite(Number(h.offset)) ? Number(h.offset) : 0,
      useKindKey: !h.preset && Boolean(h.kind),
    };
  }
  return base;
};

type ParsedPoint =
  | { kind: "world"; xyz: [number, number, number] }
  | { kind: "anchor"; anchor: string; xyz: [number, number, number] }
  | { kind: "raw" };

const readPoint = (pt: Point | undefined): ParsedPoint => {
  if (Array.isArray(pt) && pt.length >= 3) {
    return {
      kind: "world",
      xyz: [Number(pt[0]) || 0, Number(pt[1]) || 0, Number(pt[2]) || 0],
    };
  }
  if (pt && typeof pt === "object") {
    for (const [k, v] of Object.entries(pt)) {
      if (Array.isArray(v) && v.length >= 3) {
        return {
          kind: "anchor",
          anchor: k,
          xyz: [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0],
        };
      }
    }
  }
  return { kind: "raw" };
};

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

function PointRow({
  label,
  keyIndex,
  which,
  point,
}: {
  label: string;
  keyIndex: number;
  which: "p" | "l";
  point: Point;
}) {
  const parsed = readPoint(point);
  const startSnap = useRef<string | null>(null);
  if (parsed.kind === "raw") {
    return (
      <FieldRow label={label}>
        <span className="text-muted-foreground text-xs">Custom anchor</span>
      </FieldRow>
    );
  }
  const writeAxis = (axis: 0 | 1 | 2, v: number, commit: boolean) => {
    const nextXyz: [number, number, number] = [...parsed.xyz];
    nextXyz[axis] = v;
    const nextPoint: Point =
      parsed.kind === "anchor"
        ? { ...(point as Record<string, unknown>), [parsed.anchor]: nextXyz }
        : nextXyz;
    if (!commit) {
      startSnap.current ??= snapshot();
      setKeyPoint(keyIndex, which, nextPoint, preview);
      return;
    }
    if (startSnap.current !== null) {
      restore(startSnap.current);
      startSnap.current = null;
    }
    setKeyPoint(keyIndex, which, nextPoint);
  };
  const cancelAxis = () => {
    if (startSnap.current !== null) {
      restore(startSnap.current);
      startSnap.current = null;
    }
  };
  return (
    <div className="flex flex-col gap-1">
      {parsed.kind === "anchor" && (
        <span className="text-muted-foreground text-xs">
          {label} anchor ({parsed.anchor}) offset
        </span>
      )}
      <FieldRow label={parsed.kind === "anchor" ? "Offset" : label}>
        {AXES.map((axis, idx) => (
          <div key={axis} className="flex min-w-0 flex-1 items-center gap-1">
            <span className="text-muted-foreground text-xs select-none">{axis}</span>
            <NumberField
              name={`${label} ${axis}`}
              size="xs"
              value={parsed.xyz[idx]}
              step={0.1}
              digits={2}
              live={(v) => writeAxis(idx as 0 | 1 | 2, v, false)}
              onCancel={cancelAxis}
              onSave={(v) => v !== undefined && writeAxis(idx as 0 | 1 | 2, v, true)}
            />
          </div>
        ))}
      </FieldRow>
    </div>
  );
}

export function CamKeyExtraSections({ keyIndex, k }: { keyIndex: number; k: CamKey }) {
  const pickingFocus = useStudio((s) => s.pickFocus === keyIndex);
  const focusState = readFocusState(k.focus);
  const targets = focusTargetNames();
  const [customTargetKey, setCustomTargetKey] = useState<string | null>(null);
  const syncKey = `${keyIndex}:${focusState.target}`;
  const targetModeCustom = customTargetKey === syncKey;

  const handheldState = readHandheldState(k.handheld);
  const hhItems = [
    { value: "__inherit__", label: "Default (inherit)" },
    { value: "__off__", label: "Off (steady)" },
    ...SHAKES.map((id) => ({ value: id, label: formatShakeTitle(id) })),
  ];
  const hhSelectValue =
    handheldState.mode === "inherit"
      ? "__inherit__"
      : handheldState.mode === "off"
        ? "__off__"
        : handheldState.mode;

  const commitHandheld = (
    patch: Partial<Omit<HandheldState, "mode">> & { mode?: ShakeName },
    apply?: typeof preview,
  ) => {
    const preset =
      patch.mode ??
      (handheldState.mode === "inherit" || handheldState.mode === "off"
        ? "THE_CLOSEUP"
        : handheldState.mode);
    const next: HandheldSpec = {
      ...(handheldState.useKindKey ? { kind: preset } : { preset }),
      amount: patch.amount ?? handheldState.amount,
      move: patch.move ?? handheldState.move,
      speed: patch.speed ?? handheldState.speed,
      offset: patch.offset ?? handheldState.offset,
    };
    setHandheld(keyIndex, next, apply);
  };

  const commitTarget = (target: string, offset = focusState.offset, apply?: typeof preview) => {
    const clean = target.trim();
    if (!clean) return;
    const spec: FocusTargetSpec = offset.some((n) => Math.abs(n) > 1e-6)
      ? { target: clean, offset }
      : clean;
    setFocus(keyIndex, spec, apply);
  };

  const offsetSnap = useRef<string | null>(null);
  const focusSelectValue = targetModeCustom
    ? "__custom__"
    : targets.includes(focusState.target)
      ? focusState.target
      : focusState.target
        ? "__custom__"
        : (targets[0] ?? "__custom__");
  const targetItems = [
    ...targets.map((name) => ({ value: name, label: name })),
    { value: "__custom__", label: "Custom target name..." },
  ];

  const modeForUi = targetModeCustom && focusState.mode === "auto" ? "target" : focusState.mode;

  return (
    <>
      <Section
        title="Depth of field"
        right={
          <Reset
            label="Reset aperture and focus to default"
            disabled={k.fstop === undefined && k.focus === undefined}
            onClick={() => {
              setFstop(keyIndex, undefined);
              setFocus(keyIndex, undefined);
              setCustomTargetKey(null);
            }}
          />
        }
      >
        <SliderRow
          label="Aperture"
          value={typeof k.fstop === "number" ? k.fstop : 0}
          min={0}
          max={16}
          step={0.1}
          digits={1}
          doc={camDoc}
          reset={{
            label: "Reset aperture to sharp (0)",
            disabled: k.fstop === undefined,
            onClick: () => setFstop(keyIndex, undefined),
          }}
          preview={(v) => setFstop(keyIndex, v, preview)}
          save={(v) => setFstop(keyIndex, v)}
          hint="0 = sharp (off); f/1.4–f/2.8 softens foreground & background"
        />
        <FieldRow label="Focus">
          <Segmented
            label="Focus mode"
            value={modeForUi}
            fit
            items={[
              { id: "auto", title: "Auto" },
              { id: "meters", title: "Manual" },
              { id: "target", title: "Target" },
            ]}
            onChange={(m) => {
              if (m === "auto") {
                setCustomTargetKey(null);
                setFocus(keyIndex, undefined);
              } else if (m === "meters") {
                setCustomTargetKey(null);
                const fallback =
                  focusState.mode === "meters"
                    ? focusState.meters
                    : Math.max(0.1, Math.round((S.tools?.optics?.focusM ?? 3) * 100) / 100);
                setFocus(keyIndex, fallback);
              } else {
                const pick = focusState.target || targets[0] || "";
                if (pick) {
                  setCustomTargetKey(null);
                  commitTarget(pick);
                } else {
                  setCustomTargetKey(syncKey);
                }
              }
            }}
          />
        </FieldRow>
        {modeForUi === "meters" && (
          <SliderRow
            label="Distance"
            value={focusState.meters}
            min={0.1}
            max={40}
            step={0.1}
            digits={2}
            unit="m"
            doc={camDoc}
            reset={{
              label: "Reset focus to auto",
              disabled: k.focus === undefined,
              onClick: () => setFocus(keyIndex, undefined),
            }}
            preview={(v) => setFocus(keyIndex, v, preview)}
            save={(v) => setFocus(keyIndex, v)}
          />
        )}
        {modeForUi === "target" && (
          <div className="flex flex-col gap-2">
            {targets.length > 0 && (
              <FieldRow label="Subject">
                <Select
                  value={focusSelectValue}
                  items={targetItems}
                  onValueChange={(v) => {
                    if (!v || v === "__custom__") {
                      setCustomTargetKey(syncKey);
                      return;
                    }
                    setCustomTargetKey(null);
                    commitTarget(v);
                  }}
                >
                  <SelectTrigger aria-label="Focus target" className="h-7 min-w-0 flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {targetItems.map((it) => (
                      <SelectItem key={it.value} value={it.value}>
                        {it.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldRow>
            )}
            {(targets.length === 0 || focusSelectValue === "__custom__") && (
              <FieldRow label={targets.length ? "Name" : "Subject"}>
                <Input
                  key={syncKey}
                  size="sm"
                  aria-label="Focus target name"
                  placeholder="e.g. Steve.head"
                  defaultValue={focusState.target}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  onBlur={(e) => {
                    setCustomTargetKey(null);
                    commitTarget(e.currentTarget.value);
                  }}
                />
              </FieldRow>
            )}
            <FieldRow label="Offset">
              {AXES.map((axis, idx) => (
                <div key={axis} className="flex min-w-0 flex-1 items-center gap-1">
                  <span className="text-muted-foreground text-xs select-none">{axis}</span>
                  <NumberField
                    name={`Focus offset ${axis}`}
                    size="xs"
                    value={focusState.offset[idx]}
                    step={0.05}
                    digits={2}
                    live={(v) => {
                      const next: [number, number, number] = [...focusState.offset];
                      next[idx] = v;
                      offsetSnap.current ??= snapshot();
                      commitTarget(focusState.target, next, preview);
                    }}
                    onCancel={() => {
                      if (offsetSnap.current !== null) {
                        restore(offsetSnap.current);
                        offsetSnap.current = null;
                      }
                    }}
                    onSave={(v) => {
                      if (offsetSnap.current !== null) {
                        restore(offsetSnap.current);
                        offsetSnap.current = null;
                      }
                      if (v === undefined) return;
                      const next: [number, number, number] = [...focusState.offset];
                      next[idx] = v;
                      commitTarget(focusState.target, next);
                    }}
                  />
                </div>
              ))}
            </FieldRow>
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          <Tip label="Click any object on the frame to measure and lock focus distance (Esc to cancel)">
            <Button
              variant="quiet"
              size="sm"
              aria-pressed={pickingFocus}
              onClick={() => set({ pickFocus: pickingFocus ? null : keyIndex })}
            >
              <Crosshair data-icon="inline-start" aria-hidden />
              {pickingFocus ? "Click frame to focus (Esc)" : "Pick focus on frame"}
            </Button>
          </Tip>
        </div>
      </Section>

      <Section
        title="Motion & shake"
        right={
          <Reset
            label="Reset handheld shake and step bob to default"
            disabled={k.handheld === undefined && k.bob === undefined}
            onClick={() => {
              setHandheld(keyIndex, undefined);
              resetLensField(keyIndex, "bob");
            }}
          />
        }
      >
        <FieldRow label="Handheld">
          <Select
            value={hhSelectValue}
            items={hhItems}
            onValueChange={(v) => {
              if (!v || v === "__inherit__") setHandheld(keyIndex, undefined);
              else if (v === "__off__") setHandheld(keyIndex, false);
              else commitHandheld({ mode: v as ShakeName });
            }}
          >
            <SelectTrigger aria-label="Handheld shake preset" className="h-7 min-w-0 flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {hhItems.map((it) => (
                <SelectItem
                  key={it.value}
                  value={it.value}
                  title={it.value.startsWith("__") ? undefined : it.value}
                >
                  {it.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>
        {handheldState.mode !== "inherit" && handheldState.mode !== "off" && (
          <div className="flex flex-col gap-2">
            <SliderRow
              label="Amount"
              value={handheldState.amount}
              min={0}
              max={3}
              step={0.05}
              digits={2}
              unit="×"
              doc={camDoc}
              preview={(v) => commitHandheld({ amount: v }, preview)}
              save={(v) => commitHandheld({ amount: v })}
            />
            <SliderRow
              label="Move"
              value={handheldState.move}
              min={0}
              max={3}
              step={0.05}
              digits={2}
              unit="×"
              doc={camDoc}
              preview={(v) => commitHandheld({ move: v }, preview)}
              save={(v) => commitHandheld({ move: v })}
            />
            <SliderRow
              label="Speed"
              value={handheldState.speed}
              min={0.1}
              max={3}
              step={0.05}
              digits={2}
              unit="×"
              doc={camDoc}
              preview={(v) => commitHandheld({ speed: v }, preview)}
              save={(v) => commitHandheld({ speed: v })}
            />
            <SliderRow
              label="Offset"
              value={handheldState.offset}
              min={0}
              max={60}
              step={0.5}
              digits={1}
              unit="s"
              doc={camDoc}
              preview={(v) => commitHandheld({ offset: v }, preview)}
              save={(v) => commitHandheld({ offset: v })}
            />
          </div>
        )}
        <SliderRow
          label="Step bob"
          value={typeof k.bob === "number" ? k.bob : 0}
          min={0}
          max={3}
          step={0.05}
          digits={2}
          unit="×"
          doc={camDoc}
          reset={{
            label: "Reset step bob to default",
            disabled: k.bob === undefined,
            onClick: () => resetLensField(keyIndex, "bob"),
          }}
          preview={(v) => setLens(keyIndex, "bob", v, preview)}
          save={(v) => setLens(keyIndex, "bob", v)}
          hint="Subtle footstep bounce while the camera translates"
        />
      </Section>

      <Section title="Coordinates">
        <PointRow label="Position" keyIndex={keyIndex} which="p" point={k.p} />
        <PointRow label="Look-At" keyIndex={keyIndex} which="l" point={k.l} />
      </Section>
    </>
  );
}
