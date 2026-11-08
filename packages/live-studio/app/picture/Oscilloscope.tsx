// CapCut's Color oscilloscope (Settings, Picture; kept in this browser): a strip under the picture, as CapCut's Player shows
// it, with the three scopes of the frame on screen side by side (scopes.ts measures and draws them). For a dark film: a trace
// pressed flat on the 0 line is black with no detail left in it. Not on a phone: it needs the room
import { useEffect, useRef } from "react";
import type { Bind } from "../core/state";
import { S } from "../core/state";
import { useStudio } from "../core/store";

const PANES = [
  { key: "parade", title: "RGB parade", tip: "Red, green and blue levels across the picture, side by side: 0 is black, 1023 white" },
  { key: "wave", title: "RGB waveform", tip: "The three levels laid over each other (white where they agree): the bottom line is black, so a trace flat on it is detail lost" },
  { key: "vector", title: "Vectorscope", tip: "Hue round the circle, saturation out from the middle. The line up and left is where skin falls" },
] as const;

export function Oscilloscope({ bind }: { bind: Bind }) {
  const on = useStudio((s) => s.scopes), strip = useRef<HTMLDivElement>(null);
  // Shown, or resized: draw them again from a fresh frame
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { S.dirty = true; });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div
      ref={(node) => { strip.current = node; bind("scopes")(node); }}
      hidden={!on}
      aria-label="Color oscilloscope"
      role="group"
      className="grid h-[clamp(7rem,22%,10rem)] w-full flex-none grid-cols-3 gap-1 border-t border-black bg-black p-1 upright:hidden sideways:hidden"
    >
      {PANES.map((p) => (
        <figure key={p.key} title={p.tip} className="relative m-0 min-w-0 overflow-hidden rounded-sm bg-black">
          <canvas ref={bind(p.key)} role="img" aria-label={`${p.title}. ${p.tip}`} className="absolute inset-0 block size-full" />
          <figcaption className="pointer-events-none absolute top-1 right-1.5 text-tag text-white/45">{p.title}</figcaption>
        </figure>
      ))}
    </div>
  );
}
