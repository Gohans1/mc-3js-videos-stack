import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";

import { loadOpenFilmPage, type PageElement, type PageProps } from "./openfilm-page";
import { registerTransitionExtension } from "./transition-extension";
import { TRANSITIONS } from "./transitions-meta";
export { resolveOpenFilmRecipe } from "./openfilm-recipes";
import { resolveOpenFilmRecipe } from "./openfilm-recipes";

export interface OpenFilmRecipe {
  id: string;
  title: string;
  cat: string;
  group: string;
  render: string;
  path?: string;
  url?: string;
  w?: number;
  h?: number;
  fit?: number;
  durationMs?: number;
  vars?: Record<string, string>;
  motion?: Record<string, { name: string; body: string; secs: number; ease: string }>;
  fade?: string;
}
export interface OpenFilmItem extends PageProps {
  id: string;
  asset: string;
  from: number;
  to: number;
  track?: number;
  x?: number;
  y?: number;
  size?: number;
  opacity?: number;
  rotate?: number;
  rate?: number;
  offset?: number;
  loop?: boolean;
  fadeIn?: number;
  fadeOut?: number;
  blend?: GlobalCompositeOperation;
}
export interface OpenFilmTimeline {
  items: OpenFilmItem[];
}

const resourceUrl = (path: string) =>
  `/_openfilm/library/${path.split("/").map(encodeURIComponent).join("/")}`;
const compositorUrl = "/_openfilm/compositor.html";
const disposePage = (page?: ReturnType<typeof loadOpenFilmPage>) => {
  void page?.then(
    (loaded) => loaded.dispose(),
    () => {},
  );
};

function makeScreen(renderer: THREE.WebGLRenderer) {
  const canvas = document.createElement("canvas");
  canvas.width = renderer.domElement.width;
  canvas.height = renderer.domElement.height;
  const ctx = canvas.getContext("2d")!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    toneMapped: false,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new FullScreenQuad(material);
  return {
    canvas,
    ctx,
    draw() {
      texture.needsUpdate = true;
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      try {
        renderer.setRenderTarget(null);
        quad.render(renderer);
      } finally {
        renderer.autoClear = auto;
      }
    },
    dispose() {
      texture.dispose();
      material.dispose();
      quad.dispose();
    },
  };
}

function motionStyle(
  doc: Document,
  recipe: OpenFilmRecipe,
  target: HTMLElement,
  phase: string,
  duration: number,
) {
  const motion = recipe.motion?.[phase];
  if (!motion) return;
  const style = doc.createElement("style");
  style.textContent = `@keyframes ${motion.name} {${motion.body}}`;
  doc.head.append(style);
  target.style.animation = `${motion.name} ${duration}s ${motion.ease} both`;
}

type TransitionMode =
  | { kind: "motion"; ready: Promise<Awaited<ReturnType<typeof loadOpenFilmPage>>> }
  | {
      kind: "page";
      overlay: { key: string; page: Promise<Awaited<ReturnType<typeof loadOpenFilmPage>>> } | null;
    };

type TransitionState =
  | { status: "active"; mode: TransitionMode; hasFrame: boolean }
  | { status: "disposed" };

