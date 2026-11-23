import { useEffect, useState } from "react";

import { S } from "./state";
import { FPS } from "./time";

let frameSubs: Set<(f: number) => void> | null = null,
  frameTimer = 0,
  lastPush = 0,
  lastFrame = -1,
  unsubTime: (() => void) | null = null;

const pushFrame = () => {
  frameTimer = 0;
  lastPush = performance.now();
  const next = Math.round(S.t * FPS);
  if (next === lastFrame) return;
  lastFrame = next;
  if (frameSubs) for (const fn of frameSubs) fn(next);
};
const scheduleFrame = () => {
  const next = Math.round(S.t * FPS);
  if (next === lastFrame) return;
  const elapsed = performance.now() - lastPush;
  if (elapsed >= 120) {
    clearTimeout(frameTimer);
    pushFrame();
  } else if (!frameTimer) {
    frameTimer = window.setTimeout(pushFrame, 120 - elapsed);
  }
};

export const useFrame = () => {
  const [f, setF] = useState(() => Math.round(S.t * FPS));
  useEffect(() => {
    frameSubs ??= new Set();
    frameSubs.add(setF);
    if (!unsubTime) {
      lastFrame = Math.round(S.t * FPS);
      unsubTime = S.watch("time", scheduleFrame);
    }
    return () => {
      frameSubs?.delete(setF);
      if (frameSubs && frameSubs.size === 0) {
        unsubTime?.();
        unsubTime = null;
        clearTimeout(frameTimer);
        frameTimer = 0;
      }
    };
  }, []);
  return f;
};
