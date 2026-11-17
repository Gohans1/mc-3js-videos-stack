import {
  ArrowRightLeft,
  Box,
  CircleDot,
  ClipboardCheck,
  Folder,
  GitCompare,
  Layers,
  LockKeyhole,
  type LucideIcon,
  Monitor,
  Move,
  Music2,
  Shapes,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  Type,
} from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { keys as camKeys } from "../camera/cam";
import { layerItems } from "../camera/layers";
import { shotsDoc } from "../camera/shots";
import { SHOTS_OUT } from "../core/filmMeta";
import { S } from "../core/state";
import { set, useStudio } from "../core/store";
import { clockText } from "../core/time";
import { useFrame } from "../core/useFrame";
import { seek } from "../playback/transport";
import { sourceOf } from "../sound/library-view";
import { lanes, library } from "../sound/sound";
import { items as textItems } from "../text/text";
import { BUILTINS } from "./builtins";
import { HistoryPanel } from "./HistoryPanel";
import { otherKeys, type OwnField, type OwnInput, type OwnItem, ownWork } from "./own-work";

type Rec = Record<string, unknown>;
const NOW = "now";
const ABOUT: Record<string, string> = {
  [NOW]: "Scene details at the playhead.",
  audio: "Audio files added for this film.",
  text: "Custom text animations and easing.",
  stickers: "Custom stickers, shapes, and their animations.",
  effects: "Speed-ramp effects added for this film.",
  transitions: "Transitions created for this film.",
  animation: "Custom shot animations and camera easing.",
  "3d": "Objects and materials built for this film.",
  fields: "Extra properties used by this film.",
  choices: "Versions available to compare in the preview.",
  checks: "Checks available for draft renders.",
  other: "Additional data provided by this film.",
};
const aboutOf = (id: string) => ABOUT[id] ?? "Custom items provided by this film.";
const KIND_ICONS: Record<string, LucideIcon> = {
  [NOW]: Monitor,
  audio: Music2,
  text: Type,
  stickers: Shapes,
  effects: Sparkles,
  transitions: ArrowRightLeft,
  animation: Move,
  "3d": Box,
  fields: SlidersHorizontal,
  choices: GitCompare,
  checks: ClipboardCheck,
  other: Layers,
};

const filmWork = () => {
  const r = S.render;
  if (!r) return [];
  const shotRows = (shotsDoc.data ?? []) as Rec[];
  const film = {
    transitions: r.transitions,
    anims: r.anims,
    voices: S.tools?.titles?.anims,
    eases: r.eases,
    velocityEffects: r.velocityEffects,
    checks: r.checks,
    sounds: library.filter((x) => sourceOf(x) === "film"),
    objects: S.tools?.objects?.map(([, name]) => name),
    materials: S.tools?.materials?.map(([, name]) => name),
    shapes: S.tools?.titles?.shapes,
    textEases: S.tools?.titles?.eases,
    variants: r.variants,
    rows: [
      ...shotRows.flatMap((row, i) =>
        SHOTS_OUT[i] ? [{ kind: "Shot", t: SHOTS_OUT[i].t, row }] : [],
      ),
      ...camKeys.map((k) => ({ kind: "Camera key", t: k.t, row: k as unknown as Rec })),
      ...textItems.map((it) => ({ kind: "Text", t: it.from, row: it as unknown as Rec })),
      ...(lanes?.beds ?? []).map((b) => ({ kind: "Sound", t: b.from, row: b as unknown as Rec })),
      ...(lanes?.sfx ?? []).map((x) => ({ kind: "Sound", t: x.at, row: x as unknown as Rec })),
      ...layerItems().map((x) => ({ kind: "Adjustment", t: x.from, row: x as unknown as Rec })),
    ],
    other: Object.fromEntries([
      ...otherKeys(r).map((k) => [k, (r as unknown as Rec)[k]]),
      ...(S.tools ? otherKeys(S.tools, "tools") : []).map((k) => [
        `tools.${k}`,
        (S.tools as unknown as Rec)[k],
      ]),
    ]),
  } as OwnInput;
  const shots = shotRows.flatMap((row, i) =>
    SHOTS_OUT[i] ? [{ ...row, t: SHOTS_OUT[i].t }] : [],
  ) as Parameters<typeof ownWork>[2]["shots"];
  return ownWork(film, BUILTINS, {
    shots,
    texts: textItems as Parameters<typeof ownWork>[2]["texts"],
    sounds: [
      ...(lanes?.beds ?? []).map((b) => ({ name: b.name, t: b.from })),
      ...(lanes?.sfx ?? []).map((x) => ({ name: x.name, t: x.at })),
    ],
  });
};

