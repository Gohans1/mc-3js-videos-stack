// The Film tab, view only, laid out as CapCut's libraries and the Audio tab: the kinds down the left (chips across the top when
// the column is too narrow), the open one on the right. On screen is what the film's code says is in the picture at the playhead
// (draw.describe); every other kind is what its code adds on top of the studio's libraries, each with the seconds it is used at
import { SHOTS_OUT } from "film/scene";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { keys as camKeys } from "../camera/cam";
import { layerItems } from "../camera/layers";
import { shotsDoc } from "../camera/shots";
import { ChipGroup, NavItem } from "../components/inspector";
import { S } from "../core/state";
import { set, useStudio } from "../core/store";
import { clockText } from "../core/time";
import { useFrame } from "../core/useFrame";
import { seek } from "../playback/transport";
import { sourceOf } from "../sound/library-view";
import { lanes, library } from "../sound/sound";
import { items as textItems } from "../text/text";
import { BUILTINS } from "./builtins";
import { otherKeys, type OwnField, type OwnInput, type OwnItem, ownWork } from "./own-work";

type Rec = Record<string, unknown>;
const NOW = "now";
// What each kind holds, in a line, so the creator needn't know the film's code to read the list
const ABOUT: Record<string, string> = {
  [NOW]: "What the film's code says is in the picture at the playhead.",
  audio: "Sound files this film brought in itself, playing ones first.",
  text: "Text animations and eases the film's code made.",
  stickers: "Stickers the film's code draws, and their animations.",
  effects: "Speed-ramp effects the film's code made.",
  transitions: "Transitions the film's code made.",
  animation: "Shot animations and camera eases the film's code made.",
  "3d": "What the film's code builds in 3D: objects and materials.",
  fields: "Fields of its own on the timeline's rows, read only by the film's code.",
  choices: "Versions to compare: the A/B chips over the picture switch them.",
  checks: "Checks a draft render can run on the picture.",
  other: "Anything else the film's code hands the studio.",
};
const aboutOf = (id: string) => ABOUT[id] ?? "A kind of its own the film's code made up.";

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
  return (
    <dl className="flex flex-col gap-3">
      {sections.map((s, i) => (
        <div key={i} className="flex flex-col gap-0.5">
          <dt className="text-muted-foreground text-xs font-semibold tracking-wide">{s.head}</dt>
          {s.lines.map((l, j) => (
            <dd key={j} className="text-ui text-foreground/90 break-words">
              {l.fresh && <span className="text-primary mr-1.5 text-xs font-semibold">New </span>}
              {l.text}
            </dd>
          ))}
        </div>
      ))}
    </dl>
  );
}

// bare: the item's only field under a stand-in name ("value", "values", "check"), so only the value shows
function Field({ f, bare }: { f: OwnField; bare: boolean }) {
  const [code, setCode] = useState<string | null>(null);
  const name = bare ? "sr-only" : "text-muted-foreground w-24 flex-none font-mono break-all";
  if (!f.code)
    return (
      <div className="flex gap-2">
        <dt className={cn(name, "text-xs")}>{f.key}</dt>
        <dd className="min-w-0 text-xs break-words">{f.text}</dd>
      </div>
    );
  const write = f.code;
  return (
    <div className="flex flex-col">
      <dt className="sr-only">{f.key}</dt>
      <dd>
        {/* Written out on opening, once: an engine object the film hands over can be megabytes */}
        <details onToggle={(e) => setCode(e.currentTarget.open ? write() : null)}>
          <summary className="focus-visible:ring-ring flex cursor-pointer gap-2 rounded-sm text-xs outline-none focus-visible:ring-2">
            {!bare && (
              <span aria-hidden className={name}>
                {f.key}
              </span>
            )}
            <span className="text-primary">{f.text}</span>
          </summary>
          {code !== null && (
            // Focusable so a keyboard can scroll a long shader
            <pre
              tabIndex={0}
              className="bg-raised-2 focus-visible:ring-ring text-tag mt-1.5 max-h-60 overflow-auto overscroll-contain rounded-md p-2 font-mono leading-relaxed outline-none focus-visible:ring-2"
            >
              {code}
            </pre>
          )}
        </details>
      </dd>
    </div>
  );
}

