import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";

import type { CameraOptics } from "./animate";

export const VELOCITY_EFFECTS = [
  "flash",
  "hitPunch",
  "blurShake",
  "shutterStreak",
  "fadeBlur",
  "retroZoom",
  "fringeBeat",
  "rainbow",
] as const;
// What each built-in effect does on a beat, as the shader below draws it (the studio's picker, bun run find)
export const VELOCITY_LOOKS: Record<
  (typeof VELOCITY_EFFECTS)[number],
  { title: string; tip: string }
> = {
  flash: {
    title: "Flash",
    tip: "Each beat flashes the frame brighter with a contrast kick, then fades back",
  },
  hitPunch: {
    title: "Hit punch",
    tip: "Each beat punches in about 9% with a crisp contrast lift, fast in and easing back: hits on the kick drum",
  },
  blurShake: {
    title: "Blur shake",
    tip: "Each beat shakes the frame with a jittery blurred jolt that dies out",
  },
  shutterStreak: {
    title: "Shutter streak",
    tip: "Each beat smears the frame in a horizontal motion streak that fades",
  },
  fadeBlur: {
    title: "Fade blur",
    tip: "Each beat swells a soft blur and darkens the frame, then clears: a dreamy pulse",
  },
  retroZoom: {
    title: "Retro zoom",
    tip: "Each beat jumps the frame in about 16% and lets it fall back while red and blue split apart",
  },
  fringeBeat: {
    title: "Edge fringe",
    tip: "Each beat splits red and blue apart toward the frame's edges, the centre stays clean",
  },
  rainbow: {
    title: "Rainbow",
    tip: "Each beat swings red and blue copies of the frame around in a circle: a psychedelic colour wobble",
  },
};
export type VelocityEffect = (typeof VELOCITY_EFFECTS)[number] | (string & {});
export type VelocityFrame = {
  effect: VelocityEffect;
  amount: number;
  phase: number;
  beatIndex?: number;
};
export type CustomVelocityHandler = (
  frame: VelocityFrame,
  baseOptics?: CameraOptics | null,
) => Partial<CameraOptics> | void;

const BUILTIN_MODES: Record<string, number> = {
  blurShake: 1,
  fadeBlur: 2,
  retroZoom: 3,
  flash: 4,
  rainbow: 5,
  hitPunch: 6,
  fringeBeat: 7,
  shutterStreak: 8,
};

const hasOptics = (o?: CameraOptics | null): o is CameraOptics =>
  !!o &&
  (o.blur > 1e-3 ||
    o.exposure > 1e-3 ||
    o.fringe > 1e-3 ||
    Math.abs(o.bulge) > 1e-3 ||
    o.sweep > 1e-3 ||
    Math.hypot(o.smearX ?? 0, o.smearY ?? 0) > 1e-3);

const VERT =
  "varying vec2 uvOut; void main() { uvOut = uv; gl_Position = vec4(position.xy, 0., 1.); }";

