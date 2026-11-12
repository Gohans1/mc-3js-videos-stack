import { ChevronDown } from "lucide-react";
import { type RefObject, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { cn } from "@/lib/utils";

import {
  LINKAGE_KINDS,
  type LinkageKind,
  type LinkageSettings as Settings,
} from "../../src/linkage.mjs";
import { Tip } from "../components/Tip";
import { get, set, setPref, useStudio } from "../core/store";

const choices: { kind: LinkageKind; title: string; colour: string; audio?: boolean }[] = [
  { kind: "text", title: "Text", colour: "bg-timeline-text" },
  { kind: "adjustment", title: "Adjust", colour: "bg-clip-adjust" },
  { kind: "audio", title: "Audio", colour: "bg-clip-audio", audio: true },
  { kind: "sfx", title: "Sound effects", colour: "bg-clip-audio", audio: true },
  { kind: "voice", title: "Voice", colour: "bg-clip-audio", audio: true },
];

export function LinkageSettings() {
  const open = useStudio((s) => s.modal === "linkage");
  const setOpen = (o: boolean) =>
    set({ modal: o ? "linkage" : get().modal === "linkage" ? null : get().modal });
  const done = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tip label="Linkage settings: choose which layers follow the main track">
        <DialogTrigger
          render={
            <Button
              variant="quiet"
              size="icon-sm"
              aria-label="Linkage settings"
              className="-ms-1 w-4 pointer-coarse:size-10"
            />
          }
        >
          <ChevronDown className="size-3" />
        </DialogTrigger>
      </Tip>
      <DialogContent
        showCloseButton={false}
        variant="settings"
        initialFocus={done}
        className="overflow-hidden sm:max-w-[564px]"
      >
        <Body close={() => setOpen(false)} done={done} />
      </DialogContent>
    </Dialog>
  );
}

function Body({ close, done }: { close: () => void; done: RefObject<HTMLButtonElement | null> }) {
  const [draft, setDraft] = useState<Settings>(() => ({ ...get().linkageKinds }));
  const count = LINKAGE_KINDS.filter((kind) => draft[kind]).length;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setPref("linkageKinds", draft);
        close();
      }}
    >
      <div className="border-b px-3 py-2">
        <DialogTitle variant="compact">Linkage settings</DialogTitle>
      </div>
      <div className="px-4 pt-4 pb-8">
        <DialogDescription variant="compact" className="mb-4">
          When linkage is on, the selected types follow edits to clips on the main track.
        </DialogDescription>
        <FieldSet>
          <FieldLegend className="sr-only">Linked layer types</FieldLegend>
          <FieldGroup variant="tiles">
            {choices.map(({ kind, title, colour, audio }) => (
              <Field key={kind}>
                <FieldLabel variant="tile">
                  <span
                    aria-hidden
                    className="bg-raised-3 flex h-14 w-full items-center rounded-lg px-2"
                  >
                    <span
                      className={cn(
                        "text-tag text-foreground relative block w-full overflow-hidden rounded-xs px-1 leading-5",
                        colour,
                        audio ? "h-10" : "h-5",
                      )}
                    >
                      {title}
                      {audio && (
                        <svg
                          viewBox="0 0 100 18"
                          preserveAspectRatio="none"
                          className="stroke-clip-wave absolute inset-x-0 bottom-0 h-5 w-full"
                          fill="none"
                          strokeWidth=".7"
                        >
                          {Array.from({ length: 50 }, (_, i) => (
                            <path
                              key={i}
                              d={`M${i * 2 + 1} 18v-${2 + Math.abs(Math.sin(i * 0.7) * Math.cos(i * 0.19)) * 15}`}
                            />
                          ))}
                        </svg>
                      )}
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5 text-xs">
                    <Checkbox
                      size="sm"
                      checked={draft[kind]}
                      onCheckedChange={(checked) =>
                        setDraft((before) => ({ ...before, [kind]: checked }))
                      }
                    />
                    {title}
                  </span>
                </FieldLabel>
              </Field>
            ))}
          </FieldGroup>
        </FieldSet>
      </div>
      <div className="flex items-center gap-2 border-t px-4 py-3.5">
        <FieldLabel variant="compact" className="me-auto">
          <Checkbox
            size="sm"
            checked={count === LINKAGE_KINDS.length}
            indeterminate={count > 0 && count < LINKAGE_KINDS.length}
            onCheckedChange={(checked) =>
              setDraft(Object.fromEntries(LINKAGE_KINDS.map((kind) => [kind, checked])) as Settings)
            }
          />
          Select all
        </FieldLabel>
        <Button ref={done} type="submit" size="sm" className="w-[72px]">
          Done
        </Button>
        <Button type="button" size="sm" variant="secondary" className="w-[72px]" onClick={close}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
