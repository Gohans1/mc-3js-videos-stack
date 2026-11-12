import BezierEasing from "bezier-easing";
import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";

import { EASES } from "./camera";

export const TRANSITION_CATEGORIES = [
  "Basic",
  "Wipe & Split",
  "Mask & Iris",
  "Light & Focus",
  "Speed & Glitch",
] as const;
export type TransitionCategory = (typeof TRANSITION_CATEGORIES)[number];

export const TRANSITION_EASES = [
  {
    id: "auto",
    title: "Natural",
    tip: "The transition's own pacing: its film-defined curve, else its shader's timing",
  },
  { id: "linear", title: "Linear", tip: "Constant rate across the cut window" },
  { id: "smooth", title: "Smooth S", tip: "Cinetic stdInOut symmetric acceleration and settle" },
  { id: "snap", title: "Snap Out", tip: "Front-loaded fast snap with a long optical settle" },
  { id: "glide", title: "Glide Out", tip: "Cinetic house arrive glide into the incoming shot" },
] as const;
export type TransitionEasePreset = (typeof TRANSITION_EASES)[number]["id"];
export type TransitionEase =
  TransitionEasePreset | keyof typeof EASES | readonly [number, number, number, number];

export type TransitionDef = {
  id: string;
  title: string;
  tip: string;
  category: string;
  glsl: string;
  // Natural ("auto") curve for this transition; built-ins leave it out and pace themselves inside their GLSL
  ease?: TransitionEase;
  // Studio hints for a film's own shader; left out, the studio reads uFeather / uFlip in the GLSL
  feather?: boolean;
  flip?: boolean;
};

