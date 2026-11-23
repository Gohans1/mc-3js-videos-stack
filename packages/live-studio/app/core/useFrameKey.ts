import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { onWake, S } from "./state";

const MIN_INTERVAL_MS = 120;

export function useFrameKey(readKey: () => string | number): void {
  const [, setTick] = useState(0);
  const readRef = useRef(readKey);
  const prevRef = useRef<string | number>(0);

  useLayoutEffect(() => {
    readRef.current = readKey;
    prevRef.current = readKey();
  });

  useEffect(() => {
    let timer = 0;
    let last = 0;
    const check = () => {
      const next = readRef.current();
      if (next !== prevRef.current) {
        prevRef.current = next;
        setTick((n) => n + 1);
      }
    };
    const schedule = () => {
      const now = performance.now();
      const elapsed = now - last;
      if (elapsed >= MIN_INTERVAL_MS) {
        last = now;
        check();
      } else if (!timer) {
        timer = window.setTimeout(() => {
          timer = 0;
          last = performance.now();
          check();
        }, MIN_INTERVAL_MS - elapsed);
      }
    };
    const onFrame = () => (S.playing ? schedule() : check());
    const u1 = onWake("time", schedule);
    const u2 = onWake("render", onFrame);
    const u3 = onWake("rendered", onFrame);
    return () => {
      u1();
      u2();
      u3();
      clearTimeout(timer);
    };
  }, []);
}