// The screen is copied into `source` once, then every shader below reads it (and the blur of it) and writes over the canvas.
// No EffectComposer pass is used: its passes expect a render target chain and their materials carry three's output color
// conversion, which turned a straight copy of the screen into a washed-out frame under r187.
export function makeVelocity(
  renderer: THREE.WebGLRenderer,
  extra?: Record<string, CustomVelocityHandler>,
) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const source = new THREE.FramebufferTexture(size.x, size.y);
  source.colorSpace = THREE.NoColorSpace;
  source.minFilter = THREE.LinearFilter; // the downsample reads it at half res, so let the GPU average the texels
  source.magFilter = THREE.LinearFilter;
  const targetOpts = {
    depthBuffer: false,
    stencilBuffer: false,
    type: THREE.UnsignedByteType,
    colorSpace: THREE.NoColorSpace,
  };
  const blurA = new THREE.WebGLRenderTarget(
    Math.max(1, Math.round(size.x / 2)),
    Math.max(1, Math.round(size.y / 2)),
    targetOpts,
  );
  const blurB = new THREE.WebGLRenderTarget(blurA.width, blurA.height, targetOpts);
  const composed = new THREE.WebGLRenderTarget(size.x, size.y, targetOpts); // velocity output, when the lens runs after it
  const quad = new FullScreenQuad();

  const downMaterial = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      tex: { value: source },
      texel: { value: new THREE.Vector2(1 / size.x, 1 / size.y) },
    },
    vertexShader: VERT,
    fragmentShader: `
      uniform sampler2D tex;
      uniform vec2 texel;
      varying vec2 uvOut;
      void main() {
        vec4 c = texture2D(tex, uvOut + vec2(-texel.x, -texel.y))
               + texture2D(tex, uvOut + vec2( texel.x, -texel.y))
               + texture2D(tex, uvOut + vec2(-texel.x,  texel.y))
               + texture2D(tex, uvOut + vec2( texel.x,  texel.y));
        gl_FragColor = c * .25;
      }`,
  });

  const blurMaterial = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    uniforms: { tex: { value: null }, offset: { value: new THREE.Vector2() } },
    vertexShader: VERT,
    fragmentShader: `
      uniform sampler2D tex;
      uniform vec2 offset;
      varying vec2 uvOut;
      void main() {
        vec4 c = texture2D(tex, uvOut + offset)
               + texture2D(tex, uvOut - offset)
               + texture2D(tex, uvOut + vec2(offset.x, -offset.y))
               + texture2D(tex, uvOut + vec2(-offset.x, offset.y));
        gl_FragColor = c * .25;
      }`,
  });

  const material = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      baseTex: { value: source },
      blurTex: { value: blurA.texture },
      mode: { value: 0 },
      amount: { value: 0 },
      phase: { value: 0 },
      sign: { value: 1 },
      flash: { value: new THREE.Vector2() },
      chroma: { value: new THREE.Vector2() },
    },
    vertexShader: VERT,
    fragmentShader: `
      uniform sampler2D baseTex, blurTex;
      uniform int mode;
      uniform float amount, phase, sign;
      uniform vec2 flash, chroma;
      varying vec2 uvOut;
      vec2 clampUv(vec2 p) { return clamp(p, vec2(.001), vec2(.999)); }
      void main() {
        float w = clamp(amount, 0., 1.);
        if (mode == 1) {
          float env = (1. - phase) * (1. - phase) * w;
          vec2 shift = vec2(sin(phase * 38.) * .018 * sign, cos(phase * 51.) * .011) * env;
          vec2 p = clampUv(.5 + (uvOut - .5 + shift) / (1. + .045 * env));
          gl_FragColor = mix(texture2D(baseTex, p), texture2D(blurTex, p), clamp(env * .92, 0., 1.));
          return;
        }
        if (mode == 2) {
          float env = sin(phase * 3.14159265) * w;
          vec4 col = mix(texture2D(baseTex, uvOut), texture2D(blurTex, uvOut), clamp(env * .9, 0., 1.));
          gl_FragColor = vec4(col.rgb * (1. - .38 * env), col.a);
          return;
        }
        if (mode == 4) {
          vec3 col = texture2D(baseTex, uvOut).rgb + flash.x;
          gl_FragColor = vec4(clamp((col - .5) * (1. + flash.y) + .5, 0., 1.), 1.);
          return;
        }
        if (mode == 5) {
          vec3 col = vec3(
            texture2D(baseTex, clampUv(uvOut + chroma)).r,
            texture2D(baseTex, uvOut).g,
            texture2D(baseTex, clampUv(uvOut - chroma)).b);
          gl_FragColor = vec4(col, 1.);
          return;
        }
        if (mode == 6) {
          float pulse = phase < .18 ? (phase / .18) : pow(max(0., 1. - (phase - .18) / .82), 1.8);
          float z = pow(1.095, pulse * w);
          vec2 p = clampUv(.5 + (uvOut - .5) / z);
          vec4 base = texture2D(baseTex, p);
          vec3 crisp = clamp((base.rgb - .5) * (1. + .22 * pulse * w) + .5 + vec3(.04 * pulse * w), 0., 1.);
          gl_FragColor = vec4(crisp, base.a);
          return;
        }
        if (mode == 7) {
          float env = pow(1. - phase, 1.8) * w;
          vec2 d = uvOut - .5;
          float edge = clamp(dot(d, d) * 3.2, 0., 1.);
          vec2 split = (d * .065 + vec2(.008 * sign, .003)) * env * edge;
          vec3 col = vec3(
            texture2D(baseTex, clampUv(uvOut + split)).r,
            texture2D(baseTex, uvOut).g,
            texture2D(baseTex, clampUv(uvOut - split)).b);
          gl_FragColor = vec4(col, 1.);
          return;
        }
        if (mode == 8) {
          float env = pow(1. - phase, 1.5) * w;
          vec2 dir = normalize(vec2(1., .24 * sign)) * (.022 * env);
          vec4 acc = (texture2D(baseTex, clampUv(uvOut - dir * 1.5))
                    + texture2D(baseTex, clampUv(uvOut - dir * 0.5))
                    + texture2D(baseTex, clampUv(uvOut + dir * 0.5))
                    + texture2D(baseTex, clampUv(uvOut + dir * 1.5))) * .25;
          gl_FragColor = vec4(clamp(acc.rgb * (1. + .12 * env), 0., 1.), acc.a);
          return;
        }
        float z = 1. + .16 * pow(1. - phase, 1.35) * w;
        vec2 d = (uvOut - .5) / z;
        vec2 shift = d * (.04 * w * (1. - phase));
        vec4 r = texture2D(baseTex, clampUv(.5 + d + shift));
        vec4 g = texture2D(baseTex, clampUv(.5 + d));
        vec4 b = texture2D(baseTex, clampUv(.5 + d - shift));
        vec3 col = vec3(r.r, g.g, b.b) + vec3(.08, .05, .01) * w * (1. - phase);
        gl_FragColor = vec4(clamp(col, 0., 1.), g.a);
      }`,
  });

  const opticsMaterial = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      baseTex: { value: source },
      blurTex: { value: blurA.texture },
      blur: { value: 0 },
      exposure: { value: 0 },
      fringe: { value: 0 },
      bulge: { value: 0 },
      sweep: { value: 0 },
      sweepPos: { value: 0.5 },
      uSmear: { value: new THREE.Vector2() },
    },
    vertexShader: VERT,
    fragmentShader: `
      uniform sampler2D baseTex, blurTex;
      uniform float blur, exposure, fringe, bulge, sweep, sweepPos;
      uniform vec2 uSmear;
      varying vec2 uvOut;
      vec2 clampUv(vec2 p) { return clamp(p, vec2(.001), vec2(.999)); }
      vec4 sampleTap(vec2 p, float bMix) {
        vec2 u = clampUv(p);
        return bMix > 0.001 ? mix(texture2D(baseTex, u), texture2D(blurTex, u), bMix) : texture2D(baseTex, u);
      }
      vec4 sampleMix(vec2 p, float bMix) {
        vec4 base = sampleTap(p, bMix);
        if (length(uSmear) > 0.001) {
          vec2 stepUv = uSmear * 0.024;
          base = (sampleTap(p - stepUv * 1.5, bMix)
                + sampleTap(p - stepUv * 0.5, bMix)
                + sampleTap(p + stepUv * 0.5, bMix)
                + sampleTap(p + stepUv * 1.5, bMix)) * 0.25;
        }
        return base;
      }
      void main() {
        vec2 d = uvOut - 0.5;
        float r2 = dot(d, d);
        vec2 warped = 0.5 + d * (1.0 + bulge * r2 * 1.65) / max(0.35, 1.0 + bulge * 0.28);
        float bMix = clamp(blur * 1.15, 0.0, 1.0);
        vec2 shift = (d * 0.032 + vec2(0.009, 0.002)) * fringe;
        vec4 cr = sampleMix(warped + shift, bMix);
        vec4 cg = sampleMix(warped, bMix);
        vec4 cb = sampleMix(warped - shift, bMix);
        vec3 col = vec3(cr.r, cg.g, cb.b);
        if (exposure > 0.001) {
          col = col * (1.0 + exposure * 1.35) + vec3(exposure * exposure * 0.88);
        }
        if (sweep > 0.001) {
          float diag = (warped.x * 0.72 + (1.0 - warped.y) * 0.52);
          float band = exp(-pow((diag - sweepPos * 1.24) * 5.2, 2.0));
          col += vec3(1.0, 0.97, 0.9) * (band * sweep * 0.65);
        }
        gl_FragColor = vec4(clamp(col, 0.0, 1.0), cg.a);
      }`,
  });

  const ensureSize = () => {
    renderer.getDrawingBufferSize(size);
    if (source.image.width !== size.x || source.image.height !== size.y) {
      source.dispose();
      source.image.width = size.x;
      source.image.height = size.y;
      source.needsUpdate = true;
      const w = Math.max(1, Math.round(size.x / 2)),
        h = Math.max(1, Math.round(size.y / 2));
      blurA.setSize(w, h);
      blurB.setSize(w, h);
      composed.setSize(size.x, size.y);
    }
  };

  // The blur the frame or the lens asks for, made by hand: a 2x downsample, then two box passes whose reach grows with the
  // amount (each pass is one tap pair per axis, so the last one lands at a defocus radius of about 3.5% of the frame).
  const blur = (amount: number, input: THREE.Texture = source) => {
    downMaterial.uniforms.tex.value = input;
    downMaterial.uniforms.texel.value.set(1 / size.x, 1 / size.y);
    quad.material = downMaterial;
    renderer.setRenderTarget(blurA);
    quad.render(renderer);
    const w = Math.max(1, blurA.width),
      h = Math.max(1, blurA.height);
    quad.material = blurMaterial;
    for (let i = 0; i < 2; i++) {
      const step = (amount * (1.4 + i * 1.6) + 0.6) / w;
      blurMaterial.uniforms.tex.value = blurA.texture;
      blurMaterial.uniforms.offset.value.set(step, 0);
      renderer.setRenderTarget(blurB);
      quad.render(renderer);
      blurMaterial.uniforms.tex.value = blurB.texture;
      blurMaterial.uniforms.offset.value.set(0, step * (w / h));
      renderer.setRenderTarget(blurA);
      quad.render(renderer);
    }
  };

  const drawOptics = (target: THREE.WebGLRenderTarget | null, opts: CameraOptics) => {
    const u = opticsMaterial.uniforms;
    u.baseTex.value = source;
    u.blurTex.value = blurA.texture;
    u.exposure.value = Math.min(1, Math.max(0, opts.exposure));
    u.fringe.value = Math.min(1, Math.max(0, opts.fringe));
    u.bulge.value = Math.min(1, Math.max(-1, opts.bulge));
    u.sweep.value = Math.min(1, Math.max(0, opts.sweep));
    u.sweepPos.value = Math.min(1, Math.max(0, opts.sweepPos));
    u.uSmear.value.set(
      Math.min(1.5, Math.max(-1.5, opts.smearX ?? 0)),
      Math.min(1.5, Math.max(-1.5, opts.smearY ?? 0)),
    );
    quad.material = opticsMaterial;
    renderer.setRenderTarget(target);
    quad.render(renderer);
  };

  const drawVelocity = (
    frame: VelocityFrame,
    mode: number,
    base: THREE.Texture,
    w: number,
    p: number,
  ) => {
    const u = material.uniforms;
    const bi = Number.isFinite(frame.beatIndex) ? (frame.beatIndex as number) : 0;
    u.baseTex.value = base;
    u.mode.value = mode;
    u.amount.value = w;
    u.phase.value = p;
    u.sign.value = bi % 2 ? -1 : 1;
    u.blurTex.value = blurA.texture;
    if (mode === 4) {
      const env = (1 - p) * (1 - p) * w;
      u.flash.value.set(0.46 * env, 0.18 * env);
    } else if (mode === 5) {
      const angle = bi * 1.7 + p * 6.2831853,
        radius = 0.012 * Math.sin(p * Math.PI) * w;
      u.chroma.value.set(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
    quad.material = material;
    renderer.setRenderTarget(null);
    quad.render(renderer);
  };

  const draw = (frame: VelocityFrame | null, optics?: CameraOptics | null) => {
    const activeFrame = frame && frame.amount > 1e-3 ? frame : null;
    const customFn = activeFrame ? extra?.[activeFrame.effect] : undefined;
    let effOptics: CameraOptics | null | undefined = optics;
    if (activeFrame && customFn) {
      const cw = Math.min(1, Math.max(0, activeFrame.amount));
      const cp = Math.min(1, Math.max(0, activeFrame.phase));
      const cbi = Number.isFinite(activeFrame.beatIndex) ? (activeFrame.beatIndex as number) : 0;
      const patch = customFn({ ...activeFrame, amount: cw, phase: cp, beatIndex: cbi }, optics);
      if (patch) {
        effOptics = {
          blur: (optics?.blur ?? 0) + (patch.blur ?? 0),
          exposure: (optics?.exposure ?? 0) + (patch.exposure ?? 0),
          fringe: (optics?.fringe ?? 0) + (patch.fringe ?? 0),
          bulge: (optics?.bulge ?? 0) + (patch.bulge ?? 0),
          sweep: Math.max(optics?.sweep ?? 0, patch.sweep ?? 0),
          sweepPos: patch.sweepPos ?? optics?.sweepPos ?? 0.5,
          smearX: (optics?.smearX ?? 0) + (patch.smearX ?? 0),
          smearY: (optics?.smearY ?? 0) + (patch.smearY ?? 0),
        };
      }
    }
    const builtinMode = activeFrame && !customFn ? BUILTIN_MODES[activeFrame.effect] : undefined;
    const runVel = builtinMode !== undefined;
    const runOpt = hasOptics(effOptics);
    if (!runVel && !runOpt) return;
    ensureSize();
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    try {
      renderer.setRenderTarget(null);
      renderer.copyFramebufferToTexture(source);
      const w = runVel && activeFrame ? Math.min(1, Math.max(0, activeFrame.amount)) : 0;
      const p = runVel && activeFrame ? Math.min(1, Math.max(0, activeFrame.phase)) : 0;
      const velBlur = runVel && (builtinMode === 1 || builtinMode === 2) ? w : 0;
      const lensBlur = runOpt ? Math.min(1, Math.max(0, effOptics!.blur)) : 0;
      if (runOpt) {
        opticsMaterial.uniforms.blur.value = lensBlur;
        if (lensBlur > 1e-3) blur(lensBlur, source);
      }
      // The lens looks at the scene first, then the frame effect rides on top of what the lens produced: a whip flash or
      // colour split must not be swallowed by a lens blur that was mixed from the untouched frame.
      if (runVel && activeFrame) {
        if (runOpt) {
          drawOptics(composed, effOptics!);
          if (velBlur > 1e-3) blur(velBlur, composed.texture);
          drawVelocity(activeFrame, builtinMode, composed.texture, w, p);
        } else {
          if (velBlur > 1e-3) blur(velBlur, source);
          drawVelocity(activeFrame, builtinMode, source, w, p);
        }
      } else {
        drawOptics(null, effOptics!);
      }
    } finally {
      renderer.setRenderTarget(null);
      renderer.autoClear = auto;
    }
  };
  draw.effects = [
    ...VELOCITY_EFFECTS,
    ...Object.keys(extra ?? {}).filter((k) => !(k in BUILTIN_MODES)),
  ];
  draw.disposeVelocity = () => {
    source.dispose();
    blurA.dispose();
    blurB.dispose();
    composed.dispose();
    downMaterial.dispose();
    blurMaterial.dispose();
    material.dispose();
    opticsMaterial.dispose();
    quad.dispose();
  };
  return draw;
}
