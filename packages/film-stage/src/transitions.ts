import BezierEasing from "bezier-easing";
import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";

import { EASES } from "./camera-meta";

import { type ShotTransition, type TransitionDef, type TransitionEase, TRANSITIONS } from "./transitions-meta";
export * from "./transitions-meta";

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

// a film's own transition with a built-in's id replaces it, as its own titles and sounds do
function findTransition(fx: string, extra?: readonly TransitionDef[]): TransitionDef | null {
  return extra?.find((x) => x.id === fx) ?? TRANSITIONS.find((x) => x.id === fx) ?? null;
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
    ? [...TRANSITIONS.filter((b0) => !extra.some((x) => x.id === b0.id)), ...extra]
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
