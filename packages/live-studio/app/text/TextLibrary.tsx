// CapCut's Text library: Default text and the film-maker's titles, then Shapes (an arrow, a circle), each added at the playhead on
// the first text track with room by a click on its tile (text.ts addPreset). Each tile shows the look it adds, in the film's own
// fonts (the film loads them with film-stage/titles.ts)
import { Plus } from "lucide-react";
import { Tip } from "../components/Tip";
import { S } from "../core/state";
import { addPreset, type Preset, PRESETS, SHAPES } from "./text";

const familyOf = (font?: string) => S.tools?.titles?.fonts.find((f) => f.id === font)?.css ?? "system-ui, sans-serif";

function Look({ p }: { p: Preset }) {
  const it = p.item;
  if (it.kind === "arrow") return <svg aria-hidden viewBox="0 0 64 36" className="h-9 text-[#E5484D]"><path d="M14 26 L46 12 M38 10 L47 12 L42 20" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (it.kind === "circle") return <svg aria-hidden viewBox="0 0 64 36" className="h-9 text-[#E5484D]"><ellipse cx="32" cy="18" rx="22" ry="13" fill="none" stroke="currentColor" strokeWidth="3" /></svg>;
  const line = (it.text ?? "").split("\n")[0];
  return (
    <span
      aria-hidden
      style={{ fontFamily: familyOf(it.font), fontWeight: it.bold ? 700 : it.font === "mono" ? 400 : 500, letterSpacing: `${it.spacing ?? 0}em` }}
      className={it.align === "left" ? "self-end justify-self-start ps-2 pb-1.5 text-[11px] text-white" : "text-[15px] text-white"}
    >
      {line}
    </span>
  );
}

function Tile({ p }: { p: Preset }) {
  return (
    <li>
      <Tip label={p.hint}>
        <button
          type="button" aria-label={`Add ${p.title} at the playhead`} onClick={() => addPreset(p)}
          className="group/tile flex w-full flex-col gap-1.5 rounded-md text-start outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="relative grid aspect-video w-full place-items-center overflow-hidden rounded-md bg-[#1C1B1A] ring-1 ring-white/6 group-hover/tile:ring-white/20">
            <Look p={p} />
            <span aria-hidden className="absolute end-1 bottom-1 grid size-5 place-items-center rounded-sm bg-primary text-primary-foreground opacity-0 transition-opacity duration-150 group-hover/tile:opacity-100 group-focus-visible/tile:opacity-100 pointer-coarse:opacity-100"><Plus className="size-3.5" /></span>
          </span>
          <span className="truncate text-xs text-muted-foreground group-hover/tile:text-foreground">{p.title}</span>
        </button>
      </Tip>
    </li>
  );
}

export function TextLibrary() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-3 pb-3 scroll-fade">
      {([["Text", PRESETS], ["Shapes", SHAPES]] as const).map(([title, list]) => (
        <section key={title} aria-label={title} className="flex flex-col gap-2">
          <h3 className="text-[13px] font-semibold">{title}</h3>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-x-2.5 gap-y-3">{list.map((p) => <Tile key={p.id} p={p} />)}</ul>
        </section>
      ))}
      <p className="text-xs text-muted-foreground">A click adds it at the playhead. Drag it on the picture to place it, and its edges on the Text row to time it.</p>
    </div>
  );
}
