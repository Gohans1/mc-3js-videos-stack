import { expandTemplate, resolveOpenFilmRecipe } from "film-stage/openfilm-recipes";
import { useEffect, useId, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { shownShot } from "../camera/anim";
import { together } from "../core/doc";
import { S } from "../core/state";
import { say } from "../core/store";
import { edit as editSound, lanes } from "../sound/sound";
import { PageInspector } from "./PageInspector";
import { PageProperties } from "./PageProperties";
import { OpenFilmPreview } from "./Preview";
import {
  loadOpenFilm,
  openFilmDoc,
  overlayBasis,
  type OverlayItem,
  readOpenFilm,
  type Recipe,
  saveOpenFilm,
  useOpenFilm,
} from "./state";

type ApplyRequest = {
  asset: string;
  from: number;
  to: number;
  shot: number;
  props: { vars?: Record<string, string>; text?: Record<string, string> };
};
interface LibraryProps {
  showInspector?: boolean;
  category?: string;
  onApply?: (request: ApplyRequest) => Promise<void>;
}
const controls = (text: string): Record<string, unknown> => {
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Custom controls must be a JSON object");
  return value;
};

function Inspector({
  asset,
  item,
  category,
  onApply,
  onClose,
}: LibraryProps & { asset: Recipe; item?: OverlayItem; onClose: () => void }) {
  const prefix = useId();
  const [from, setFrom] = useState(item?.from ?? S.t);
  const [to, setTo] = useState(item?.to ?? S.t + (asset.durationMs ?? 3000) / 1000);
  const [shot, setShot] = useState(Math.max(1, shownShot()));
  const [raw, setRaw] = useState(() => {
    if (!item) return "{}";
    const {
      id: _id,
      asset: _asset,
      from: _from,
      to: _to,
      timebase: _basis,
      __timing: _timing,
      ...rest
    } = item;
    return JSON.stringify(rest, null, 2);
  });
  const [saveState, setSaveState] = useState<
    { status: "idle"; error: string } | { status: "saving" }
  >({ status: "idle", error: "" });
  const busy = saveState.status === "saving";
  const saveError = saveState.status === "idle" ? saveState.error : "";
  const props = useMemo(() => {
    try {
      return controls(raw);
    } catch {
      return {};
    }
  }, [raw]);
  const save = async () => {
    if (busy) return;
    setSaveState({ status: "saving" });
    try {
      const custom = controls(raw);
      if (!(to > from) || from < 0) throw new Error("Choose a positive time range");
      if (item)
        await saveOpenFilm(
          useOpenFilm
            .getState()
            .doc.data.items.map((it) =>
              it.id === item.id ? { ...it, ...custom, id: it.id, asset: asset.id, from, to } : it,
            ),
        );
      else if (onApply) await onApply({ asset: asset.id, from, to, shot, props: custom });
      else {
        if (!openFilmDoc.data) await readOpenFilm();
        if (!openFilmDoc.data) throw new Error("Cannot load the overlay timeline");
        const basis = overlayBasis(),
          previous = useOpenFilm.getState().doc.data.items;
        if (asset.render === "group") {
          if (!asset.clips || !asset.durationMs) throw new Error("Template data is incomplete");
          const plan = expandTemplate(
            { ...asset, clips: asset.clips, durationMs: asset.durationMs },
            from,
            to,
          );
          if (plan.music && !lanes)
            throw new Error(
              "Configure the film's audio timeline before adding a template with music",
            );
          together(() => {
            void saveOpenFilm([
              ...previous,
              ...plan.items.map((it) => ({ ...it, id: crypto.randomUUID(), timebase: basis })),
            ]);
            if (plan.music)
              editSound((data) => {
                data.beds.push({
                  name:
                    "of-bgm-" +
                    plan
                      .music!.split("/")
                      .pop()!
                      .replace(/\.[^.]+$/, ""),
                  from,
                  to,
                  gain: -24,
                  fadeIn: 0.2,
                  fadeOut: 0.5,
                });
              });
          });
        } else
          await saveOpenFilm([
            ...previous,
            { ...custom, id: crypto.randomUUID(), asset: asset.id, from, to, timebase: basis },
          ]);
      }
      setSaveState({ status: "idle", error: "" });
      say(asset.title + " saved");
    } catch (e) {
      setSaveState({
        status: "idle",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };
  return (
    <div className="border-border space-y-3 border-b pb-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{asset.title}</h3>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      {saveError && (
        <p role="alert" className="text-destructive text-xs">
          {saveError}
        </p>
      )}
      <OpenFilmPreview recipe={asset} props={props} />
      <p className="text-muted-foreground text-xs">{asset.about}</p>
      {category !== "filter" &&
        (asset.cat === "transition" ? (
          <label className="block text-xs" htmlFor={prefix + "-duration"}>
            Duration (s)
            <Input
              id={prefix + "-duration"}
              type="number"
              min="0.033333"
              step="0.033333"
              value={to - from}
              onChange={(e) => setTo(from + Number(e.target.value))}
            />
          </label>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs" htmlFor={prefix + "-from"}>
              From (s)
              <Input
                id={prefix + "-from"}
                type="number"
                min="0"
                step="0.033333"
                value={from}
                onChange={(e) => setFrom(Number(e.target.value))}
              />
            </label>
            <label className="text-xs" htmlFor={prefix + "-to"}>
              To (s)
              <Input
                id={prefix + "-to"}
                type="number"
                min="0"
                step="0.033333"
                value={to}
                onChange={(e) => setTo(Number(e.target.value))}
              />
            </label>
          </div>
        ))}
      {asset.cat === "transition" && (
        <label className="block text-xs" htmlFor={prefix + "-shot"}>
          Cut before shot (1 = second shot)
          <Input
            id={prefix + "-shot"}
            type="number"
            min="1"
            value={shot}
            onChange={(e) => setShot(Number(e.target.value))}
          />
        </label>
      )}
      <PageProperties
        definitions={asset.props}
        values={props}
        defaults={{ vars: asset.vars }}
        onChange={(next) => setRaw(JSON.stringify(next, null, 2))}
      />
      {!["filter", "transition"].includes(category ?? "") && (
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["x", "X (0–1)", 0.5],
              ["y", "Y (0–1)", 0.5],
              ["size", "Height (0–1)", asset.fit ?? 0.25],
              ["opacity", "Opacity (0–1)", 1],
              ["rotate", "Rotation (°)", 0],
              ["track", "Layer", 0],
            ] as const
          ).map(([key, label, fallback]) => (
            <label className="text-xs" key={key} htmlFor={prefix + key}>
              {label}
              <Input
                id={prefix + key}
                type="number"
                step={key === "track" ? 1 : 0.05}
                value={Number(props[key] ?? fallback)}
                onChange={(e) =>
                  setRaw(JSON.stringify({ ...props, [key]: Number(e.target.value) }, null, 2))
                }
              />
            </label>
          ))}
        </div>
      )}
      {category !== "filter" && (
        <details>
          <summary className="cursor-pointer text-xs">Custom controls</summary>
          <textarea
            aria-label="OpenFilm custom properties JSON"
            className="bg-card mt-2 min-h-28 w-full rounded border p-2 font-mono text-xs"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
          />
        </details>
      )}
      {asset.render === "group" && (
        <p className="text-muted-foreground text-xs">
          Adds overlay layers and original music over your 3D picture. The CLI plan lists camera
          slot timings.
        </p>
      )}
      <Button className="w-full" disabled={busy} onClick={() => void save()}>
        {busy ? "Saving…" : item ? "Save layer" : "Use in film"}
      </Button>
    </div>
  );
}