export const TRANSITIONS = [
  // ── Basic ──────────────────────────────────────────────────────────────────
  {
    id: "dissolve",
    title: "Dissolve",
    tip: "Blend the two camera views smoothly across the cut",
    category: "Basic",
    glsl: `vec4 transition(vec2 uv) {
      float p = smoothstep(0.0, 1.0, progress);
      return mix(getFromColor(uv), getToColor(uv), p);
    }`,
  },
  {
    id: "black",
    title: "Black Fade",
    tip: "Fade out, cut in pure black, then emerge cleanly",
    category: "Basic",
    glsl: `vec4 transition(vec2 uv) {
      vec4 black = vec4(0.0, 0.0, 0.0, 1.0);
      float hold = mix(0.04, 0.22, uFeather);
      if (progress < 0.5 - hold * 0.5) {
        return mix(getFromColor(uv), black, smoothstep(0.0, 0.5 - hold * 0.5, progress));
      }
      if (progress > 0.5 + hold * 0.5) {
        return mix(black, getToColor(uv), smoothstep(0.5 + hold * 0.5, 1.0, progress));
      }
      return black;
    }`,
  },
  {
    id: "white",
    title: "White Flash",
    tip: "Flash through bright white across the cut",
    category: "Basic",
    glsl: `vec4 transition(vec2 uv) {
      vec4 white = vec4(1.0, 1.0, 1.0, 1.0);
      float peak = 1.0 - abs(progress * 2.0 - 1.0);
      peak = pow(clamp(peak, 0.0, 1.0), mix(1.8, 0.75, uFeather));
      vec4 base = progress < 0.5 ? getFromColor(uv) : getToColor(uv);
      return mix(base, white, peak);
    }`,
  },
  {
    id: "dipGrey",
    title: "Neutral Grey Bridge",
    tip: "Cinetic neutral mid-grey bridge preventing muddy hue clashes",
    category: "Basic",
    glsl: `vec4 transition(vec2 uv) {
      vec4 grey = vec4(0.18, 0.185, 0.195, 1.0);
      float bridge = sin(progress * 3.14159265);
      bridge = pow(clamp(bridge, 0.0, 1.0), mix(1.6, 0.8, uFeather));
      vec4 base = mix(getFromColor(uv), getToColor(uv), smoothstep(0.28, 0.72, progress));
      return mix(base, grey, bridge * 0.88);
    }`,
  },

  // ── Wipe & Split ───────────────────────────────────────────────────────────
  {
    id: "topDip",
    title: "Dip from Top",
    tip: "Dark falls from the top edge, holds black, then the next shot fades up",
    category: "Basic",
    glsl: `vec4 transition(vec2 uv) {
      float y = uFlip > 0.5 ? uv.y : 1.0 - uv.y;
      float a = clamp(progress / 0.55, 0.0, 1.0);
      float lead = mix(0.25, 0.9, uFeather);
      float dark = smoothstep(0.0, 1.0, a * (1.0 + lead) - y * lead);
      vec4 dipped = vec4(mix(getFromColor(uv).rgb, vec3(0.0), dark), 1.0);
      return mix(dipped, getToColor(uv), smoothstep(0.55, 1.0, progress));
    }`,
  },
  {
    id: "snapMorph",
    title: "Snap Morph Flash",
    tip: "Half blend on the middle frames under a short white-blue +30% luma flash",
    category: "Basic",
    glsl: `vec4 transition(vec2 uv) {
      float w = mix(0.05, 0.14, uFeather);
      float flash = 1.0 - smoothstep(0.0, w, abs(progress - 0.5));
      vec4 base = mix(getFromColor(uv), getToColor(uv), smoothstep(0.5 - w, 0.5 + w, progress));
      float l = dot(base.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 lifted = base.rgb + (vec3(0.82, 0.9, 1.0) * 0.3 + l * 0.3) * flash;
      return vec4(clamp(lifted, 0.0, 1.0), 1.0);
    }`,
  },
  {
    id: "wipe",
    title: "Wipe Right",
    tip: "Reveal the next view from left to right",
    category: "Wipe & Split",
    glsl: `vec4 transition(vec2 uv) {
      float x = uFlip > 0.5 ? 1.0 - uv.x : uv.x;
      float soft = mix(0.002, 0.18, uFeather);
      float p = progress * (1.0 + soft * 2.0) - soft;
      float m = 1.0 - smoothstep(p - soft, p + soft, x);
      return mix(getFromColor(uv), getToColor(uv), m);
    }`,
  },
  {
    id: "wipeLeft",
    title: "Wipe Left",
    tip: "Reveal the next view from right to left",
    category: "Wipe & Split",
    glsl: `vec4 transition(vec2 uv) {
      float x = uFlip > 0.5 ? uv.x : 1.0 - uv.x;
      float soft = mix(0.002, 0.18, uFeather);
      float p = progress * (1.0 + soft * 2.0) - soft;
      float m = 1.0 - smoothstep(p - soft, p + soft, x);
      return mix(getFromColor(uv), getToColor(uv), m);
    }`,
  },
  {
    id: "wipeUp",
    title: "Wipe Up",
    tip: "Reveal the next view from bottom to top",
    category: "Wipe & Split",
    glsl: `vec4 transition(vec2 uv) {
      float y = uFlip > 0.5 ? 1.0 - uv.y : uv.y;
      float soft = mix(0.002, 0.18, uFeather);
      float p = progress * (1.0 + soft * 2.0) - soft;
      float m = 1.0 - smoothstep(p - soft, p + soft, y);
      return mix(getFromColor(uv), getToColor(uv), m);
    }`,
  },
  {
    id: "wipeDown",
    title: "Wipe Down",
    tip: "Reveal the next view from top to bottom",
    category: "Wipe & Split",
    glsl: `vec4 transition(vec2 uv) {
      float y = uFlip > 0.5 ? uv.y : 1.0 - uv.y;
      float soft = mix(0.002, 0.18, uFeather);
      float p = progress * (1.0 + soft * 2.0) - soft;
      float m = 1.0 - smoothstep(p - soft, p + soft, y);
      return mix(getFromColor(uv), getToColor(uv), m);
    }`,
  },
  {
    id: "softWipe",
    title: "Soft Feathered Wipe",
    tip: "Cinetic decelerating wipe with a wide optical feather",
    category: "Wipe & Split",
    glsl: `vec4 transition(vec2 uv) {
      float x = uFlip > 0.5 ? 1.0 - uv.x : uv.x;
      float ep = 1.0 - pow(1.0 - progress, 3.0);
      float soft = mix(0.08, 0.36, uFeather);
      float p = ep * (1.0 + soft * 2.0) - soft;
      float m = 1.0 - smoothstep(p - soft, p + soft, x);
      return mix(getFromColor(uv), getToColor(uv), m);
    }`,
  },
  {
    id: "diagonalWipe",
    title: "Diagonal Wipe",
    tip: "Angled architectural wipe sweeping corner to corner",
    category: "Wipe & Split",
    glsl: `vec4 transition(vec2 uv) {
      float axis = uFlip > 0.5 ? ((1.0 - uv.x) * 0.65 + uv.y * 0.35) : (uv.x * 0.65 + (1.0 - uv.y) * 0.35);
      float soft = mix(0.004, 0.2, uFeather);
      float p = progress * (1.0 + soft * 2.0) - soft;
      float m = 1.0 - smoothstep(p - soft, p + soft, axis);
      return mix(getFromColor(uv), getToColor(uv), m);
    }`,
  },
  {
    id: "pushSlide",
    title: "Parallax Push",
    tip: "Incoming shot slides in while pushing outgoing shot at 0.62x parallax",
    category: "Wipe & Split",
    glsl: `vec4 transition(vec2 uv) {
      float dir = uFlip > 0.5 ? -1.0 : 1.0;
      float ep = 1.0 - pow(1.0 - progress, 3.2);
      float soft = mix(0.001, 0.06, uFeather);
      float p = ep * (1.0 + soft * 2.0) - soft;
      vec2 inUv = uv + vec2((1.0 - ep) * dir, 0.0);
      vec2 outUv = uv - vec2(ep * 0.62 * dir, 0.0);
      float mask = dir > 0.0
        ? 1.0 - smoothstep(p - soft, p + soft, uv.x)
        : smoothstep(1.0 - p - soft, 1.0 - p + soft, uv.x);
      return mix(getFromColor(outUv), getToColor(inUv), mask);
    }`,
  },
  {
    id: "doorSplit",
    title: "Parting Doors",
    tip: "Outgoing shot parts outward from the centre line revealing the next shot",
    category: "Wipe & Split",
    glsl: `vec4 transition(vec2 uv) {
      float ep = smoothstep(0.0, 1.0, progress);
      float axis = uFlip > 0.5 ? uv.y : uv.x;
      float dist = abs(axis - 0.5);
      float soft = mix(0.002, 0.05, uFeather);
      float halfOpen = mix(-soft, 0.5 + soft, ep);
      float inside = 1.0 - smoothstep(halfOpen - soft, halfOpen + soft, dist);
      float shift = sign(axis - 0.5) * ep * 0.5;
      vec2 outUv = uFlip > 0.5 ? vec2(uv.x, uv.y - shift) : vec2(uv.x - shift, uv.y);
      vec2 inUv = (uv - 0.5) * mix(1.08, 1.0, ep) + 0.5;
      return mix(getFromColor(outUv), getToColor(inUv), inside);
    }`,
  },
  {
    id: "bandWipe",
    title: "Staggered Slice Bands",
    tip: "Horizontal slice bands sweep across with staggered timing",
    category: "Wipe & Split",
    glsl: `vec4 transition(vec2 uv) {
      float bands = 7.0;
      float row = floor(uv.y * bands);
      float lag = fract(sin((row + 1.0) * 19.37) * 43758.5453) * 0.28;
      float localP = clamp((progress * 1.28 - lag), 0.0, 1.0);
      localP = 1.0 - pow(1.0 - localP, 2.6);
      float x = uFlip > 0.5 ? 1.0 - uv.x : uv.x;
      float soft = mix(0.002, 0.08, uFeather);
      float p = localP * (1.0 + soft * 2.0) - soft;
      float m = 1.0 - smoothstep(p - soft, p + soft, x);
      return mix(getFromColor(uv), getToColor(uv), m);
    }`,
  },

  // ── Mask & Iris ────────────────────────────────────────────────────────────
  {
    id: "tornPaper",
    title: "Torn Paper Steps",
    tip: "A jagged paper edge with a white fibre fringe tears across in four held steps",
    category: "Wipe & Split",
    glsl: `vec4 transition(vec2 uv) {
      float x = uFlip > 0.5 ? 1.0 - uv.x : uv.x;
      float idx = min(floor(progress * 5.0), 4.0);
      float amp = mix(0.012, 0.045, uFeather);
      float fr = 0.0035;
      float sh = 0.002;
      float pad = amp + fr + sh + 0.01;
      float pos = mix(-pad, 1.0 + pad, idx / 4.0);
      float seed = idx * 12.9898;
      float jag = amp * (0.55 * sin(uv.y * 41.0 + seed) + 0.3 * sin(uv.y * 97.0 + seed * 1.7) + 0.15 * sin(uv.y * 211.0 + seed * 2.3));
      float edge = pos + jag;
      if (x < edge) { return getToColor(uv); }
      if (x < edge + fr) { return vec4(0.96, 0.95, 0.92, 1.0); }
      vec4 src = getFromColor(uv);
      if (x < edge + fr + sh) { return vec4(src.rgb * 0.62, 1.0); }
      return src;
    }`,
  },
  {
    id: "irisOpen",
    title: "Iris Open",
    tip: "Circular aperture opens from centre to frame corners",
    category: "Mask & Iris",
    glsl: `vec4 transition(vec2 uv) {
      vec2 d = (uv - 0.5) * vec2(uRatio, 1.0);
      float maxR = length(vec2(0.5 * uRatio, 0.5));
      float soft = mix(0.004, 0.16, uFeather) * maxR;
      float dist = uFlip > 0.5 ? maxR - length(d) : length(d);
      float r = progress * (maxR + soft * 2.0) - soft;
      float m = 1.0 - smoothstep(r - soft, r + soft, dist);
      return mix(getFromColor(uv), getToColor(uv), m);
    }`,
  },
  {
    id: "irisClose",
    title: "Iris Close",
    tip: "Outgoing shot closes down into a circular aperture",
    category: "Mask & Iris",
    glsl: `vec4 transition(vec2 uv) {
      vec2 d = (uv - 0.5) * vec2(uRatio, 1.0);
      float maxR = length(vec2(0.5 * uRatio, 0.5));
      float soft = mix(0.004, 0.16, uFeather) * maxR;
      float dist = uFlip > 0.5 ? maxR - length(d) : length(d);
      float r = (1.0 - progress) * (maxR + soft * 2.0) - soft;
      float keepOut = 1.0 - smoothstep(r - soft, r + soft, dist);
      float m = 1.0 - keepOut;
      return mix(getFromColor(uv), getToColor(uv), m);
    }`,
  },
  {
    id: "lightIris",
    title: "Luminous Ring Iris",
    tip: "Expanding circular iris rimmed with a bright specular ring",
    category: "Mask & Iris",
    glsl: `vec4 transition(vec2 uv) {
      vec2 d = (uv - 0.5) * vec2(uRatio, 1.0);
      float maxR = length(vec2(0.5 * uRatio, 0.5));
      float width = mix(0.025, 0.11, uFeather) * maxR;
      float r = progress * (maxR + width * 2.0) - width;
      float dist = uFlip > 0.5 ? maxR - length(d) : length(d);
      float m = 1.0 - smoothstep(r - width, r + width, dist);
      float ring = exp(-pow((dist - r) / max(width * 0.65, 0.004), 2.0)) * sin(progress * 3.14159265);
      vec4 col = mix(getFromColor(uv), getToColor(uv), m);
      return vec4(clamp(col.rgb + vec3(1.0, 0.98, 0.94) * ring * 0.55, 0.0, 1.0), 1.0);
    }`,
  },
  {
    id: "blobRing",
    title: "Organic Multi-Lobe Iris",
    tip: "Cinetic soft multi-lobe organic aperture swirling open",
    category: "Mask & Iris",
    glsl: `vec4 transition(vec2 uv) {
      vec2 d = (uv - 0.5) * vec2(uRatio, 1.0);
      float ang = atan(d.y, d.x) + (uFlip > 0.5 ? -1.0 : 1.0) * progress * 1.4;
      float wobble = 1.0 + 0.11 * sin(ang * 5.0) + 0.06 * cos(ang * 3.0 - progress * 2.5);
      float maxR = length(vec2(0.5 * uRatio, 0.5)) * 1.2;
      float soft = mix(0.01, 0.18, uFeather) * maxR;
      float r = progress * (maxR + soft * 2.0) - soft;
      float m = 1.0 - smoothstep(r - soft, r + soft, length(d) * wobble);
      return mix(getFromColor(uv), getToColor(uv), m);
    }`,
  },
  {
    id: "windowExpand",
    title: "Window Expand",
    tip: "Rounded portal expands from centre while the outgoing shot steps back",
    category: "Mask & Iris",
    glsl: `vec4 transition(vec2 uv) {
      float ep = 1.0 - pow(1.0 - progress, 3.0);
      float soft = mix(0.002, 0.05, uFeather);
      vec2 openHalf = mix(vec2(-soft * 1.5), vec2(0.5 + soft * 1.5), ep);
      vec2 closeHalf = mix(vec2(0.5 + soft * 1.5), vec2(-soft * 1.5), ep);
      vec2 halfSize = uFlip > 0.5 ? closeHalf : openHalf;
      float corner = uFlip > 0.5 ? mix(0.0, 0.08, ep) : mix(0.08, 0.0, ep);
      vec2 q = abs(uv - 0.5) - halfSize + corner;
      float sdf = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - corner;
      float inside = 1.0 - smoothstep(-soft, soft, sdf);
      float m = uFlip > 0.5 ? 1.0 - inside : inside;
      vec2 outUv = (uv - 0.5) / mix(1.0, 0.88, ep) + 0.5;
      vec2 inUv = (uv - 0.5) * mix(uFlip > 0.5 ? 0.92 : 1.14, 1.0, ep) + 0.5;
      return mix(getFromColor(outUv), getToColor(inUv), m);
    }`,
  },
  {
    id: "mosaicCut",
    title: "Log Mosaic Beat",
    tip: "Cinetic log-scale pixelation steps up into the cut and resolves crisp",
    category: "Mask & Iris",
    glsl: `vec4 transition(vec2 uv) {
      float pulse = sin(progress * 3.14159265);
      float cells = mix(240.0, mix(14.0, 6.0, uFeather), pow(pulse, 0.85));
      vec2 grid = vec2(cells * uRatio, cells);
      vec2 pUv = pulse < 0.02 ? uv : (floor(uv * grid) + 0.5) / grid;
      return progress < 0.5 ? getFromColor(pUv) : getToColor(pUv);
    }`,
  },
  {
    id: "mosaicIris",
    title: "Cellular Mosaic Ring",
    tip: "Pixelated cellular ring expands across the frame into the next shot",
    category: "Mask & Iris",
    glsl: `vec4 transition(vec2 uv) {
      float cells = mix(36.0, 18.0, uFeather);
      vec2 grid = vec2(cells * uRatio, cells);
      vec2 cellCenter = (floor(uv * grid) + 0.5) / grid;
      vec2 d = (cellCenter - 0.5) * vec2(uRatio, 1.0);
      float maxR = length(vec2(0.5 * uRatio, 0.5));
      float dist = uFlip > 0.5 ? maxR - length(d) : length(d);
      float r = progress * (maxR + 0.18) - 0.09;
      float band = exp(-pow((dist - r) / 0.11, 2.0)) * sin(progress * 3.14159265);
      vec2 sampleUv = mix(uv, cellCenter, clamp(band * 1.2, 0.0, 1.0));
      float m = 1.0 - smoothstep(r - 0.04, r + 0.04, dist);
      return mix(getFromColor(sampleUv), getToColor(sampleUv), m);
    }`,
  },

  // ── Light & Focus ──────────────────────────────────────────────────────────
  {
    id: "frameCollapse",
    title: "Frame Collapse",
    tip: "The frame closes sideways first, then shrinks to a point; its picture shrinks slower than the frame",
    category: "Mask & Iris",
    glsl: `vec4 transition(vec2 uv) {
      float q = uFlip > 0.5 ? 1.0 - progress : progress;
      float soft = mix(0.001, 0.02, uFeather);
      float shut = smoothstep(0.4, 1.0, q);
      float hx = mix(0.5 + soft * 2.0, -soft * 2.0, mix(smoothstep(0.0, 0.35, q) * 0.72, 1.0, shut));
      float hy = mix(0.5 + soft * 2.0, -soft * 2.0, mix(smoothstep(0.12, 0.45, q) * 0.6, 1.0, shut));
      vec2 d = abs(uv - 0.5);
      float m = (1.0 - smoothstep(hx - soft, hx + soft, d.x)) * (1.0 - smoothstep(hy - soft, hy + soft, d.y));
      float cs = mix(1.0, 0.6, smoothstep(0.0, 1.0, q));
      vec2 cuv = (uv - 0.5) / cs + 0.5;
      if (uFlip > 0.5) { return mix(getFromColor(uv), getToColor(cuv), m); }
      return mix(getToColor(uv), getFromColor(cuv), m);
    }`,
  },
  {
    id: "blurDissolve",
    title: "Defocus Melt",
    tip: "Both shots melt through a soft optical blur pulse across the seam",
    category: "Light & Focus",
    glsl: `vec4 transition(vec2 uv) {
      float pulse = sin(progress * 3.14159265);
      float rad = pulse * mix(0.008, 0.032, uFeather);
      vec4 accA = vec4(0.0);
      vec4 accB = vec4(0.0);
      for (int i = 0; i < 8; i++) {
        float a0 = float(i) * 0.78539816;
        vec2 off = vec2(cos(a0) / uRatio, sin(a0)) * rad;
        accA += getFromColor(uv + off);
        accB += getToColor(uv + off);
      }
      vec4 blurA = (accA + getFromColor(uv) * 2.0) / 10.0;
      vec4 blurB = (accB + getToColor(uv) * 2.0) / 10.0;
      return mix(blurA, blurB, smoothstep(0.18, 0.82, progress));
    }`,
  },
  {
    id: "exposureBloom",
    title: "Exposure Bloom",
    tip: "Highlights lift and bloom warmly across the cut then settle",
    category: "Light & Focus",
    glsl: `vec4 transition(vec2 uv) {
      float pulse = pow(sin(progress * 3.14159265), mix(1.8, 0.9, uFeather));
      vec4 col = mix(getFromColor(uv), getToColor(uv), smoothstep(0.32, 0.68, progress));
      float gain = exp2(pulse * 1.45);
      vec3 lifted = col.rgb * gain + vec3(1.0, 0.985, 0.95) * pulse * 0.28;
      return vec4(clamp(lifted, 0.0, 1.0), 1.0);
    }`,
  },
  {
    id: "lightSweep",
    title: "Specular Light Band",
    tip: "Angled specular light band sweeps across and reveals the incoming shot",
    category: "Light & Focus",
    glsl: `vec4 transition(vec2 uv) {
      float axis = uFlip > 0.5 ? (1.0 - uv.x) * 0.85 + uv.y * 0.15 : uv.x * 0.85 + (1.0 - uv.y) * 0.15;
      float width = mix(0.06, 0.24, uFeather);
      float pos = progress * (1.0 + width * 3.0) - width * 1.5;
      float m = 1.0 - smoothstep(pos - width, pos + width, axis);
      float band = exp(-pow((axis - pos) / max(width * 0.65, 0.01), 2.0)) * sin(progress * 3.14159265);
      vec4 col = mix(getFromColor(uv), getToColor(uv), m);
      return vec4(clamp(col.rgb + vec3(1.0, 0.97, 0.91) * band * 0.65, 0.0, 1.0), 1.0);
    }`,
  },
  {
    id: "hueSweep",
    title: "Chromatic Front Sweep",
    tip: "Cinetic spectral colour front sweeps across and cools into the next shot",
    category: "Light & Focus",
    glsl: `vec4 transition(vec2 uv) {
      float x = uFlip > 0.5 ? 1.0 - uv.x : uv.x;
      float width = mix(0.08, 0.26, uFeather);
      float pos = progress * (1.0 + width * 3.0) - width * 1.5;
      float m = 1.0 - smoothstep(pos - width, pos + width, x);
      float lead = exp(-pow((x - (pos + width * 0.35)) / max(width * 0.5, 0.01), 2.0));
      float trail = exp(-pow((x - (pos - width * 0.35)) / max(width * 0.5, 0.01), 2.0));
      float env = sin(progress * 3.14159265);
      vec4 col = mix(getFromColor(uv), getToColor(uv), m);
      vec3 tint = vec3(0.28, 0.62, 1.0) * lead + vec3(0.95, 0.55, 0.85) * trail;
      return vec4(clamp(col.rgb + tint * env * 0.45, 0.0, 1.0), 1.0);
    }`,
  },
  {
    id: "lumaMelt",
    title: "Luminance Melt",
    tip: "Brightest regions of the incoming shot break through first",
    category: "Light & Focus",
    glsl: `vec4 transition(vec2 uv) {
      vec4 aCol = getFromColor(uv);
      vec4 bCol = getToColor(uv);
      float luma = dot(bCol.rgb, vec3(0.2126, 0.7152, 0.0722));
      float key = uFlip > 0.5 ? luma : 1.0 - luma;
      float soft = mix(0.04, 0.32, uFeather);
      float p = progress * (1.0 + soft * 2.0) - soft;
      float m = 1.0 - smoothstep(p - soft, p + soft, key);
      return mix(aCol, bCol, m);
    }`,
  },

  // ── Speed & Glitch ─────────────────────────────────────────────────────────
  {
    id: "crossOver",
    title: "Evaporate Cross-over",
    tip: "The shot evaporates behind a soft front while shrinking; the next enters huge and blurred from the side",
    category: "Light & Focus",
    glsl: `vec4 transition(vec2 uv) {
      float x = uFlip > 0.5 ? 1.0 - uv.x : uv.x;
      float dir = uFlip > 0.5 ? -1.0 : 1.0;
      float soft = mix(0.03, 0.2, uFeather);
      float front = mix(-soft * 2.0, 1.0 + soft * 2.0, smoothstep(0.0, 0.7, progress));
      float keep = smoothstep(front - soft, front + soft, x);
      float so = 1.0 - 0.12 * progress;
      vec4 outgoing = getFromColor((uv - 0.5) / so + 0.5);
      float k = 1.0 - pow(1.0 - progress, 3.0);
      float s = mix(2.2, 1.0, k);
      vec2 c = (uv - 0.5 + vec2(dir * mix(0.32, 0.0, k), 0.0)) / s + 0.5;
      float r = mix(0.004, 0.016, uFeather) * (1.0 - k);
      vec4 incoming = (getToColor(c + vec2(r, r)) + getToColor(c - vec2(r, r)) + getToColor(c + vec2(r, -r)) + getToColor(c - vec2(r, -r))) * 0.25;
      float ain = clamp(progress * 4.0, 0.0, 1.0) * min(1.0, 0.4 + k);
      return mix(incoming, outgoing, keep * (1.0 - ain * 0.6));
    }`,
  },
  {
    id: "heatBleach",
    title: "Heat Bleach",
    tip: "Highlights lead the shot through olive, gold and peach to white, then the next shot develops",
    category: "Light & Focus",
    glsl: `vec4 transition(vec2 uv) {
      vec4 src = getFromColor(uv);
      float l = dot(src.rgb, vec3(0.2126, 0.7152, 0.0722));
      float h = smoothstep(0.0, 0.5, progress);
      float lead = mix(0.15, 0.6, uFeather);
      float w = clamp(h * (1.0 + lead) - (1.0 - l) * lead, 0.0, 1.0);
      vec3 heat = mix(vec3(0.27, 0.26, 0.1), vec3(0.83, 0.66, 0.38), smoothstep(0.15, 0.5, w));
      heat = mix(heat, vec3(1.0, 0.82, 0.7), smoothstep(0.45, 0.8, w));
      heat = mix(heat, vec3(1.0), smoothstep(0.75, 1.0, w));
      vec3 bleached = mix(src.rgb, heat, w);
      return vec4(mix(bleached, getToColor(uv).rgb, smoothstep(0.5, 1.0, progress)), 1.0);
    }`,
  },
  {
    id: "whipStreak",
    title: "Shutter Whip Streak",
    tip: "Directional horizontal shutter-smeared whip across the cut",
    category: "Speed & Glitch",
    glsl: `vec4 transition(vec2 uv) {
      float dir = uFlip > 0.5 ? -1.0 : 1.0;
      float speed = sin(progress * 3.14159265);
      float smear = speed * mix(0.03, 0.11, uFeather);
      float ep = smoothstep(0.0, 1.0, progress);
      float p = mix(-0.002, 1.002, ep);
      vec2 outUv = uv - vec2(dir * ep, 0.0);
      vec2 inUv = uv + vec2(dir * (1.0 - ep), 0.0);
      vec4 acc = vec4(0.0);
      for (int i = -3; i <= 3; i++) {
        vec2 off = vec2(float(i) / 3.0 * smear * dir, 0.0);
        float useIn = dir > 0.0 ? 1.0 - step(p, uv.x + off.x) : step(1.0 - p, uv.x + off.x);
        acc += mix(getFromColor(outUv + off), getToColor(inUv + off), useIn);
      }
      return acc / 7.0;
    }`,
  },
  {
    id: "zoomCross",
    title: "Log Zoom-Through",
    tip: "Exponential 2x zoom-through carrying scale across the cut",
    category: "Speed & Glitch",
    glsl: `vec4 transition(vec2 uv) {
      float dir = uFlip > 0.5 ? -1.0 : 1.0;
      float ep = smoothstep(0.0, 1.0, progress);
      float scaleOut = exp2(dir * ep * 0.85);
      float scaleIn = exp2(-dir * (1.0 - ep) * 0.85);
      vec2 outUv = (uv - 0.5) / scaleOut + 0.5;
      vec2 inUv = (uv - 0.5) / scaleIn + 0.5;
      float streak = sin(progress * 3.14159265) * mix(0.01, 0.05, uFeather);
      vec2 rad = (uv - 0.5) * streak;
      vec4 aCol = 0.5 * (getFromColor(outUv - rad) + getFromColor(outUv + rad));
      vec4 bCol = 0.5 * (getToColor(inUv - rad) + getToColor(inUv + rad));
      return mix(aCol, bCol, ep);
    }`,
  },
  {
    id: "invertFlash",
    title: "Polarity Flash Band",
    tip: "Cinetic InvertBand crisp inverted-luminance band snapping across the cut",
    category: "Speed & Glitch",
    glsl: `vec4 transition(vec2 uv) {
      float x = uFlip > 0.5 ? 1.0 - uv.x : uv.x;
      float w = mix(0.08, 0.22, uFeather);
      float pos = progress * (1.0 + w * 2.4) - w * 1.2;
      float m = 1.0 - smoothstep(pos - 0.008, pos + 0.008, x);
      float inBand = (1.0 - smoothstep(pos + w * 0.5 - 0.008, pos + w * 0.5 + 0.008, x))
                   * smoothstep(pos - w * 0.5 - 0.008, pos - w * 0.5 + 0.008, x);
      vec4 base = mix(getFromColor(uv), getToColor(uv), m);
      vec3 inv = vec3(1.0) - base.rgb;
      return vec4(mix(base.rgb, inv, inBand * sin(progress * 3.14159265)), 1.0);
    }`,
  },
  {
    id: "rgbSplitCut",
    title: "Chromatic Fringe Cut",
    tip: "Radial red/cyan chromatic aberration pulse bridging a high-energy cut",
    category: "Speed & Glitch",
    glsl: `vec4 transition(vec2 uv) {
      float pulse = sin(progress * 3.14159265);
      float amt = pulse * mix(0.012, 0.042, uFeather) * (uFlip > 0.5 ? -1.0 : 1.0);
      vec2 dir = (uv - 0.5) * amt + vec2(amt * 0.45, 0.0);
      float m = smoothstep(0.35, 0.65, progress);
      float r = mix(getFromColor(uv + dir).r, getToColor(uv + dir).r, m);
      float g = mix(getFromColor(uv).g, getToColor(uv).g, m);
      float bCh = mix(getFromColor(uv - dir).b, getToColor(uv - dir).b, m);
      return vec4(r, g, bCh, 1.0);
    }`,
  },
  {
    id: "glitchBreak",
    title: "Glitch Break",
    tip: "Four designed full-frame states hard-cut in turn: RGB ghost, blue mosaic, cyan-green, white",
    category: "Speed & Glitch",
    glsl: `vec4 transition(vec2 uv) {
      float s = floor(progress * 6.0);
      float amt = mix(0.004, 0.012, uFeather);
      if (s < 1.0) { return getFromColor(uv); }
      if (s > 4.0) { return getToColor(uv); }
      if (s < 2.0) {
        vec4 src = getFromColor(uv);
        float r = getFromColor(uv + vec2(amt, 0.0)).r;
        float bl = getFromColor(uv - vec2(amt, 0.0)).b;
        float ghost = dot(getFromColor(uv + vec2(0.0, amt * 3.0)).rgb, vec3(0.333));
        return vec4(mix(vec3(r, src.g, bl), vec3(1.0), ghost * 0.35), 1.0);
      }
      if (s < 3.0) {
        vec2 grid = vec2(6.0 * uRatio, 6.0);
        vec2 q = (floor(uv * grid) + 0.5) / grid;
        float l = dot(mix(getFromColor(q).rgb, getToColor(q).rgb, 0.5), vec3(0.299, 0.587, 0.114));
        return vec4(mix(vec3(0.02, 0.05, 0.25), vec3(0.45, 0.7, 1.0), l), 1.0);
      }
      if (s < 4.0) {
        float l = dot(getToColor(uv).rgb, vec3(0.299, 0.587, 0.114));
        return vec4(mix(vec3(0.0, 0.12, 0.1), vec3(0.4, 1.0, 0.8), l), 1.0);
      }
      return vec4(mix(getToColor(uv).rgb, vec3(1.0), 0.85), 1.0);
    }`,
  },
] as const satisfies readonly TransitionDef[];