function nativeTransition(recipe: OpenFilmRecipe, renderer: THREE.WebGLRenderer) {
  const screen = makeScreen(renderer);
  const { width: w, height: h } = screen.canvas;
  let state: TransitionState = {
    status: "active",
    hasFrame: false,
    mode:
      recipe.render === "motion"
        ? {
            kind: "motion",
            ready: loadOpenFilmPage(compositorUrl, w, h).then((page) => {
              const doc = page.iframe.contentDocument!;
              for (const phase of ["out", "in"]) {
                const canvas = doc.createElement("canvas");
                canvas.width = w;
                canvas.height = h;
                canvas.id = phase;
                canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
                doc.body.append(canvas);
                motionStyle(doc, recipe, canvas, phase, 1);
              }
              return page;
            }),
          }
        : { kind: "page", overlay: null },
  };
  const assertActive = () => {
    if (state.status === "disposed") throw new Error("OpenFilm transition was disposed");
    return state;
  };
  return {
    async prepare(
      progress: number,
      capture: (incoming: boolean) => HTMLCanvasElement,
      props?: PageProps,
    ) {
      const active = assertActive();
      if (active.mode.kind === "page") {
        const key = JSON.stringify([props?.vars, props?.text]);
        if (!active.mode.overlay || active.mode.overlay.key !== key) {
          disposePage(active.mode.overlay?.page);
          const pagePromise = loadOpenFilmPage(resourceUrl(recipe.path!), w, h, props, {
            resetCanvasState: true,
          }).catch((error) => {
            if (
              state.status === "active" &&
              state.mode.kind === "page" &&
              state.mode.overlay?.page === pagePromise
            ) {
              state.mode.overlay = null;
            }
            throw error;
          });
          active.mode.overlay = { key, page: pagePromise };
        }
        const page = await active.mode.overlay.page;
        assertActive();
        page.setOverrides(props?.elements ?? []);
        const image = await page.seek((progress * (recipe.durationMs ?? 1000)) / 1000);
        assertActive();
        screen.ctx.globalCompositeOperation = "copy";
        screen.ctx.drawImage(capture(progress >= 0.5), 0, 0, w, h);
        screen.ctx.globalCompositeOperation = page.blend;
        screen.ctx.drawImage(image, 0, 0, w, h);
      } else {
        const page = await active.mode.ready;
        assertActive();
        page.setOverrides(props?.elements ?? []);
        const doc = page.iframe.contentDocument!;
        const cut = recipe.id.startsWith("motions/cut-");
        const captures =
          progress < 0.5
            ? ([
                ["in", true],
                ["out", false],
              ] as const)
            : ([
                ["out", false],
                ["in", true],
              ] as const);
        for (const [phase, incoming] of captures) {
          const canvas = doc.getElementById(phase) as HTMLCanvasElement;
          canvas.getContext("2d")!.drawImage(capture(incoming), 0, 0, w, h);
          canvas.style.visibility = cut && incoming !== progress >= 0.5 ? "hidden" : "visible";
        }
        const image = await page.seek(
          cut ? (progress < 0.5 ? progress * 2 : progress * 2 - 1) : progress,
        );
        assertActive();
        screen.ctx.globalCompositeOperation = "copy";
        screen.ctx.drawImage(image, 0, 0);
      }
      assertActive().hasFrame = true;
    },
    draw() {
      if (state.status === "active" && state.hasFrame) screen.draw();
    },
    dispose() {
      if (state.status === "disposed") return;
      const prev = state;
      state = { status: "disposed" };
      if (prev.mode.kind === "page") disposePage(prev.mode.overlay?.page);
      else disposePage(prev.mode.ready);
      screen.dispose();
    },
  };
}

export function registerOpenFilm(recipes: OpenFilmRecipe[]) {
  for (const recipe of recipes.filter((r) => r.cat === "transition")) {
    const alias =
      recipe.render === "fade"
        ? TRANSITIONS.find(
            (r) =>
              r.id ===
              { dissolve: "dissolve", "dip-black": "black", "dip-white": "white" }[recipe.fade!],
          )
        : null;
    if (alias) {
      registerTransitionExtension({
        definition: {
          ...alias,
          id: `of:${recipe.id}`,
          title: recipe.title,
          category: `OpenFilm / ${recipe.group}`,
          len: (recipe.durationMs ?? 500) / 1000,
        },
      });
    } else
      registerTransitionExtension({
        definition: {
          id: `of:${recipe.id}`,
          title: recipe.title,
          tip: recipe.id,
          category: `OpenFilm / ${recipe.group}`,
          glsl: "",
          len: (recipe.durationMs ?? 500) / 1000,
        },
        create: (renderer) => nativeTransition(recipe, renderer),
      });
  }
}

