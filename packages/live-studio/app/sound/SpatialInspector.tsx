import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { focusTargetNames, keys as camKeys } from "../camera/cam";
import { FieldRow, Reset, Section, Segmented, SliderRow, ValueBox } from "../components/inspector";
import { Tip } from "../components/Tip";
import { SHOTS } from "../core/filmMeta";
import { S } from "../core/state";
import { r3 } from "../core/time";
import { useFrame } from "../core/useFrame";
import { placedData } from "../objects/placed-data";
import {
  defaultReverbParams,
  isPresetSpace,
  resolveClipReverb,
  resolveReverbSpec,
  REVERB_SPACES,
} from "./ir";
import {
  availableSpatialTargets,
  registerSceneSpatialProvider,
  sceneCameraPoseAt,
  sceneTargetAt,
} from "./scene-spatial";
import type { ClipRef } from "./slice";
import {
  type Bed,
  edit,
  lanes,
  type OneShot,
  preview,
  restore,
  setClipReverb,
  setClipSpatial,
  setFilmReverb,
  setShotSpace,
  snapshot,
} from "./sound";
import {
  computeSpatialParams,
  isSpatialActive,
  offsetPosition,
  SPATIAL_DEFAULTS,
  type SpatialSpec,
  type Vec3,
} from "./spatial";

const soundDoc = { snapshot, restore };

registerSceneSpatialProvider({
  getCamKeys: () => camKeys,
  getPlaced: placedData,
  getTargetNames: focusTargetNames,
});

const SPACE_LABELS: Record<string, string> = {
  __inherit__: "Inherit (shot / film)",
  dry: "Dry (off)",
  "small-room": "Small room",
  hall: "Hall",
  stairwell: "Stairwell",
  cave: "Cave",
  outdoor: "Outdoor",
  __custom__: "Custom IR WAV…",
};

const currentShotWindow = (t: number): [number, number] | null => {
  if (!SHOTS.length) return null;
  let idx = 0;
  for (let i = 0; i < SHOTS.length; i++) {
    if (SHOTS[i].t <= t + 1e-4) idx = i;
  }
  const from = SHOTS[idx].t;
  const maxBed = lanes?.beds.reduce((m, b) => Math.max(m, b.to), from + 1) ?? from + 1;
  const to = SHOTS[idx + 1]?.t ?? Math.max(from + 1, maxBed);
  return [from, to];
};