export type BuiltinTransitionId = (typeof TRANSITIONS)[number]["id"];

export type ShotTransition = {
  fx: string;
  len: number;
  ease?: TransitionEase;
  feather?: number;
  flip?: boolean;
};

type Shot = { t: number; transition?: ShotTransition };

const bezierCache = new Map<string, (x: number) => number>();
function evalTuple(tuple: readonly [number, number, number, number], x: number) {
  const key = tuple.join(",");
  let fn = bezierCache.get(key);
  if (!fn) {
    fn = BezierEasing(tuple[0], tuple[1], tuple[2], tuple[3]);
    bezierCache.set(key, fn);
  }
  return fn(x);
}

export function transitionProgress(rawProgress: number, ease?: TransitionEase) {
  const u = Math.max(0, Math.min(1, rawProgress));
  if (!ease || ease === "auto" || ease === "linear") return u;
  if (typeof ease !== "string") {
    return ease.length === 4 ? evalTuple([ease[0], ease[1], ease[2], ease[3]], u) : u;
  }
  if (ease === "smooth") return EASES.stdInOut(u);
  if (ease === "snap") return EASES.snapOut(u);
  if (ease === "glide") return EASES.glideOut(u);
  if (ease in EASES) return EASES[ease as keyof typeof EASES](u);
  return u;
}

