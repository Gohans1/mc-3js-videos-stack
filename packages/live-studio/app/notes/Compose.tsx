// The note being written. Every keystroke is kept on the device (notes/notes.ts setDraft), so a reload never loses it.
// On an upright phone it sits right under the picture, so the keyboard can't cover it and a tap still lands on the picture;
// in PhoneApp (inline) it is the top of the notes column, which the keyboard shrinks (device.ts resizes-content) instead of covering
import { TriangleAlert } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Textarea } from "@/components/ui/textarea";

import { PHONE } from "../core/device";
import { get, ui, useStudio } from "../core/store";
import { rangeText, stamp } from "../core/time";
import { inOutAt } from "../timeline/inout";
import { INK_KEYS, setInk, toolsOpen } from "./ink";
import { cancelNote, saveNote, setDraft } from "./notes";

export function Compose({ inline = false }: { inline?: boolean }) {
  const compose = useStudio((s) => s.compose),
    draft = useStudio((s) => s.draft),
    drawn = useStudio((s) => s.inkSaid);
  useStudio((s) => s.inOut); // inOutAt below reads it
  const text = useRef<HTMLTextAreaElement>(null);
  // The box last mounted takes the focus calls (the Review room has its own beside the hidden panel's); unmounted, it hands them back
  useLayoutEffect(() => {
    const was = [ui.focusNote, ui.blurNote] as const;
    const focus = () => {
      flushSync(() => {});
      text.current?.focus({ preventScroll: true });
    };
    ui.focusNote = focus;
    ui.blurNote = () => text.current?.blur();
    return () => {
      if (ui.focusNote === focus) [ui.focusNote, ui.blurNote] = was;
    };
  }, []);
  const open = !!compose;
  // A pin just placed gives the box the keys and shows the drawing tools: until a word is typed or the box is clicked, 1 to 4
  // pick a tool here as they do anywhere else. Click the box first to start a note with a digit
  const [clickedFor, setClickedFor] = useState<unknown>(null),
    pin = compose?.pin;
  const drawKeys = !PHONE && compose?.kind === "create" && !!pin && clickedFor !== compose; // a phone has no drawing tools
  // A phone keyboard doesn't report which key it pressed: its Enter only shows up as a line break arriving. Listened to on the
  // element itself: React's onBeforeInput is its own event, built from keypress and textInput, and never says insertLineBreak
  useEffect(() => {
    const box = text.current;
    if (!open || !box || !PHONE) return;
    const enter = (e: InputEvent) => {
      if (e.inputType === "insertLineBreak") {
        e.preventDefault();
        saveNote();
      }
    };
    box.addEventListener("beforeinput", enter);
    return () => box.removeEventListener("beforeinput", enter);
  }, [open]);
  if (!compose) return null;
  const isEdit = compose.kind === "edit";
  const where = isEdit
    ? `Editing note · ${compose.time} · Shot ${compose.shot}`
    : `${stamp(compose.t)} · Shot ${compose.shot}: ${compose.shotName}${compose.pin ? ` · ${compose.pin.what}` : ""}`;
  return (
    <div
      className={
        inline
          ? "bg-card flex-none border-b border-white/8 px-3 py-2"
          : "bg-card upright:fixed upright:inset-x-0 upright:top-[min(56.25vw,62vh)] upright:z-5 upright:shadow-sheet sideways:px-3 sideways:py-2 flex-none p-3"
      }
    >
      <div className="text-ui text-primary sideways:mb-1 mb-2 wrap-anywhere">{where}</div>
      {drawn && <div className="text-ui text-ink mb-2 tabular-nums">{drawn}</div>}
      {!drawn && !isEdit && inOutAt(compose.t) && (
        <div className="text-ui text-in-out-text mb-2 tabular-nums">
          About {rangeText(inOutAt(compose.t)!)}, the In to Out stretch
        </div>
      )}
      {isEdit && (
        <Callout variant="warn" className="mb-2">
          <TriangleAlert aria-hidden />
          <span>Saving replaces the note's old text.</span>
        </Callout>
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
        onPointerDown={() => setClickedFor(compose)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (
            drawKeys &&
            !draft &&
            /^[1-4]$/.test(e.key) &&
            !e.ctrlKey &&
            !e.metaKey &&
            !e.altKey &&
            toolsOpen(get())
          ) {
            e.preventDefault();
            setInk(INK_KEYS[+e.key - 1]);
            return;
          }
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            saveNote();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancelNote();
          }
        }}
        variant="note"
        className="upright:h-19 sideways:h-16 h-28 resize-y"
      />
      <div className="sideways:mt-1.5 mt-2 flex gap-2">
        <Button size="xl" className="flex-1" onClick={saveNote}>
          {isEdit ? "Save" : "Add note"}
        </Button>
        <Button variant="secondary" size="xl" onClick={cancelNote}>
          Cancel
        </Button>
      </div>
      <small className="text-muted-foreground mt-2 block text-xs pointer-coarse:hidden">
        Enter adds · Shift+Enter new line · Esc cancels. Your draft survives a reload.
      </small>
    </div>
  );
}