export interface OverlayPlacement {
  id: string;
  width: number;
  height: number;
  displayWidth: number;
  displayHeight: number;
  frameWidth: number;
  frameHeight: number;
  x: number;
  y: number;
  rotate: number;
}
export interface OverlayInspection extends OverlayPlacement {
  elements: PageElement[];
  vars?: Record<string, string>;
  hitTest: (x: number, y: number) => string | null;
}

export function overlayPoint(layer: OverlayPlacement, x: number, y: number): [number, number] {
  const dx = (x - layer.x) * layer.frameWidth,
    dy = (y - layer.y) * layer.frameHeight;
  const r = (-layer.rotate * Math.PI) / 180;
  return [
    ((dx * Math.cos(r) - dy * Math.sin(r)) * layer.width) / layer.displayWidth + layer.width / 2,
    ((dx * Math.sin(r) + dy * Math.cos(r)) * layer.height) / layer.displayHeight + layer.height / 2,
  ];
}
export function overlayFramePoint(layer: OverlayPlacement, x: number, y: number): [number, number] {
  const dx = ((x - layer.width / 2) * layer.displayWidth) / layer.width,
    dy = ((y - layer.height / 2) * layer.displayHeight) / layer.height,
    r = (layer.rotate * Math.PI) / 180;
  return [
    layer.x + (dx * Math.cos(r) - dy * Math.sin(r)) / layer.frameWidth,
    layer.y + (dx * Math.sin(r) + dy * Math.cos(r)) / layer.frameHeight,
  ];
}

