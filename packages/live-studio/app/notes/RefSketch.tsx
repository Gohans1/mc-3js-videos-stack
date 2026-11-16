// A pasted picture opened big, to see what is being sent and to draw on it: freehand strokes in a few colours and sizes,
// shaped by perfect-freehand (Steve Ruiz, tldraw's ink) and painted on a canvas at the picture's own size. Each stroke ends
// flattened into the JPEG the note sends (refs.ts); the strokes are kept apart, so Undo and Clear never lose the picture
import { Eraser, Trash2, Undo2 } from "lucide-react";
import { getStroke } from "perfect-freehand";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { useDialogModal } from "../core/store";
import { modKeyLabel } from "./note-card-meta";
import { changeRef, removeRef, toJpeg } from "./refs";
import type { RefPic, RefStroke } from "./slice";

const COLORS = [
  { name: "Red", value: "#D14D41" },
  { name: "Yellow", value: "#D0A215" },
  { name: "Green", value: "#879A39" },
  { name: "Blue", value: "#4385BE" },
  { name: "White", value: "#FFFCF0" },
  { name: "Black", value: "#100F0F" },
];
// a share of the picture's long side, so a stroke looks the same on a small or a big picture
const SIZES = [
  { name: "Thin", k: 0.005 },
  { name: "Medium", k: 0.01 },
  { name: "Thick", k: 0.02 },
];

// perfect-freehand's README: its outline points as an SVG path of quadratic curves through their midpoints
const avg = (a: number, b: number) => (a + b) / 2;
const svgPath = (p: number[][]) => {
  if (p.length < 4) return "";
  let [a, b] = [p[0]!, p[1]!];
  const c = p[2]!;
  let d = `M${a[0]},${a[1]} Q${b[0]},${b[1]} ${avg(b[0]!, c[0]!)},${avg(b[1]!, c[1]!)} T`;
  for (let i = 2; i < p.length - 1; i++) {
    a = p[i]!;
    b = p[i + 1]!;
    d += `${avg(a[0]!, b[0]!)},${avg(a[1]!, b[1]!)} `;
  }
  return `${d}Z`;
};
// pressure as the pointer gave it: a pen's own, 0.5 for a mouse or finger (an even line, as a marker draws)
const paint = (g: CanvasRenderingContext2D, s: RefStroke) => {
  g.fillStyle = s.color;
  g.fill(
    new Path2D(
      svgPath(
        getStroke(s.pts, {
          size: s.size,
          thinning: 0.5,
          smoothing: 0.5,
          streamline: 0.5,
          simulatePressure: false,
        }),
      ),
    ),
  );
};

