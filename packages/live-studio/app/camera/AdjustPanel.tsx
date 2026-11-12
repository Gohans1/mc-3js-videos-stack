import type { Grade } from "film-stage/grade";
import { ADJUSTMENTS, type BasicKey } from "film-stage/grade-color";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { Footer, Reset, SaveStatus, Section, Segmented, SliderRow } from "../components/inspector";
import { S } from "../core/state";
import { get, say, set, useStudio } from "../core/store";
import {
  changeGrade as change,
  gradeDoc,
  gradeOf,
  type GradeTarget,
  gradeTarget,
  loadGrades,
  putGrade,
  resetGrade,
  savePreset,
} from "./adjust";
import { AdjustLibrary, ImportLut } from "./AdjustLibrary";
import { CurvesAdjust, HSLAdjust } from "./ColorAdjust";
import { layerItems, layerLocked } from "./layers";
import { shotsDoc } from "./shots";
import { WheelsAdjust } from "./WheelsAdjust";

const value = (shot: GradeTarget, key: BasicKey, v: number, keep = true) =>
  change(
    shot,
    (g) => {
      g.basic = { ...g.basic, [key]: v };
    },
    keep,
  );

function SavePreset({ grade }: { grade: Grade }) {
  const open = useStudio((s) => s.modal === "savePreset");
  const setOpen = (o: boolean) =>
    set({ modal: o ? "savePreset" : get().modal === "savePreset" ? null : get().modal });
  const [name, setName] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    id = useId();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button size="sm" />}
        onClick={() => {
          setName("");
          setError("");
        }}
      >
        Save as preset
      </DialogTrigger>
      <DialogContent initialFocus={input}>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim() || busy) return;
            setBusy(true);
            setError("");
            try {
              await savePreset(name.trim(), structuredClone(grade));
              setOpen(false);
              set({ lib: "adjust" });
              say("Preset saved. Available in every film.");
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Save as preset</DialogTitle>
            <DialogDescription>Reuse these adjustments and the LUT in any film.</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={id}>Preset name</FieldLabel>
            <Input
              ref={input}
              id={id}
              value={name}
              maxLength={100}
              required
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          {error && <Callout role="alert">{error}</Callout>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AdjustPanel({ library: showLibrary = false }: { library?: boolean }) {
  const [part, setPart] = useState<"basic" | "hsl" | "curves" | "wheels">("basic");
  useStudio((s) => s.shotsRev);
  useStudio((s) => s.camKey);
  useStudio((s) => s.shotPick);
  useStudio((s) => s.shot);
  const saved = useStudio((s) => s.shotsSaved),
    ready = useStudio((s) => s.ready),
    canEdit = useStudio((s) => s.shots);
  const library = useStudio((s) => s.gradeLibrary),
    [error, setError] = useState("");
  useEffect(() => {
    void loadGrades().catch((e: Error) => setError(e.message));
  }, []);
  useStudio((s) => s.layersRev);
  useStudio((s) => s.layerPicks);
  const layersSaved = useStudio((s) => s.layersSaved),
    layersReady = useStudio((s) => s.layers);
  const libraryModalOpen = useStudio((s) => s.modal === "adjustLibrary");
  const shot = gradeTarget(),
    grade = gradeOf(shot),
    layer = typeof shot === "string",
    locked = layer && layerLocked(shot),
    doc = gradeDoc(shot);
  const saveState = layer ? layersSaved : saved;
  if (!ready || !(layer ? layersReady : canEdit) || !S.render?.adjustments)
    return (
      <p className="text-ui text-muted-foreground px-3">Adjust is unavailable for this film.</p>
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="text-muted-foreground flex items-center justify-between px-3 pb-2 text-xs">
        <SaveStatus state={saveState} />
        <span>{layer ? layerItems().find((it) => it.id === shot)?.name : `Shot ${shot}`}</span>
      </div>
      <Segmented
        label="Adjust part"
        className="mx-3 mb-2 [&>button]:flex-auto [&>button]:px-1 [&>button]:whitespace-nowrap"
        value={part}
        onChange={setPart}
        items={[
          { id: "basic", title: "Basic" },
          { id: "hsl", title: "HSL" },
          { id: "curves", title: "Curves" },
          { id: "wheels", title: "Color wheel" },
        ]}
      />
      <fieldset disabled={locked} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {error && (
          <Callout role="alert" className="mx-3 mb-2">
            {error}
          </Callout>
        )}
        {part === "hsl" ? (
          <HSLAdjust shot={shot} grade={grade} disabled={locked} />
        ) : part === "curves" ? (
          <CurvesAdjust shot={shot} grade={grade} disabled={locked} />
        ) : part === "wheels" ? (
          <WheelsAdjust shot={shot} grade={grade} disabled={locked} />
        ) : (
          <>
            <Section
              title="Adjust"
              on={grade.enabled !== false}
              disabled={locked}
              onCheck={(on) =>
                change(shot, (g) => {
                  g.enabled = on;
                })
              }
              right={<Reset label="Reset adjustments" onClick={() => resetGrade(shot)} />}
            >
              {(["Color", "Lightness", "Effects"] as const).map((group) => (
                <div key={group} className="flex flex-col gap-1">
                  <h3 className="text-muted-foreground border-b pb-2 text-xs">{group}</h3>
                  {ADJUSTMENTS.filter((x) => x.group === group).map((x) => (
                    <SliderRow
                      key={x.id}
                      label={x.title}
                      value={grade.basic?.[x.id] ?? 0}
                      min={x.min}
                      max={x.max}
                      step={1}
                      digits={0}
                      origin={0}
                      compact
                      gradient={x.group === "Color" ? x.id : undefined}
                      disabled={grade.enabled === false}
                      doc={doc}
                      preview={(v) => value(shot, x.id, v, false)}
                      save={(v) => value(shot, x.id, v)}
                    />
                  ))}
                </div>
              ))}
            </Section>
            <Section
              title="LUT"
              right={
                <Reset
                  label="Remove LUT"
                  disabled={!grade.lut}
                  onClick={() =>
                    change(shot, (g) => {
                      delete g.lut;
                    })
                  }
                />
              }
            >
              <Select
                value={grade.lut?.url ?? "none"}
                items={[
                  { value: "none", label: "None" },
                  ...library.luts.map((l) => ({ value: l.url, label: l.name })),
                ]}
                onValueChange={(url) => {
                  const lut = library.luts.find((l) => l.url === url);
                  setError("");
                  if (!lut)
                    change(shot, (g) => {
                      delete g.lut;
                    });
                  else
                    void putGrade(shot, { ...grade, lut: { ...lut, amount: 100 } }).catch(
                      (e: Error) => setError(e.message),
                    );
                }}
              >
                <SelectTrigger aria-label="LUT" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {library.luts.map((lut) => (
                    <SelectItem key={lut.url} value={lut.url}>
                      {lut.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div>
                <ImportLut onError={setError} />
              </div>
              {grade.lut && (
                <SliderRow
                  compact
                  label="Intensity"
                  value={grade.lut.amount ?? 100}
                  min={0}
                  max={100}
                  step={1}
                  digits={0}
                  doc={doc}
                  preview={(v) =>
                    change(
                      shot,
                      (g) => {
                        g.lut!.amount = v;
                      },
                      false,
                    )
                  }
                  save={(v) =>
                    change(shot, (g) => {
                      g.lut!.amount = v;
                    })
                  }
                />
              )}
            </Section>
          </>
        )}
      </fieldset>
      <Footer>
        {showLibrary && (
          <Dialog
            open={libraryModalOpen}
            onOpenChange={(o) =>
              set({
                modal: o ? "adjustLibrary" : get().modal === "adjustLibrary" ? null : get().modal,
              })
            }
          >
            <DialogTrigger render={<Button variant="secondary" size="sm" />}>Presets</DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Adjustment</DialogTitle>
                <DialogDescription>Choose a saved preset or LUT for this shot.</DialogDescription>
              </DialogHeader>
              <AdjustLibrary />
            </DialogContent>
          </Dialog>
        )}
        <SavePreset grade={grade} />
        {!layer && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              shotsDoc.edit((rows) => {
                for (const row of rows) row.adjust = structuredClone(grade);
              });
              say("Adjustments applied to all shots. Ctrl+Z to undo");
            }}
          >
            Apply to all
          </Button>
        )}
      </Footer>
    </div>
  );
}
