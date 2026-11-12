import {
  Box,
  ChevronLeft,
  ChevronRight,
  Diamond,
  Eye,
  EyeOff,
  Magnet,
  Move3d,
  Plus,
  Rotate3d,
  RotateCcw,
  Scale3d,
  Squirrel,
  Trash2,
} from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
// The Objects tab, Unreal's Details panel over its Content Browser: the dropped-in object the gizmo is on (name, where it is at
// the playhead, its clip if it's a mob), then what is in the film already, then everything it can take: the game's own blocks
// and mobs first, as Minecraft's creative tabs put them, and every custom block (the shared props, the mod picks) in one tab. A library row is dragged onto the picture, or + puts it in the middle of the view. Every edit keys the object at the
// playhead (objects/placed.ts) and is one undo step (Ctrl+Z)
import { cn } from "@/lib/utils";

import { timingClock } from "../../src/timing-state.mjs";
import { CurveEditor, EaseTiles } from "../components/EasePicker";
import { EmptyCard, Segmented } from "../components/inspector";
import { NumberField } from "../components/NumberField";
import { SearchBox } from "../components/SearchBox";
import { Tip } from "../components/Tip";
import { matcher } from "../core/search";
import { S } from "../core/state";
import { useStudio } from "../core/store";
import { FPS, stamp } from "../core/time";
import { keyNav } from "../keys/keynav";
import { lookAtClick } from "../picture/look";
import { seek } from "../playback/transport";
import {
  addInFront,
  cancelPreviewTransform,
  canPlace,
  clearClip,
  type GizmoMode,
  OBJECT_EASE,
  placedData,
  placedDoc,
  previewTransform,
  removeObject,
  renameObject,
  resetTransform,
  select,
  setClip,
  setClipRate,
  setGizmo,
  setKeyEase,
  setSnap,
  setTransform,
  setVisible,
  shownTransform,
  startedBy,
  startObjectCarry,
  titleOf,
  toggleKey,
  tools,
} from "./placed";

type Item = { what: string; kind: "block" | "mob" | "custom"; title: string };
let catalog: Promise<Item[]> | null = null;
const icons = new Map<string, string | null>();
// One block drawn at a time: each is a small WebGL render, and a scrolled list asks for dozens at once
let iconQueue = Promise.resolve();
const iconOf = (what: string) => {
  if (icons.has(what)) return Promise.resolve(icons.get(what)!);
  const job = iconQueue
    .then(
      () =>
        tools()
          ?.icon(what, 64)
          .catch(() => null) ?? null,
    )
    .then((u) => {
      icons.set(what, u);
      return u;
    });
  iconQueue = job.then(() => undefined);
  return job;
};

const r = (x: number, d: number) => +x.toFixed(d);
const STILL = "none"; // mc-assets/placed.ts plays no clip it doesn't know
const label = "text-ui text-muted-foreground";

// A number typed and saved on Enter or on leaving the box; Escape puts the shown value back
function Num({
  value,
  onSave,
  live,
  onCancel,
  name,
  step = 0.0625,
}: {
  value: number;
  onSave: (v: number) => void;
  live?: (v: number) => void;
  onCancel?: () => void;
  name: string;
  step?: number;
}) {
  return (
    <NumberField
      size="tight"
      name={name}
      value={value}
      step={step}
      live={live}
      onCancel={onCancel}
      onSave={(v) => {
        if (v !== undefined) onSave(v);
      }}
    />
  );
}

// Where the object is at the playhead, as drawn, and the playhead's frame: read a few times a second, so the panel follows
// playback, seeking and the gizmo
const useShown = (name: string) => {
  const [v, setV] = useState(() => ({ shown: shownTransform(name), frame: Math.round(S.t * FPS) }));
  useEffect(() => {
    let last = "";
    const read = () => {
      const now = { shown: shownTransform(name), frame: Math.round(S.t * FPS) };
      const s = JSON.stringify(now);
      if (s !== last) {
        last = s;
        setV(now);
      }
    };
    read();
    const id = setInterval(read, 120);
    return () => clearInterval(id);
  }, [name]);
  return v;
};