export function RefSketchBoard({
  r,
  undoRef,
}: {
  r: RefPic;
  undoRef: React.RefObject<(() => void) | null>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    base = useRef<HTMLImageElement | null>(null),
    live = useRef<RefStroke | null>(null);
  const [color, setColor] = useState(COLORS[0]!.value),
    [sizeK, setSizeK] = useState(SIZES[1]!.k),
    [loadState, setLoadState] = useState<{ src: string; status: "loading" | "ready" | "error" }>({
      src: r.src,
      status: "loading",
    });
  const ready = loadState.src === r.src && loadState.status === "ready";
  const failed = loadState.src === r.src && loadState.status === "error";
  const draw = () => {
    const c = canvas.current,
      img = base.current;
    if (!c || !img) return;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0, c.width, c.height);
    for (const s of r.strokes) paint(g, s);
    if (live.current) paint(g, live.current);
  };
  useLayoutEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      base.current = img;
      if (canvas.current) {
        canvas.current.width = img.naturalWidth;
        canvas.current.height = img.naturalHeight;
      }
      setLoadState({ src: r.src, status: "ready" });
    };
    img.onerror = () => {
      if (!cancelled) setLoadState({ src: r.src, status: "error" });
    };
    img.src = r.src;
    return () => {
      cancelled = true;
    };
  }, [r.src]);
  useEffect(draw);
  const save = (strokes: RefStroke[]) => {
    const c = canvas.current,
      b = base.current;
    if (!c || !b) return;
    live.current = null;
    // drawn here first so the flattened picture is the one with these strokes, then sent on as it is
    const g = c.getContext("2d");
    if (!g) return;
    g.drawImage(b, 0, 0, c.width, c.height);
    for (const s of strokes) paint(g, s);
    changeRef({ ...r, strokes, url: strokes.length ? toJpeg(c, c.width, c.height) : r.src });
  };
  const at = (e: React.PointerEvent | PointerEvent): [number, number, number] => {
    const c = canvas.current!,
      box = c.getBoundingClientRect();
    const w = Math.max(1, box.width);
    const h = Math.max(1, box.height);
    return [
      ((e.clientX - box.left) * c.width) / w,
      ((e.clientY - box.top) * c.height) / h,
      e.pointerType === "pen" ? e.pressure || 0.5 : 0.5,
    ];
  };
  const undo = () => r.strokes.length && save(r.strokes.slice(0, -1));
  useEffect(() => {
    undoRef.current = undo;
  });
  const stepRadio = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    idx: number,
    len: number,
    pick: (next: number) => void,
  ) => {
    const delta =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (!delta) return;
    e.preventDefault();
    const nextIdx = (idx + delta + len) % len;
    pick(nextIdx);
    const siblings =
      e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role='radio']");
    siblings?.[nextIdx]?.focus();
  };
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div role="radiogroup" aria-label="Colour" className="flex items-center gap-1.5">
          {COLORS.map((c, idx) => (
            <button
              key={c.value}
              type="button"
              role="radio"
              tabIndex={color === c.value ? 0 : -1}
              aria-checked={color === c.value}
              aria-label={c.name}
              onClick={() => setColor(c.value)}
              onKeyDown={(e) => stepRadio(e, idx, COLORS.length, (i) => setColor(COLORS[i]!.value))}
              className={cn(
                "focus-visible:ring-ring ring-hairline-strong aria-checked:outline-picture size-7 rounded-full bg-(--swatch) ring-1 outline-2 outline-offset-2 outline-transparent ring-inset focus-visible:ring-2 pointer-coarse:size-10",
              )}
              style={{ "--swatch": c.value }}
            />
          ))}
        </div>
        <div role="radiogroup" aria-label="Stroke size" className="flex items-center gap-1">
          {SIZES.map((s, idx) => (
            <button
              key={s.k}
              type="button"
              role="radio"
              tabIndex={sizeK === s.k ? 0 : -1}
              aria-checked={sizeK === s.k}
              aria-label={s.name}
              onClick={() => setSizeK(s.k)}
              onKeyDown={(e) => stepRadio(e, idx, SIZES.length, (i) => setSizeK(SIZES[i]!.k))}
              className="hover:bg-muted focus-visible:ring-ring aria-checked:bg-muted flex size-8 items-center justify-center rounded-md focus-visible:ring-2 pointer-coarse:size-10"
            >
              <span
                className="size-(--dot) rounded-full bg-current"
                style={{ "--dot": `${4 + s.k * 500}px` }}
              />
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <Button variant="secondary" size="md" onClick={undo} disabled={!r.strokes.length}>
          <Undo2 aria-hidden data-icon="inline-start" />
          Undo
        </Button>
        <Button variant="secondary" size="md" onClick={() => save([])} disabled={!r.strokes.length}>
          <Eraser aria-hidden data-icon="inline-start" />
          Clear
        </Button>
        <Button variant="destructive" size="md" onClick={() => removeRef(r.id)}>
          <Trash2 aria-hidden data-icon="inline-start" />
          Remove picture
        </Button>
      </div>
      {failed ? (
        <p className="text-muted-foreground text-ui py-8 text-center">Picture unavailable.</p>
      ) : (
        <canvas
          ref={canvas}
          aria-label="The picture: drag on it to draw"
          className={cn(
            "mx-auto block h-auto max-h-[72vh] w-auto max-w-full cursor-crosshair touch-none rounded-md",
            !ready && "invisible",
          )}
          onPointerDown={(e) => {
            if (e.button !== 0 || !base.current) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            const c = canvas.current!;
            live.current = { color, size: Math.max(c.width, c.height) * sizeK, pts: [at(e)] };
            draw();
          }}
          onPointerMove={(e) => {
            if (!live.current) return;
            const events = e.nativeEvent.getCoalescedEvents?.();
            for (const p of events?.length ? events : [e.nativeEvent]) live.current.pts.push(at(p));
            draw();
          }}
          onPointerUp={() => live.current && save([...r.strokes, live.current])}
          onPointerCancel={() => {
            live.current = null;
            draw();
          }}
        />
      )}
    </div>
  );
}

// The picture open in the note box, by id; gone (removed) closes it
export function RefSketch({
  r,
  n,
  of,
  onClose,
}: {
  r: RefPic | null;
  n: number;
  of: number;
  onClose: () => void;
}) {
  const undo = useRef<(() => void) | null>(null);
  useDialogModal("refSketch", !!r);
  return (
    <Dialog open={!!r} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        font="md"
        className="max-h-[94vh] grid-rows-[auto_minmax(0,1fr)] sm:max-w-[min(94vw,1400px)]"
        // on the whole dialog, wherever the focus is after a stroke: the studio's own shortcuts (Space plays, Ctrl+Z undoes an
        // edit of the film) stay out while drawing
        onKeyDown={(e) => {
          if (e.key === "Escape") return;
          e.stopPropagation();
          if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
            e.preventDefault();
            undo.current?.();
          }
        }}
      >
        <DialogTitle>
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span>
              Your picture {n} of {of}
            </span>
            <span className="text-muted-foreground text-ui font-normal">
              Drag on it to draw · {modKeyLabel()}Z undoes
            </span>
          </span>
        </DialogTitle>
        {r && <RefSketchBoard key={r.id} r={r} undoRef={undo} />}
      </DialogContent>
    </Dialog>
  );
}
