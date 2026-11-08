// The note being written. Every keystroke is kept on the device (notes/notes.ts setDraft), so a reload never loses it.
// On an upright phone it sits right under the picture, so the keyboard can't cover it and a tap still lands on the picture
import { TriangleAlert } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PHONE } from "../core/device";
import { rangeText, stamp } from "../core/time";
import { inOutAt } from "../timeline/inout";
import { INK_KEYS, setInk, toolsOpen } from "./ink";
import { cancelNote, saveNote, setDraft } from "./notes";
import { get, ui, useStudio } from "../core/store";

export function Compose() {
  const compose = useStudio((s) => s.compose), draft = useStudio((s) => s.draft), drawn = useStudio((s) => s.inkSaid);
  useStudio((s) => s.inOut); // inOutAt below reads it
  const text = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    ui.focusNote = () => { flushSync(() => {}); text.current?.focus({ preventScroll: true }); };
    ui.blurNote = () => text.current?.blur();
  }, []);
  const open = !!compose;
  // A pin just placed gives the box the keys and shows the drawing tools: until a word is typed or the box is clicked, 1 to 4
  // pick a tool here as they do anywhere else. Click the box first to start a note with a digit
  const [drawKeys, setDrawKeys] = useState(false), pin = compose?.pin;
  useEffect(() => setDrawKeys(!!pin && !compose?.editing), [pin, compose?.editing]);
  // A phone keyboard doesn't report which key it pressed: its Enter only shows up as a line break arriving. Listened to on the
  // element itself: React's onBeforeInput is its own event, built from keypress and textInput, and never says insertLineBreak
  useEffect(() => {
    const box = text.current;
    if (!open || !box || !PHONE) return;
    const enter = (e: InputEvent) => { if (e.inputType === "insertLineBreak") { e.preventDefault(); saveNote(); } };
    box.addEventListener("beforeinput", enter);
    return () => box.removeEventListener("beforeinput", enter);
  }, [open]);
  if (!compose) return null;
  const where = compose.editing
    ? `Editing note · ${compose.time} · Shot ${compose.shot}`
    : `${stamp(compose.t)} · Shot ${compose.shot}: ${compose.shotName}${compose.pin ? ` · ${compose.pin.what}` : ""}`;
  return (
    <div className="flex-none bg-card p-3 upright:fixed upright:inset-x-0 upright:top-[min(56.25vw,62vh)] upright:z-5 upright:shadow-sheet sideways:px-3 sideways:py-2">
      <div className="mb-2 text-ui wrap-anywhere text-primary sideways:mb-1">{where}</div>
      {drawn && <div className="mb-2 text-ui text-ink tabular-nums">{drawn}</div>}
      {!drawn && !compose.editing && inOutAt(compose.t) && <div className="mb-2 text-ui text-in-out-text tabular-nums">About {rangeText(inOutAt(compose.t)!)}, the In to Out stretch</div>}
      {compose.editing && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-warn-bg px-2.5 py-1.5 text-ui text-warn">
          <TriangleAlert className="size-4 flex-none" aria-hidden />
          <span>Saving replaces the note's old text.</span>
        </div>
      )}
      <Textarea
        ref={text}
        name="note"
        aria-label="Note"
        placeholder={drawKeys ? "Type or dictate… or press 1–4 to draw" : "Type or dictate…"}
        enterKeyHint="done"
        autoComplete="off"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onPointerDown={() => setDrawKeys(false)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (drawKeys && !draft && /^[1-4]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey && toolsOpen(get())) { e.preventDefault(); setInk(INK_KEYS[+e.key - 1]); return; }
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); saveNote(); }
          else if (e.key === "Escape") { e.preventDefault(); cancelNote(); }
        }}
        variant="note" className="h-28 resize-y upright:h-19 sideways:h-16"
      />
      <div className="mt-2 flex gap-2 sideways:mt-1.5">
        <Button size="xl" className="flex-1" onClick={saveNote}>{compose.editing ? "Save" : "Add note"}</Button>
        <Button variant="secondary" size="xl" onClick={cancelNote}>Cancel</Button>
      </div>
      <small className="mt-2 block text-xs text-muted-foreground pointer-coarse:hidden">
        Enter adds · Shift+Enter new line · Esc cancels. Your draft survives a reload.
      </small>
    </div>
  );
}
