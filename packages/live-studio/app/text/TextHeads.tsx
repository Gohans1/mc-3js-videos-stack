import { Eye, EyeOff, Lock, LockOpen, Type } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";

import { Tip } from "../components/Tip";
import { useStudio } from "../core/store";
import { items, pickText, setTrack, trackState, tracksUsed } from "./text";
import { ROW_H } from "./textrow";

export function TextHeads() {
  useStudio((s) => s.textRev);
  const count = Math.max(1, tracksUsed());
  return (
    <ul aria-label="Text tracks" className="border-track-line bg-track-head border-e">
      {Array.from({ length: count }, (_, row) => {
        const track = count - 1 - row,
          state = trackState(track),
          name = `Text ${track + 1}`;
        return (
          <li
            key={track}
            style={{ "--row-h": `${ROW_H}px` }}
            className="border-background flex h-(--row-h) items-center border-b"
          >
            <Tip label={`${name}: select its clips`}>
              <Button
                variant="quiet"
                size="icon-sm"
                aria-label={`Select ${name}`}
                onClick={() =>
                  pickText(items.flatMap((it, i) => ((it.track ?? 0) === track ? [i] : [])))
                }
              >
                <Type />
              </Button>
            </Tip>
            <Tip label={state.lock ? `Unlock ${name}` : `Lock ${name}`}>
              <Toggle
                variant="quiet"
                size="icon-sm"
                pressed={!!state.lock}
                onPressedChange={(on) => setTrack(track, { lock: on || undefined })}
                aria-label={`Lock ${name}`}
              >
                {state.lock ? <Lock /> : <LockOpen />}
              </Toggle>
            </Tip>
            <Tip label={state.hidden ? `Show ${name}` : `Hide ${name} (preview and render)`}>
              <Toggle
                variant="quiet"
                size="icon-sm"
                pressed={!!state.hidden}
                onPressedChange={(on) => setTrack(track, { hidden: on || undefined })}
                aria-label={`Hide ${name}`}
              >
                {state.hidden ? <EyeOff /> : <Eye />}
              </Toggle>
            </Tip>
          </li>
        );
      })}
    </ul>
  );
}