const normalizeFeather = (feather?: number) =>
  typeof feather === "number" && Number.isFinite(feather) ? Math.max(0, Math.min(1, feather)) : 0.5;

function findTransition(fx: string, extra?: readonly TransitionDef[]): TransitionDef | null {
  return TRANSITIONS.find((x) => x.id === fx) ?? extra?.find((x) => x.id === fx) ?? null;
}

export function transitionLength(
  shots: Shot[],
  end: number,
  i: number,
  extra?: readonly TransitionDef[],
) {
  const tr = shots[i]?.transition;
  if (!i || !tr || !Number.isFinite(tr.len) || tr.len <= 0 || !findTransition(tr.fx, extra)) {
    return 0;
  }
  return Math.max(
    0,
    Math.min(tr.len, shots[i].t - shots[i - 1].t, (shots[i + 1]?.t ?? end) - shots[i].t),
  );
}

export function transitionAt(
  shots: Shot[],
  end: number,
  t: number,
  extra?: readonly TransitionDef[],
) {
  for (let i = 1; i < shots.length; i++) {
    const len = transitionLength(shots, end, i, extra);
    const start = shots[i].t - len / 2;
    if (len > 0 && t >= start && t < start + len) {
      const spec = shots[i].transition!;
      const rawProgress = Math.max(0, Math.min(1, (t - shots[i].t) / len + 0.5));
      const ease =
        !spec.ease || spec.ease === "auto" ? findTransition(spec.fx, extra)?.ease : spec.ease;
      return {
        shot: i,
        rawProgress,
        progress: transitionProgress(rawProgress, ease),
        fx: spec.fx,
        feather: normalizeFeather(spec.feather),
        flip: Boolean(spec.flip),
      };
    }
  }
  return null;
}