function OnScreen() {
  useFrame();
  const sections = S.render?.describe?.(S.t) ?? [];
  if (sections.length === 0)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Monitor aria-hidden />
          </EmptyMedia>
          <EmptyTitle>No scene details at this time</EmptyTitle>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Move the playhead to another moment. Details appear when the film provides them.
          </p>
        </EmptyHeader>
      </Empty>
    );
  return (
    <div className="border-hairline-strong bg-card flex flex-col gap-5 rounded-lg border p-4">
      <p className="text-primary-text text-ui inline-flex items-center gap-2 font-mono tabular-nums">
        <CircleDot aria-hidden className="size-4" />
        Playhead {clockText(S.t)}
      </p>
      <dl className="flex flex-col gap-5">
        {sections.map((s, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <dt className="text-primary-text text-sm font-semibold">{s.head}</dt>
            {s.lines.map((l, j) => (
              <dd key={j} className="text-sm leading-relaxed wrap-anywhere">
                {l.fresh && (
                  <span className="text-primary-text text-ui me-2 font-semibold">New</span>
                )}
                {l.text}
              </dd>
            ))}
          </div>
        ))}
      </dl>
    </div>
  );
}

function Field({ f, bare }: { f: OwnField; bare: boolean }) {
  const [code, setCode] = useState<string | null>(null);
  const name = bare ? "sr-only" : "text-muted-foreground text-ui font-mono wrap-anywhere";
  if (!f.code)
    return (
      <div
        className={cn(
          "grid min-w-0 gap-x-4 gap-y-1",
          !bare && "@min-[40rem]/film:grid-cols-[minmax(0,8rem)_minmax(0,1fr)]",
        )}
      >
        <dt className={name}>{f.key}</dt>
        <dd className="min-w-0 text-sm leading-relaxed wrap-anywhere">
          <bdi>{f.text}</bdi>
        </dd>
      </div>
    );
  const write = f.code;
  return (
    <div className="flex flex-col">
      <dt className="sr-only">{f.key}</dt>
      <dd>
        {/* Serialize only while open: engine objects can be megabytes. */}
        <details onToggle={(e) => setCode(e.currentTarget.open ? write() : null)}>
          <summary className="text-primary-text focus-visible:ring-ring cursor-pointer rounded-sm py-1 text-sm leading-relaxed wrap-anywhere outline-none focus-visible:ring-2">
            <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 align-top">
              {!bare && <span className={name}>{f.key}</span>}
              <span>{f.text}</span>
            </span>
          </summary>
          {code !== null && (
            <pre
              tabIndex={0}
              role="region"
              aria-label={`${f.key} details`}
              className="bg-raised-2 focus-visible:ring-ring text-ui mt-2 max-h-64 overflow-auto overscroll-contain rounded-md p-3 font-mono leading-relaxed outline-none focus-visible:ring-2"
            >
              {code}
            </pre>
          )}
        </details>
      </dd>
    </div>
  );
}

const FEW = 8;

function UsageTimes({ times }: { times: number[] }) {
  const [expanded, setExpanded] = useState(false);
  const timeButton = (t: number) => (
    <Button
      key={t}
      variant="time"
      size="row"
      onClick={() => seek(t)}
      aria-label={`Go to ${clockText(t)}`}
    >
      {clockText(t)}
    </Button>
  );
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-ui">Used at</p>
      <div className="flex flex-wrap gap-2">{times.slice(0, FEW).map(timeButton)}</div>
      {times.length > FEW && (
        <details onToggle={(e) => setExpanded(e.currentTarget.open)}>
          <summary className="text-primary-text focus-visible:ring-ring w-fit cursor-pointer rounded-sm py-1 text-sm leading-relaxed outline-none focus-visible:ring-2">
            More timestamps ({times.length - FEW})
          </summary>
          {expanded && (
            <div className="flex flex-wrap gap-2 pt-2">{times.slice(FEW).map(timeButton)}</div>
          )}
        </details>
      )}
    </div>
  );
}

function Item({ x }: { x: OwnItem }) {
  return (
    <article className="border-hairline-strong bg-card flex min-w-0 flex-col gap-3 rounded-lg border p-4">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-base leading-relaxed font-semibold wrap-anywhere">
          <bdi>{x.title}</bdi>
        </h3>
        {x.id !== x.title && (
          <span className="text-muted-foreground text-ui font-mono wrap-anywhere">
            <bdi>{x.id}</bdi>
          </span>
        )}
        {x.part && <span className="text-muted-foreground text-ui">{x.part}</span>}
      </div>
      {x.changes && (
        <p className="text-warn-text text-ui flex items-start gap-2">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          Overrides the studio version
        </p>
      )}
      {x.tip && (
        <p className="text-muted-foreground text-sm leading-relaxed wrap-anywhere">{x.tip}</p>
      )}
      {x.used.length > 0 && <UsageTimes times={x.used} />}
      {x.fields.length > 0 && (
        <dl className="flex min-w-0 flex-col gap-3">
          {x.fields.map((f) => (
            <Field
              key={f.key}
              f={f}
              bare={x.fields.length === 1 && ["value", "values", "check"].includes(f.key)}
            />
          ))}
        </dl>
      )}
    </article>
  );
}

