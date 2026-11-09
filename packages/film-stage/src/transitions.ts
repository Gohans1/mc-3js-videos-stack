import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import fade from "gl-transitions/transitions/Fade.glsl?raw";
import fadeColor from "gl-transitions/transitions/FadeColor.glsl?raw";
import wipe from "gl-transitions/transitions/DirectionalWipe.glsl?raw";

export const TRANSITIONS = [
  { id: "dissolve", title: "Dissolve", tip: "Blend the two camera views across the cut" },
  { id: "black", title: "Black Fade", tip: "Fade out, cut in black, then fade in" },
  { id: "white", title: "White Flash", tip: "Fade through white at the cut" },
  { id: "wipe", title: "Wipe right", tip: "Reveal the next view from left to right" },
] as const;
type Fx = typeof TRANSITIONS[number]["id"];
type Shot = { t: number; transition?: { fx: string; len: number } };

export function transitionLength(shots: Shot[], end: number, i: number) {
  const tr = shots[i]?.transition;
  if (!i || !tr || !Number.isFinite(tr.len) || tr.len <= 0 || !TRANSITIONS.some((x) => x.id === tr.fx)) return 0;
  return Math.max(0, Math.min(tr.len, shots[i].t - shots[i - 1].t, (shots[i + 1]?.t ?? end) - shots[i].t));
}

export function transitionAt(shots: Shot[], end: number, t: number) {
  for (let i = 1; i < shots.length; i++) {
    const len = transitionLength(shots, end, i), start = shots[i].t - len / 2;
    if (len > 0 && t >= start && t < start + len) return { shot: i, progress: (t - start) / len, fx: shots[i].transition!.fx as Fx };
  }
  return null;
}

// Camera handles hold their boundary pose; actors, lights and sound still use the unchanged film time.
export const viewTime = (shots: Shot[], end: number, i: number, t: number) => Math.max(shots[i].t, Math.min(t, (shots[i + 1]?.t ?? end) - 1e-6));

export function makeTransitions(renderer: THREE.WebGLRenderer, frame: (t: number, shot?: number) => void, shots: () => Shot[], end: () => number, free: { on: boolean }) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const a = new THREE.FramebufferTexture(size.x, size.y), b = new THREE.FramebufferTexture(size.x, size.y);
  // These are already display-referred framebuffer pixels: no second tone map or output colour conversion.
  const materials = [fade, fadeColor, fadeColor, wipe].map((glsl, i) => new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: { a: { value: a }, b: { value: b }, progress: { value: 0 }, color: { value: new THREE.Vector4(i === 2 ? 1 : 0, i === 2 ? 1 : 0, i === 2 ? 1 : 0, 1) }, colorPhase: { value: 0.5 }, direction: { value: new THREE.Vector2(1, 0) }, smoothness: { value: 0.001 } },
    vertexShader: "varying vec2 uvOut; void main() { uvOut = uv; gl_Position = vec4(position.xy, 0., 1.); }",
    fragmentShader: `
      uniform sampler2D a, b;
      uniform float progress;
      varying vec2 uvOut;
      vec4 getFromColor(vec2 uv) { return texture2D(a, uv); }
      vec4 getToColor(vec2 uv) { return texture2D(b, uv); }
      ${glsl}
      void main() { gl_FragColor = transition(uvOut); }`,
  }));
  const quad = new FullScreenQuad(materials[0]);
  const draw = (t: number) => {
    const tr = free.on ? null : transitionAt(shots(), end(), t);
    if (!tr) { frame(t); return; }
    renderer.getDrawingBufferSize(size);
    for (const tex of [a, b]) if (tex.image.width !== size.x || tex.image.height !== size.y) {
      tex.dispose(); tex.image.width = size.x; tex.image.height = size.y; tex.needsUpdate = true;
    }
    const capture = (shot: number, texture: THREE.FramebufferTexture) => {
      frame(t, shot);
      renderer.setRenderTarget(null);
      renderer.copyFramebufferToTexture(texture);
    };
    // Leave the scene posed from the active shot so picking and studio overlays match the playhead.
    if (t < shots()[tr.shot].t) { capture(tr.shot, b); capture(tr.shot - 1, a); }
    else { capture(tr.shot - 1, a); capture(tr.shot, b); }
    const material = materials[TRANSITIONS.findIndex((x) => x.id === tr.fx)];
    material.uniforms.progress.value = tr.progress;
    quad.material = material;
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    try { quad.render(renderer); } finally { renderer.autoClear = auto; }
  };
  draw.transitions = TRANSITIONS;
  draw.disposeTransitions = () => { a.dispose(); b.dispose(); materials.forEach((m) => m.dispose()); quad.dispose(); };
  return draw;
}