// Camera handles hold their boundary pose; actors, lights and sound still use the unchanged film time.
export const viewTime = (shots: Shot[], end: number, i: number, t: number) =>
  Math.max(shots[i].t, Math.min(t, (shots[i + 1]?.t ?? end) - 1e-6));

export function makeTransitions(
  renderer: THREE.WebGLRenderer,
  frame: (t: number, shot?: number) => void,
  shots: () => Shot[],
  end: () => number,
  free: { on: boolean },
  finish?: (t: number) => void,
  enabled?: (cut: number) => boolean,
  extra?: readonly TransitionDef[],
) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const a = new THREE.FramebufferTexture(size.x, size.y);
  const b = new THREE.FramebufferTexture(size.x, size.y);
  a.wrapS = a.wrapT = b.wrapS = b.wrapT = THREE.ClampToEdgeWrapping;

  const catalogue: readonly TransitionDef[] = extra?.length
    ? [...TRANSITIONS, ...extra.filter((x) => !TRANSITIONS.some((b0) => b0.id === x.id))]
    : TRANSITIONS;

  // Lazy-compiled display-referred shaders so startup compiles zero unused WebGL programs.
  const materials = new Map<string, THREE.ShaderMaterial>();
  const materialFor = (def: TransitionDef) => {
    let mat = materials.get(def.id);
    if (!mat) {
      mat = new THREE.ShaderMaterial({
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        uniforms: {
          a: { value: a },
          b: { value: b },
          progress: { value: 0 },
          uRawProgress: { value: 0 },
          uFeather: { value: 0.5 },
          uFlip: { value: 0 },
          uRatio: { value: size.y > 0 ? size.x / size.y : 16 / 9 },
        },
        vertexShader:
          "varying vec2 uvOut; void main() { uvOut = uv; gl_Position = vec4(position.xy, 0., 1.); }",
        fragmentShader: `
          uniform sampler2D a, b;
          uniform float progress, uRawProgress, uFeather, uFlip, uRatio;
          varying vec2 uvOut;
          vec4 getFromColor(vec2 uv) { return texture2D(a, clamp(uv, vec2(0.0005), vec2(0.9995))); }
          vec4 getToColor(vec2 uv) { return texture2D(b, clamp(uv, vec2(0.0005), vec2(0.9995))); }
          ${def.glsl}
          void main() { gl_FragColor = transition(uvOut); }`,
      });
      materials.set(def.id, mat);
    }
    return mat;
  };

  const quad = new FullScreenQuad();
  const draw = (t: number) => {
    const tr = free.on ? null : transitionAt(shots(), end(), t, catalogue);
    const def = tr ? findTransition(tr.fx, catalogue) : null;
    if (!tr || !def || enabled?.(shots()[tr.shot].t) === false) {
      frame(t);
      finish?.(t);
      return;
    }
    renderer.getDrawingBufferSize(size);
    for (const tex of [a, b]) {
      if (tex.image.width !== size.x || tex.image.height !== size.y) {
        tex.dispose();
        tex.image.width = size.x;
        tex.image.height = size.y;
        tex.needsUpdate = true;
      }
    }
    const capture = (shot: number, texture: THREE.FramebufferTexture) => {
      frame(t, shot);
      renderer.setRenderTarget(null);
      renderer.copyFramebufferToTexture(texture);
    };
    // Leave the scene posed from the active shot so picking and studio overlays match the playhead.
    if (t < shots()[tr.shot].t) {
      capture(tr.shot, b);
      capture(tr.shot - 1, a);
    } else {
      capture(tr.shot - 1, a);
      capture(tr.shot, b);
    }
    const material = materialFor(def);
    material.uniforms.progress.value = tr.progress;
    material.uniforms.uRawProgress.value = tr.rawProgress;
    material.uniforms.uFeather.value = tr.feather;
    material.uniforms.uFlip.value = tr.flip ? 1 : 0;
    material.uniforms.uRatio.value = size.y > 0 ? size.x / size.y : 16 / 9;
    quad.material = material;
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    try {
      quad.render(renderer);
    } finally {
      renderer.autoClear = auto;
    }
    finish?.(t);
  };
  draw.transitions = catalogue;
  draw.disposeTransitions = () => {
    a.dispose();
    b.dispose();
    materials.forEach((m) => m.dispose());
    materials.clear();
    quad.dispose();
  };
  return draw;
}
