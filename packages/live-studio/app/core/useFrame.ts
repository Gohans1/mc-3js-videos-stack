// The playhead's frame, for a panel that shows what is on the playhead (a key there, its ◁◇▷). The store never carries the time,
// which changes every frame, so this reads it a few times a second and re-renders only when the frame changes
import { useEffect, useState } from "react";

import { S } from "./state";
import { FPS } from "./time";

export const useFrame = () => {
  const [f, setF] = useState(() => Math.round(S.t * FPS));
  useEffect(() => {
    const id = setInterval(() => setF(Math.round(S.t * FPS)), 120);
    return () => clearInterval(id);
  }, []);
  return f;
};
