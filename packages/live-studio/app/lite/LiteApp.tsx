import { useEffect } from "react";

import { showUndo, toast, Toaster } from "@/components/ui/toast";

import { ComposeDock } from "./ComposeDock.tsx";
import { bindLiteHotkeys } from "./hotkeys.ts";
import { noteState } from "./model.ts";
import { jumpToNote } from "./NoteCardParts.tsx";
import { NoteList } from "./NoteList.tsx";
import { playback } from "./playback.ts";
import { ScrubBar } from "./ScrubBar.tsx";
import { lite, useLite } from "./store.ts";
import { VideoBar } from "./VideoBar.tsx";
import { VideoStage } from "./VideoStage.tsx";

export function LiteApp() {
  const filmName = useLite((s) => s.film.name);
  const statusPill = useLite((s) => s.statusPill);

  useEffect(() => {
    lite.setNoticeHandler((notice) => {
      if (notice.undo) {
        showUndo(notice.title, notice.undo);
      } else {
        toast.add({
          title: notice.title,
          description: notice.description,
          type: notice.type,
        });
      }
    });
    lite.setSeekHandler((t, clipChanged) => {
      playback.pause();
      if (clipChanged) playback.seekAfterClipChange(t);
      else playback.seek(t);
    });
    void lite.init();

    const unbindHotkeys = bindLiteHotkeys({
      togglePlay: () => {
        if (lite.store.getState().videoReady) playback.togglePlay();
      },
      step: (dt) => {
        if (!lite.store.getState().videoReady) return;
        playback.pause();
        playback.seek(playback.t + dt);
      },
      seekBy: (dt) => {
        if (!lite.store.getState().videoReady) return;
        playback.seek(playback.t + dt);
      },
      seekStart: () => {
        if (!lite.store.getState().videoReady) return;
        playback.seekLocal(0);
      },
      seekEnd: () => {
        if (!lite.store.getState().videoReady) return;
        playback.seekLocal(playback.duration);
      },
      toggleMute: () => {
        lite.setMuted(!lite.store.getState().muted);
      },
      openNewNote: () => {
        const s = lite.store.getState();
        if (!s.selectedPath || s.noteSaving || s.compose?.kind === "edit") return;
        const wasPlaying = playback.isPlaying;
        if (wasPlaying) playback.pause();
        lite.openCreateNote(null, playback.t, wasPlaying, { autoFocus: true });
      },
      toggleDraw: () => {
        const s = lite.store.getState();
        if (!s.selectedPath || s.noteSaving || s.compose?.kind === "edit") return;
        if (s.inkTool) {
          lite.setInkTool(null);
          return;
        }
        const wasPlaying = playback.isPlaying;
        if (wasPlaying) playback.pause();
        if (!s.compose) {
          lite.openCreateNote(null, playback.t, wasPlaying, { autoFocus: false });
        }
        lite.setInkTool("pen");
      },
      refresh: () => {
        if (!lite.store.getState().refreshing) void lite.refreshAll();
      },
      jumpNote: (dir) => {
        const s = lite.store.getState();
        if (s.noteSaving) return;
        const list = s.notes
          .filter((n) => noteState(n) !== "done")
          .toSorted((a, b) => a.t - b.t || a.id.localeCompare(b.id));
        if (!list.length) return;
        const now = playback.t;
        const target =
          dir === 1
            ? (list.find((n) => n.t > now + 0.05) ?? list[0]!)
            : (list.findLast((n) => n.t < now - 0.05) ?? list.at(-1)!);
        jumpToNote(target, false);
      },
      hasCompose: () => lite.store.getState().compose !== null,
      cancelCompose: () => {
        const resume = lite.cancelCompose();
        if (resume) playback.play();
      },
      hasInkTool: () => lite.store.getState().inkTool !== null,
      stopDraw: () => lite.setInkTool(null),
      canUndoInk: () => {
        const s = lite.store.getState();
        return s.compose?.kind === "create" && !s.noteSaving && s.inkMarks.length > 0;
      },
      undoInk: () => {
        lite.undoInk();
      },
    });

    const onOnline = () => void lite.flushNotes();
    const onVisible = () => {
      if (!document.hidden) void lite.flushNotes();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      unbindHotkeys();
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    document.title = filmName ? `${filmName} · Studio Lite` : "Studio Lite";
  }, [filmName]);

  return (
    <Toaster
      limit={2}
      viewportClassName="inset-x-2 top-11 bottom-auto mx-auto max-w-md [&_[data-slot=toast]]:top-0 [&_[data-slot=toast]]:bottom-auto [&_[data-slot=toast]]:origin-top"
    >
      {statusPill && (
        <div
          role="status"
          aria-live="polite"
          data-lite-status-pill
          className="bg-scrim-strong text-foreground border-hairline-strong pointer-events-none fixed top-11 left-1/2 z-40 max-w-[min(calc(100vw-1rem),28rem)] -translate-x-1/2 truncate rounded-full border px-3 py-1 text-xs font-medium shadow-md backdrop-blur-md"
        >
          {statusPill}
        </div>
      )}
      <div className="bg-background safe-sides phone-h flex flex-col overflow-hidden text-sm max-md:landscape:grid max-md:landscape:grid-cols-[minmax(0,1fr)_min(42%,22rem)] md:grid md:grid-cols-[minmax(0,1fr)_min(42%,25rem)] lg:grid-cols-[minmax(0,1fr)_min(34%,28rem)]">
        <div className="max-md:landscape:phone-h md:phone-h flex min-h-0 flex-initial flex-col">
          <VideoBar />
          <VideoStage />
          <ScrubBar />
        </div>
        <aside
          aria-label="Notes"
          className="max-md:landscape:phone-h md:phone-h border-border/80 flex min-h-0 flex-1 flex-col overflow-hidden max-md:landscape:border-l md:border-l"
        >
          <div className="flex min-h-0 flex-1 flex-col contain-size">
            <NoteList />
          </div>
          <ComposeDock />
        </aside>
      </div>
    </Toaster>
  );
}
