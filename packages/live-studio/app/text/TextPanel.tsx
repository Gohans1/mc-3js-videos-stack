import { TEXT_ITEM_KEYS, TEXT_PRESETS } from "film-stage/titles-catalog";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Ban,
  Bold,
  CaseUpper,
  Italic,
  Star,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";

import { TEXT_KEYS, TEXT_SLOT_KEYS } from "../../src/contract-keys";
import { playSpan, stopSpan } from "../camera/anim";
import { FavoriteStar } from "../components/FavoriteStar";
import {
  ChipGroup,
  FieldRow,
  SaveStatus,
  Section,
  Segmented,
  SliderRow,
  ValueBox,
} from "../components/inspector";
import { TabStage } from "../components/Motion";
import { SearchBox } from "../components/SearchBox";
import { Tip } from "../components/Tip";
import type { Ease } from "../core/ease";
import { matcher } from "../core/search";
import { S } from "../core/state";
import { set, useStudio } from "../core/store";
import { stamp } from "../core/time";
import { ownVoice, THIS_FILM, withFilmChip } from "../own/builtins";
import { replaceField } from "../own/custom-fields";
import { CustomFields } from "../own/CustomFields";
import { FILM_MADE, FilmMark } from "../own/FilmMark";
import { frameSize } from "../picture/frame";
import {
  edit,
  editPicked,
  isShape,
  items,
  locked,
  nameOf,
  resolveItem,
  restore,
  snapshot,
  textDoc,
  type TextItem,
} from "./text";
import {
  freshTitleFx,
  orderedTitleCategories,
  shapeGlyph,
  shapeUsesLength,
  tidyTitleFx,
  TINT_SWATCHES,
  TITLE_CURVES,
  TITLE_HOLDS,
  type TitleFxMeta,
  voiceDefaultStagger,
  voiceDefaultTint,
  voiceSupportsStagger,
  voiceSupportsTint,
} from "./text-anim";

const DOC = { snapshot, restore };
const SWATCHES = ["#FFFCF0", "#100F0F", "#D14D41", "#D0A215", "#3AA99F", "#4385BE"];
const ALL = "All",
  FAV = "Favorites";
const byId = (id: string | undefined) =>
  S.tools?.titles?.fonts.find((f) => f.id === id) ?? S.tools?.titles?.fonts[0];

function Slide({
  label,
  get: read,
  put,
  min,
  max,
  step,
  digits = 0,
  unit,
  scale = 1,
}: {
  label: string;
  get: (it: TextItem) => number;
  put: (it: TextItem, v: number) => void;
  min: number;
  max: number;
  step: number;
  digits?: number;
  unit?: string;
  scale?: number;
}) {
  const raw = items[useStudio((s) => s.textPicks[0])];
  if (!raw) return null;
  const it = resolveItem(raw);
  return (
    <SliderRow
      label={label}
      value={read(it) * scale}
      min={min}
      max={max}
      step={step}
      digits={digits}
      unit={unit}
      doc={DOC}
      preview={(v) => editPicked((x) => put(x, v / scale), true)}
      save={(v) => editPicked((x) => put(x, v / scale))}
    />
  );
}

function Colors({
  label,
  value,
  put,
  palette = SWATCHES,
}: {
  label: string;
  value: string;
  put: (c: string) => void;
  palette?: readonly string[];
}) {
  const pickerHex = (() => {
    if (/^#[0-9a-f]{6}$/i.test(value)) return value;
    const hex3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
    if (hex3) return `#${hex3[1]}${hex3[1]}${hex3[2]}${hex3[2]}${hex3[3]}${hex3[3]}`;
    const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value);
    if (rgb) {
      const h = (n: string) =>
        Math.max(0, Math.min(255, Number(n)))
          .toString(16)
          .padStart(2, "0");
      return `#${h(rgb[1]!)}${h(rgb[2]!)}${h(rgb[3]!)}`;
    }
    return TINT_SWATCHES[0];
  })();
  return (
    <FieldRow label={label}>
      {palette.map((c) => (
        <Tip key={c} label={c}>
          <button
            type="button"
            aria-label={`${label} ${c}`}
            aria-pressed={value.toUpperCase() === c}
            onClick={() => put(c)}
            style={{ "--swatch": c }}
            className="focus-visible:ring-ring aria-pressed:ring-primary ring-hairline-strong size-6 flex-none rounded-full bg-(--swatch) ring-1 outline-none focus-visible:ring-2 aria-pressed:ring-2"
          />
        </Tip>
      ))}
      <input
        type="color"
        aria-label={`${label}: any colour`}
        value={pickerHex}
        onChange={(e) => put(e.target.value.toUpperCase())}
        className="h-6 w-8 flex-none cursor-pointer rounded-sm bg-transparent"
      />
    </FieldRow>
  );
}

