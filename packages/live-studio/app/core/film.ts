// The film's shots on the studio's clock: which shot a second falls in, and where a shot ends
import { DURATION, SHOTS_OUT as SHOTS } from "film/scene";

export const shotIndex = (x: number) => { let i = 0; SHOTS.forEach((s, n) => { if (x >= s.t) i = n; }); return i; };
export const shotEnd = (i: number) => SHOTS[i + 1]?.t ?? DURATION;
