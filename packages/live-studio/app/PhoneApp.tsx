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
    <Toaster limit={2} viewportClassName="phone-toast-bottom">
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
            <div className="flex min-h-0 flex-1 flex-col contain-size">
              <NoteList />
            </div>
            <Compose
              inline
              dock
              idleFooter={
                <div className="safe-bottom-compact motion-safe:animate-in motion-safe:fade-in-0 flex-none px-2.5 pt-1 duration-150">
                  <Button
                    size="phone-cta"
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