export function OwnPanel() {
  const categoryLabelId = useId();
  const headingId = useId();
  useStudio((s) => s.ready);
  useStudio((s) => s.shotsRev);
  useStudio((s) => s.camRev);
  useStudio((s) => s.textRev);
  useStudio((s) => s.soundRev);
  useStudio((s) => s.timingRev);
  useStudio((s) => s.layersRev);
  useStudio((s) => s.metaRev);
  useStudio((s) => s.groups);
  const pick = useStudio((s) => s.filmKind);
  const groups = filmWork();
  const kinds = [
    ...(S.render?.describe ? [{ id: NOW, title: "On screen" }] : []),
    ...groups.map((g) => ({ id: g.id, title: g.title, count: g.items.length })),
    { id: "history", title: "Versions" },
  ];
  const open = kinds.find((k) => k.id === pick) ?? kinds[0];
  const group = groups.find((g) => g.id === open.id);
  const choose = (id: string) => set({ filmKind: id });
  const OpenIcon = KIND_ICONS[open.id] ?? Folder;
  return (
    <section
      aria-label="Made by this film"
      className="@container/film flex min-h-0 w-full min-w-0 flex-1 overflow-hidden wrap-anywhere"
    >
      <nav
        aria-label="Film categories"
        className="border-hairline-subtle hidden w-44 flex-none flex-col gap-1 overflow-y-auto overscroll-contain border-e p-2 @min-[40rem]/film:flex"
      >
        {kinds.map((k) => {
          const Icon = KIND_ICONS[k.id] ?? Folder;
          return (
            <Button
              key={k.id}
              variant="quiet"
              size="row"
              className="w-full"
              aria-pressed={k.id === open.id}
              onClick={() => choose(k.id)}
            >
              <span className="flex min-w-0 items-center gap-2">
                <Icon aria-hidden data-icon="inline-start" />
                <span className="min-w-0 wrap-anywhere">{k.title}</span>
              </span>
              {"count" in k && (
                <span className="text-ui shrink-0 font-mono tabular-nums">{k.count}</span>
              )}
            </Button>
          );
        })}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-none flex-col gap-2 px-4 pt-4 @min-[40rem]/film:hidden">
          <p id={categoryLabelId} className="text-muted-foreground text-ui">
            Category
          </p>
          <Select
            value={open.id}
            items={kinds.map((k) => ({ value: k.id, label: k.title }))}
            onValueChange={(value) => {
              if (value !== null) choose(value);
            }}
          >
            <SelectTrigger aria-labelledby={categoryLabelId} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start" finalFocus>
              <SelectGroup>
                {kinds.map((k) => (
                  <SelectItem key={k.id} value={k.id} className="min-w-0">
                    <span className="min-w-0 wrap-anywhere whitespace-normal">
                      {k.title}
                      {"count" in k ? ` (${k.count})` : ""}
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div
          key={open.id}
          role="region"
          aria-labelledby={headingId}
          className="scroll-fade min-h-0 flex-1 overflow-y-auto overscroll-contain"
        >
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-2 px-4 pt-4 pb-4">
            <div className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-1">
              <div className="flex min-w-0 flex-1 basis-48 items-start gap-3">
                <OpenIcon aria-hidden className="text-primary-text mt-1 size-5 shrink-0" />
                <h2 id={headingId} className="min-w-0 flex-1 text-lg leading-normal font-semibold">
                  {open.title}
                </h2>
              </div>
              {group && (
                <span
                  dir="auto"
                  className="text-muted-foreground text-ui shrink-0 pt-1 tabular-nums"
                >
                  {group.items.length} {group.items.length === 1 ? "item" : "items"}
                </span>
              )}
            </div>
            <p className="text-muted-foreground text-sm leading-relaxed">
              {open.id === "history"
                ? "Try a different direction and return to a version you kept."
                : aboutOf(open.id)}
            </p>
            {open.id !== "history" && (
              <p className="text-muted-foreground text-ui flex items-start gap-2 leading-relaxed">
                <LockKeyhole aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                View only · Add a note to request changes.
              </p>
            )}
          </div>
          <div className="mx-auto w-full max-w-4xl px-4 pb-4">
            {open.id === "history" ? (
              <HistoryPanel />
            ) : group ? (
              <div className="flex flex-col gap-4">
                {group.items.map((x) => (
                  <Item key={`${x.part ?? ""}:${x.id}`} x={x} />
                ))}
              </div>
            ) : (
              <OnScreen />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
