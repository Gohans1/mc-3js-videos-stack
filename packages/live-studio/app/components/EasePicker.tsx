// How a key is eased into, picked as CapCut's Speed > Curve tiles: the film's named eases (draw.eases), user-saved
// reusable ease templates (never mutating built-in presets), the pro tools' presets when the film shares none, and a custom
// curve with its editor (bezier-easing-editor, a CSS cubic-bezier).
import BezierEditor, { type BezierValue } from "bezier-easing-editor";
import { Check, Pencil, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import {
  type Bezier,
  DEFAULT_CUSTOM_CURVE,
  deleteEaseTemplate,
  type Ease,
  easeFn,
  easeNames,
  type EaseTemplate,
  easeTitle,
  easeToBezier,
  sameCurve,
  saveEaseTemplate,
} from "../core/ease";
import { S } from "../core/state";
import { useStudio } from "../core/store";
import { ownEase } from "../own/builtins";
import { FILM_MADE, FilmMark } from "../own/FilmMark";
import { tone } from "../timeline/canvas";
import { Reset, revealInScrollContainer } from "./inspector";
import { NumberField } from "./NumberField";
import { Tip } from "./Tip";

let customCurvePickAt = 0;

// What each of film-stage's named eases does (formulas in film-stage/src/camera.ts EASES; titles in core/ease.ts). smooth is
// 60% smoothstep + 40% linear, so it never comes to a full stop at a keyframe; inout does
const TIPS: Record<string, string> = {
  smooth: "Eases a little at both ends, never fully stops",
  linear: "Constant speed. Looks mechanical; use mid-move",
  out: "Slows into this keyframe: an arrival, a landing",
  in: "Speeds up from the last keyframe: a launch, a move leaving before a cut",
  inout: "Slow, fast, slow. Stops fully at both keyframes",
  expo: "Starts slow, then shoots away (fast pull-back)",
  snapOut: "Arrive: fast front-loaded snap with a long calm settle",
  glideOut: "Arrive: Cinetic house velvet landing into rest",
  settleOut: "Arrive: balanced deceleration for medium reframes",
  softOut: "Arrive: gentle low-contrast drift to rest",
  liftOut: "Arrive: slight build off the mark before a crisp landing",
  jump: "Arrive: instant exponential jump (k=12) that brakes immediately",
  xpArrive: "Arrive: exponential decay (k=7) carrying cut momentum to rest",
  stdInOut: "Reposition: Cinetic monotone spline S-curve for in-scene reframes",
  strongInOut: "Reposition: dramatic slow-fast-slow S-curve",
  whipBuild: "Reposition: long quiet wind-up into a steep whip snap",
  anticipate: "Reposition: pulls back ~5% first to wind up before launching",
  xpTravel: "Reposition: symmetric exponential S-curve across two marks",
  softIn: "Leave: gentle acceleration into a cut (never brakes before the cut)",
  buildIn: "Leave: steady acceleration building speed into the cut",
  launchIn: "Leave: holds back then launches hard right at the cut",
  xpLeave: "Leave: pure exponential acceleration (k=6) into the cut",
};
// For a film that shares no named eases: the pro tools' presets as cubic-beziers, each editable after, named as above. Ease is
// After Effects Easy Ease (F9: speed 0, influence 33.33%), the default of Blender (Auto Clamped), Unreal (Cubic Auto) and
// Cinemachine too; Ease Out and Ease In keep the other end linear, as After Effects' Easy Ease In and Out do (Shift+F9, Ctrl+Shift+F9)
const CURVES: { id: string; title: string; tip: string; v: Bezier }[] = [
  {
    id: "c-ease",
    title: "Ease",
    tip: "Eases out of the last keyframe and into this one",
    v: [0.333, 0, 0.667, 1],
  },
  {
    id: "c-ease-out",
    title: "Ease Out",
    tip: "A slow stop on this keyframe",
    v: [0.333, 0.333, 0.667, 1],
  },
  {
    id: "c-ease-in",
    title: "Ease In",
    tip: "A slow start from the last keyframe",
    v: [0.333, 0, 0.667, 0.667],
  },
];
const round = (v: number[]) => v.map((x) => Math.round(x * 1000) / 1000) as Bezier;

// A tile's picture of an ease as CapCut draws its speed curves: time across, speed up, the dashed line the average speed (the
// speed a linear move keeps), the same yellow as the speed shape on the camera row
const N = 32;
function Graph({ f }: { f: ((x: number) => number) | null }) {
  const d = 1 / N,
    speed = f
      ? Array.from({ length: N + 1 }, (_, i) => {
          const x = Math.min(1 - d / 2, Math.max(d / 2, i * d));
          return Math.max(0, (f(x + d / 2) - f(x - d / 2)) / d);
        })
      : [];
  const top = Math.max(2, ...speed),
    pts = speed.map((v, i) => `${4 + (i / N) * 40},${42 - (v / top) * 36}`).join(" ");
  return (
    <svg aria-hidden viewBox="0 0 48 48" className="bg-raised-2 absolute inset-0 size-full">
      <path
        d={`M4 ${42 - 36 / top}H44`}
        className="stroke-raised-4"
        strokeWidth="1"
        strokeDasharray="2 2"
        fill="none"
      />
      {f && (
        <polyline
          points={pts}
          fill="none"
          stroke={tone("warn")}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
function Tile({
  title,
  tip,
  f,
  on,
  own,
  onPick,
  onCustomize,
  customizeLabel,
  customizeMode,
  mono,
}: {
  title: string;
  tip: string;
  f: ((x: number) => number) | null;
  on: boolean;
  own?: boolean;
  onPick: () => void;
  onCustomize?: () => void;
  customizeLabel?: string;
  customizeMode?: "clone" | "edit";
  mono?: boolean;
}) {
  return (
    <li className="group flex min-w-0 flex-col items-center gap-1">
      <div className="relative aspect-square w-full">
        <Tip label={tip}>
          <button
            type="button"
            aria-pressed={on}
            aria-label={`${title}: ${tip}${own ? `, ${FILM_MADE}` : ""}`}
            onClick={onPick}
            className="text-foreground/85 studio-press studio-ease-tile ring-hairline focus-visible:ring-ring aria-pressed:text-primary-text aria-pressed:ring-primary relative block size-full cursor-pointer overflow-hidden rounded-md ring-1 outline-none focus-visible:ring-2 aria-pressed:ring-2"
          >
            {f ? (
              <Graph f={f} />
            ) : (
              <span className="bg-raised-2 text-warn-text absolute inset-0 grid place-items-center">
                <SlidersHorizontal className="size-6" />
              </span>
            )}
            {own && <FilmMark />}
          </button>
        </Tip>
        {onCustomize && customizeLabel && (
          <div className="pointer-events-auto absolute top-1 right-1 z-1 opacity-85 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
            <Tip label={customizeLabel}>
              <button
                type="button"
                aria-label={customizeLabel}
                onClick={onCustomize}
                className="studio-press studio-ease-customize border-hairline-strong bg-backdrop/85 text-label focus-visible:ring-ring flex size-6 cursor-pointer items-center justify-center rounded-full border outline-none focus-visible:ring-2 pointer-coarse:size-10 [&_svg]:pointer-events-none [&_svg]:size-3"
              >
                {customizeMode === "edit" ? <Pencil /> : <SlidersHorizontal />}
              </button>
            </Tip>
          </div>
        )}
      </div>
      <span
        title={title}
        translate={mono ? "no" : undefined}
        className={cn(
          "text-ui w-full truncate text-center leading-snug transition-colors duration-150",
          on ? "text-primary-text font-medium" : "text-label group-hover:text-foreground",
        )}
      >
        {title}
      </span>
    </li>
  );
}

const CURVE_AXES = ["x1", "y1", "x2", "y2"] as const;

function BezierCurveFields({
  value,
  defaultValue,
  onHandleDrag,
  onCommit,
}: {
  value: Bezier;
  defaultValue: Bezier;
  onHandleDrag: (v: Bezier) => void;
  onCommit: (v: Bezier) => void;
}) {
  return (
    <>
      <div className="bg-background self-center rounded-lg">
        <BezierEditor
          value={value as BezierValue}
          onChange={(v) => onHandleDrag(round(v))}
          width={220}
          height={220}
          background="transparent"
          gridColor={tone("card")}
          curveColor={tone("foreground")}
          handleColor={tone("primary")}
          progressColor={tone("slider")}
          textStyle={{ fill: tone("muted-foreground"), fontSize: 11, fontFamily: "inherit" }}
        />
      </div>
      {/* The same four numbers by keyboard with individual resets so no one has to memorize defaults. */}
      <div className="grid grid-cols-4 gap-1.5">
        {CURVE_AXES.map((n, k) => {
          const def = Math.round(defaultValue[k] * 1000) / 1000;
          const withK = (x: number) => {
            const v = [...value] as Bezier;
            v[k] = k % 2 ? x : Math.max(0, Math.min(1, x));
            return round(v);
          };
          return (
            <div key={n} className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between gap-0.5">
                <span className="text-label text-ui font-mono font-medium">{n}</span>
                <Reset
                  compact
                  label={`Reset ${n} to ${def}`}
                  disabled={Math.abs(value[k] - def) < 1e-3}
                  onClick={() => onCommit(withK(def))}
                />
              </div>
              <NumberField
                size="tight"
                name={`Curve ${n}`}
                value={value[k]}
                step={0.01}
                digits={3}
                onSave={(x) => {
                  if (x !== undefined) onCommit(withK(x));
                }}
              />
            </div>
          );
        })}
      </div>
    </>
  );
}

type TemplateDraft = {
  mode: "create" | "edit";
  templateId?: string;
  sourceTitle?: string;
  name: string;
  curve: Bezier;
  baseCurve: Bezier;
};

const uniqueTemplateName = (base: string, existing: EaseTemplate[]) => {
  const taken = new Set(existing.map((t) => t.name.toLowerCase()));
  const seed = base.trim() || "Custom ease";
  if (!taken.has(seed.toLowerCase())) return seed;
  let n = 2;
  while (taken.has(`${seed} ${n}`.toLowerCase())) n++;
  return `${seed} ${n}`;
};

// value: the key's ease as stored, none meaning fallback (what the film gives a key without one); onPick saves, one undo step
export function EaseTiles({
  value,
  fallback,
  onPick,
  className,
  names,
}: {
  value: Ease | undefined;
  fallback: string;
  onPick: (v: Ease | undefined) => void;
  className?: string;
  names?: string[];
}) {
  useStudio((s) => s.ready);
  const templates = useStudio((s) => s.easeTemplates);
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const [draftRevealSeq, setDraftRevealSeq] = useState(0);
  const [saving, setSaving] = useState(false);
  const draftRef = useRef<HTMLDivElement>(null);

  const list = names ?? easeNames();
  const curve = Array.isArray(value) ? value : null,
    presets = list.length ? [] : CURVES;
  const matchedTemplate = curve ? templates.find((t) => sameCurve(t.curve, curve)) : undefined;
  const now = curve
    ? (matchedTemplate?.id ?? presets.find((c) => c.v.join() === curve.join())?.id ?? "custom")
    : (value ?? fallback);
  const pick = (id: string) => {
    if (id === now) return;
    if (id === "custom") customCurvePickAt = performance.now();
    const c = CURVES.find((x) => x.id === id),
      v = c
        ? c.v
        : id === "custom"
          ? (curve ?? [...DEFAULT_CUSTOM_CURVE])
          : id === fallback
            ? undefined
            : id;
    if (JSON.stringify(v) !== JSON.stringify(value)) onPick(v);
  };
  const tipOf = (n: string) =>
    `${n === fallback ? "Default. " : ""}${TIPS[n] ?? `The film's own ease "${n}"`}`;

  const openClone = (sourceTitle: string, sourceEase: Ease | undefined) => {
    const baseCurve = easeToBezier(sourceEase, fallback);
    setDraftRevealSeq((s) => s + 1);
    setDraft({
      mode: "create",
      sourceTitle,
      name: uniqueTemplateName(`${sourceTitle} custom`, templates),
      curve: [...baseCurve] as Bezier,
      baseCurve: [...baseCurve] as Bezier,
    });
  };

  const nameId = useId();
  const openEditTemplate = (tpl: EaseTemplate) => {
    setDraftRevealSeq((s) => s + 1);
    setDraft({
      mode: "edit",
      templateId: tpl.id,
      sourceTitle: tpl.basedOn,
      name: tpl.name,
      curve: [...tpl.curve] as Bezier,
      baseCurve: [...tpl.curve] as Bezier,
    });
  };

  useEffect(() => {
    if (!draft || draftRevealSeq === 0) return;
    return revealInScrollContainer(draftRef.current, { pulseEl: draftRef.current });
  }, [draft, draftRevealSeq]);

  const applyDraft = async () => {
    if (!draft || saving || !draft.name.trim()) return;
    setSaving(true);
    try {
      const saved = await saveEaseTemplate({
        id: draft.templateId,
        name: draft.name.trim(),
        curve: draft.curve,
        basedOn: draft.sourceTitle,
      });
      if (saved) {
        onPick([...saved.curve]);
        setDraft(null);
      }
    } finally {
      setSaving(false);
    }
  };

  const removeDraft = async () => {
    if (!draft?.templateId || saving) return;
    setSaving(true);
    try {
      await deleteEaseTemplate(draft.templateId);
      setDraft(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-label text-ui font-medium tabular-nums">
          {templates.length
            ? `${templates.length} custom template${templates.length > 1 ? "s" : ""}`
            : "Presets"}
        </span>
        <Tip label="Create a reusable keyframe easing template from the current curve without altering any built-in preset">
          <Button
            variant="secondary"
            size="md"
            onClick={() => openClone(easeTitle(value, fallback), value ?? fallback)}
          >
            <Plus data-icon="inline-start" aria-hidden />
            Add template
          </Button>
        </Tip>
      </div>
      <ul
        aria-label="Speed curve"
        className={
          className ?? "grid grid-cols-[repeat(auto-fill,minmax(4.25rem,1fr))] gap-x-2.5 gap-y-3"
        }
      >
        {list.map((n) => (
          <Tile
            key={n}
            title={easeTitle(n, fallback)}
            tip={tipOf(n)}
            f={easeFn(n, fallback)}
            on={now === n}
            own={ownEase(n, S.render?.eases)}
            onPick={() => pick(n)}
            customizeMode="clone"
            customizeLabel={`Customize ${easeTitle(n, fallback)} as new template`}
            onCustomize={() => openClone(easeTitle(n, fallback), n)}
            mono={!TIPS[n]}
          />
        ))}
        {presets.map((c) => (
          <Tile
            key={c.id}
            title={c.title}
            tip={`${c.tip}. cubic-bezier(${c.v.join(", ")})`}
            f={easeFn(c.v, fallback)}
            on={now === c.id}
            onPick={() => pick(c.id)}
            customizeMode="clone"
            customizeLabel={`Customize ${c.title} as new template`}
            onCustomize={() => openClone(c.title, c.v)}
          />
        ))}
        {templates.map((tpl) => (
          <Tile
            key={tpl.id}
            title={tpl.name}
            tip={`Template (${tpl.curve.join(", ")})${tpl.basedOn ? ` · from ${tpl.basedOn}` : ""}`}
            f={easeFn(tpl.curve, fallback)}
            on={now === tpl.id}
            onPick={() => onPick([...tpl.curve])}
            customizeMode="edit"
            customizeLabel={`Edit template ${tpl.name}`}
            onCustomize={() => openEditTemplate(tpl)}
          />
        ))}
        <Tile
          title="Custom"
          tip="Your own curve: drag its two handles below"
          f={null}
          on={now === "custom"}
          onPick={() => pick("custom")}
        />
      </ul>
      {!list.length && (
        <Callout>Only curves here: the film doesn't share its named eases (draw.eases).</Callout>
      )}
      {draft && (
        <div
          ref={draftRef}
          aria-label={draft.mode === "edit" ? "Edit easing template" : "New easing template"}
          className="studio-panel-enter bg-card border-hairline mt-1 flex flex-col gap-2.5 rounded-lg border p-3"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-heading-foreground text-sm leading-snug font-semibold">
                {draft.mode === "edit" ? "Edit template" : `New template from ${draft.sourceTitle}`}
              </p>
              <p className="text-label text-ui leading-normal text-pretty">
                {draft.mode === "edit"
                  ? "Saves into your reusable templates."
                  : "Original preset stays unchanged."}
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={nameId} className="text-label text-ui font-medium">
              Template name
            </label>
            <Input
              id={nameId}
              size="md"
              aria-label="Template name"
              value={draft.name}
              spellCheck={false}
              onChange={(e) => {
                const name = e.target.value;
                setDraft((d) => (d ? { ...d, name } : null));
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") void applyDraft();
                if (e.key === "Escape") setDraft(null);
              }}
            />
          </div>
          <BezierCurveFields
            value={draft.curve}
            defaultValue={draft.baseCurve}
            onHandleDrag={(next) => setDraft((d) => (d ? { ...d, curve: next } : null))}
            onCommit={(next) => setDraft((d) => (d ? { ...d, curve: next } : null))}
          />
          <div className="flex items-center gap-1.5 pt-0.5">
            {draft.mode === "edit" && (
              <Button
                variant="remove"
                size="sm"
                disabled={saving}
                onClick={() => void removeDraft()}
              >
                <Trash2 data-icon="inline-start" aria-hidden />
                Delete
              </Button>
            )}
            <Button variant="quiet" size="sm" className="ms-auto" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!draft.name.trim() || saving}
              onClick={() => void applyDraft()}
            >
              <Check data-icon="inline-start" aria-hidden />
              Save &amp; apply
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

type CurveDrag =
  | {
      kind: "idle";
    }
  | {
      kind: "dragging";
      snapshot: string;
      initial: Bezier;
      latest: Bezier;
      restore: (s: string) => void;
      onSave: (v: Bezier) => void;
      end: AbortController;
    };

// The custom curve's editor: a drag previews (doc.preview) and its release saves once (onSave), so a whole drag is one undo step.
// bezier-easing-editor follows a handle on window, so a release off its box is common: the drag ends on window as well
export function CurveEditor({
  value,
  defaultValue = DEFAULT_CUSTOM_CURVE,
  preview,
  doc,
  onSave,
}: {
  value: Bezier;
  defaultValue?: Bezier;
  preview: (v: Bezier) => void;
  doc: { snapshot: () => string; restore: (s: string) => void };
  onSave: (v: Bezier) => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const drag = useRef<CurveDrag>({ kind: "idle" });
  useEffect(() => {
    if (customCurvePickAt > 0 && performance.now() - customCurvePickAt < 600) {
      customCurvePickAt = 0;
      const section = editorRef.current?.closest("section") ?? editorRef.current;
      return revealInScrollContainer(section, {
        anchorEl: section,
        pulseEl: editorRef.current,
      });
    }
  }, []);
  const finish = useCallback((saveDrag: boolean) => {
    const active = drag.current;
    if (active.kind !== "dragging") return;
    drag.current = { kind: "idle" };
    active.end.abort();
    active.restore(active.snapshot);
    if (saveDrag && JSON.stringify(active.latest) !== JSON.stringify(active.initial)) {
      active.onSave(active.latest);
    }
  }, []);
  useEffect(() => () => finish(false), [finish]);
  const begin = (next: Bezier) => {
    if (drag.current.kind === "dragging") {
      drag.current.latest = next;
      return;
    }
    const end = new AbortController();
    drag.current = {
      kind: "dragging",
      snapshot: doc.snapshot(),
      initial: value,
      latest: next,
      restore: doc.restore,
      onSave,
      end,
    };
    window.addEventListener("pointerup", () => finish(true), { capture: true, signal: end.signal });
    window.addEventListener("pointercancel", () => finish(false), {
      capture: true,
      signal: end.signal,
    });
    window.addEventListener("blur", () => finish(false), { signal: end.signal });
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          finish(false);
        }
      },
      { capture: true, signal: end.signal },
    );
  };
  return (
    <div ref={editorRef} className="flex flex-col gap-3 rounded-lg">
      <BezierCurveFields
        value={value}
        defaultValue={defaultValue}
        onHandleDrag={(next) => {
          begin(next);
          preview(next);
        }}
        onCommit={onSave}
      />
    </div>
  );
}
