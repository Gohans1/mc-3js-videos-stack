// CapCut's "Paste attributes?" box (Ctrl+Alt+V, or Paste attributes in a right-click menu): one tick per thing the copy holds,
// all ticked to start, each with what it will paste; Paste puts the ticked ones onto what is picked, one undo step
// (attributes.ts). Enter pastes, Esc cancels
import { type RefObject, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { set, useStudio } from "../core/store";
import { choices, onto, pasteAttrs } from "./attributes";

export function PasteAttributes() {
  const open = useStudio((s) => s.pasteAsk), go = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) set({ pasteAsk: false }); }}>
      <DialogContent initialFocus={go}>
        <Body go={go} />
      </DialogContent>
    </Dialog>
  );
}

// Mounted with the box, so its lines stay as they were while it closes
function Body({ go }: { go: RefObject<HTMLButtonElement | null> }) {
  const [list] = useState(choices), [where] = useState(onto), [off, setOff] = useState<ReadonlySet<string>>(new Set());
  const on = list.filter((c) => !off.has(c.id));
  const flip = (id: string, v: boolean) => { const next = new Set(off); if (v) next.delete(id); else next.add(id); setOff(next); };
  return (
    <form onSubmit={(e) => { e.preventDefault(); pasteAttrs(on.map((c) => c.id)); }} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Paste attributes?</DialogTitle>
        <DialogDescription>{where}</DialogDescription>
      </DialogHeader>
      <fieldset className="-mx-2 flex flex-col">
        <legend className="sr-only">Attributes to paste</legend>
        {list.map((c) => (
          <label key={c.id} className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-2 hover:bg-raised-2">
            <input type="checkbox" checked={!off.has(c.id)} onChange={(e) => flip(c.id, e.target.checked)} className="mt-0.5 size-4 flex-none accent-primary" />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium text-foreground">{c.title}</span>
              <span className="text-xs text-muted-foreground">{c.value}</span>
              {c.warn && !off.has(c.id) && <span className="text-xs text-warn">{c.warn}</span>}
            </span>
          </label>
        ))}
      </fieldset>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
        <Button ref={go} type="submit" disabled={!on.length}>Paste</Button>
      </DialogFooter>
    </form>
  );
}
