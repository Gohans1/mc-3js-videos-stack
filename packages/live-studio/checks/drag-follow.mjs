// Browser probe: call while holding one audio clip; compare rendered pixels with the original pointer grab offset.
export function checkAudioDrag(pointerY, grabOffsetY) {
  const canvas = document.querySelector('canvas[aria-label^="Audio tracks"]');
  const rect = canvas.getBoundingClientRect();
  const { data, width, height } = canvas
    .getContext("2d")
    .getImageData(0, 0, canvas.width, canvas.height);
  const scale = rect.height / height,
    edges = [];
  for (let y = 0; y < height; y++) {
    let run = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      run = data[i] > 245 && data[i + 1] > 245 && data[i + 2] > 245 ? run + 1 : 0;
      if (run * scale >= 14) {
        edges.push(rect.top + y * scale);
        break;
      }
    }
  }
  if (!edges.length) throw new Error("No selected audio outline is visible");
  const expected = pointerY - grabOffsetY - 1,
    actual = edges[0];
  if (Math.abs(actual - expected) > 2)
    throw new Error(
      `Dragged clip top ${actual}px; expected ${expected}px (${actual - expected}px from pointer grab)`,
    );
  return { pointerY, grabOffsetY, expected, actual, error: actual - expected };
}
