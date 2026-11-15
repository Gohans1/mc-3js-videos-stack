// The studio on a phone (core/device.ts PHONE; main.tsx loads this instead of App.tsx): review only, three jobs. Scrub the
// film, add a note (a tap on the picture pins one there, the Note button notes the whole frame), read and answer the notes.
// Frame.io's mobile review is the model: the player on top, the comments under it, a tap on one jumps to its frame. Upright:
// picture, bar, notes, Note at the bottom under the thumb. On its side: the picture and its bar left, the notes column right.
// No timeline, panels, option chips or free camera here, so none of their code is downloaded either
import { Pencil } from "lucide-react";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";

import type { Bind, Elements } from "./core/state";
import { Compose } from "./notes/Compose";
import { NoteList } from "./notes/NoteList";
import { openNote, originOf } from "./notes/notes";
import { Stage } from "./picture/Stage";
import { useBoot } from "./shell/boot";
import { PhoneBar } from "./shell/PhoneBar";

export function App() {
  const el = useRef({} as Elements);
  const bind: Bind = (key) => (node) => {
    if (node) el.current[key] = node;
  };
  useBoot(el);
  return (
    // toasts stack above the Note button (its 44 px, its padding and an iPhone's 34 px home bar), never over it
    <Toaster limit={2} viewportClassName="bottom-20">
      <TooltipProvider delay={500}>
        <div className="bg-background safe-sides phone-h flex flex-col text-sm landscape:grid landscape:grid-cols-[minmax(0,1fr)_min(42%,22rem)]">
          <div className="landscape:phone-h flex min-h-0 flex-initial flex-col">
            <Stage bind={bind} phone />
            <PhoneBar />
          </div>
          <aside
            aria-label="Notes"
            className="landscape:phone-h border-border/80 flex min-h-0 flex-1 flex-col overflow-hidden landscape:border-l"
          >
            {/* The list adds nothing to the column's least height (contain-size), so when the keyboard leaves too little
                room the picture above shrinks and the note box keeps its Save button in view */}
            <div className="flex min-h-0 flex-1 flex-col contain-size">
              <NoteList />
            </div>
            <Compose
              inline
              dock
              idleFooter={
                <div className="safe-bottom motion-safe:animate-in motion-safe:fade-in-0 flex-none px-3 pt-2 duration-150">
                  <Button
                    size="xl"
                    className="w-full"
                    onClick={(e) => openNote(null, true, originOf(e.currentTarget))}
                  >
                    <Pencil data-icon="inline-start" aria-hidden />
                    Note
                  </Button>
                </div>
              }
            />
          </aside>
        </div>
        <audio ref={bind("audio")} preload="auto" />
      </TooltipProvider>
    </Toaster>
  );
}