const FEW = 8; // seconds shown before "+N more": a field set on every row would bury the list in buttons

function Item({ x }: { x: OwnItem }) {
  const [all, setAll] = useState(false);
  const times = all ? x.used : x.used.slice(0, FEW);
  return (
    <article className="flex flex-col gap-1.5 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h3 className="text-ui font-semibold break-words">{x.title}</h3>
        {x.id !== x.title && (
          <span className="text-muted-foreground font-mono text-xs break-all">{x.id}</span>
        )}
        {x.part && <span className="text-muted-foreground text-xs">{x.part}</span>}
        {x.changes && <span className="text-warn text-xs">changes the studio's own</span>}
      </div>
      {x.tip && <p className="text-muted-foreground text-xs">{x.tip}</p>}
      {x.used.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-muted-foreground text-xs">Used at</span>
          {times.map((t) => (
            <Button
              key={t}
              variant="time"
              size="sm"
              onClick={() => seek(t)}
              aria-label={`Go to ${clockText(t)}`}
            >
              {clockText(t)}
            </Button>
          ))}
          {x.used.length > FEW && (
            <Button variant="quiet" size="sm" onClick={() => setAll(!all)}>
              {all ? "Fewer" : `+${x.used.length - FEW} more`}
            </Button>
          )}
        </div>
      )}
      {x.fields.length > 0 && (
        <dl className="flex flex-col gap-1">
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
  useStudio((s) => s.ready);
  useStudio((s) => s.shotsRev);
  useStudio((s) => s.camRev);
  useStudio((s) => s.textRev);
  useStudio((s) => s.soundRev);
  useStudio((s) => s.timingRev);
  useStudio((s) => s.layersRev);
  useStudio((s) => s.groups);
  const pick = useStudio((s) => s.filmKind);
  const groups = filmWork();
  const kinds = [
    ...(S.render?.describe ? [{ id: NOW, title: "On screen" }] : []),
    ...groups.map((g) => ({ id: g.id, title: g.title, count: g.items.length })),
  ];
  if (!kinds.length)
    return (
      <p className="text-muted-foreground px-3 py-3.5 text-xs">
        This film's code adds nothing of its own: every effect comes from the studio's libraries.
      </p>
    );
  const open = kinds.find((k) => k.id === pick) ?? kinds[0];
  const group = groups.find((g) => g.id === open.id);
  const choose = (id: string) => set({ filmKind: id });
  return (
    <section
      aria-label="Made by this film"
      className="@container flex min-h-0 flex-1 overflow-hidden"
    >
      <nav
        aria-label="Kinds"
        className="border-border flex w-[134px] flex-none flex-col gap-0.5 overflow-y-auto overscroll-contain border-e px-1.5 py-2.5 @max-[320px]:hidden"
      >
        {kinds.map((k) => (
          <NavItem
            key={k.id}
            title={k.title}
            count={"count" in k ? k.count : undefined}
            current={k.id === open.id}
            onClick={() => choose(k.id)}
          />
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex-none px-3 pt-2.5 @min-[320px]:hidden">
          <ChipGroup
            scroll
            label="Kinds"
            value={open.id}
            onChange={choose}
            items={kinds.map((k) => ({
              id: k.id,
              title: k.title,
              ...("count" in k ? { count: k.count } : {}),
            }))}
          />
        </div>
        <div className="flex flex-none flex-col gap-0.5 px-3 pt-2.5 pb-1">
          <div className="flex items-baseline gap-2">
            <h2 className="text-ui font-semibold">{open.title}</h2>
            <span
              className="text-muted-foreground ms-auto text-xs"
              title="To change something here, write a note"
            >
              View only
            </span>
          </div>
          <p className="text-muted-foreground text-xs">{aboutOf(open.id)}</p>
        </div>
        <div className="scroll-fade min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-1 pb-3">
          {group ? (
            <div key={open.id} className="divide-border flex flex-col divide-y">
              {group.items.map((x) => (
                <Item key={`${x.part ?? ""}:${x.id}`} x={x} />
              ))}
            </div>
          ) : (
            <OnScreen />
          )}
        </div>
      </div>
    </section>
  );
}
