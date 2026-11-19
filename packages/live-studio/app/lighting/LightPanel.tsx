import { EASES } from "film-stage/camera-meta";
import {
  type FogMode,
  LIGHT_PRESET_IDS,
  LIGHT_PRESETS,
  type LightPresetId,
  type LightsState,
} from "film-stage/lights-meta";
import type { CSSProperties } from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import {
  EmptyCard,
  FieldRow,
  KeyNav,
  Reset,
  SaveStatus,
  Section,
  Segmented,
  SliderRow,
} from "../components/inspector";
import { Tip } from "../components/Tip";
import { S } from "../core/state";
import { useStudio } from "../core/store";
import { stamp } from "../core/time";
import { useFrame } from "../core/useFrame";
import { ColorKelvinField } from "./ColorKelvinField";
import {
  addLightKeyAt,
  applyLightPresetAt,
  findLightKeyAt,
  goLightKey,
  lightKeys,
  lightsDocAdapter,
  lightsSampleAt,
  mutateLightAt,
  removeLightKeyAt,
  resetLightSection,
  setLightCut,
  updateLightKey,
} from "./lights";
import { PracticalSection } from "./PracticalSection";

const EASE_OPTIONS = Object.keys(EASES);

function bindSlider(t: number, write: (s: LightsState, v: number) => void) {
  return {
    doc: lightsDocAdapter,
    preview: (v: number) => mutateLightAt(t, (s) => write(s, v), false),
    save: (v: number) => mutateLightAt(t, (s) => write(s, v), true),
  };
}

