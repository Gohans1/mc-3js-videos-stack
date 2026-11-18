import * as THREE from "three";

import { makeOpenFilmLayers } from "../../src/openfilm";
import { loadOpenFilmPage } from "../../src/openfilm-page";

Object.assign(window, {
  async pickingProbe() {
    const page = await loadOpenFilmPage("/picking.html", 400, 200);
    try {
      await page.seek(0);
      return [20, 120, 220, 320].map((x) => page.hitTest(x, 20));
    } finally {
      page.dispose();
    }
  },
  async overlayProbe(width = 960) {
    const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
    renderer.setSize(width, (width * 9) / 16, false);
    const layers = makeOpenFilmLayers(renderer, []);
    try {
      renderer.setClearColor(0);
      renderer.clear();
      await layers.render(
        [
          {
            id: "own",
            asset: "/editable.html",
            from: 0,
            to: 6,
            elements: [{ selector: "#page-title", style: { color: "#00ff00" } }],
          },
        ],
        0,
      );
      const title = layers.inspect()[0].elements.find((e) => e.selector === "#page-title");
      return {
        color: title?.style.color,
        text: title?.text,
        width: layers.inspect()[0].width,
        rect: title?.rect,
      };
    } finally {
      layers.dispose();
      renderer.dispose();
    }
  },
  async editProbe() {
    const page = await loadOpenFilmPage("/editable.html", 200, 100);
    const other = await loadOpenFilmPage("/editable.html", 200, 100);
    const pixel = (canvas: HTMLCanvasElement) => [
      ...canvas.getContext("2d")!.getImageData(80, 20, 1, 1).data,
    ];
    try {
      const iframe = page.iframe;
      page.setOverrides([
        { selector: "#box", style: { "background-color": "#00ff00" }, translate: [12, 8] },
        { selector: "#title", text: "Human " },
      ]);
      const colors = [];
      const positions = [];
      for (const t of [2, 0, 1, 2]) {
        colors.push(pixel(await page.seek(t)));
        positions.push(page.elements().find((el) => el.selector === "#box")!.rect[0]);
      }
      const doc = page.iframe.contentDocument!;
      const result = {
        colors,
        positions,
        text: doc.querySelector("#title")!.textContent!,
        child: doc.querySelector("#title em")!.textContent!,
        stable: iframe === page.iframe,
        selectors: page.elements().map((el) => el.selector),
        other: pixel(await other.seek(0)),
      };
      page.setOverrides([]);
      const reset = pixel(await page.seek(2));
      return { ...result, reset, restored: doc.querySelector("#title")!.textContent! };
    } finally {
      page.dispose();
      other.dispose();
    }
  },
});