function Words({ it }: { it: TextItem }) {
  const snap = useRef<string | null>(null);
  return (
    <Textarea
      aria-label="Text"
      value={it.text ?? ""}
      rows={2}
      onFocus={() => {
        snap.current = snapshot();
      }}
      onChange={(e) =>
        editPicked((x) => {
          x.text = e.target.value;
        }, true)
      }
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          if (snap.current !== null) {
            restore(snap.current);
            snap.current = null;
          }
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => {
        if (snap.current === null) return;
        const v = e.target.value;
        restore(snap.current);
        snap.current = null;
        editPicked((x) => {
          x.text = v;
        });
      }}
    />
  );
}

function Transform({ it }: { it: TextItem }) {
  const [W, H] = frameSize(1920);
  return (
    <Section title="Transform">
      <Slide
        label="Scale"
        get={(x) => x.scale ?? 1}
        put={(x, v) => {
          x.scale = +v.toFixed(3);
        }}
        min={10}
        max={400}
        step={1}
        unit="%"
        scale={100}
      />
      <FieldRow label="Position">
        <span className="text-muted-foreground text-xs">X</span>
        <ValueBox
          name="Position X"
          value={Math.round((it.x ?? 0.5) * W)}
          step={1}
          digits={0}
          onSave={(v) =>
            editPicked((x) => {
              x.x = +(v / W).toFixed(4);
            })
          }
        />
        <span className="text-muted-foreground text-xs">Y</span>
        <ValueBox
          name="Position Y"
          value={Math.round((it.y ?? 0.5) * H)}
          step={1}
          digits={0}
          onSave={(v) =>
            editPicked((x) => {
              x.y = +(v / H).toFixed(4);
            })
          }
        />
      </FieldRow>
      <Slide
        label="Rotate"
        get={(x) => x.rotate ?? 0}
        put={(x, v) => {
          x.rotate = Math.round(v);
        }}
        min={-180}
        max={180}
        step={1}
        unit="°"
      />
    </Section>
  );
}

