import { Headphones, Volume2, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";

import { shotIndex } from "../core/film";
import { DURATION } from "../core/filmMeta";
import { S } from "../core/state";
import { set, useStudio } from "../core/store";
import { stamp } from "../core/time";
import { toggleMute } from "../playback/transport";

export function BlindAudioCurtain() {
  const active = useStudio((s) => s.blindAudio);
  const playing = useStudio((s) => s.playing);
  const muted = useStudio((s) => s.muted);
  useStudio((s) => s.metaRev);
  useStudio((s) => s.shotsRev);

  const timeRef = useRef<HTMLSpanElement>(null);
  const shotRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!active) return;
    const sync = () => {
      if (timeRef.current) {
        timeRef.current.textContent = `${stamp(S.t)} / ${stamp(DURATION)}`;
      }
      if (shotRef.current) {
        const i = shotIndex(S.t);
        const name = S.comments[i];
        shotRef.current.textContent = name ? `Shot ${i} · ${name}` : `Shot ${i}`;
      }
    };
    sync();
    return S.watch("time", sync);
  }, [active]);

  if (!active) return null;
  const i = shotIndex(S.t);
  const shotName = S.comments[i];

  return (
    <div
      role="region"
      aria-label="Blind audio test"
      className="bg-stage absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 p-6 text-center select-none"
    >
      <div className="bg-card ring-hairline-strong flex size-12 items-center justify-center rounded-full ring-1">
        <Headphones aria-hidden className="text-primary-text size-5" />
      </div>
      <div className="flex flex-col items-center gap-1">
        <span className="text-primary-text text-tag font-mono font-semibold tracking-wider uppercase">
          Blind Audio Test · {playing ? "Listening" : "Paused"}
        </span>
        <span
          ref={timeRef}
          className="text-heading-foreground font-mono text-2xl font-semibold tabular-nums"
        >
          {stamp(S.t)} / {stamp(DURATION)}
        </span>
        <span ref={shotRef} className="text-label text-sm">
          {shotName ? `Shot ${i} · ${shotName}` : `Shot ${i}`}
        </span>
      </div>
      {muted && (
        <div className="bg-warn-bg text-warn-text ring-warn/30 flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs ring-1">
          <span>Audio is currently muted</span>
          <Button variant="warn" size="xs" onClick={toggleMute}>
            <Volume2 data-icon="inline-start" />
            Unmute
          </Button>
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="md"
          onClick={() => set({ blindAudio: false })}
          aria-label="Exit Blind Audio"
        >
          <X data-icon="inline-start" />
          Exit Blind Audio
        </Button>
      </div>
      <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <span>Picture hidden without pausing playback · Press</span>
        <Kbd>Esc</Kbd>
        <span>or</span>
        <Kbd>Shift+H</Kbd>
        <span>to return</span>
      </p>
    </div>
  );
}
