export function parseCropRect(spec) {
  if (typeof spec === "object" && spec !== null && !Array.isArray(spec)) {
    return validateCropRect(spec);
  }
  const raw = String(spec ?? "").trim();
  if (!raw) throw new Error("Crop must be 4 numbers x,y,w,h (normalized 0..1)");
  const parts = raw.split(",").map((s) => Number(s.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(
      `Crop must be 4 numbers x,y,w,h (normalized 0..1), got ${JSON.stringify(spec)}`,
    );
  }
  const [x, y, w, h] = parts;
  return validateCropRect({ x, y, w, h });
}

function validateCropRect({ x, y, w, h }) {
  if (!Number.isFinite(x) || x < 0 || x > 1) {
    throw new Error(`Crop x must be in 0..1, got ${x}`);
  }
  if (!Number.isFinite(y) || y < 0 || y > 1) {
    throw new Error(`Crop y must be in 0..1, got ${y}`);
  }
  if (!Number.isFinite(w) || w <= 0 || w > 1) {
    throw new Error(`Crop w must be in (0, 1], got ${w}`);
  }
  if (!Number.isFinite(h) || h <= 0 || h > 1) {
    throw new Error(`Crop h must be in (0, 1], got ${h}`);
  }
  if (x + w > 1 + 1e-6 || y + h > 1 + 1e-6) {
    throw new Error(`Crop rectangle x+w and y+h must fit within 0..1, got ${x}+${w}, ${y}+${h}`);
  }
  return { x, y, w, h };
}

export function computeCropView(fullWidth, fullHeight, rect) {
  const { x, y, w, h } = validateCropRect(rect);
  const scale = Math.max(w, h);
  return {
    fullWidth,
    fullHeight,
    offsetX: Math.round(x * fullWidth),
    offsetY: Math.round(y * fullHeight),
    viewWidth: Math.max(1, Math.round(fullWidth * scale)),
    viewHeight: Math.max(1, Math.round(fullHeight * scale)),
    outWidth: Math.max(1, Math.round((fullWidth * w) / scale)),
    outHeight: Math.max(1, Math.round((fullHeight * h) / scale)),
    scale,
  };
}

export function withCropViewOffset(camera, fullWidth, fullHeight, rect, fn) {
  const view = computeCropView(fullWidth, fullHeight, rect);
  const canOffset = typeof camera?.setViewOffset === "function";
  const prevView = camera?.view ? { ...camera.view } : null;

  const restore = () => {
    if (!canOffset) return;
    if (prevView?.enabled) {
      camera.setViewOffset(
        prevView.fullWidth,
        prevView.fullHeight,
        prevView.offsetX,
        prevView.offsetY,
        prevView.width,
        prevView.height,
      );
    } else if (typeof camera.clearViewOffset === "function") {
      camera.clearViewOffset();
    } else if (camera.view) {
      camera.view.enabled = false;
      camera.updateProjectionMatrix?.();
    }
  };

  if (canOffset) {
    camera.setViewOffset(
      view.fullWidth,
      view.fullHeight,
      view.offsetX,
      view.offsetY,
      view.viewWidth,
      view.viewHeight,
    );
  }

  try {
    const result = fn(view);
    if (result && typeof result.then === "function") {
      return result.finally(restore);
    }
    restore();
    return result;
  } catch (err) {
    restore();
    throw err;
  }
}
