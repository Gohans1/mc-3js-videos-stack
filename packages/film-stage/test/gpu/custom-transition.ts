import * as THREE from "three";

import { makeTransitions } from "../../src/transitions";

Object.assign(window, {
  customTransitionProbe() {
    const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
    renderer.setSize(64, 64, false);
    let params: { intensity?: number } | undefined;
    const draw = makeTransitions(
      renderer,
      () => {
        renderer.setClearColor(0);
        renderer.clear();
      },
      () => [{ t: 0 }, { t: 1, transition: { fx: "own", len: 1, params } }],
      () => 2,
      { on: false },
      undefined,
      undefined,
      [
        {
          id: "own",
          title: "Own",
          category: "Film",
          tip: "",
          uniforms: { intensity: 0.25 },
          glsl: "uniform float intensity; vec4 transition(vec2 uv){ return vec4(intensity, 0., 0., 1.); }",
        },
      ],
    );
    const pixel = () => {
      draw(1);
      const gl = renderer.getContext(),
        data = new Uint8Array(4);
      gl.readPixels(32, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
      return data[0];
    };
    try {
      const source = pixel();
      params = JSON.parse(JSON.stringify({ intensity: 0.75 }));
      const edited = pixel();
      params = undefined;
      return [source, edited, pixel()];
    } finally {
      draw.disposeTransitions();
      renderer.dispose();
    }
  },
});
