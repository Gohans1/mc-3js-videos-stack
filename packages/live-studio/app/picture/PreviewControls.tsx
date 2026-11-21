import { ScanLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";

import { FieldRow, Segmented, ValueBox } from "../components/inspector";
import { set, setPref, useStudio } from "../core/store";
import { copyCameraInspection } from "./camera-monitor";
import { CROP_RATIOS, type CropRatio } from "./preview-model";
import { changePreview } from "./preview-state";

export function PreviewControls() {
  const p = useStudio((s) => s.preview);
  const free = useStudio((s) => s.free);
  const split = useStudio((s) => s.filmView === "split");
  const guides = useStudio((s) => s.guides);
  const check = (label: string, value: boolean, update: (value: boolean) => void) => (
    <label className="flex cursor-pointer items-center gap-2">
      <Checkbox aria-label={label} checked={value} onCheckedChange={update} />
      {label}
    </label>
  );

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="quiet"
            size="icon-lg"
            className="pointer-coarse:hidden"
            aria-label="Preview tools"
          >
            <ScanLine />
          </Button>
        }
      />
      <PopoverContent side="top" align="end" className="max-h-[70vh] w-92 overflow-y-auto">
        <div className="flex items-center justify-between gap-2">
          <PopoverTitle>Preview</PopoverTitle>
          <Button size="sm" variant="quiet" onClick={copyCameraInspection}>
            Copy camera
          </Button>
          <Button
            size="sm"
            variant="quiet"
            onClick={() => {
              set({ shotList: true, compareGrid: false });
            }}
          >
            Shotlist
          </Button>
        </div>
        <div className="flex flex-col gap-2">
          <FieldRow label="2D zoom">
            <ValueBox
              name="Preview zoom"
              value={p.zoom}
              digits={0}
              min={10}
              max={1600}
              step={10}
              unit="%"
              onSave={(zoom) => changePreview({ zoom })}
            />
            <Button
              size="sm"
              variant="quiet"
              onClick={() => changePreview({ zoom: 100, panX: 0, panY: 0 })}
            >
              Fit
            </Button>
          </FieldRow>
          <div className="grid grid-cols-2 gap-y-2 text-xs">
            {check("Mirror horizontal", p.mirror, (mirror) => changePreview({ mirror }))}
            {check("Half resolution on play", p.reduced, (reduced) => changePreview({ reduced }))}
            {check("Shutter preview (4 samples)", p.motionBlur, (motionBlur) =>
              changePreview({ motionBlur }),
            )}
            {check("Clean feed", p.clean, (clean) => changePreview({ clean }))}
            {check("Horizon and camera HUD", p.horizon, (horizon) => changePreview({ horizon }))}
            {check("Camera minimap", p.minimap, (minimap) => changePreview({ minimap }))}
            {free &&
              check("Split film view", split, (on) => setPref("filmView", on ? "split" : "m"))}
          </div>
        </div>
        <div className="flex flex-col gap-2 border-t pt-3">
          <Segmented
            label="Optical monitor"
            value={p.layers}
            onChange={(layers) => changePreview({ layers })}
            items={[
              { id: "off", title: "Off" },
              { id: "peaking", title: "Peaking" },
              { id: "zebras", title: "Zebras" },
              { id: "falseColor", title: "False color" },
            ]}
          />
          {p.layers === "zebras" && (
            <FieldRow label="Zebra threshold">
              <ValueBox
                name="Zebra threshold"
                value={p.zebra}
                min={1}
                max={100}
                step={1}
                digits={0}
                unit="IRE"
                onSave={(zebra) => changePreview({ zebra })}
              />
            </FieldRow>
          )}
          <Segmented
            label="3D debug view"
            value={p.debug}
            onChange={(debug) => changePreview({ debug })}
            items={[
              { id: "off", title: "Film" },
              { id: "clay", title: "Clay" },
              { id: "wireframe", title: "Wireframe" },
              { id: "xray", title: "X-ray" },
            ]}
          />
        </div>
        <div className="flex flex-col gap-2 border-t pt-3 text-xs">
          {check("Framing guides", guides, (on) => setPref("guides", on))}
          {guides && (
            <>
              <div className="flex flex-wrap gap-1" role="group" aria-label="Crop guides">
                {(Object.keys(CROP_RATIOS) as CropRatio[]).map((ratio) => (
                  <Button
                    key={ratio}
                    size="sm"
                    aria-pressed={p.crops.includes(ratio)}
                    variant={p.crops.includes(ratio) ? "secondary" : "quiet"}
                    onClick={() =>
                      changePreview({
                        crops: p.crops.includes(ratio)
                          ? p.crops.filter((r) => r !== ratio)
                          : [...p.crops, ratio],
                      })
                    }
                  >
                    {ratio}
                  </Button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-y-2">
                {check("35 / 50 / 85 mm", p.primes, (primes) => changePreview({ primes }))}
                {check("Golden ratio", p.golden, (golden) => changePreview({ golden }))}
                {check("Ruler", p.ruler, (ruler) => changePreview({ ruler }))}
              </div>
              {p.ruler && (
                <FieldRow label="Ruler X / Y">
                  <ValueBox
                    name="Vertical ruler"
                    value={p.rulerX}
                    min={0}
                    max={100}
                    digits={0}
                    step={1}
                    unit="%"
                    onSave={(rulerX) => changePreview({ rulerX })}
                  />
                  <ValueBox
                    name="Horizontal ruler"
                    value={p.rulerY}
                    min={0}
                    max={100}
                    digits={0}
                    step={1}
                    unit="%"
                    onSave={(rulerY) => changePreview({ rulerY })}
                  />
                </FieldRow>
              )}
              {p.crops.length > 0 && (
                <FieldRow label="Passepartout">
                  <ValueBox
                    name="Passepartout opacity"
                    value={p.passepartout}
                    min={0}
                    max={100}
                    step={5}
                    digits={0}
                    unit="%"
                    onSave={(passepartout) => changePreview({ passepartout })}
                  />
                </FieldRow>
              )}
            </>
          )}
          <FieldRow label="Onion skin">
            <ValueBox
              name="Onion skin opacity"
              value={p.onion}
              min={0}
              max={100}
              step={5}
              digits={0}
              unit="%"
              onSave={(onion) => changePreview({ onion })}
            />
          </FieldRow>
        </div>
      </PopoverContent>
    </Popover>
  );
}
