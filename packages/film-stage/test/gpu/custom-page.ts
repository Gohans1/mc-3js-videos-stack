import { loadOpenFilmPage } from "../../src/openfilm-page";

Object.assign(window, {
  async asyncFrames(mode: string) {
    const page = await loadOpenFilmPage(
      `/${mode}`,
      8,
      8,
      {},
      { resetCanvasState: mode.startsWith("_openfilm/") },
    );
    try {
      return await Promise.all(
        [0.2, 0.7, 0.2].map(async (t) => {
          const canvas = await page.seek(t);
          return [...canvas.getContext("2d")!.getImageData(0, 0, 1, 1).data];
        }),
      );
    } finally {
      page.dispose();
    }
  },
  async pageFailure(mode: string, timeoutMs = 2000) {
    const before = document.querySelectorAll("iframe").length;
    let page: Awaited<ReturnType<typeof loadOpenFilmPage>> | undefined;
    let error = "";
    try {
      page = await loadOpenFilmPage(`/${mode}`, 8, 8, {}, { timeoutMs });
      await page.seek(0.7);
    } catch (e) {
      error = (e as Error).message;
    }
    const leaked = document.querySelectorAll("iframe").length - before;
    page?.dispose();
    return { error, leaked };
  },
});