function Inspector({ name }: { name: string }) {
  useStudio((s) => s.keysRev);
  const gizmo = useStudio((s) => s.gizmo),
    snap = useStudio((s) => s.snap);
  const o = placedData()[name],
    { shown } = useShown(name);
  if (!o) return null;
  const mob = o.what.startsWith("mob:"),
    clips = tools()?.clipsOf(name) ?? [];
  const nav = keyNav(
      o.keys.map((k) => k.t),
      S.t,
      0.5 / FPS,
    ),
    keyNear = nav.here >= 0;
  const iconBtn = "pointer-coarse:size-10";
  let visible = true;
  for (const k of o.keys)
    if (k.t <= S.t + 0.5 / FPS && k.visible !== undefined) visible = k.visible;
  const at = shown?.at ?? o.keys[0].at,
    rot = shown?.rot ?? o.keys[0].rot ?? [0, 0, 0],
    scale = shown?.scale ?? o.keys[0].scale ?? 1;
  const axis = (list: number[], i: number, v: number) => list.map((x, k) => (k === i ? v : x));
  const modes: { id: GizmoMode; title: string; icon: typeof Move3d; key: string }[] = [
    { id: "translate", title: "Move", icon: Move3d, key: "W" },
    { id: "rotate", title: "Rotate", icon: Rotate3d, key: "E" },
    { id: "scale", title: "Scale", icon: Scale3d, key: "R" },
  ];
  return (
    <section aria-label="Selected object" className="bg-card flex flex-col gap-2.5 rounded-xl p-3">
      <div className="flex items-center gap-2">
        <Badge variant="secondary">{mob ? "MOB" : "BLOCK"}</Badge>
        <Input
          key={name}
          variant="title"
          size="tight"
          aria-label="Object name"
          defaultValue={name}
          spellCheck={false}
          className="flex-1"
          onBlur={(e) => {
            if (!renameObject(name, e.target.value)) e.target.value = name;
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              e.currentTarget.value = name;
              e.currentTarget.blur();
            }
          }}
        />
        <Tip label="Delete object (Delete)">
          <Button
            variant="remove"
            size="icon-lg"
            className="-me-1 pointer-coarse:size-10"
            aria-label={`Delete ${name}`}
            onClick={() => removeObject(name)}
          >
            <Trash2 />
          </Button>
        </Tip>
      </div>
      <p translate="no" className="text-muted-foreground -mt-1 truncate text-xs" title={o.what}>
        {o.what}
      </p>
      <div className="flex items-center gap-1.5">
        <ToggleGroup
          value={[gizmo]}
          onValueChange={(v: string[]) => v[0] && setGizmo(v[0] as GizmoMode)}
          spacing={1}
          className="flex-1"
          aria-label="Gizmo"
        >
          {modes.map((m) => (
            <Tip key={m.id} label={`${m.title} (${m.key})`}>
              <ToggleGroupItem
                value={m.id}
                aria-label={m.title}
                variant="pick"
                size="lg"
                className="flex-1"
              >
                <m.icon className="size-4" />
                {m.title}
              </ToggleGroupItem>
            </Tip>
          ))}
        </ToggleGroup>
        <Tip
          label={
            snap
              ? "Snap is on: 1 game pixel, 15°. Click to move freely"
              : "Snap is off. Click to move by 1 game pixel and 15°"
          }
        >
          <Button
            variant="quiet"
            size="icon-lg"
            aria-pressed={snap}
            aria-label="Snap"
            onClick={() => setSnap(!snap)}
          >
            <Magnet />
          </Button>
        </Tip>
      </div>
      <div className="-mb-1 flex items-center gap-0.5">
        <span className="text-ui flex-1 font-medium">Transform</span>
        <Tip label="Previous keyframe">
          <Button
            variant="quiet"
            size="icon-lg"
            className={iconBtn}
            aria-label="Previous keyframe"
            disabled={nav.prev === null}
            onClick={() => nav.prev !== null && seek(nav.prev)}
          >
            <ChevronLeft />
          </Button>
        </Tip>
        <Tip
          label={
            keyNear ? "Delete this keyframe" : "Add a keyframe here, keeping the object where it is"
          }
        >
          <Button
            variant={keyNear ? "lit" : "quiet"}
            size="icon-lg"
            className={iconBtn}
            aria-label={
              keyNear ? `Delete keyframe at ${stamp(S.t)}` : `Add keyframe at ${stamp(S.t)}`
            }
            onClick={() => toggleKey(name)}
          >
            <Diamond className={cn(keyNear && "fill-current")} />
          </Button>
        </Tip>
        <Tip label="Next keyframe">
          <Button
            variant="quiet"
            size="icon-lg"
            className={iconBtn}
            aria-label="Next keyframe"
            disabled={nav.next === null}
            onClick={() => nav.next !== null && seek(nav.next)}
          >
            <ChevronRight />
          </Button>
        </Tip>
        <Tip label="Reset rotation and scale at the playhead">
          <Button
            variant="quiet"
            size="icon-lg"
            className={iconBtn}
            aria-label="Reset rotation and scale"
            onClick={() => resetTransform(name)}
          >
            <RotateCcw />
          </Button>
        </Tip>
      </div>
      <div className="grid grid-cols-[4.5rem_repeat(3,minmax(0,1fr))] items-center gap-1.5">
        <span className={label}>Position</span>
        {["X", "Y", "Z"].map((n, i) => (
          <Num
            key={n}
            name={`Position ${n}`}
            value={r(at[i], 3)}
            live={(v) => previewTransform(name, { at: axis(at, i, v) })}
            onCancel={() => cancelPreviewTransform(name)}
            onSave={(v) => setTransform(name, { at: axis(at, i, v) })}
          />
        ))}
        <span className={label}>Rotation</span>
        {["X", "Y", "Z"].map((n, i) => (
          <Num
            key={n}
            name={`Rotation ${n} (degrees)`}
            step={1}
            value={r(rot[i], 1)}
            live={(v) => previewTransform(name, { rot: axis(rot, i, v) })}
            onCancel={() => cancelPreviewTransform(name)}
            onSave={(v) => setTransform(name, { rot: axis(rot, i, v) })}
          />
        ))}
        <span className={label}>Scale</span>
        <Num
          name="Scale"
          step={0.0625}
          value={r(scale, 3)}
          live={(v) => previewTransform(name, { scale: v })}
          onCancel={() => cancelPreviewTransform(name)}
          onSave={(v) => setTransform(name, { scale: v })}
        />
        <span className="col-span-2" />
      </div>
      {mob && clips.length > 0 && <ClipRow name={name} clips={clips} />}
      {nav.here > 0 && <EaseRow name={name} i={nav.here} />}
      <div className="text-ui flex items-center gap-2">
        <span className="text-muted-foreground min-w-0 flex-1">
          {keyNear ? (
            <>
              Keyframe at <span className="tabular-nums">{stamp(S.t)}</span>
            </>
          ) : (
            <>
              {o.keys.length} keyframe{o.keys.length === 1 ? "" : "s"}. An edit here adds one at{" "}
              <span className="tabular-nums">{stamp(S.t)}</span>
            </>
          )}
        </span>
        <Tip label={visible ? "Hide from the playhead on" : "Show from the playhead on"}>
          <Button variant="secondary" size="md" onClick={() => setVisible(name, !visible)}>
            {visible ? <EyeOff /> : <Eye />}
            {visible ? "Hide" : "Show"}
          </Button>
        </Tip>
      </div>
      <div className="flex flex-wrap gap-1">
        {o.keys.map((k) => (
          <button
            key={k.t}
            type="button"
            onClick={() => seek(k.t)}
            className={cn(
              "bg-background text-muted-foreground hover:text-foreground rounded-md px-1.5 py-0.5 text-xs tabular-nums",
              Math.abs(k.t - S.t) < 0.5 / FPS && "bg-tint text-primary",
            )}
          >
            {stamp(k.t)}
          </button>
        ))}
      </div>
    </section>
  );
}

