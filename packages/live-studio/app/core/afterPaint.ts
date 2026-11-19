export const afterPaint = () =>
  new Promise<void>((resolve) => {
    if (document.hidden) {
      setTimeout(resolve, 0);
      return;
    }
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        clearTimeout(fallback);
        resolve();
      });
    });
    let second = 0;
    // An opening tab can go into the background before its next frame.
    const fallback = setTimeout(() => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      resolve();
    }, 100);
  });
