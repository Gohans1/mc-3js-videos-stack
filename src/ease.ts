// @ts-nocheck
export const clamp01 = (x) => Math.min(1, Math.max(0, x));
// smoothstep on 0..1: eases in and out, flat at both ends
export const smooth = (x) => { const u = clamp01(x); return u * u * (3 - 2 * u); };