export function LightPanel() {
  const lightsReady = useStudio((s) => s.lights);
  useStudio((s) => s.lightsRev);
  const saved = useStudio((s) => s.lightsSaved);
  useFrame();
  const t = S.t;

  if (!lightsReady) {
    return (
      <div className="p-3">
        <EmptyCard title="Lighting unavailable">
          Add &quot;lightsTimeline&quot;: &quot;src/timeline/lights.json&quot; under package.json
          live-studio to keyframe scene lighting.
        </EmptyCard>
      </div>
    );
  }

  const keys = lightKeys();
  const nav = findLightKeyAt(t);
  const here = nav.exactIndex !== null;
  const currentKey = nav.exactIndex !== null ? keys[nav.exactIndex] : null;
  const activeKey = nav.activeIndex !== null ? keys[nav.activeIndex] : null;
  const sample = lightsSampleAt(t);
  const activeEase =
    typeof currentKey?.ease === "string"
      ? currentKey.ease
      : typeof activeKey?.ease === "string"
        ? activeKey.ease
        : "smooth";
  const activePreset = (currentKey?.preset ?? activeKey?.preset ?? "") as LightPresetId | "";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-4">
      <SaveStatus state={saved} hideWhenIdle className="block pb-1" />

      <div className="border-hairline mb-2 flex flex-col gap-2 border-b pb-2">
        <div className="flex items-center justify-between gap-2">
          <KeyNav
            what="lighting"
            prev={nav.prev !== null}
            next={nav.next !== null}
            here={here}
            onPrev={() => goLightKey(nav.prev)}
            onNext={() => goLightKey(nav.next)}
            onToggle={() => (here ? removeLightKeyAt(nav.exactIndex) : addLightKeyAt(t))}
            addTip="Add lighting keyframe at playhead"
            removeTip="Delete lighting keyframe at playhead"
          />
          {!here && nav.activeIndex !== null && (
            <Tip label="Update active keyframe with current playhead state">
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => updateLightKey(nav.activeIndex, t)}
              >
                Update
              </Button>
            </Tip>
          )}
          <span className="text-muted-foreground text-tag tabular-nums">
            {keys.length === 0
              ? "No keys"
              : here && nav.exactIndex !== null
                ? `Key ${nav.exactIndex + 1}/${keys.length} · ${stamp(keys[nav.exactIndex].t)}`
                : `${keys.length} ${keys.length === 1 ? "key" : "keys"} · @ ${stamp(t)}`}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">Cut</span>
            <Switch
              aria-label="Hard cut at keyframe"
              checked={!!currentKey?.cut}
              onCheckedChange={(cut) => setLightCut(t, cut)}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground text-xs">Ease</span>
            <Select
              value={activeEase}
              onValueChange={(ease) => {
                if (!ease) return;
                mutateLightAt(
                  t,
                  (_s, key) => {
                    key.ease = ease;
                  },
                  true,
                  false,
                );
              }}
            >
              <SelectTrigger size="sm" aria-label="Lighting keyframe ease">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EASE_OPTIONS.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <Section title="Presets">
        <div className="grid grid-cols-2 gap-1.5">
          {LIGHT_PRESET_IDS.map((id) => {
            const preset = LIGHT_PRESETS[id];
            const selected = activePreset === id;
            return (
              <Tip key={id} label={preset.tip}>
                <button
                  type="button"
                  onClick={() => applyLightPresetAt(id, t)}
                  className={
                    selected
                      ? "border-primary bg-tint text-primary-text flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-left text-xs font-medium"
                      : "border-hairline text-foreground hover:bg-tint/50 flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-left text-xs transition-colors"
                  }
                >
                  <span
                    aria-hidden
                    className="border-hairline size-2.5 shrink-0 rounded-full border bg-linear-135 from-(--swatch-a) from-50% to-(--swatch-b) to-50%"
                    style={
                      {
                        "--swatch-a": preset.state.key.color,
                        "--swatch-b": preset.state.world.skyColor,
                      } as CSSProperties
                    }
                  />
                  <span className="truncate">{preset.title}</span>
                </button>
              </Tip>
            );
          })}
        </div>
      </Section>

      <Section
        title="Key light"
        on={sample.key.enabled}
        onCheck={(enabled) =>
          mutateLightAt(t, (s) => {
            s.key.enabled = enabled;
          })
        }
        right={<Reset label="Reset Key light" onClick={() => resetLightSection("key", t)} />}
      >
        <ColorKelvinField
          label="Color"
          scope="Key"
          value={sample.key.color}
          onChange={(color) =>
            mutateLightAt(t, (s) => {
              s.key.color = color;
            })
          }
        />
        <SliderRow
          label="Intensity"
          value={sample.key.intensity}
          min={0}
          max={8}
          step={0.05}
          digits={2}
          {...bindSlider(t, (s, v) => {
            s.key.intensity = v;
          })}
        />
        <SliderRow
          label="Azimuth"
          value={sample.key.azimuth}
          min={-180}
          max={180}
          step={1}
          digits={0}
          unit="°"
          origin={0}
          {...bindSlider(t, (s, v) => {
            s.key.azimuth = v;
          })}
        />
        <SliderRow
          label="Elevation"
          value={sample.key.elevation}
          min={-89}
          max={89}
          step={1}
          digits={0}
          unit="°"
          origin={0}
          {...bindSlider(t, (s, v) => {
            s.key.elevation = v;
          })}
        />
        <FieldRow label="Cast shadow">
          <div className="flex items-center justify-end">
            <Switch
              aria-label="Key light cast shadow"
              checked={sample.key.castShadow}
              onCheckedChange={(castShadow) =>
                mutateLightAt(t, (s) => {
                  s.key.castShadow = castShadow;
                })
              }
            />
          </div>
        </FieldRow>
        <SliderRow
          label="Shadow radius"
          value={sample.key.shadowRadius}
          min={0}
          max={12}
          step={0.1}
          digits={1}
          unit="px"
          {...bindSlider(t, (s, v) => {
            s.key.shadowRadius = v;
          })}
        />
      </Section>

      <Section
        title="Fill light"
        closed
        on={sample.fill.enabled}
        onCheck={(enabled) =>
          mutateLightAt(t, (s) => {
            s.fill.enabled = enabled;
          })
        }
        right={<Reset label="Reset Fill light" onClick={() => resetLightSection("fill", t)} />}
      >
        <ColorKelvinField
          label="Color"
          scope="Fill"
          value={sample.fill.color}
          onChange={(color) =>
            mutateLightAt(t, (s) => {
              s.fill.color = color;
            })
          }
        />
        <SliderRow
          label="Intensity"
          value={sample.fill.intensity}
          min={0}
          max={6}
          step={0.05}
          digits={2}
          {...bindSlider(t, (s, v) => {
            s.fill.intensity = v;
          })}
        />
        <SliderRow
          label="Azimuth"
          value={sample.fill.azimuth}
          min={-180}
          max={180}
          step={1}
          digits={0}
          unit="°"
          origin={0}
          {...bindSlider(t, (s, v) => {
            s.fill.azimuth = v;
          })}
        />
        <SliderRow
          label="Elevation"
          value={sample.fill.elevation}
          min={-89}
          max={89}
          step={1}
          digits={0}
          unit="°"
          origin={0}
          {...bindSlider(t, (s, v) => {
            s.fill.elevation = v;
          })}
        />
        <FieldRow label="Negative fill">
          <div className="flex items-center justify-end">
            <Switch
              aria-label="Negative fill contrast"
              checked={sample.fill.negativeFill}
              onCheckedChange={(negativeFill) =>
                mutateLightAt(t, (s) => {
                  s.fill.negativeFill = negativeFill;
                })
              }
            />
          </div>
        </FieldRow>
      </Section>

      <Section
        title="Rim light"
        closed
        on={sample.rim.enabled}
        onCheck={(enabled) =>
          mutateLightAt(t, (s) => {
            s.rim.enabled = enabled;
          })
        }
        right={<Reset label="Reset Rim light" onClick={() => resetLightSection("rim", t)} />}
      >
        <ColorKelvinField
          label="Color"
          scope="Rim"
          value={sample.rim.color}
          onChange={(color) =>
            mutateLightAt(t, (s) => {
              s.rim.color = color;
            })
          }
        />
        <SliderRow
          label="Intensity"
          value={sample.rim.intensity}
          min={0}
          max={6}
          step={0.05}
          digits={2}
          {...bindSlider(t, (s, v) => {
            s.rim.intensity = v;
          })}
        />
        <SliderRow
          label="Azimuth"
          value={sample.rim.azimuth}
          min={-180}
          max={180}
          step={1}
          digits={0}
          unit="°"
          origin={0}
          {...bindSlider(t, (s, v) => {
            s.rim.azimuth = v;
          })}
        />
        <SliderRow
          label="Elevation"
          value={sample.rim.elevation}
          min={-89}
          max={89}
          step={1}
          digits={0}
          unit="°"
          origin={0}
          {...bindSlider(t, (s, v) => {
            s.rim.elevation = v;
          })}
        />
      </Section>

      <Section
        title="World"
        closed
        right={<Reset label="Reset World" onClick={() => resetLightSection("world", t)} />}
      >
        <ColorKelvinField
          label="Sky"
          scope="World sky"
          value={sample.world.skyColor}
          onChange={(skyColor) =>
            mutateLightAt(t, (s) => {
              s.world.skyColor = skyColor;
            })
          }
        />
        <ColorKelvinField
          label="Ground"
          scope="World ground"
          showKelvin={false}
          value={sample.world.groundColor}
          onChange={(groundColor) =>
            mutateLightAt(t, (s) => {
              s.world.groundColor = groundColor;
            })
          }
        />
        <SliderRow
          label="Ambient"
          value={sample.world.ambientIntensity}
          min={0}
          max={3}
          step={0.02}
          digits={2}
          {...bindSlider(t, (s, v) => {
            s.world.ambientIntensity = v;
          })}
        />
        <FieldRow label="Background">
          <div className="flex items-center justify-end">
            <Switch
              aria-label="Override scene background"
              checked={sample.world.background !== null}
              onCheckedChange={(on) =>
                mutateLightAt(t, (s) => {
                  s.world.background = on ? (s.world.background ?? "#11161f") : null;
                })
              }
            />
          </div>
        </FieldRow>
        {sample.world.background !== null && (
          <ColorKelvinField
            label="Bg color"
            scope="Background"
            showKelvin={false}
            value={sample.world.background}
            onChange={(background) =>
              mutateLightAt(t, (s) => {
                s.world.background = background;
              })
            }
          />
        )}
      </Section>

      <Section
        title="Fog"
        closed={sample.fog.mode === "none"}
        right={<Reset label="Reset Fog" onClick={() => resetLightSection("fog", t)} />}
      >
        <Segmented
          label="Fog mode"
          value={sample.fog.mode}
          onChange={(mode: FogMode) =>
            mutateLightAt(t, (s) => {
              s.fog.mode = mode;
            })
          }
          items={[
            { id: "none", title: "None" },
            { id: "linear", title: "Linear" },
            { id: "exp2", title: "Exp2" },
          ]}
        />
        {sample.fog.mode !== "none" && (
          <>
            <ColorKelvinField
              label="Color"
              scope="Fog"
              showKelvin={false}
              value={sample.fog.color}
              onChange={(color) =>
                mutateLightAt(t, (s) => {
                  s.fog.color = color;
                })
              }
            />
            {sample.fog.mode === "linear" ? (
              <>
                <SliderRow
                  label="Near"
                  value={sample.fog.near}
                  min={0}
                  max={100}
                  step={0.5}
                  digits={1}
                  unit="m"
                  {...bindSlider(t, (s, v) => {
                    s.fog.near = v;
                  })}
                />
                <SliderRow
                  label="Far"
                  value={sample.fog.far}
                  min={1}
                  max={200}
                  step={1}
                  digits={0}
                  unit="m"
                  {...bindSlider(t, (s, v) => {
                    s.fog.far = v;
                  })}
                />
              </>
            ) : (
              <SliderRow
                label="Density"
                value={sample.fog.density}
                min={0}
                max={0.2}
                step={0.001}
                digits={3}
                {...bindSlider(t, (s, v) => {
                  s.fog.density = v;
                })}
              />
            )}
          </>
        )}
      </Section>

      <PracticalSection practicals={sample.practicals} t={t} />

      <Section
        title="Godrays"
        closed={!sample.godrays.enabled}
        on={sample.godrays.enabled}
        onCheck={(enabled) =>
          mutateLightAt(t, (s) => {
            s.godrays.enabled = enabled;
          })
        }
        right={<Reset label="Reset Godrays" onClick={() => resetLightSection("godrays", t)} />}
      >
        <SliderRow
          label="Weight"
          value={sample.godrays.weight}
          min={0}
          max={2}
          step={0.05}
          digits={2}
          {...bindSlider(t, (s, v) => {
            s.godrays.weight = v;
          })}
        />
        <SliderRow
          label="Density"
          value={sample.godrays.density}
          min={0}
          max={0.1}
          step={0.001}
          digits={3}
          {...bindSlider(t, (s, v) => {
            s.godrays.density = v;
          })}
        />
        <SliderRow
          label="Max density"
          value={sample.godrays.maxDensity}
          min={0}
          max={1}
          step={0.02}
          digits={2}
          {...bindSlider(t, (s, v) => {
            s.godrays.maxDensity = v;
          })}
        />
        <SliderRow
          label="Edge strength"
          value={sample.godrays.edgeStrength}
          min={0}
          max={8}
          step={0.1}
          digits={1}
          {...bindSlider(t, (s, v) => {
            s.godrays.edgeStrength = v;
          })}
        />
        <SliderRow
          label="Edge radius"
          value={sample.godrays.edgeRadius}
          min={0.5}
          max={8}
          step={0.25}
          digits={2}
          {...bindSlider(t, (s, v) => {
            s.godrays.edgeRadius = v;
          })}
        />
        <SliderRow
          label="Steps"
          value={sample.godrays.raymarchSteps}
          min={12}
          max={120}
          step={4}
          digits={0}
          {...bindSlider(t, (s, v) => {
            s.godrays.raymarchSteps = Math.round(v);
          })}
        />
        <FieldRow label="Blur">
          <div className="flex items-center justify-end">
            <Switch
              aria-label="Blur godrays"
              checked={sample.godrays.blur}
              onCheckedChange={(blur) =>
                mutateLightAt(t, (s) => {
                  s.godrays.blur = blur;
                })
              }
            />
          </div>
        </FieldRow>
        <FieldRow label="Tint">
          <div className="flex items-center justify-end">
            <Switch
              aria-label="Custom godrays tint"
              checked={!!sample.godrays.color}
              onCheckedChange={(on) =>
                mutateLightAt(t, (s) => {
                  if (on) s.godrays.color = s.godrays.color ?? s.key.color;
                  else delete s.godrays.color;
                })
              }
            />
          </div>
        </FieldRow>
        {sample.godrays.color && (
          <ColorKelvinField
            label="Tint color"
            scope="Godrays tint"
            value={sample.godrays.color}
            onChange={(color) =>
              mutateLightAt(t, (s) => {
                s.godrays.color = color;
              })
            }
          />
        )}
      </Section>
    </div>
  );
}
