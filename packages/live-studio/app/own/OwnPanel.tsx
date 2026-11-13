// The Film tab, view only: what is on screen at the playhead as the film's code describes it (draw.describe), and what the
// film's code adds on top of the studio's libraries, by kind (transitions, sounds, 3D…), each with the seconds it is used at

import { SHOTS_OUT } from "film/scene";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { shotsDoc } from "../camera/shots";
import { Section } from "../components/inspector";
import { S } from "../core/state";
import { useStudio } from "../core/store";
import { clockText } from "../core/time";
import { useFrame } from "../core/useFrame";
import { seek } from "../playback/transport";
import { sourceOf } from "../sound/library-view";
import { lanes, library } from "../sound/sound";
import { items as textItems } from "../text/text";
import { BUILTINS } from "./builtins";
import { otherKeys, type OwnField, type OwnInput, type OwnItem, ownWork } from "./own-work";

const filmWork = () => {
  const r = S.render;
  if (!r) return [];
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
    other: Object.fromEntries([
      ...otherKeys(r).map((k) => [k, (r as unknown as Record<string, unknown>)[k]]),
      ...(S.tools ? otherKeys(S.tools, "tools") : []).map((k) => [
        `tools.${k}`,
        (S.tools as unknown as Record<string, unknown>)[k],
      ]),
    ]),
  } as OwnInput;
  const shots = (shotsDoc.data ?? []).flatMap((row, i) =>
    SHOTS_OUT[i] ? [{ ...(row as object), t: SHOTS_OUT[i].t }] : [],
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
  const describe = S.render?.describe;
  if (!describe) return null;
  const sections = describe(S.t);
  return (
    <Section title="On screen now">
      <dl className="flex flex-col gap-2.5">
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
    </Section>
  );
}

// bare: the item's only field under a stand-in name ("value", "check"), so only the value shows
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
              className="bg-raised-2 focus-visible:ring-ring text-tag mt-1.5 max-h-60 overflow-auto rounded-md p-2 font-mono leading-relaxed outline-none focus-visible:ring-2"
            >
              {code}
            </pre>
          )}
        </details>
      </dd>
    </div>
  );
}

function Item({ x }: { x: OwnItem }) {
  return (
    <article className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h3 className="text-ui font-semibold">{x.title}</h3>
        {x.id !== x.title && (
          <span className="text-muted-foreground font-mono text-xs">{x.id}</span>
        )}
        {x.part && <span className="text-muted-foreground text-xs">{x.part}</span>}
        {x.changes && <span className="text-warn text-xs">changes the studio's own</span>}
      </div>
      {x.tip && <p className="text-muted-foreground text-xs">{x.tip}</p>}
      {x.used.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-muted-foreground text-xs">Used at</span>
          {x.used.map((t) => (
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
        </div>
      )}
      {x.fields.length > 0 && (
        <dl className="flex flex-col gap-1">
          {x.fields.map((f) => (
            <Field
              key={f.key}
              f={f}
              bare={x.fields.length === 1 && (f.key === "value" || f.key === "check")}
            />
          ))}
        </dl>
      )}
    </article>
  );
}

export function OwnPanel() {
  useFrame(); // the shots and text may change under it (an edit, the AI's save): read again as the playhead moves
  useStudio((s) => s.textRev);
  const groups = filmWork();
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
      <p className="text-muted-foreground px-3 pt-1 pb-2 text-xs">
        What this film's code shows and adds on top of the studio. View only: to change something,
        write a note.
      </p>
      <OnScreen />
      {groups.map((g) => (
        <Section key={g.id} title={`${g.title} · ${g.items.length}`} closed={g.items.length > 8}>
          {g.items.map((x) => (
            <Item key={`${x.part ?? ""}:${x.id}`} x={x} />
          ))}
        </Section>
      ))}
      {!groups.length && (
        <p className="text-muted-foreground px-3 py-3.5 text-xs">
          No effects of its own: every transition, animation and ease comes from the studio's
          libraries.
        </p>
      )}
    </div>
  );
}
