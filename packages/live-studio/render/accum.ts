// A clip frame's sub-frames (motion blur) averaged as light, in 32-bit float on the GPU. Blending them on a 2D canvas kept 8
// bits after every sample (a 1/16 share rounds away) and averaged sRGB codes, which darkens anything bright that moves.
const VERT = `#version 300 es
void main() { gl_Position = vec4(gl_VertexID == 1 ? 3. : -1., gl_VertexID == 2 ? 3. : -1., 0., 1.); }`;
// the picture's sRGB codes to linear light; alpha counts the samples
const ADD = `#version 300 es
precision highp float;
uniform sampler2D sum, pic;
out vec4 o;
float dec(float c) { return c <= .04045 ? c / 12.92 : pow((c + .055) / 1.055, 2.4); }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 c = texelFetch(pic, p, 0).rgb;
  o = texelFetch(sum, p, 0) + vec4(dec(c.r), dec(c.g), dec(c.b), 1.);
}`;
// back to sRGB with under half a code of noise, so a soft blur between two 8-bit steps does not band
const RESOLVE = `#version 300 es
precision highp float;
uniform sampler2D sum;
out vec4 o;
float enc(float c) { return c <= .0031308 ? 12.92 * c : 1.055 * pow(c, 1. / 2.4) - .055; }
void main() {
  vec4 s = texelFetch(sum, ivec2(gl_FragCoord.xy), 0);
  vec3 c = s.rgb / max(s.a, 1.);
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - .5;
  o = vec4(vec3(enc(c.r), enc(c.g), enc(c.b)) + n * .98 / 255., 1.);
}`;

/**
 * With `gl` (the film's own context, draw.tools.renderer) each add() takes what was just drawn on its canvas and resolve()
 * draws the average back there, all on the GPU; `after` hands the context back (three's renderer.resetState). Without
 * it, a context of its own copies each picture in, a readback per sample: many times slower at 1440p.
 */
export const makeAccumulator = (
  w: number,
  h: number,
  shared?: WebGL2RenderingContext,
  after: () => void = () => {},
) => {
  const canvas = shared ? null : document.createElement("canvas");
  if (canvas) {
    canvas.width = w;
    canvas.height = h;
  }
  const gl =
    shared ??
    canvas!.getContext("webgl2", {
      antialias: false,
      depth: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });
  if (!gl?.getExtension("EXT_color_buffer_float"))
    throw new Error(
      "motion blur (SAMPLES over 1) needs WebGL2 float render targets in this Chrome",
    );
  const program = (frag: string) => {
    const p = gl.createProgram()!;
    for (const [type, src] of [
      [gl.VERTEX_SHADER, VERT],
      [gl.FRAGMENT_SHADER, frag],
    ] as const) {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)!);
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    return p;
  };
  const add = program(ADD),
    resolve = program(RESOLVE);
  const target = (format: number) => {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, w, h);
    // a float32 texture left on the default (linear) filter is incomplete, and reads as black
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { t, fb };
  };
  const pic = target(gl.RGBA8);
  // ping-pong: a float32 target cannot be blended into everywhere, so each sample reads one sum and writes the other
  const sums = [target(gl.RGBA32F), target(gl.RGBA32F)];
  let cur = 0;
  after();
  // the state these passes need, whatever the film left set
  const ready = (p: WebGLProgram, textures: [string, WebGLTexture][]) => {
    for (const cap of [gl.BLEND, gl.DEPTH_TEST, gl.STENCIL_TEST, gl.SCISSOR_TEST, gl.CULL_FACE])
      gl.disable(cap);
    gl.colorMask(true, true, true, true);
    gl.bindVertexArray(null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(p);
    textures.forEach(([name, t], unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(gl.getUniformLocation(p, name), unit);
    });
  };
  return {
    reset() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, sums[cur]!.fb);
      gl.colorMask(true, true, true, true);
      gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      after();
    },
    // texel rows count from the bottom, as gl_FragCoord does: the canvas's picture is drawn that way, a copied one flipped
    add(source?: TexImageSource) {
      if (shared) {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, pic.fb);
        gl.disable(gl.SCISSOR_TEST);
        gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      } else {
        gl.bindTexture(gl.TEXTURE_2D, pic.t);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, source!);
      }
      ready(add, [
        ["sum", sums[cur]!.t],
        ["pic", pic.t],
      ]);
      cur ^= 1;
      gl.bindFramebuffer(gl.FRAMEBUFFER, sums[cur]!.fb);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      after();
    },
    resolve() {
      ready(resolve, [["sum", sums[cur]!.t]]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      after();
      return gl.canvas as HTMLCanvasElement;
    },
  };
};