export function makeOpenFilmLayers(renderer: THREE.WebGLRenderer, recipes: OpenFilmRecipe[]) {
  const screen = makeScreen(renderer);
  const motion = document.createElement("canvas");
  motion.width = screen.canvas.width;
  motion.height = screen.canvas.height;
  const motionCtx = motion.getContext("2d")!;
  const pages = new Map<string, Promise<Awaited<ReturnType<typeof loadOpenFilmPage>>>>();
  const catalog = new Map(recipes.map((r) => [r.id, r]));
  let inspected: {
    placement: OverlayPlacement;
    page: Awaited<ReturnType<typeof loadOpenFilmPage>>;
  }[] = [];
  return {
    inspect(): OverlayInspection[] {
      return inspected.map(({ placement, page }) => ({
        ...placement,
        elements: page.elements(),
        hitTest: page.hitTest,
        vars: page.variables(),
      }));
    },
    async render(
      items: OpenFilmItem[],
      t: number,
      timeAt: (item: OpenFilmItem) => number = () => t,
    ) {
      inspected = [];
      const active = items
        .filter((it) => timeAt(it) >= it.from && timeAt(it) < it.to)
        .sort((a, b) => (a.track ?? 0) - (b.track ?? 0));
      if (!active.length) {
        for (const page of pages.values()) disposePage(page);
        pages.clear();
        return;
      }
      const used = new Set<string>();
      screen.ctx.globalCompositeOperation = "copy";
      screen.ctx.drawImage(renderer.domElement, 0, 0);
      screen.ctx.globalCompositeOperation = "source-over";
      for (const it of active) {
        const recipe =
          catalog.get(it.asset) ??
          resolveOpenFilmRecipe(it.asset, [], screen.canvas.width, screen.canvas.height);
        if (!recipe) throw new Error(`Unknown OpenFilm asset: ${it.asset}`);
        if (!["page", "motion"].includes(recipe.render))
          throw new Error(`Apply ${recipe.id} using its native ${recipe.cat} lane`);
        const { width: w, height: h } = screen.canvas;
        const full =
          recipe.cat === "effect" || recipe.cat === "transition" || recipe.render === "motion";
        const ph = full ? h : Math.max(1, Math.round(h * (it.size ?? recipe.fit ?? 0.25)));
        const pw = full ? w : Math.max(1, Math.round((ph * (recipe.w ?? 1)) / (recipe.h ?? 1)));
        const pageWidth = recipe.render === "motion" ? pw : (recipe.w ?? pw);
        const pageHeight = recipe.render === "motion" ? ph : (recipe.h ?? ph);
        const vars = { ...recipe.vars, "--clip-length": `${it.to - it.from}s`, ...it.vars };
        const key = JSON.stringify([it.id, it.asset, pageWidth, pageHeight, vars, it.text]);
        used.add(key);
        if (!pages.has(key))
          pages.set(
            key,
            loadOpenFilmPage(
              recipe.render === "motion"
                ? compositorUrl
                : (recipe.url ?? resourceUrl(recipe.path!)),
              pageWidth,
              pageHeight,
              { vars, text: it.text },
              { resetCanvasState: recipe.render === "page" },
            )
              .then((page) => {
                if (recipe.render === "motion") {
                  const doc = page.iframe.contentDocument!,
                    canvas = doc.createElement("canvas");
                  canvas.id = "picture";
                  canvas.width = w;
                  canvas.height = h;
                  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
                  doc.body.append(canvas);
                  const phase = recipe.motion?.in ? "in" : recipe.motion?.out ? "out" : "loop";
                  motionStyle(
                    doc,
                    recipe,
                    canvas,
                    phase,
                    phase === "loop" ? recipe.motion!.loop.secs : it.to - it.from,
                  );
                  if (phase === "loop") canvas.style.animationIterationCount = "infinite";
                }
                return page;
              })
              .catch((error) => {
                pages.delete(key);
                throw error;
              }),
          );
        const page = await pages.get(key)!;
        page.setOverrides(it.elements ?? []);
        if (recipe.render === "motion")
          (page.iframe.contentDocument!.getElementById("picture") as HTMLCanvasElement)
            .getContext("2d")!
            .drawImage(screen.canvas, 0, 0);
        const itemTime = timeAt(it);
        let local = (itemTime - it.from) * (it.rate ?? 1) + (it.offset ?? 0);
        if (it.loop && recipe.durationMs) local %= recipe.durationMs / 1000;
        let image: HTMLCanvasElement;
        try {
          image = await page.seek(local);
        } catch (error) {
          pages.delete(key);
          page.dispose();
          throw error;
        }
        const alpha =
          (it.opacity ?? 1) *
          Math.min(
            1,
            it.fadeIn ? (itemTime - it.from) / it.fadeIn : 1,
            it.fadeOut ? (it.to - itemTime) / it.fadeOut : 1,
          );
        const isMotion = recipe.render === "motion";
        const ctx = isMotion ? motionCtx : screen.ctx;
        ctx.save();
        if (isMotion) {
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = "copy";
          ctx.fillStyle = "black";
          ctx.fillRect(0, 0, w, h);
          ctx.globalCompositeOperation = "source-over";
        } else {
          ctx.globalCompositeOperation = it.blend ?? page.blend;
          ctx.globalAlpha = alpha;
        }
        ctx.translate((it.x ?? 0.5) * w, (it.y ?? 0.5) * h);
        ctx.rotate(((it.rotate ?? 0) * Math.PI) / 180);
        ctx.drawImage(image, -pw / 2, -ph / 2, pw, ph);
        ctx.restore();
        if (!isMotion && alpha > 0)
          inspected.push({
            page,
            placement: {
              id: it.id,
              width: pageWidth,
              height: pageHeight,
              displayWidth: pw,
              displayHeight: ph,
              frameWidth: w,
              frameHeight: h,
              x: it.x ?? 0.5,
              y: it.y ?? 0.5,
              rotate: it.rotate ?? 0,
            },
          });
        if (isMotion) {
          screen.ctx.save();
          screen.ctx.globalAlpha = alpha;
          screen.ctx.globalCompositeOperation = it.blend ?? "source-over";
          screen.ctx.drawImage(motion, 0, 0);
          screen.ctx.restore();
        }
      }
      screen.draw();
      for (const [key, page] of pages) {
        if (!used.has(key)) {
          pages.delete(key);
          disposePage(page);
        }
      }
    },
    dispose() {
      pages.forEach(disposePage);
      pages.clear();
      screen.dispose();
    },
  };
}
