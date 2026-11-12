import type { TransitionEase } from "film-stage/transitions";
import { TRANSITION_EASES } from "film-stage/transitions";
import { DURATION } from "film/scene";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { FieldRow, Footer, Reset, Section, SliderRow } from "../components/inspector";
import { Tip } from "../components/Tip";
import { useStudio } from "../core/store";
import { playSpan, shownShot, stopSpan } from "./anim";
import { shotsDoc } from "./shots";
import {
  transitionEaseChoices,
  transitionSupportsFeather,
  transitionSupportsFlip,
} from "./transition-math";
import {
  applyTransitionToAll,
  resetTransition,
  setTransition,
  setTransitionDuration,
  setTransitionOption,
  transitionDuration,
  transitionOf,
  transitionRoom,
  transitions,
  transitionSpan,
} from "./transitions";

export function TransitionPanel() {
  useStudio((s) => s.shotsRev);
  useStudio((s) => s.timingRev);
  useStudio((s) => s.shotPick);
  const shot = shownShot(),
    current = transitionOf(shot);
  if (!current)
    return (
      <p className="text-ui text-muted-foreground px-3">
        Drag a transition from the library onto a cut between two shots.
      </p>
    );
  const fx = transitions().find((x) => x.id === current.fx);
  const title = fx?.title ?? current.fx;
  const replay = () => {
    const [from, to] = transitionSpan(shot);
    playSpan(Math.max(0, from - 0.25), Math.min(DURATION, to + 0.25));
  };
  const easeKey = !current.ease
    ? "auto"
    : typeof current.ease === "string"
      ? current.ease
      : `bezier:${current.ease.join(",")}`;
  const presets = transitionEaseChoices(fx, current.ease);
  const customEase = !TRANSITION_EASES.some((e) => e.id === easeKey);
  const customLabel = !current.ease
    ? ""
    : typeof current.ease === "string"
      ? current.ease
      : `Custom (${current.ease.join(", ")})`;
  const easeItems = [
    ...presets.map((e) => ({ value: e.id, label: e.title })),
    ...(customEase ? [{ value: easeKey, label: customLabel }] : []),
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
      <Section
        title="Transition parameters"
        right={
          <Reset
            label="Reset transition parameters"
            onClick={() => {
              resetTransition(shot);
              replay();
            }}
          />
        }
      >
        <p className="text-ui flex gap-4">
          <span className="text-muted-foreground">Name</span>
          {title}
        </p>
        <SliderRow
          label="Duration"
          value={transitionDuration(shot)}
          min={Math.min(transitionRoom(shot), 1 / 30)}
          max={transitionRoom(shot)}
          step={1 / 30}
          digits={2}
          unit="s"
          doc={shotsDoc}
          preview={(v) => {
            stopSpan();
            setTransitionDuration(shot, v, false);
          }}
          save={(v) => setTransitionDuration(shot, v)}
        />
        {(transitionSupportsFeather(fx) || current.feather !== undefined) && (
          <SliderRow
            label="Softness"
            value={current.feather ?? 0.5}
            min={0}
            max={1}
            step={0.05}
            digits={2}
            doc={shotsDoc}
            preview={(v) => {
              stopSpan();
              setTransitionOption(shot, { feather: v }, false);
            }}
            save={(v) => setTransitionOption(shot, { feather: v })}
            hint="Edge softness, hold window or optical spread of the transition (0.50 is the tuned default)"
          />
        )}
        <FieldRow label="Curve">
          <Select
            value={easeKey}
            items={easeItems}
            onValueChange={(v) => {
              if (v !== easeKey) {
                setTransitionOption(shot, {
                  ease: v === "auto" ? undefined : (v as TransitionEase),
                });
                replay();
              }
            }}
          >
            <SelectTrigger aria-label="Transition curve" className="h-7 min-w-0 flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {presets.map((e) => (
                <SelectItem key={e.id} value={e.id} title={e.tip}>
                  {e.title}
                </SelectItem>
              ))}
              {customEase && (
                <SelectItem value={easeKey} title="Custom curve written by the film">
                  {easeItems.at(-1)!.label}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
          {(transitionSupportsFlip(fx) || Boolean(current.flip)) && (
            <Tip label="Reverse: flip the wipe, push, sweep or iris direction">
              <FieldLabel variant="inline" className="flex-none">
                <Checkbox
                  checked={!!current.flip}
                  aria-label="Reverse transition direction"
                  onCheckedChange={(checked) => {
                    setTransitionOption(shot, { flip: checked });
                    replay();
                  }}
                />
                Reverse
              </FieldLabel>
            </Tip>
          )}
        </FieldRow>
      </Section>
      <Footer>
        <Button variant="quiet" onClick={() => setTransition(shot, null)}>
          Remove
        </Button>
        <Button variant="secondary" onClick={() => applyTransitionToAll(shot)}>
          Apply to all
        </Button>
      </Footer>
    </div>
  );
}