// How the object moves into the keyframe at the playhead from the one before (CapCut's keyframe curve), as the camera's Speed tab
function EaseRow({ name, i }: { name: string; i: number }) {
  const o = placedData()[name],
    k = o.keys[i],
    curve = Array.isArray(k.ease) ? k.ease : null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-ui">
        <span className="font-medium">Speed</span>{" "}
        <span className="text-muted-foreground tabular-nums">
          {stamp(o.keys[i - 1].t)} → {stamp(k.t)}
        </span>
      </p>
      <EaseTiles
        value={k.ease}
        fallback={OBJECT_EASE}
        onPick={(v) => setKeyEase(name, i, v)}
        className="grid grid-cols-[repeat(auto-fill,minmax(3.75rem,1fr))] gap-x-2 gap-y-2.5"
      />
      {curve && (
        <CurveEditor
          value={curve}
          doc={placedDoc}
          preview={(v) => placedDoc.preview(name, i, v)}
          onSave={(v) => setKeyEase(name, i, v)}
        />
      )}
    </div>
  );
}

// The mob's clip, keyed like the transform: what runs at the playhead, and the keyframe that started it. Picking another keys it
// at the playhead, so a chest opens at the keyframe it is picked on and stays open (a one-shot clip holds its last frame)
function ClipRow({ name, clips }: { name: string; clips: string[] }) {
  const o = placedData()[name],
    run = tools()?.clipAt(name, timingClock.sourceAt(S.t + 0.5 / FPS)) ?? null,
    by = startedBy(o);
  const now = run?.clip ?? clips.find((c) => /idle/i.test(c)) ?? STILL,
    here = by && Math.abs(by.t - S.t) < 0.5 / FPS;
  const link =
    "rounded-sm font-medium text-foreground underline decoration-dotted underline-offset-2 outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_4.5rem] items-center gap-1.5">
        <span className={label}>Animation</span>
        <Select
          items={[
            { value: STILL, label: "None (stands still)" },
            ...clips.map((c) => ({ value: c, label: c })),
          ]}
          value={now}
          onValueChange={(v) => v && v !== now && setClip(name, v)}
        >
          <SelectTrigger className="h-8 w-full" aria-label="Animation from the playhead on">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={STILL}>None (stands still)</SelectItem>
            {clips.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Num
          name="Animation speed"
          step={0.1}
          value={run?.rate ?? 1}
          onSave={(v) => setClipRate(name, v, now)}
        />
      </div>
      <p className="text-muted-foreground ps-19.5 text-xs">
        {here ? (
          <>
            Starts at this keyframe.{" "}
            <button type="button" className={link} onClick={() => clearClip(name)}>
              Remove
            </button>
          </>
        ) : by ? (
          <>
            Started by the keyframe at{" "}
            <button type="button" className={cn(link, "tabular-nums")} onClick={() => seek(by.t)}>
              {stamp(by.t)}
            </button>
            . Another one starts here.
          </>
        ) : (
          <>Pick one to start it at the playhead.</>
        )}
      </p>
    </div>
  );
}