export function ReverbSection({
  clip,
  c,
  from,
  to,
}: {
  clip: ClipRef;
  c: Bed | OneShot;
  from: number;
  to: number;
}) {
  const mid = 0.5 * (from + to);
  const inherited = resolveClipReverb(undefined, mid, lanes?.spaces, lanes?.reverb);
  const clipSpec = c.reverb;
  const isCustom = Boolean(clipSpec && !isPresetSpace(clipSpec.space));
  const [customRequested, setCustomRequested] = useState(false);
  const [customDraft, setCustomDraft] = useState<string | null>(null);

  const customOpen = isCustom || customRequested;
  const shownPath = customDraft ?? (isCustom ? clipSpec!.space : "");

  const selectValue = !clipSpec
    ? customRequested
      ? "__custom__"
      : "__inherit__"
    : isPresetSpace(clipSpec.space)
      ? customRequested
        ? "__custom__"
        : clipSpec.space
      : "__custom__";

  const activeResolved = resolveReverbSpec(clipSpec);
  const shotWin = currentShotWindow(mid);

  const onSelectSpace = (val: string | null) => {
    if (!val) return;
    if (val === "__inherit__") {
      setCustomRequested(false);
      setCustomDraft(null);
      setClipReverb(clip, undefined);
      return;
    }
    if (val === "__custom__") {
      setCustomRequested(true);
      const path = shownPath.trim();
      if (path) {
        const defs = defaultReverbParams(path);
        setClipReverb(clip, {
          space: path,
          wet: clipSpec?.wet ?? defs.wet,
          preDelayMs: clipSpec?.preDelayMs ?? defs.preDelayMs,
        });
      }
      return;
    }
    setCustomRequested(false);
    setCustomDraft(null);
    if (val === "dry") {
      setClipReverb(clip, { space: "dry" });
      return;
    }
    const defs = defaultReverbParams(val);
    setClipReverb(clip, {
      space: val,
      wet: clipSpec && clipSpec.space !== "dry" ? (clipSpec.wet ?? defs.wet) : defs.wet,
      preDelayMs:
        clipSpec && clipSpec.space !== "dry"
          ? (clipSpec.preDelayMs ?? defs.preDelayMs)
          : defs.preDelayMs,
    });
  };

  const updateReverb = (patch: { wet?: number; preDelayMs?: number }, commit: boolean) => {
    if (!clipSpec || clipSpec.space === "dry") return;
    const apply = commit ? edit : preview;
    apply((l) => {
      const target = (clip.list === "beds" ? l.beds : l.sfx)[clip.i];
      const defs = defaultReverbParams(clipSpec.space);
      target.reverb = {
        space: clipSpec.space,
        wet: r3(patch.wet ?? clipSpec.wet ?? defs.wet),
        preDelayMs: Math.round(patch.preDelayMs ?? clipSpec.preDelayMs ?? defs.preDelayMs),
      };
    });
  };

  const commitCustomPath = (raw: string) => {
    const cleaned = raw.trim();
    setCustomDraft(null);
    if (!cleaned) return;
    const defs = defaultReverbParams(cleaned);
    setClipReverb(clip, {
      space: cleaned,
      wet: clipSpec?.wet ?? defs.wet,
      preDelayMs: clipSpec?.preDelayMs ?? defs.preDelayMs,
    });
  };

  const spaceItems = [
    { value: "__inherit__", label: SPACE_LABELS.__inherit__ },
    ...REVERB_SPACES.map((sp) => ({ value: sp, label: SPACE_LABELS[sp] ?? sp })),
    { value: "__custom__", label: SPACE_LABELS.__custom__ },
  ];

  const badCustomPath =
    shownPath.includes("..") ||
    shownPath.startsWith("/") ||
    shownPath.startsWith("\\") ||
    /^[A-Za-z]:/.test(shownPath);

  return (
    <Section
      title="Space / Reverb"
      right={
        <Reset
          label="Clear clip reverb override"
          disabled={!clipSpec}
          onClick={() => {
            setCustomRequested(false);
            setCustomDraft(null);
            setClipReverb(clip, undefined);
          }}
        />
      }
    >
      <FieldRow label="Space">
        <Select items={spaceItems} value={selectValue} onValueChange={onSelectSpace}>
          <SelectTrigger className="h-8 w-full min-w-0" aria-label="Acoustic space">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {spaceItems.map((it) => (
              <SelectItem key={it.value} value={it.value}>
                {it.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldRow>

      {!clipSpec && inherited && (
        <p className="text-muted-foreground text-xs">
          Inheriting {inherited.space} ({Math.round(inherited.wet * 100)}% wet)
        </p>
      )}

      {customOpen && (
        <div className="flex flex-col gap-1">
          <FieldRow label="IR WAV">
            <Input
              value={shownPath}
              placeholder="assets/ir/room.wav"
              aria-label="Custom impulse response WAV path"
              className="h-8"
              onChange={(e) => setCustomDraft(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter" && !badCustomPath) {
                  commitCustomPath(shownPath);
                  e.currentTarget.blur();
                }
              }}
              onBlur={() => {
                if (!badCustomPath && shownPath.trim()) commitCustomPath(shownPath);
                else setCustomDraft(null);
              }}
            />
          </FieldRow>
          {badCustomPath && (
            <p className="text-warn-text text-xs">
              Path must stay inside the film folder (no .. or leading /).
            </p>
          )}
        </div>
      )}

      {activeResolved && clipSpec && (
        <>
          <SliderRow
            label="Wet"
            value={Math.round(activeResolved.wet * 100)}
            min={0}
            max={100}
            step={1}
            digits={0}
            unit="%"
            doc={soundDoc}
            preview={(v) => updateReverb({ wet: v / 100 }, false)}
            save={(v) => updateReverb({ wet: v / 100 }, true)}
          />
          <SliderRow
            label="Pre-delay"
            value={Math.round(activeResolved.preDelayMs)}
            min={0}
            max={250}
            step={1}
            digits={0}
            unit="ms"
            doc={soundDoc}
            preview={(v) => updateReverb({ preDelayMs: v }, false)}
            save={(v) => updateReverb({ preDelayMs: v }, true)}
          />
          <FieldRow label="Default">
            <div className="flex min-w-0 flex-1 gap-1.5">
              {shotWin && (
                <Tip label="Use this reverb as the acoustic space for this shot">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-7 min-w-0 flex-1"
                    onClick={() => setShotSpace(shotWin[0], shotWin[1], clipSpec)}
                  >
                    Shot space
                  </Button>
                </Tip>
              )}
              <Tip label="Use this reverb as the film default acoustic space">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-7 min-w-0 flex-1"
                  onClick={() => setFilmReverb(clipSpec)}
                >
                  Film default
                </Button>
              </Tip>
            </div>
          </FieldRow>
        </>
      )}
    </Section>
  );
}

export function SpatialSection({ clip, c }: { clip: ClipRef; c: Bed | OneShot }) {
  useFrame();
  const t = S.t;
  const airLpfId = useId();
  const active = isSpatialActive(c.spatial);
  const spec = c.spatial ?? {};
  const mode: "off" | "world" | "target" = !active ? "off" : spec.target ? "target" : "world";

  const targets = availableSpatialTargets();
  const [customRequested, setCustomRequested] = useState(false);
  const [targetDraft, setTargetDraft] = useState<string | null>(null);

  const isCustomTarget = customRequested || Boolean(spec.target && !targets.includes(spec.target));
  const shownTarget = targetDraft ?? spec.target ?? "";

  const setMode = (next: "off" | "world" | "target") => {
    if (next === mode) return;
    if (next === "off") {
      setCustomRequested(false);
      setTargetDraft(null);
      setClipSpatial(clip, undefined);
      return;
    }
    const base: SpatialSpec = {
      refDistance: spec.refDistance ?? SPATIAL_DEFAULTS.refDistance,
      maxDistance: spec.maxDistance ?? SPATIAL_DEFAULTS.maxDistance,
      rolloff: spec.rolloff ?? SPATIAL_DEFAULTS.rolloff,
      occlusion: spec.occlusion ?? SPATIAL_DEFAULTS.occlusion,
      airAbsorption: spec.airAbsorption ?? SPATIAL_DEFAULTS.airAbsorption,
    };
    if (next === "world") {
      setCustomRequested(false);
      setTargetDraft(null);
      setClipSpatial(clip, {
        ...base,
        at: spec.at ?? [0, 1.6, 0],
      });
      return;
    }
    const first = spec.target ?? targets[0] ?? "steve";
    setCustomRequested(!targets.includes(first));
    setTargetDraft(null);
    setClipSpatial(clip, {
      ...base,
      target: first,
      offset: spec.offset,
    });
  };

  const patchSpatial = (mut: (s: SpatialSpec) => void, commit: boolean) => {
    const apply = commit ? edit : preview;
    apply((l) => {
      const target = (clip.list === "beds" ? l.beds : l.sfx)[clip.i];
      const next: SpatialSpec = structuredClone(target.spatial ?? { at: [0, 1.6, 0] });
      mut(next);
      target.spatial = next;
    });
  };

  const vec = (field: "at" | "offset"): Vec3 => {
    const raw = spec[field];
    return raw ? [raw[0], raw[1], raw[2]] : field === "at" ? [0, 1.6, 0] : [0, 0, 0];
  };

  const setAxis = (field: "at" | "offset", axis: 0 | 1 | 2, v: number, commit: boolean) => {
    patchSpatial((s) => {
      const base = [...(s[field] ?? (field === "at" ? [0, 1.6, 0] : [0, 0, 0]))] as Vec3;
      base[axis] = r3(v);
      s[field] = base;
    }, commit);
  };

  const refDist = spec.refDistance ?? SPATIAL_DEFAULTS.refDistance;
  const maxDist = Math.max(refDist, spec.maxDistance ?? SPATIAL_DEFAULTS.maxDistance);
  const rolloff = spec.rolloff ?? SPATIAL_DEFAULTS.rolloff;
  const occlusion = spec.occlusion ?? SPATIAL_DEFAULTS.occlusion;
  const airAbs = spec.airAbsorption ?? SPATIAL_DEFAULTS.airAbsorption;

  const targetSelectItems = [
    ...targets.map((name) => ({ value: name, label: name })),
    { value: "__custom__", label: "Custom name…" },
  ];
  const selectTargetVal = isCustomTarget
    ? "__custom__"
    : spec.target && targets.includes(spec.target)
      ? spec.target
      : "__custom__";

  let readout: string | null = null;
  if (active) {
    const cam = sceneCameraPoseAt(t);
    const rawSrc =
      mode === "target" && spec.target ? (sceneTargetAt(spec.target, t) ?? [0, 0, 0]) : vec("at");
    const sp = computeSpatialParams(cam, offsetPosition(rawSrc, spec.offset), spec);
    const panLabel =
      Math.abs(sp.pan) < 0.03
        ? "C"
        : `${sp.pan < 0 ? "L" : "R"}${Math.round(Math.abs(sp.pan) * 100)}`;
    readout = `${panLabel} · ${sp.distance.toFixed(1)}m · ${Math.round(sp.cutoffHz)}Hz`;
  }

  return (
    <Section
      title="3D Spatial Anchor"
      right={
        <Reset
          label="Turn off 3D spatial audio"
          disabled={!active}
          onClick={() => {
            setCustomRequested(false);
            setTargetDraft(null);
            setClipSpatial(clip, undefined);
          }}
        />
      }
    >
      <Segmented
        label="Spatial anchor mode"
        value={mode}
        onChange={setMode}
        items={[
          { id: "off", title: "Off" },
          { id: "world", title: "World XYZ" },
          { id: "target", title: "Target" },
        ]}
      />

      {mode === "world" && (
        <FieldRow label="Position">
          {(["X", "Y", "Z"] as const).map((label, axis) => (
            <ValueBox
              key={label}
              name={`Spatial ${label}`}
              value={vec("at")[axis]}
              step={0.1}
              digits={2}
              compact
              live={(v) => setAxis("at", axis as 0 | 1 | 2, v, false)}
              onSave={(v) => setAxis("at", axis as 0 | 1 | 2, v, true)}
            />
          ))}
        </FieldRow>
      )}

      {mode === "target" && (
        <>
          <FieldRow label="Target">
            <Select
              items={targetSelectItems}
              value={selectTargetVal}
              onValueChange={(v) => {
                if (!v) return;
                if (v === "__custom__") {
                  setCustomRequested(true);
                  return;
                }
                setCustomRequested(false);
                setTargetDraft(null);
                patchSpatial((s) => {
                  s.target = v;
                  delete s.at;
                }, true);
              }}
            >
              <SelectTrigger className="h-8 w-full min-w-0" aria-label="Spatial target">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {targetSelectItems.map((it) => (
                  <SelectItem key={it.value} value={it.value}>
                    {it.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
          {isCustomTarget && (
            <FieldRow label="Name">
              <Input
                value={shownTarget}
                placeholder="steve"
                aria-label="Custom target name"
                className="h-8"
                onChange={(e) => setTargetDraft(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter" && shownTarget.trim()) {
                    patchSpatial((s) => {
                      s.target = shownTarget.trim();
                      delete s.at;
                    }, true);
                    setTargetDraft(null);
                    e.currentTarget.blur();
                  }
                }}
                onBlur={() => {
                  if (shownTarget.trim()) {
                    patchSpatial((s) => {
                      s.target = shownTarget.trim();
                      delete s.at;
                    }, true);
                  }
                  setTargetDraft(null);
                }}
              />
            </FieldRow>
          )}
          <FieldRow label="Offset">
            {(["X", "Y", "Z"] as const).map((label, axis) => (
              <ValueBox
                key={label}
                name={`Offset ${label}`}
                value={vec("offset")[axis]}
                step={0.1}
                digits={2}
                compact
                live={(v) => setAxis("offset", axis as 0 | 1 | 2, v, false)}
                onSave={(v) => setAxis("offset", axis as 0 | 1 | 2, v, true)}
              />
            ))}
          </FieldRow>
        </>
      )}

      {mode !== "off" && (
        <>
          <SliderRow
            label="Ref dist"
            value={refDist}
            min={0.5}
            max={20}
            step={0.5}
            digits={1}
            unit="m"
            doc={soundDoc}
            preview={(v) =>
              patchSpatial((s) => {
                s.refDistance = v;
                if ((s.maxDistance ?? SPATIAL_DEFAULTS.maxDistance) < v) s.maxDistance = v;
              }, false)
            }
            save={(v) =>
              patchSpatial((s) => {
                s.refDistance = v;
                if ((s.maxDistance ?? SPATIAL_DEFAULTS.maxDistance) < v) s.maxDistance = v;
              }, true)
            }
          />
          <SliderRow
            label="Max dist"
            value={maxDist}
            min={Math.max(1, refDist)}
            max={100}
            step={1}
            digits={0}
            unit="m"
            doc={soundDoc}
            preview={(v) =>
              patchSpatial((s) => {
                s.maxDistance = Math.max(refDist, v);
              }, false)
            }
            save={(v) =>
              patchSpatial((s) => {
                s.maxDistance = Math.max(refDist, v);
              }, true)
            }
          />
          <SliderRow
            label="Rolloff"
            value={rolloff}
            min={0}
            max={5}
            step={0.1}
            digits={1}
            origin={1}
            doc={soundDoc}
            preview={(v) =>
              patchSpatial((s) => {
                s.rolloff = v;
              }, false)
            }
            save={(v) =>
              patchSpatial((s) => {
                s.rolloff = v;
              }, true)
            }
          />
          <SliderRow
            label="Occlusion"
            value={Math.round(occlusion * 100)}
            min={0}
            max={100}
            step={1}
            digits={0}
            unit="%"
            doc={soundDoc}
            preview={(v) =>
              patchSpatial((s) => {
                s.occlusion = r3(v / 100);
              }, false)
            }
            save={(v) =>
              patchSpatial((s) => {
                s.occlusion = r3(v / 100);
              }, true)
            }
          />
          <FieldRow label="Air LPF">
            <div className="flex items-center gap-2">
              <Checkbox
                id={airLpfId}
                checked={airAbs}
                onCheckedChange={(checked) =>
                  patchSpatial((s) => {
                    s.airAbsorption = Boolean(checked);
                  }, true)
                }
              />
              <label
                htmlFor={airLpfId}
                className="text-ui text-muted-foreground cursor-pointer select-none"
              >
                Distance &amp; behind-head damping
              </label>
            </div>
          </FieldRow>
          {readout && (
            <p className="text-muted-foreground text-xs tabular-nums" aria-live="off">
              Now: {readout}
            </p>
          )}
        </>
      )}
    </Section>
  );
}
