// CapCut's Text library: Default text and the film-maker's titles, then Shapes (an arrow, a circle), each added at the playhead on
// the first text track with room by a click on its tile (text.ts addPreset). Each tile shows the look it adds, in the film's own
// fonts (the film loads them with film-stage/titles.ts)
import { Plus } from "lucide-react";

import { cn } from "@/lib/utils";

import { Tip } from "../components/Tip";
import { S } from "../core/state";
import { useStudio } from "../core/store";
import { FILM_MADE, FilmMark } from "../own/FilmMark";
import { addPreset, type Preset, PRESETS, SHAPES } from "./text";

const familyOf = (font?: string) =>
  S.tools?.titles?.fonts.find((f) => f.id === font)?.css ?? "system-ui, sans-serif";

function Look({ p }: { p: Preset }) {
  const it = p.item;
  const shapeCls =
    it.kind === "box"
      ? "h-9 text-accent-hover"
      : it.kind === "underline"
        ? "h-9 text-warn"
        : "h-9 text-destructive";
  if (it.kind === "arrow")
    return (
      <svg aria-hidden viewBox="0 0 64 36" className={shapeCls}>
        <path
          d="M14 26 L46 12 M38 10 L47 12 L42 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  if (it.kind === "circle")
    return (
      <svg aria-hidden viewBox="0 0 64 36" className={shapeCls}>
        <ellipse
          cx="32"
          cy="18"
          rx="22"
          ry="13"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
        />
      </svg>
    );
  if (it.kind === "box")
    return (
      <svg aria-hidden viewBox="0 0 64 36" className={shapeCls}>
        <rect
          x="11"
          y="6"
          width="42"
          height="24"
          rx="4"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
        />
      </svg>
    );
  if (it.kind === "bracket")
    return (
      <svg aria-hidden viewBox="0 0 64 36" className={shapeCls}>
        <path
          d="M19 7 H11 V15 M45 7 H53 V15 M11 21 V29 H19 M53 21 V29 H45"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  if (it.kind === "underline")
    return (
      <svg aria-hidden viewBox="0 0 64 36" className={shapeCls}>
        <path
          d="M10 22 Q32 16 54 22"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
      </svg>
    );
  if (it.kind !== "text")
    return (
      <span aria-hidden className="text-title text-primary font-semibold">
        ◇
      </span>
    );
  const line = (it.text ?? "").split("\n")[0];
  return (
    <span
      aria-hidden
      style={{ "--font": familyOf(it.font), "--tracking": `${it.spacing ?? 0}em` }}
      className={cn(
        "font-(family-name:--font) tracking-(--tracking) text-white",
        it.bold ? "font-bold" : it.font === "mono" ? "font-normal" : "font-medium",
        it.align === "left" ? "text-tag self-end justify-self-start ps-2 pb-1.5" : "text-title",
      )}
    >
      {line}
    </span>
  );
}

function Tile({ p, own }: { p: Preset; own?: boolean }) {
  return (
    <li>
      <Tip label={p.hint}>
        <button
          type="button"
          aria-label={`Add ${p.title} at the playhead${own ? `, ${FILM_MADE}` : ""}`}
          onClick={() => addPreset(p)}
          className="group/tile focus-visible:ring-ring flex w-full flex-col gap-1.5 rounded-md text-start outline-none focus-visible:ring-2"
        >
          <span className="bg-backdrop relative grid aspect-video w-full place-items-center overflow-hidden rounded-md ring-1 ring-white/6 group-hover/tile:ring-white/20">
            <Look p={p} />
            {own && <FilmMark />}
            <span
              aria-hidden
              className="bg-primary text-primary-foreground absolute end-1 bottom-1 grid size-5 place-items-center rounded-sm opacity-0 transition-opacity duration-150 group-hover/tile:opacity-100 group-focus-visible/tile:opacity-100 pointer-coarse:opacity-100"
            >
              <Plus className="size-3.5" />
            </span>
          </span>
          <span className="text-muted-foreground group-hover/tile:text-foreground truncate text-xs">
            {p.title}
          </span>
        </button>
      </Tip>
    </li>
  );
}

export function TextLibrary() {
  useStudio((s) => s.ready);
  const extraShapes: Preset[] = (S.tools?.titles?.shapes ?? [])
    .filter((s) => !SHAPES.some((b) => b.item.kind === s.id))
    .map((s) => ({
      id: `shape-${s.id}`,
      title: s.title,
      hint: s.tip ?? `Custom ${s.title} annotation shape`,
      len: 2.5,
      item: {
        kind: s.id,
        color: "#E5484D",
        width: 10,
        w: 260,
        h: 170,
        in: { fx: "draw", len: 0.5 },
        out: { fx: "fade", len: 0.4 },
      },
    }));
  const shapes = extraShapes.length ? [...SHAPES, ...extraShapes] : SHAPES;
  return (
    <div className="scroll-fade flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-3 pb-3">
      {(
        [
          ["Text", PRESETS],
          ["Shapes", shapes],
        ] as const
      ).map(([title, list]) => (
        <section key={title} aria-label={title} className="flex flex-col gap-2">
          <h3 className="text-ui font-semibold">{title}</h3>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-x-2.5 gap-y-3">
            {list.map((p) => (
              <Tile key={p.id} p={p} own={extraShapes.includes(p)} />
            ))}
          </ul>
        </section>
      ))}
      <p className="text-muted-foreground text-xs">
        A click adds it at the playhead. Drag it on the picture to place it, and its edges on the
        Text row to time it.
      </p>
    </div>
  );
}
