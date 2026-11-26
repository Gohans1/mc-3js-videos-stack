import { Slider } from "@/components/Slider";
import { Field, FieldLabel } from "@/components/ui/field";
import { Kbd } from "@/components/ui/kbd";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { HelpTip } from "../components/HelpTip";
import { set, setPref } from "../core/store";
import {
  clampGhostOpacity,
  GHOST_OPACITY,
  VALUE_CHECK_MODES,
  type ValueCheckMode,
} from "../picture/director-eye";
import { toggleMute } from "../playback/transport";

const EyeSwitchRow = ({
  id,
  label,
  keys,
  help,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  keys: string[];
  help: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) => (
  <Field orientation="horizontal" className="min-h-10 justify-between">
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      <FieldLabel htmlFor={id} variant="row" className="min-h-10 cursor-pointer">
        {label}
        <span aria-hidden className="inline-flex items-center gap-0.5 pointer-coarse:hidden">
          {keys.map((k) => (
            <Kbd key={k}>{k}</Kbd>
          ))}
        </span>
      </FieldLabel>
      <HelpTip label={label}>{help}</HelpTip>
    </span>
    <Switch id={id} checked={checked} onCheckedChange={onChange} />
  </Field>
);

export function DirectorEyeSettings({
  valueCheck,
  ghost,
  ghostOpacity,
  colorScript,
  muted,
  blindAudio,
}: {
  valueCheck: ValueCheckMode;
  ghost: boolean;
  ghostOpacity: number;
  colorScript: boolean;
  muted: boolean;
  blindAudio: boolean;
}) {
  return (
    <div className="upright:hidden sideways:hidden divide-border divide-y">
      <div className="flex min-h-10 items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-sm whitespace-nowrap">
          Value check
          <span aria-hidden className="inline-flex items-center gap-0.5 pointer-coarse:hidden">
            <Kbd>Shift</Kbd>
            <Kbd>V</Kbd>
          </span>
          <HelpTip label="Value check">
            Checks Rec.709 grayscale values or high-contrast figure-ground silhouette on the
            viewport only. Film grades and final renders never change.
          </HelpTip>
        </span>
        <ToggleGroup
          value={[valueCheck]}
          onValueChange={(v: string[]) => {
            if (v[0]) set({ valueCheck: v[0] as ValueCheckMode });
          }}
          aria-label="Value check mode"
          spacing={0.5}
          variant="segment"
          size="sm"
        >
          {VALUE_CHECK_MODES.map((m) => (
            <ToggleGroupItem key={m} value={m}>
              {m === "off" ? "Off" : m === "bw" ? "B&W" : "Silhouette"}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <EyeSwitchRow
        id="cut-ghost"
        label="Cut-boundary ghost"
        keys={["Shift", "O"]}
        checked={ghost}
        onChange={(on) => set({ ghost: on })}
        help="Overlays the previous shot's outgoing frame on top of the current shot to align eye-trace and match cuts."
      />
      {ghost && (
        <div className="flex min-h-10 items-center justify-between gap-3">
          <span className="text-sm whitespace-nowrap">Ghost opacity</span>
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="flex h-9 min-w-0 flex-1 items-center">
              <Slider
                min={GHOST_OPACITY.min}
                max={GHOST_OPACITY.max}
                step={GHOST_OPACITY.step}
                value={ghostOpacity}
                onValueChange={(v: number | readonly number[]) =>
                  setPref("ghostOpacity", clampGhostOpacity(typeof v === "number" ? v : v[0]!))
                }
                aria-label="Settings ghost opacity"
                format={{ style: "percent" }}
              />
            </span>
            <span className="text-muted-foreground min-w-[4ch] text-end text-sm tabular-nums">
              {Math.round(ghostOpacity * 100)}%
            </span>
          </span>
        </div>
      )}
      <EyeSwitchRow
        id="color-script"
        label="Color script strip"
        keys={["Shift", "C"]}
        checked={colorScript}
        onChange={(on) => set({ colorScript: on })}
        help="Horizontal storyboard strip under the picture with shot thumbnails, dominant 4-color palettes, Rec.709 luminance and pacing highlights."
      />
      <EyeSwitchRow
        id="mute-audio"
        label="Mute audio"
        keys={["Alt", "M"]}
        checked={muted}
        onChange={(on) => {
          if (on !== muted) toggleMute();
        }}
        help="Silences audio for picture-only review while preserving your current volume level."
      />
      <EyeSwitchRow
        id="blind-audio"
        label="Blind audio test"
        keys={["Shift", "H"]}
        checked={blindAudio}
        onChange={(on) => set({ blindAudio: on })}
        help="Curtains the picture while playback continues so you can judge pacing, dialogue and mix with eyes closed. Esc exits."
      />
    </div>
  );
}