function Icon({ item }: { item: Item }) {
  const [url, setUrl] = useState<string | null | undefined>(() => icons.get(item.what));
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (item.kind === "mob" || url !== undefined || !ref.current) return;
    let live = true;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      iconOf(item.what).then((u) => live && setUrl(u));
    });
    io.observe(ref.current);
    return () => {
      live = false;
      io.disconnect();
    };
  }, [item.kind, item.what, url]);
  return (
    <span
      ref={ref}
      aria-hidden
      className="bg-background text-muted-foreground grid size-9 flex-none place-items-center rounded-md"
    >
      {url ? (
        <img src={url} alt="" className="size-8 [image-rendering:pixelated]" />
      ) : item.kind === "mob" ? (
        <Squirrel className="size-4" />
      ) : (
        <Box className="size-4" />
      )}
    </span>
  );
}

const KINDS = [
  { id: "block", title: "Blocks", one: "block" },
  { id: "mob", title: "Mobs", one: "mob" },
  { id: "custom", title: "Custom", one: "custom object" },
] as const;
type Kind = Item["kind"];
const CAP = 200;
// The game's own by name; custom ones by where they come from, the film's own pack (gohans) first, then each mod
const nsOf = (x: Item) => x.what.split(":")[1] ?? "";
const order = (a: Item, b: Item) =>
  a.kind === "custom" && b.kind === "custom" && nsOf(a) !== nsOf(b)
    ? nsOf(a) === "gohans"
      ? -1
      : nsOf(b) === "gohans"
        ? 1
        : nsOf(a).localeCompare(nsOf(b))
    : a.title.localeCompare(b.title);