export function OpenFilmDetails() {
  const { catalogState, selection, doc } = useOpenFilm();
  const catalog = catalogState.recipes;
  const selected = selection.kind === "none" ? null : selection.id;
  const element = selection.kind === "element" ? selection.selector : null;
  const item = doc.data.items.find((it) => it.id === selected);
  const recipe =
    item &&
    (resolveOpenFilmRecipe(
      item.asset,
      catalog.flatMap((r) => [r, ...(r.children ?? [])]),
    ) as Recipe | undefined);
  if (!item || !recipe)
    return (
      <p className="text-ui text-muted-foreground px-3">
        Pick an overlay on the picture or timeline to edit it.
      </p>
    );
  return (
    <div className="min-h-0 overflow-y-auto px-3">
      <PageInspector itemId={item.id} />
      {!element && (
        <Inspector
          key={item.id + ":" + doc.revision}
          asset={recipe}
          item={item}
          onClose={() => useOpenFilm.setState({ selection: { kind: "none" } })}
        />
      )}
    </div>
  );
}

export function OpenFilmLibrary({ category, onApply, showInspector = true }: LibraryProps = {}) {
  const { catalogState, doc, selection } = useOpenFilm();
  const catalog = catalogState.recipes;
  const selected = selection.kind === "none" ? null : selection.id;
  const element = selection.kind === "element" ? selection.selector : null;
  const [query, setQuery] = useState(""),
    [kind, setKind] = useState(category ?? "effect"),
    [group, setGroup] = useState("");
  const [limit, setLimit] = useState(40),
    [choice, setChoice] = useState<{ recipe: Recipe; revision: number } | null>(null);
  useEffect(() => {
    void loadOpenFilm().catch(() => {});
  }, []);
  const item = doc.data.items.find((it) => it.id === selected);
  const picked =
    item &&
    (resolveOpenFilmRecipe(
      item.asset,
      catalog.flatMap((r) => [r, ...(r.children ?? [])]),
    ) as Recipe | undefined);
  const asset = picked || choice?.recipe;
  const groups = [...new Set(catalog.filter((r) => r.cat === kind).map((r) => r.group))];
  const matches = catalog.filter(
    (r) =>
      r.cat === kind &&
      (!group || r.group === group) &&
      (r.id + " " + r.title + " " + r.about).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section
      aria-label={(category ?? "Effects") + " library from OpenFilm"}
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3"
    >
      <div className="space-y-2">
        <Input
          aria-label="Search OpenFilm assets"
          placeholder="Search assets or enter /your-page.html"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(40);
          }}
        />
        <div className="flex gap-2">
          {!category && (
            <label className="min-w-0 flex-1 text-xs">
              Type
              <select
                aria-label="Effect type"
                className="bg-card mt-1 h-8 w-full rounded border px-2"
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value);
                  setGroup("");
                  setLimit(40);
                }}
              >
                {["effect", "sticker", "template"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
          )}
          <label className="min-w-0 flex-1 text-xs">
            Category
            <select
              aria-label="OpenFilm category"
              className="bg-card mt-1 h-8 w-full rounded border px-2"
              value={group}
              onChange={(e) => {
                setGroup(e.target.value);
                setLimit(40);
              }}
            >
              <option value="">All categories</option>
              {groups.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-muted-foreground text-xs">{matches.length} assets · OpenFilm</p>
      </div>
      {catalogState.status === "error" && (
        <p role="alert" className="text-destructive text-xs">
          {catalogState.message}
        </p>
      )}
      {!catalog.length && catalogState.status !== "error" && (
        <p role="status" className="text-muted-foreground text-xs">
          {catalogState.status === "ready"
            ? "Enter /your-page.html to use this film's HTML. Run bun run fetch:openfilm for the asset library."
            : "Loading library…"}
        </p>
      )}
      {resolveOpenFilmRecipe(query.trim(), []) && (
        <Button
          variant="secondary"
          onClick={() => {
            useOpenFilm.setState({ selection: { kind: "none" } });
            setChoice({
              recipe: resolveOpenFilmRecipe(query.trim(), [])!,
              revision: (choice?.revision ?? 0) + 1,
            });
          }}
        >
          Use this film's HTML page
        </Button>
      )}
      {showInspector && item && <PageInspector itemId={item.id} />}
      {asset && (!item || showInspector) && !element && (
        <Inspector
          key={(picked ? item!.id : asset.id + ":" + choice?.revision) + ":" + doc.revision}
          asset={asset}
          item={picked ? item : undefined}
          category={category}
          onApply={onApply}
          onClose={() => {
            setChoice(null);
            useOpenFilm.setState({ selection: { kind: "none" } });
          }}
        />
      )}
      <div className="grid grid-cols-2 gap-1.5">
        {matches.slice(0, limit).map((recipe) => (
          <button
            type="button"
            key={recipe.id}
            onClick={() => {
              useOpenFilm.setState({ selection: { kind: "none" } });
              setChoice({ recipe, revision: (choice?.revision ?? 0) + 1 });
            }}
            className="bg-card hover:bg-tint focus-visible:ring-ring border-border min-h-12 rounded border px-2 py-2 text-left text-xs outline-none focus-visible:ring-2"
          >
            <span className="block font-medium">{recipe.title}</span>
            <span className="text-muted-foreground">{recipe.group}</span>
          </button>
        ))}
      </div>
      {matches.length > limit && (
        <Button variant="ghost" onClick={() => setLimit(limit + 40)}>
          Show more
        </Button>
      )}
      {!matches.length && catalog.length > 0 && (
        <p role="status" className="text-muted-foreground text-xs">
          No matching assets. Try another category or search.
        </p>
      )}
    </section>
  );
}