function Basic({ it, raw, one }: { it: TextItem; raw: TextItem; one: boolean }) {
  const fonts = S.tools?.titles?.fonts ?? [];
  const presets = S.tools?.titles?.presets ?? TEXT_PRESETS;
  const shadowObj =
    it.shadow && typeof it.shadow === "object"
      ? it.shadow
      : { color: "rgba(0,0,0,0.55)", blur: 0.25, x: 0, y: 0.04 };
  const inheritedOf = (x: TextItem, k: keyof TextItem) =>
    resolveItem({ ...x, [k]: undefined } as TextItem);
  const flag = (k: "bold" | "italic" | "upper", label: string, icon: ReactNode) => (
    <Tip label={label}>
      <Toggle
        size="lg"
        aria-label={label}
        pressed={k === "bold" ? (typeof it.weight === "number" ? it.weight >= 700 : !!it.bold) : !!it[k]}
        onPressedChange={(on) =>
          editPicked((x) => {
            const inh = inheritedOf(x, k);
            if (on) x[k] = true;
            else if (inh[k]) x[k] = false;
            else delete x[k];
            if (k === "bold") {
              const inhWeight = inheritedOf(x, "weight").weight;
              if (x.weight !== undefined || inhWeight !== undefined) x.weight = on ? 700 : 500;
            }
          })
        }
      >
        {icon}
      </Toggle>
    </Tip>
  );
  return (
    <>
      <Section title="Basic">
        {one && <Words it={raw} />}
        <FieldRow label="Preset">
          <Select
            value={raw.preset ?? "__none__"}
            items={[
              {
                value: "__none__",
                label: textDoc()?.preset ? `Inherit (${textDoc()?.preset})` : "None",
              },
              ...presets.map((p) => ({ value: p.id, label: p.title })),
            ]}
            onValueChange={(v) =>
              editPicked((x) => {
                if (v === "__none__") {
                  const kind = resolveItem(x).kind ?? "text";
                  delete x.preset;
                  const doc = textDoc();
                  if (!x.kind && !doc?.preset && !doc?.defaults?.kind) x.kind = kind;
                } else {
                  x.preset = v as string;
                }
              })
            }
          >
            <SelectTrigger aria-label="Preset" className="h-7 min-w-0 flex-1">
              <SelectValue>
                {presets.find((p) => p.id === raw.preset)?.title ??
                  raw.preset ??
                  (textDoc()?.preset ? `Inherit (${textDoc()?.preset})` : "None")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">
                {textDoc()?.preset ? `Inherit (${textDoc()?.preset})` : "None"}
              </SelectItem>
              {presets.map((p) => (
                <SelectItem key={p.id} value={p.id} title={p.tip}>
                  {p.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>
        <FieldRow label="Font">
          <Select
            value={byId(it.font)?.id ?? "sans"}
            items={fonts.map((f) => ({ value: f.id, label: f.title }))}
            onValueChange={(v) =>
              editPicked((x) => {
                x.font = v as string;
              })
            }
          >
            <SelectTrigger aria-label="Font" className="h-7 min-w-0 flex-1">
              <SelectValue>
                <span
                  className="truncate font-(family-name:--font)"
                  style={{ "--font": byId(it.font)?.css }}
                >
                  {byId(it.font)?.title}
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {fonts.map((f) => (
                <SelectItem key={f.id} value={f.id} title={f.tip}>
                  <span className="font-(family-name:--font)" style={{ "--font": f.css }}>
                    {f.title}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>
        <Slide
          label="Font size"
          get={(x) => x.size ?? 56}
          put={(x, v) => {
            x.size = Math.round(v);
          }}
          min={12}
          max={300}
          step={1}
        />
        <Slide
          label="Weight"
          get={(x) =>
            typeof x.weight === "number" ? x.weight : x.bold ? 700 : x.font === "mono" ? 400 : 500
          }
          put={(x, v) => {
            x.weight = Math.round(v);
            const inhBold = inheritedOf(x, "bold").bold;
            x.bold = x.weight >= 700 ? true : inhBold ? false : undefined;
          }}
          min={100}
          max={900}
          step={100}
        />
        <FieldRow label="Pattern">
          {flag("bold", "Bold", <Bold />)}
          {flag("italic", "Italic", <Italic />)}
          {flag("upper", "Uppercase", <CaseUpper />)}
        </FieldRow>
        <Colors
          label="Color"
          value={it.color ?? "#FFFCF0"}
          put={(c) =>
            editPicked((x) => {
              x.color = c;
            })
          }
        />
        <Slide
          label="Spacing"
          get={(x) => x.spacing ?? 0}
          put={(x, v) => {
            x.spacing = +v.toFixed(3);
          }}
          min={-5}
          max={50}
          step={1}
          scale={100}
        />
        <Slide
          label="Line spacing"
          get={(x) => x.line ?? 1.2}
          put={(x, v) => {
            x.line = +v.toFixed(2);
          }}
          min={0.8}
          max={2.5}
          step={0.05}
          digits={2}
        />
        <FieldRow label="Alignment">
          <Segmented
            label="Alignment"
            className="flex-1"
            value={it.align ?? "center"}
            onChange={(v) =>
              editPicked((x) => {
                x.align = v;
              })
            }
            items={[
              {
                id: "left",
                title: (
                  <>
                    <AlignLeft aria-hidden className="size-4" />
                    <span className="sr-only">Left</span>
                  </>
                ),
              },
              {
                id: "center",
                title: (
                  <>
                    <AlignCenter aria-hidden className="size-4" />
                    <span className="sr-only">Center</span>
                  </>
                ),
              },
              {
                id: "right",
                title: (
                  <>
                    <AlignRight aria-hidden className="size-4" />
                    <span className="sr-only">Right</span>
                  </>
                ),
              },
            ]}
          />
        </FieldRow>
        <Slide
          label="Opacity"
          get={(x) => x.opacity ?? 1}
          put={(x, v) => {
            x.opacity = +v.toFixed(2);
          }}
          min={0}
          max={100}
          step={1}
          unit="%"
          scale={100}
        />
      </Section>
      <Section
        title="Stroke"
        on={!!it.stroke}
        onCheck={(on) =>
          editPicked((x) => {
            if (!on) {
              const inh = inheritedOf(x, "stroke");
              x.stroke = inh.stroke ? null : undefined;
            } else {
              delete x.stroke;
              if (!resolveItem(x).stroke) x.stroke = { color: "#100F0F", width: 6 };
            }
          })
        }
      >
        {it.stroke && (
          <>
            <Colors
              label="Stroke color"
              value={it.stroke.color ?? "#100F0F"}
              put={(c) =>
                editPicked((x) => {
                  x.stroke = { ...resolveItem(x).stroke, color: c };
                })
              }
            />
            <Slide
              label="Stroke width"
              get={(x) => x.stroke?.width ?? 6}
              put={(x, v) => {
                x.stroke = { ...resolveItem(x).stroke, width: Math.round(v) };
              }}
              min={1}
              max={30}
              step={1}
            />
            <FieldRow label="Join">
              <Segmented
                label="Stroke join"
                className="flex-1"
                value={it.stroke.join ?? "round"}
                onChange={(v) =>
                  editPicked((x) => {
                    x.stroke = {
                      ...resolveItem(x).stroke,
                      join: v as "round" | "miter" | "bevel",
                    };
                  })
                }
                items={[
                  { id: "round", title: "Round" },
                  { id: "miter", title: "Miter" },
                  { id: "bevel", title: "Bevel" },
                ]}
              />
            </FieldRow>
          </>
        )}
      </Section>
      <Section
        title="Background"
        on={!!it.background}
        onCheck={(on) =>
          editPicked((x) => {
            if (!on) {
              const inh = inheritedOf(x, "background");
              x.background = inh.background ? null : undefined;
            } else {
              delete x.background;
              if (!resolveItem(x).background) x.background = { color: "#100F0F", opacity: 0.6 };
            }
          })
        }
      >
        {it.background && (
          <>
            <Colors
              label="Background color"
              value={it.background.color ?? "#100F0F"}
              put={(c) =>
                editPicked((x) => {
                  x.background = { ...resolveItem(x).background, color: c };
                })
              }
            />
            <Slide
              label="Background opacity"
              get={(x) => x.background?.opacity ?? 0.6}
              put={(x, v) => {
                x.background = { ...resolveItem(x).background, opacity: +v.toFixed(2) };
              }}
              min={0}
              max={100}
              step={1}
              unit="%"
              scale={100}
            />
          </>
        )}
      </Section>
      <Section
        title="Shadow"
        on={it.shadow !== false}
        onCheck={(on) =>
          editPicked((x) => {
            if (!on) {
              const inh = inheritedOf(x, "shadow");
              x.shadow = inh.shadow === false ? undefined : false;
            } else {
              delete x.shadow;
              if (resolveItem(x).shadow === false) x.shadow = true;
            }
          })
        }
      >
        {it.shadow !== false && (
          <>
            <Colors
              label="Shadow color"
              value={shadowObj.color ?? "rgba(0,0,0,0.55)"}
              put={(c) =>
                editPicked((x) => {
                  const cur = resolveItem(x).shadow;
                  const base = cur && typeof cur === "object" ? cur : { blur: 0.25, x: 0, y: 0.04 };
                  x.shadow = { ...base, color: c };
                })
              }
            />
            <Slide
              label="Shadow blur"
              get={(x) => (x.shadow && typeof x.shadow === "object" ? (x.shadow.blur ?? 0.25) : 0.25)}
              put={(x, v) => {
                const cur = resolveItem(x).shadow;
                const base =
                  cur && typeof cur === "object"
                    ? cur
                    : { color: "rgba(0,0,0,0.55)", x: 0, y: 0.04 };
                x.shadow = { ...base, blur: +v.toFixed(3) };
              }}
              min={0}
              max={50}
              step={0.5}
              digits={1}
              unit="%"
              scale={100}
            />
            <Slide
              label="Shadow X"
              get={(x) => (x.shadow && typeof x.shadow === "object" ? (x.shadow.x ?? 0) : 0)}
              put={(x, v) => {
                const cur = resolveItem(x).shadow;
                const base =
                  cur && typeof cur === "object"
                    ? cur
                    : { color: "rgba(0,0,0,0.55)", blur: 0.25, y: 0.04 };
                x.shadow = { ...base, x: +v.toFixed(3) };
              }}
              min={-20}
              max={20}
              step={0.5}
              digits={1}
              unit="%"
              scale={100}
            />
            <Slide
              label="Shadow Y"
              get={(x) => (x.shadow && typeof x.shadow === "object" ? (x.shadow.y ?? 0.04) : 0.04)}
              put={(x, v) => {
                const cur = resolveItem(x).shadow;
                const base =
                  cur && typeof cur === "object"
                    ? cur
                    : { color: "rgba(0,0,0,0.55)", blur: 0.25, x: 0 };
                x.shadow = { ...base, y: +v.toFixed(3) };
              }}
              min={-20}
              max={20}
              step={0.5}
              digits={1}
              unit="%"
              scale={100}
            />
          </>
        )}
      </Section>
      <Transform it={it} />
    </>
  );
}

function Shape({ it }: { it: TextItem }) {
  const kind = resolveItem(it).kind ?? "text";
  const defaultLen = kind === "underline" ? 220 : 160;
  return (
    <>
      <Section title="Basic">
        <Colors
          label="Color"
          value={it.color ?? "#D14D41"}
          put={(c) =>
            editPicked((x) => {
              x.color = c;
            })
          }
        />
        <Slide
          label="Thickness"
          get={(x) => x.width ?? 10}
          put={(x, v) => {
            x.width = Math.round(v);
          }}
          min={2}
          max={40}
          step={1}
        />
        {shapeUsesLength(kind) ? (
          <Slide
            label="Length"
            get={(x) => x.size ?? defaultLen}
            put={(x, v) => {
              x.size = Math.round(v);
            }}
            min={40}
            max={1000}
            step={5}
          />
        ) : (
          <>
            <Slide
              label="Width"
              get={(x) => x.w ?? 260}
              put={(x, v) => {
                x.w = Math.round(v);
              }}
              min={20}
              max={1600}
              step={5}
            />
            <Slide
              label="Height"
              get={(x) => x.h ?? 170}
              put={(x, v) => {
                x.h = Math.round(v);
              }}
              min={20}
              max={1000}
              step={5}
            />
          </>
        )}
        <Slide
          label="Opacity"
          get={(x) => x.opacity ?? 1}
          put={(x, v) => {
            x.opacity = +v.toFixed(2);
          }}
          min={0}
          max={100}
          step={1}
          unit="%"
          scale={100}
        />
      </Section>
      <Transform it={it} />
    </>
  );
}

const EMPTY_FX: readonly TitleFxMeta[] = [];

function VoiceBadge({ fx, shape, kind }: { fx: TitleFxMeta | null; shape: boolean; kind: string }) {
  if (!fx) return <Ban aria-hidden className="text-muted-foreground size-5" />;
  if (shape)
    return (
      <span aria-hidden className="text-title text-primary-text font-semibold">
        {shapeGlyph(kind)}
      </span>
    );
  const { id, cat } = fx;
  if (id === "scramble" || id === "scrambleOut")
    return (
      <span
        aria-hidden
        className="text-clip-voice-wave font-mono text-sm font-semibold tracking-wider"
      >
        0X#
      </span>
    );
  if (id === "type" || id === "easedType")
    return (
      <span aria-hidden className="text-picture font-mono text-sm font-semibold">
        Aa_
      </span>
    );
  if (id === "inkIn")
    return (
      <span aria-hidden className="text-title text-accent-hover font-bold">
        Aa
      </span>
    );
  if (id === "hueSweepIn")
    return (
      <span aria-hidden className="text-title text-warn-text font-bold">
        Aa
      </span>
    );
  if (id === "lineSplitIn" || id === "lineSplitOut")
    return (
      <span aria-hidden className="text-picture text-sm font-bold tracking-tight">
        A<span className="text-primary-text">/</span>a
      </span>
    );
  if (cat === "Build & Mask")
    return (
      <span
        aria-hidden
        className="border-primary/80 text-picture border-b-2 pb-0.5 text-sm font-semibold"
      >
        Aa
      </span>
    );
  if (cat === "Pop & Scale")
    return (
      <span aria-hidden className="text-title text-picture scale-110 font-bold">
        Aa
      </span>
    );
  return (
    <span aria-hidden className="text-title text-picture font-semibold">
      Aa
    </span>
  );
}

function Anim({ it }: { it: TextItem }) {
  const slot = useStudio((s) => s.textSlot),
    favs = useStudio((s) => s.favorites.effects);
  const shape = isShape(it),
    lists = S.tools?.titles?.anims[shape ? "shape" : "text"];
  const [q, setQ] = useState(""),
    [cat, setCat] = useState(ALL);
  const list = lists?.[slot] ?? EMPTY_FX;
  const curFx = it[slot],
    now = curFx?.fx ?? null,
    fx = list.find((x) => x.id === now);
  const cats = useMemo(
    () =>
      withFilmChip(
        orderedTitleCategories(list, shape),
        list.some((x) => ownVoice(shape, slot, x)),
      ),
    [list, shape, slot],
  );
  const activeCat = cats.includes(cat) ? cat : ALL;
  const favPrefix = `text:${shape ? "shape" : "text"}:${slot}:`;
  const shown = useMemo(() => {
    const hit = matcher(q);
    return list.filter(
      (x) =>
        hit(`${x.title} ${x.cat ?? ""} ${x.tip ?? ""}`) &&
        (activeCat === ALL ||
          (activeCat === FAV
            ? favs.includes(favPrefix + x.id)
            : activeCat === THIS_FILM
              ? ownVoice(shape, slot, x)
              : (x.cat ?? "Custom") === activeCat)),
    );
  }, [list, q, activeCat, favs, favPrefix, shape, slot]);

  const playVoice = useCallback(
    (len: number, loop = false) => {
      const pad = Math.max(0.35, len + 0.15);
      const a = slot === "in" ? it.from : Math.max(it.from, it.to - pad);
      const b = slot === "in" ? Math.min(it.to, it.from + pad) : it.to;
      if (b > a) playSpan(a, b, loop);
    },
    [it.from, it.to, slot],
  );

  const trial = useRef<
    | { kind: "idle" }
    | { kind: "pending"; id: string | null; snap: string; timer: number }
    | { kind: "playing"; id: string | null; snap: string }
  >({ kind: "idle" });
  const leave = useCallback(() => {
    const current = trial.current;
    if (current.kind === "idle") return;
    trial.current = { kind: "idle" };
    if (current.kind === "pending") {
      clearTimeout(current.timer);
      return;
    }
    restore(current.snap);
    stopSpan();
  }, []);
  const clearSlot = (x: TextItem) => {
    const inh = resolveItem({ ...x, [slot]: undefined } as TextItem)[slot];
    if (inh?.fx) x[slot] = { fx: "none" };
    else delete x[slot];
  };
  const tryOn = (meta: TitleFxMeta | null) => {
    leave();
    const id = meta?.id ?? null;
    if (id === now) return;
    const snap = snapshot();
    const timer = window.setTimeout(() => {
      if (trial.current.kind !== "pending" || trial.current.timer !== timer) return;
      trial.current = { kind: "playing", id, snap };
      editPicked((x) => {
        if (meta) x[slot] = freshTitleFx(x[slot] ?? resolveItem(x)[slot], meta);
        else clearSlot(x);
      }, true);
      playVoice(meta?.len ?? 0.5, true);
    }, 140);
    trial.current = { kind: "pending", id, snap, timer };
  };
  const none = activeCat === ALL && !q.trim();
  useEffect(() => {
    if (trial.current.kind === "idle") return;
    const { id } = trial.current;
    if (!(id === null ? none : shown.some((x) => x.id === id))) leave();
  }, [shown, none, leave]);
  useEffect(() => leave, [leave, slot, it.kind]);

  if (!lists) return null;
  const pick = (meta: TitleFxMeta | null) => {
    leave();
    editPicked((x) => {
      if (meta) x[slot] = freshTitleFx(x[slot] ?? resolveItem(x)[slot], meta);
      else clearSlot(x);
    });
    if (meta) playVoice(curFx?.len ?? meta.len);
  };
  const setVoiceOpt = (
    patch: { ease?: Ease; stagger?: number; tint?: string; hold?: number },
    live = false,
  ) => {
    editPicked((x) => {
      const cur = x[slot] ?? resolveItem(x)[slot];
      if (cur) x[slot] = tidyTitleFx({ ...cur, ...patch }, fx);
    }, live);
  };
  const easeKey = Array.isArray(curFx?.ease)
    ? `bezier:${curFx.ease.join(",")}`
    : (curFx?.ease ?? "auto");
  const filmExtraEases = (S.tools?.titles?.eases ?? []).filter(
    (id) => !TITLE_CURVES.some((c) => c.id === id),
  );
  const baseEaseItems = [
    ...TITLE_CURVES.map((c) => ({ value: c.id, label: c.title, tip: c.tip })),
    ...filmExtraEases.map((id) => ({
      value: id,
      label: id[0] ? id[0].toUpperCase() + id.slice(1) : id,
      tip: "Custom curve provided by the film",
      own: true,
    })),
  ];
  const customEase = !baseEaseItems.some((c) => c.value === easeKey);
  const easeItems = [
    ...baseEaseItems.map(({ value, label }) => ({ value, label })),
    ...(customEase
      ? [
          {
            value: easeKey,
            label: Array.isArray(curFx?.ease)
              ? `Custom (${curFx.ease.join(", ")})`
              : String(curFx?.ease),
          },
        ]
      : []),
  ];
  const defaultStagger = voiceDefaultStagger(fx ?? now);
  const defaultTint = voiceDefaultTint(fx ?? now);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none px-3 pb-2.5">
        <Segmented
          label="Animation part"
          value={slot}
          onChange={(v) => {
            set({ textSlot: v });
            setCat(ALL);
          }}
          items={(["in", "out"] as const).map((s) => ({
            id: s,
            title: (
              <>
                {s === "in" ? "In" : "Out"}
                {it[s]?.fx && (
                  <>
                    <span aria-hidden className="bg-primary size-1.5 rounded-full" />
                    <span className="sr-only">(set)</span>
                  </>
                )}
              </>
            ),
          }))}
        />
      </div>
      <TabStage activeKey={slot} order={["in", "out"]} className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-none flex-col gap-2.5 px-3 pb-2.5">
          <SearchBox
            name="text-anim-search"
            value={q}
            onChange={setQ}
            label={`Search ${slot === "in" ? "In" : "Out"} voices`}
            placeholder={`Search ${list.length} ${slot === "in" ? "In" : "Out"} voices…`}
          />
          <ChipGroup
            scroll
            label="Voice category"
            value={activeCat}
            onChange={setCat}
            items={cats.map((c) => ({
              id: c,
              title: (
                <>
                  {c === FAV && <Star aria-hidden className="size-3" />}
                  {c}
                </>
              ),
            }))}
          />
        </div>
        <ul
          aria-label={`${slot === "in" ? "In" : "Out"} animations`}
          className="scroll-fade grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(4.25rem,1fr))] gap-x-2.5 gap-y-3 overflow-y-auto overscroll-contain px-3 pb-3"
        >
          {none && (
            <li
              className="flex min-w-0 flex-col items-center gap-1"
              onPointerEnter={(e) => e.pointerType === "mouse" && tryOn(null)}
              onPointerLeave={leave}
            >
              <button
                type="button"
                aria-pressed={!now}
                onClick={() => pick(null)}
                onFocus={() => tryOn(null)}
                onBlur={leave}
                className="text-muted-foreground hover:text-foreground focus-visible:ring-ring aria-pressed:text-foreground flex w-full flex-col items-center gap-1 rounded-md text-xs outline-none focus-visible:ring-2"
              >
                <span className="bg-raised-2 in-aria-pressed:ring-primary ring-hairline-subtle grid aspect-square w-full place-items-center rounded-md ring-1 in-aria-pressed:ring-2">
                  <VoiceBadge fx={null} shape={shape} kind={resolveItem(it).kind ?? "text"} />
                </span>
                <span className="w-full truncate text-center">None</span>
              </button>
            </li>
          )}
          {shown.map((x) => {
            const favId = favPrefix + x.id;
            const isFav = favs.includes(favId);
            return (
              <li
                key={x.id}
                className="group relative flex min-w-0 flex-col items-center gap-1"
                onPointerEnter={(e) => e.pointerType === "mouse" && tryOn(x)}
                onPointerLeave={leave}
              >
                <button
                  type="button"
                  aria-pressed={now === x.id}
                  onClick={() => pick(x)}
                  onFocus={() => tryOn(x)}
                  onBlur={leave}
                  title={x.tip ?? x.title}
                  aria-label={ownVoice(shape, slot, x) ? `${x.title}, ${FILM_MADE}` : undefined}
                  className="text-muted-foreground hover:text-foreground focus-visible:ring-ring aria-pressed:text-foreground flex w-full flex-col items-center gap-1 rounded-md text-xs outline-none focus-visible:ring-2"
                >
                  <span
                    className={cn(
                      "bg-backdrop in-aria-pressed:ring-primary ring-hairline-subtle group-hover:ring-hairline-strong relative grid aspect-square w-full place-items-center rounded-md ring-1 in-aria-pressed:ring-2",
                    )}
                  >
                    <VoiceBadge fx={x} shape={shape} kind={resolveItem(it).kind ?? "text"} />
                    {ownVoice(shape, slot, x) && <FilmMark />}
                  </span>
                  <span
                    className={cn(
                      "w-full truncate text-center",
                      now === x.id && "text-primary-text",
                    )}
                  >
                    {x.title}
                  </span>
                </button>
                <FavoriteStar
                  kind="effects"
                  id={favId}
                  name={`${slot === "in" ? "In" : "Out"} ${x.title}`}
                  onTile
                  reveal={!isFav}
                  className="absolute top-[calc(100%-2.6rem)] left-0.5"
                />
              </li>
            );
          })}
          {!shown.length && (
            <li className="text-ui text-muted-foreground col-span-full py-2">
              {activeCat === FAV && !q.trim()
                ? `No favorite ${slot === "in" ? "In" : "Out"} voices yet. Point at one and click its star.`
                : `No voices match "${q.trim()}".`}
            </li>
          )}
        </ul>
        {curFx && (
          <div className="flex flex-none flex-col gap-2 border-t px-3 py-3">
            <Slide
              label="Duration"
              get={(x) => x[slot]?.len ?? fx?.len ?? 0.5}
              put={(x, v) => {
                const cur = x[slot] ?? resolveItem(x)[slot];
                if (cur) x[slot] = tidyTitleFx({ ...cur, len: +v.toFixed(2) }, fx);
              }}
              min={0.1}
              max={5}
              step={0.05}
              digits={2}
              unit="s"
            />
            <FieldRow label="Curve">
              <Select
                value={easeKey}
                items={easeItems}
                onValueChange={(v) => {
                  if (v !== easeKey) {
                    setVoiceOpt({ ease: v === "auto" ? undefined : (v as Ease) });
                    playVoice(curFx.len ?? fx?.len ?? 0.5);
                  }
                }}
              >
                <SelectTrigger aria-label="Voice curve" className="h-7 min-w-0 flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {baseEaseItems.map((c) => (
                    <SelectItem
                      key={c.value}
                      value={c.value}
                      title={c.tip}
                      aria-label={"own" in c ? `${c.label}, ${FILM_MADE}` : undefined}
                    >
                      {c.label}
                      {"own" in c && <FilmMark className="static" />}
                    </SelectItem>
                  ))}
                  {customEase && (
                    <SelectItem value={easeKey} title="Custom curve written by the film">
                      {easeItems.at(-1)!.label}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </FieldRow>
            <FieldRow label="Timing">
              <ChipGroup
                label="Voice timing"
                value={String(curFx.hold ?? 1)}
                items={[
                  ...TITLE_HOLDS.map((h) => ({ id: h.id as string, title: h.title })),
                  ...(curFx.hold && !TITLE_HOLDS.some((h) => h.id === String(curFx.hold))
                    ? [{ id: String(curFx.hold), title: `Every ${curFx.hold} frames` }]
                    : []),
                ]}
                onChange={(v) => {
                  setVoiceOpt({ hold: Number(v) });
                  playVoice(curFx.len ?? fx?.len ?? 0.5);
                }}
              />
            </FieldRow>
            {!shape && (voiceSupportsStagger(fx ?? now) || curFx.stagger !== undefined) && (
              <SliderRow
                label="Stagger"
                value={(curFx.stagger ?? defaultStagger) * 100}
                min={0}
                max={100}
                step={5}
                digits={0}
                unit="%"
                doc={DOC}
                preview={(v) => {
                  stopSpan();
                  setVoiceOpt({ stagger: v / 100 }, true);
                }}
                save={(v) => setVoiceOpt({ stagger: v / 100 })}
                hint="How tightly or widely words overlap across the arrival or drop-out"
              />
            )}
            {!shape && (voiceSupportsTint(fx ?? now) || Boolean(curFx.tint)) && (
              <Colors
                label="Tint"
                value={curFx.tint ?? defaultTint}
                palette={TINT_SWATCHES}
                put={(c) => {
                  setVoiceOpt({ tint: c });
                  playVoice(curFx.len ?? fx?.len ?? 0.5);
                }}
              />
            )}
          </div>
        )}
      </TabStage>
    </div>
  );
}

export function TextPanel({ part }: { part: "text" | "textAnim" }) {
  const picks = useStudio((s) => s.textPicks),
    saved = useStudio((s) => s.textSaved);
  useStudio((s) => s.textRev);
  const raw = items[picks[0]];
  if (!raw)
    return (
      <p className="text-ui text-muted-foreground px-3 pt-2">
        Pick a text item on the Text row or the picture to edit it, or add one from the Text
        library.
      </p>
    );
  const it = resolveItem(raw);
  if (picks.every(locked))
    return (
      <p className="text-ui text-muted-foreground px-3 pt-2">
        This text track is locked. Unlock it in the track header to edit.
      </p>
    );
  const shapes = picks.every((i) => items[i] && isShape(items[i])),
    mixed = !shapes && picks.some((i) => items[i] && isShape(items[i]));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SaveStatus state={saved} hideWhenIdle className="block px-3 pb-1" />
      <p className="text-muted-foreground flex-none truncate px-3 pb-1 text-xs tabular-nums">
        {picks.length > 1
          ? `${picks.length} picked: changes go to all of them`
          : `${nameOf(raw)} · ${stamp(raw.from)} – ${stamp(raw.to)}`}
      </p>
      {part === "textAnim" ? (
        <Anim it={it} />
      ) : mixed ? (
        <p className="text-ui text-muted-foreground px-3 pt-2">
          Texts and shapes are picked together: pick only one kind to edit its look.
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {shapes ? <Shape it={it} /> : <Basic it={it} raw={raw} one={picks.length === 1} />}
          {picks.length === 1 ? (
            <CustomFields
              value={raw}
              known={[...TEXT_KEYS, ...TEXT_ITEM_KEYS, ...TEXT_SLOT_KEYS]}
              onChange={(path, value) => {
                if (!locked(picks[0]))
                  edit((data) => replaceField(data.items[picks[0]], path, value));
              }}
            />
          ) : (
            <p className="text-ui text-muted-foreground px-3 pb-3">
              Select one item to edit custom fields.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