// What the film holds already, Unreal's Outliner in one line: a click selects it, on the picture and on its timeline row
function InFilm() {
  useStudio((s) => s.keysRev);
  const object = useStudio((s) => s.object),
    names = Object.keys(placedData());
  if (!names.length) return null;
  return (
    <section aria-label="In this film" className="flex flex-col gap-1.5">
      <h3 className="text-label px-0.5 text-xs font-semibold">In this film ({names.length})</h3>
      <div className="flex flex-wrap gap-1">
        {names.map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={object === n}
            onClick={() => select(n)}
            className="bg-card text-ui text-label hover:bg-raised-2 hover:text-foreground aria-pressed:bg-tint aria-pressed:text-primary h-7 max-w-full truncate rounded-md px-2"
          >
            {n}
          </button>
        ))}
      </div>
    </section>
  );
}

// side: a wide library, its kinds in a column down the left as CapCut's sections are
export function ObjectLibrary({ side = false }: { side?: boolean }) {
  const ready = useStudio((s) => s.ready);
  const [items, setItems] = useState<Item[] | null>(null);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<Kind>("block");
  useEffect(() => {
    if (!ready || !tools()) return;
    catalog ??= tools()!.catalog();
    catalog.then((xs) => setItems([...xs].sort(order))).catch(() => setItems([]));
  }, [ready]);
  // Every tab's matches, so the tabs say how many each holds for the words typed
  const found = useMemo(() => {
    const hit = matcher(q);
    const all = (items ?? []).filter((x) => hit(`${x.what} ${x.title}`));
    return Object.fromEntries(
      KINDS.map((k) => [k.id, all.filter((x) => x.kind === k.id)]),
    ) as Record<Kind, Item[]>;
  }, [items, q]);
  const shown = found[kind],
    meta = KINDS.find((k) => k.id === kind)!,
    typed = q.trim() !== "";
  const elsewhere = KINDS.filter((k) => k.id !== kind && found[k.id].length);
  // Dragged: a few pixels of movement turn the press into carrying the object to the picture (as the sound library does)
  const press = (what: string) => (e: ReactPointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    getSelection()?.removeAllRanges();
    const x0 = e.clientX,
      y0 = e.clientY;
    const stop = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", stop);
      removeEventListener("pointercancel", stop);
    };
    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
      stop();
      startObjectCarry(what, ev, lookAtClick);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", stop);
    addEventListener("pointercancel", stop);
  };
  return (
    <section
      aria-label="Object library"
      className={cn("flex gap-2", side ? "items-start" : "flex-col")}
    >
      <Segmented
        label="Kind"
        vertical={side}
        value={kind}
        onChange={setKind}
        className={cn(side && "sticky top-0 w-27")}
        items={KINDS.map((k) => ({
          id: k.id,
          title: (
            <>
              <span className="truncate">{k.title}</span>
              {typed && items && (
                <span className="text-muted-foreground ms-auto tabular-nums">
                  {found[k.id].length}
                </span>
              )}
            </>
          ),
        }))}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <SearchBox
          name="object-search"
          value={q}
          onChange={setQ}
          label="Search objects"
          placeholder={
            items
              ? `Search ${items.filter((x) => x.kind === kind).length} ${meta.title.toLowerCase()}…`
              : "Loading objects…"
          }
        />
        <p className="text-muted-foreground px-0.5 text-xs">
          Drag onto the picture, or click + to add it in the middle of the view.
        </p>
        <ul className="flex flex-col">
          {shown.slice(0, CAP).map((x) => (
            <li
              key={x.what}
              onPointerDown={press(x.what)}
              onDragStart={(e) => e.preventDefault()}
              className="group hover:bg-card flex min-h-11 cursor-grab touch-none items-center gap-2 rounded-lg px-1 select-none active:cursor-grabbing"
            >
              <Icon item={x} />
              <span className="flex min-w-0 flex-1 flex-col py-1">
                <span className="text-ui truncate first-letter:uppercase">{x.title}</span>
                <span translate="no" className="text-muted-foreground truncate text-xs">
                  {x.what}
                </span>
              </span>
              <Tip label="Add in the middle of the view">
                <Button
                  variant="quiet"
                  size="icon-lg"
                  className="flex-none pointer-coarse:size-10"
                  aria-label={`Add ${titleOf(x.what)}`}
                  onClick={() => addInFront(x.what, lookAtClick)}
                >
                  <Plus />
                </Button>
              </Tip>
            </li>
          ))}
          {items && shown.length > CAP && (
            <li className="text-muted-foreground px-1 py-2 text-xs">
              Showing {CAP} of {shown.length}. Type to narrow it down.
            </li>
          )}
          {items && !shown.length && (
            <li className="text-ui text-muted-foreground flex flex-col items-start gap-1.5 px-1 py-2">
              {!items.length
                ? "Couldn't list the film's blocks and mobs"
                : typed
                  ? `No ${meta.one}s match "${q.trim()}"`
                  : `This film has no ${meta.one}s`}
              {elsewhere.map((k) => (
                <Button key={k.id} variant="secondary" size="md" onClick={() => setKind(k.id)}>
                  {found[k.id].length} in {k.title}
                </Button>
              ))}
            </li>
          )}
        </ul>
      </div>
    </section>
  );
}

export function ObjectInspector() {
  const object = useStudio((s) => s.object);
  useStudio((s) => s.keysRev);
  return object && placedData()[object] ? (
    <Inspector key={object} name={object} />
  ) : (
    <EmptyCard title="No object selected">
      Click an object on the picture, or drag one in from the list below.
    </EmptyCard>
  );
}

// part: the whole tab (one column), or on a wide screen the object in the right column and the library in the left one
export function ObjectsPanel({ part = "all" }: { part?: "all" | "object" | "library" }) {
  useStudio((s) => s.keysRev);
  const loaded = useStudio((s) => s.keyFiles !== null);
  if (!loaded) return null;
  if (!canPlace())
    return (
      <EmptyCard title="This film can't take objects yet" className="m-3">
        It needs a placed key file and makePlaced in its scene (docs/film-contract.md).
      </EmptyCard>
    );
  return (
    <div
      data-arrow-scroll
      className="scroll-fade flex min-h-0 flex-1 flex-col gap-3 overflow-auto overscroll-contain px-3 pt-1 pb-3 *:shrink-0"
    >
      {part !== "library" && <ObjectInspector />}
      {part !== "object" && <InFilm />}
      {part !== "object" && <ObjectLibrary side={part === "library"} />}
    </div>
  );
}
