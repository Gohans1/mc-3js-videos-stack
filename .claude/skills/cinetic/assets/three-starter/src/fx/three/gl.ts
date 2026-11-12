// Which WebGL tier a runtime provides, read once: 'gpu' (hardware WebGL with float/half-float targets),
// 'software' (SwiftShader, llvmpipe, WARP) or 'none' (no context / Node).
// Node-safe: without a document the tier is 'none'. Pure per machine: the same page always gets the same tier.

export type GlTier = "gpu" | "software" | "none";
/** 'auto' (hardware GPU WebGL required) or 'force' (render 3D whenever any WebGL context exists, including software GL). */
export type GlMode = "auto" | "force";

const SOFTWARE = /swiftshader|llvmpipe|softpipe|lavapipe|software|basic render|warp/i;
let tier: GlTier | null = null;

/** The page's GL tier, probed once with a throwaway context (released at once). */
export const glTier = (): GlTier => {
  if (tier) return tier;
  if (typeof document === "undefined") return "none";
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") ?? c.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return (tier = "none");
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String(
      info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    );
    const halfFloat =
      !!(gl as WebGL2RenderingContext).getExtension?.("EXT_color_buffer_float") ||
      !!gl.getExtension("EXT_color_buffer_half_float");
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    tier = SOFTWARE.test(name) ? "software" : halfFloat ? "gpu" : "none";
  } catch {
    tier = "none";
  }
  return tier;
};

/** True when hardware (or forced software) WebGL is available under `mode`. */
export const draws3D = (mode: GlMode = "auto"): boolean => {
  const t = glTier();
  return mode === "force" ? t !== "none" : t === "gpu";
};
