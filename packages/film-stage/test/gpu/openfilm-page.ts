import * as THREE from "three";

import { withOpenFilm } from "../../../live-studio/app/openfilm/render";
import { makeOpenFilmLayers, registerOpenFilm } from "../../src/openfilm";
import { loadOpenFilmPage } from "../../src/openfilm-page";
import { makeTransitions } from "../../src/transitions";

Object.assign(window, {
  async seekRecovery() {
    const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
    renderer.setSize(64, 36, false);
    const recipe = {
      id: "test-seek",
      title: "Test seek",
      cat: "effect",
      group: "test",
      render: "page" as const,
      path: "test-recovery-seek.html",
      durationMs: 1000,
    };
    const layers = makeOpenFilmLayers(renderer, [recipe]);
    registerOpenFilm([{ ...recipe, id: "transitions/test-seek", cat: "transition" }]);
    const cut = makeTransitions(
      renderer,
      () => {
        renderer.setClearColor(0xff0000);
        renderer.clear();
      },
      () => [{ t: 0 }, { t: 1, transition: { fx: "of:transitions/test-seek", len: 1 } }],
      () => 2,
      { on: false },
    );
    const result: { layers: unknown[]; cuts: unknown[] } = { layers: [], cuts: [] };
    try {
      for (const kind of ["layers", "cuts"] as const)
        for (const t of [0.25, 0.75, 0.25]) {
          renderer.setClearColor(0xff0000);
          renderer.clear();
          try {
            if (kind === "layers")
              await layers.render([{ id: "one", asset: recipe.id, from: 0, to: 1 }], t);
            else {
              await cut.prepareFrame(t + 0.5);
              cut(t + 0.5);
            }
            const px = new Uint8Array(4),
              gl = renderer.getContext();
            gl.readPixels(32, 18, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
            result[kind].push({ pixel: [...px] });
          } catch (error) {
            result[kind].push({ error: String(error) });
          }
        }
      return result;
    } finally {
      layers.dispose();
      cut.disposeTransitions();
      renderer.dispose();
    }
  },
  async inactiveCutDraws() {
    const recipes = await (await fetch("/_openfilm/catalog")).json();
    registerOpenFilm(recipes);
    const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
    renderer.setSize(64, 36, false);
    let frames = 0;
    const stage = makeTransitions(
      renderer,
      () => {
        frames++;
        renderer.setClearColor(0xff0000);
        renderer.clear();
      },
      () => [{ t: 0 }, { t: 2, transition: { fx: "of:motions/move-push-left", len: 1 } }],
      () => 4,
      { on: false },
    );
    const draw = withOpenFilm(
      Object.assign(stage, { tools: { renderer } }) as never,
      { items: [] },
      recipes,
      () => true,
    );
    try {
      await draw.renderFrame!(0);
      return frames;
    } finally {
      draw.disposeOpenFilm?.();
      stage.disposeTransitions();
      renderer.dispose();
    }
  },
  async layerRecovery() {
    const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
    renderer.setSize(64, 36, false);
    const layers = makeOpenFilmLayers(
      renderer,
      ["bad", "good"].map((id) => ({
        id,
        title: id,
        cat: "effect",
        group: "test",
        render: "page",
        path: `test-recovery-${id}.html`,
      })),
    );
    const results = [];
    try {
      for (const asset of ["bad", "good", "bad", null, "good"]) {
        renderer.setClearColor(0xff0000);
        renderer.clear();
        try {
          await layers.render(asset ? [{ id: "one", asset, from: 0, to: 1 }] : [], 0.5);
          const px = new Uint8Array(4),
            gl = renderer.getContext();
          gl.readPixels(32, 18, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          results.push({ asset, pixel: [...px] });
        } catch (error) {
          results.push({ asset, error: String(error) });
        }
      }
      return results;
    } finally {
      layers.dispose();
      renderer.dispose();
    }
  },
  async layerOpacity() {
    const recipes = await (await fetch("/_openfilm/catalog")).json();
    const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
    renderer.setSize(64, 36, false);
    const layers = makeOpenFilmLayers(renderer, recipes);
    const pixels = [];
    try {
      for (const opacity of [0, 0.5, 1]) {
        renderer.setClearColor(0xff0000);
        renderer.clear();
        await layers.render(
          [{ id: "fade", asset: "motions/in-fade", from: 0, to: 3, opacity }],
          0.5,
        );
        const px = new Uint8Array(4),
          gl = renderer.getContext();
        gl.readPixels(32, 18, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        pixels.push([...px]);
      }
      return pixels;
    } finally {
      layers.dispose();
      renderer.dispose();
    }
  },
  async fontWidths() {
    const page = await loadOpenFilmPage("/_openfilm/library/text/text/files/text.html", 800, 130, {
      text: { ".t": "AI tự do sáng tạo" },
    });
    try {
      const image = await page.seek(0);
      const doc = page.iframe.contentDocument!,
        text = doc.querySelector(".t")!,
        style = page.iframe.contentWindow!.getComputedStyle(text);
      const native = doc.createElement("canvas");
      native.width = 800;
      native.height = 130;
      const ctx = native.getContext("2d")!;
      ctx.font = style.font;
      ctx.letterSpacing = style.letterSpacing;
      ctx.fillText(text.textContent!, 20, 100);
      const inkWidth = (canvas: HTMLCanvasElement) => {
        const px = canvas.getContext("2d")!.getImageData(0, 0, 800, 130).data;
        let first = 800,
          last = -1;
        for (let y = 0; y < 130; y++)
          for (let x = 0; x < 800; x++)
            if (px[(y * 800 + x) * 4 + 3]! > 40) {
              first = Math.min(first, x);
              last = Math.max(last, x);
            }
        return last - first + 1;
      };
      return { snapshot: inkWidth(image), native: inkWidth(native) };
    } finally {
      page.dispose();
    }
  },
  async propsBeforeInit() {
    const page = await loadOpenFilmPage("/_openfilm/library/test-init.html", 32, 32, {
      text: { ".label": "AI" },
      vars: { "--ink": "red" },
    });
    try {
      const canvas = await page.seek(0.3);
      return {
        text: page.iframe.contentDocument!.querySelector(".label")!.textContent,
        pixel: Array.from(canvas.getContext("2d")!.getImageData(16, 16, 1, 1).data),
      };
    } finally {
      page.dispose();
    }
  },
  async pageFrames() {
    const page = await loadOpenFilmPage("/fixture", 80, 40, { text: { ".label": "AI" } });
    const frames: number[][] = [];
    for (const t of [0, 0.5, 0]) {
      const canvas = await page.seek(t);
      frames.push(Array.from(canvas.getContext("2d")!.getImageData(0, 0, 80, 40).data));
    }
    page.dispose();
    return frames;
  },
  async transitionsNative(ids: string[]) {
    const recipes = await (await fetch("/_openfilm/catalog")).json();
    registerOpenFilm(recipes);
    const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true, antialias: false });
    renderer.setSize(160, 90, false);
    let fx = "";
    const draw = makeTransitions(
      renderer,
      (_t, shot = 1) => {
        renderer.setClearColor(shot === 0 ? 0xff0000 : 0x0000ff);
        renderer.clear();
      },
      () => [{ t: 0 }, { t: 1, transition: { fx, len: 1 } }],
      () => 2,
      { on: false },
    );
    const results = [];
    try {
      for (const id of ids) {
        fx = `of:${id}`;
        const frames = [];
        for (const t of [0.51, 1.49, 0.51, 1.501]) {
          await draw.prepareFrame(t);
          draw(t);
          const px = new Uint8Array(160 * 90 * 4),
            gl = renderer.getContext();
          gl.readPixels(0, 0, 160, 90, gl.RGBA, gl.UNSIGNED_BYTE, px);
          let red = 0,
            blue = 0,
            hash = 2166136261;
          for (let i = 0; i < px.length; i++) {
            hash = Math.imul(hash ^ px[i]!, 16777619);
            if (i % 4 === 0) red += px[i]!;
            if (i % 4 === 2) blue += px[i]!;
          }
          frames.push({ red, blue, hash: hash >>> 0 });
        }
        results.push({ id, frames });
      }
      return results;
    } finally {
      draw.disposeTransitions();
      renderer.dispose();
    }
  },
  async auditPages(ids: string[]) {
    const catalog = await (await fetch("/_openfilm/catalog")).json();
    const all = catalog.flatMap((r: { children?: unknown[] }) => [r, ...(r.children ?? [])]);
    const results = [];
    for (const id of ids) {
      const recipe = all.find((r: { id: string }) => r.id === id);
      let page: Awaited<ReturnType<typeof loadOpenFilmPage>> | undefined;
      try {
        const width = recipe.w ? Math.min(240, recipe.w) : 240;
        const height = recipe.h ? Math.max(16, Math.round((width * recipe.h) / recipe.w)) : 135;
        page = await loadOpenFilmPage(
          `/_openfilm/library/${recipe.path}`,
          width,
          height,
          {
            vars: recipe.vars,
          },
          { resetCanvasState: true },
        );
        const hashes = [];
        let first: Uint8ClampedArray | undefined,
          diff = 0,
          maxDiff = 0,
          blockDiff = 0;
        let alpha = 0;
        const duration = (recipe.durationMs ?? 3000) / 1000;
        for (const t of [0.37 * duration, 0.73 * duration, 0.17, 0.37 * duration]) {
          const image = await page.seek(t);
          const px = image.getContext("2d")!.getImageData(0, 0, image.width, image.height).data;
          if (!first) first = px.slice();
          else if (hashes.length === 3) {
            for (let i = 0; i < px.length; i++) {
              const d = Math.abs(px[i]! - first[i]!);
              diff += d;
              maxDiff = Math.max(maxDiff, d);
            }
            for (let y = 0; y < height; y += 8)
              for (let x = 0; x < width; x += 8) {
                const a = [0, 0, 0, 0],
                  b = [0, 0, 0, 0];
                let count = 0;
                for (let yy = y; yy < Math.min(height, y + 8); yy++)
                  for (let xx = x; xx < Math.min(width, x + 8); xx++) {
                    const index = (yy * width + xx) * 4;
                    count++;
                    for (let channel = 0; channel < 4; channel++) {
                      a[channel]! +=
                        first[index + channel]! * (channel === 3 ? 1 : first[index + 3]! / 255);
                      b[channel]! +=
                        px[index + channel]! * (channel === 3 ? 1 : px[index + 3]! / 255);
                    }
                  }
                for (let channel = 0; channel < 4; channel++)
                  blockDiff = Math.max(blockDiff, Math.abs(a[channel]! - b[channel]!) / count);
              }
          }
          let hash = 2166136261;
          for (const byte of px) hash = Math.imul(hash ^ byte, 16777619);
          for (let i = 3; i < px.length; i += 4) alpha += px[i]!;
          hashes.push(hash >>> 0);
        }
        results.push({ id, pure: blockDiff < 2, alpha, diff, maxDiff, blockDiff });
      } catch (e) {
        results.push({ id, error: (e as Error).message });
      } finally {
        page?.dispose();
      }
    }
    return results;
  },
});
