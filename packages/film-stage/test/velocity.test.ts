import { expect, test } from "bun:test";

import * as THREE from "three";

import { makeVelocity, VELOCITY_EFFECTS } from "../src/velocity";

function fakeRenderer(w = 640, h = 360) {
  let copies = 0;
  const targets: (THREE.WebGLRenderTarget | null)[] = [];
  const rendered: THREE.Material[] = [];
  const renderer = {
    autoClear: true,
    getDrawingBufferSize: (out: THREE.Vector2) => out.set(w, h),
    getRenderTarget: () => targets.at(-1) ?? null,
    setRenderTarget: (rt: THREE.WebGLRenderTarget | null) => {
      targets.push(rt);
    },
    copyFramebufferToTexture: () => {
      copies++;
    },
    render: (scene: THREE.Scene) => {
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.material) rendered.push(mesh.material as THREE.Material);
      });
    },
  } as unknown as THREE.WebGLRenderer;
  return { renderer, getCopies: () => copies, targets, rendered };
}

test("makeVelocity bypasses offscreen render targets on clean frames and runs directional smear + optics pass when active", () => {
  const { renderer, getCopies, targets, rendered } = fakeRenderer();
  const vel = makeVelocity(renderer);

  // Neutral optics + null accent: zero framebuffer copies or offscreen passes
  vel(null, {
    blur: 0,
    exposure: 0,
    fringe: 0,
    bulge: 0,
    sweep: 0,
    sweepPos: 0.5,
    smearX: 0,
    smearY: 0,
  });
  expect(getCopies()).toBe(0);
  expect(targets.length).toBe(0);
  expect(rendered.length).toBe(0);

  // Directional smear alone triggers the optics shader pass with uSmear populated
  vel(null, {
    blur: 0,
    exposure: 0,
    fringe: 0,
    bulge: 0,
    sweep: 0,
    sweepPos: 0.5,
    smearX: 0.75,
    smearY: -0.25,
  });
  expect(getCopies()).toBe(1);
  expect(rendered.length).toBe(1);
  const shader = rendered[0] as THREE.ShaderMaterial;
  expect(shader.fragmentShader).toContain("uSmear");
  expect((shader.uniforms.uSmear.value as THREE.Vector2).toArray()).toEqual([0.75, -0.25]);

  vel.disposeVelocity();
});

test("makeVelocity supports Cinetic beat accents (hitPunch, fringeBeat, shutterStreak) and guards missing beatIndex from NaN", () => {
  expect(VELOCITY_EFFECTS).toEqual([
    "flash",
    "hitPunch",
    "blurShake",
    "shutterStreak",
    "fadeBlur",
    "retroZoom",
    "fringeBeat",
    "rainbow",
  ]);
  const { renderer, rendered } = fakeRenderer();
  const vel = makeVelocity(renderer);

  for (const effect of VELOCITY_EFFECTS) {
    rendered.length = 0;
    // Also exercise omitted beatIndex runtime safety
    vel({ effect, amount: 0.7, phase: 0.25, beatIndex: undefined as unknown as number }, null);
    expect(rendered.length).toBeGreaterThanOrEqual(1);
    const mat = rendered.at(-1) as THREE.ShaderMaterial;
    expect(Number.isFinite(mat.uniforms.sign.value as number)).toBe(true);
    const ch = mat.uniforms.chroma.value as THREE.Vector2;
    expect(Number.isFinite(ch.x) && Number.isFinite(ch.y)).toBe(true);
  }

  vel.disposeVelocity();
});

test("makeVelocity passes through unknown custom beat effects cleanly (never silent retroZoom) and runs registered extra beat effects", () => {
  const { renderer, getCopies, rendered } = fakeRenderer();
  const plain = makeVelocity(renderer);

  // Unknown custom beat effect without optics: no-op instead of silently running retroZoom (mode 3)
  plain({ effect: "customStrobe", amount: 0.8, phase: 0.3, beatIndex: 1 }, null);
  expect(getCopies()).toBe(0);
  expect(rendered.length).toBe(0);

  // Unknown custom beat effect WITH camera optics: runs only the optics pass, never mode 3 velocity shader
  plain(
    { effect: "customStrobe", amount: 0.8, phase: 0.3, beatIndex: 1 },
    { blur: 0, exposure: 0.5, fringe: 0, bulge: 0, sweep: 0, sweepPos: 0.5 },
  );
  expect(rendered.length).toBe(1);
  expect((rendered[0] as THREE.ShaderMaterial).uniforms.mode).toBeUndefined();
  plain.disposeVelocity();

  // Registered custom beat effect via extra map drives optics/builtin modulation cleanly
  rendered.length = 0;
  const custom = makeVelocity(renderer, {
    customStrobe: ({ amount, phase }) => ({ exposure: amount * (1 - phase), fringe: 0.4 * amount }),
  });
  custom({ effect: "customStrobe", amount: 0.5, phase: 0.2, beatIndex: 2 }, null);
  expect(rendered.length).toBe(1);
  const optMat = rendered[0] as THREE.ShaderMaterial;
  expect(optMat.uniforms.exposure.value).toBeCloseTo(0.4, 5);
  expect(optMat.uniforms.fringe.value).toBeCloseTo(0.2, 5);
  custom.disposeVelocity();
});
