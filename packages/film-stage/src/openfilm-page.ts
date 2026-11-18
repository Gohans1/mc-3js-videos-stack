import { getFontEmbedCSS, toCanvas } from "html-to-image";

export interface PageProps {
  vars?: Record<string, string>;
  text?: Record<string, string>;
}

export async function loadOpenFilmPage(
  url: string,
  width: number,
  height: number,
  props: PageProps = {},
  { timeoutMs = 15_000, resetCanvasState = false } = {},
) {
  const wait = async <T>(phase: string, work: () => T | PromiseLike<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([
        Promise.resolve().then(work),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`did not finish within ${timeoutMs} ms`)),
            timeoutMs,
          );
        }),
      ]);
    } catch (cause) {
      throw new Error(`${url}: ${phase}: ${(cause as Error).message ?? cause}`, { cause });
    } finally {
      clearTimeout(timer!);
    }
  };
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.tabIndex = -1;
  iframe.style.cssText = `position:fixed;left:-100000px;top:0;width:${width}px;height:${height}px;border:0;pointer-events:none`;
  const loaded = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`OpenFilm page timed out: ${url}`)), timeoutMs);
    iframe.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    iframe.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`Cannot load OpenFilm page: ${url}`));
    };
  });
  const sourceUrl = new URL(url, location.href);
  const hosted =
    sourceUrl.origin === location.origin && sourceUrl.pathname.startsWith("/_openfilm/library/");
  if (hosted && (props.vars || props.text))
    sourceUrl.searchParams.set("_of", JSON.stringify(props));
  iframe.src = sourceUrl.href;
  document.body.append(iframe);
  try {
    await loaded;
    const doc = iframe.contentDocument!;
    const host = iframe.contentWindow as Window & {
      __openFilmCanvas2D?: Set<CanvasRenderingContext2D>;
      film?: {
        frame: (t: number) => void | Promise<void>;
        ready?: PromiseLike<unknown> | (() => unknown);
      };
    };
    if (!host.film?.frame) throw new Error(`No film.frame(t) in ${url}`);
    if (!hosted) {
      for (const [key, value] of Object.entries(props.vars ?? {}))
        doc.documentElement.style.setProperty(key, value);
      for (const [selector, value] of Object.entries(props.text ?? {})) {
        for (const node of doc.querySelectorAll(selector)) node.textContent = value;
      }
    }
    await wait("ready", async () => {
      const ready = host.film!.ready;
      await (typeof ready === "function" ? ready.call(host.film) : ready);
      await doc.fonts.ready;
      await Promise.all([...doc.images].map((image) => image.decode()));
    });
    const contexts = new Map<
      CanvasRenderingContext2D,
      {
        ctx: CanvasRenderingContext2D;
        state: Record<string, unknown>;
        transform: DOMMatrix;
        dash: number[];
      }
    >();
    const captureContexts = () => {
      if (!resetCanvasState) return;
      for (const ctx of host.__openFilmCanvas2D ?? []) {
        if (!doc.contains(ctx.canvas)) continue;
        if (contexts.has(ctx)) continue;
        const state = Object.fromEntries(
          Object.getOwnPropertyNames(Object.getPrototypeOf(ctx))
            .filter((key) => Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ctx), key)?.set)
            .map((key) => [key, (ctx as unknown as Record<string, unknown>)[key]]),
        );
        contexts.set(ctx, { ctx, state, transform: ctx.getTransform(), dash: ctx.getLineDash() });
      }
    };
    captureContexts();
    await wait("frame(0)", () => host.film!.frame(0));
    captureContexts();
    // html-to-image's font traversal skips children from an iframe's JavaScript realm.
    for (const sheet of doc.styleSheets) {
      if (sheet.href) continue;
      for (const [index, rule] of [...sheet.cssRules].entries()) {
        if (rule.type !== CSSRule.FONT_FACE_RULE) continue;
        const css = rule.cssText.replace(
          /url\((['"]?)(.*?)\1\)/g,
          (_match, _quote, path) => `url(${JSON.stringify(new URL(path, doc.baseURI).href)})`,
        );
        sheet.deleteRule(index);
        sheet.insertRule(css, index);
      }
    }
    const fontNodes = new Map<string, HTMLElement>();
    for (const node of doc.querySelectorAll<HTMLElement>("body, body *"))
      fontNodes.set(host.getComputedStyle(node).fontFamily, node);
    const fontEmbedCSS = await wait("fonts", async () =>
      [
        ...new Set(
          await Promise.all(
            [...fontNodes.values()].map((node) =>
              getFontEmbedCSS(node, { preferredFontFormat: "woff2" }),
            ),
          ),
        ),
      ].join("\n"),
    );
    await wait("font layout", async () => {
      doc.body.getBoundingClientRect();
      await doc.fonts.ready;
      await host.film!.frame(0);
    });
    const blend =
      [...doc.body.querySelectorAll("*")]
        .map((el) => host.getComputedStyle(el).mixBlendMode)
        .find((value) => value !== "normal") ?? "source-over";
    // Legacy mask longhands overwrite animated standard mask positions during SVG cloning.
    const styleProperties = Array.from(host.getComputedStyle(doc.documentElement)).filter(
      (key) => !key.startsWith("-webkit-mask-"),
    );
    let disposed = false;
    let queue = Promise.resolve<HTMLCanvasElement | null>(null);
    return {
      iframe,
      blend: blend as GlobalCompositeOperation,
      seek(t: number) {
        const run = async () => {
          if (disposed) throw new Error(`${url}: page was disposed; load it again before seeking`);
          // Source pages can leave shadow/composite state behind, so every seek starts from initialization state.
          captureContexts();
          for (const { ctx, state, transform, dash } of contexts.values()) {
            if (!doc.contains(ctx.canvas)) continue;
            ctx.reset();
            Object.assign(ctx, state);
            ctx.setTransform(transform);
            ctx.setLineDash(dash);
            ctx.beginPath();
          }
          await host.film!.frame(t);
          doc.body.getBoundingClientRect();
          const animations = doc.getAnimations();
          for (const animation of animations) {
            animation.pause();
            animation.currentTime = t * 1000;
          }
          doc.body.getBoundingClientRect();
          const restore: (() => void)[] = [];
          const frozen = new Map<HTMLElement | SVGElement, Map<string, string>>();
          for (const animation of animations) {
            const effect = animation.effect as KeyframeEffect | null;
            const target = effect?.target as HTMLElement | SVGElement | null;
            if (!target || !effect) continue;
            const computed = host.getComputedStyle(target);
            const values = frozen.get(target) ?? new Map<string, string>();
            for (const frame of effect.getKeyframes())
              for (const key of Object.keys(frame)) {
                if (["offset", "computedOffset", "easing", "composite"].includes(key)) continue;
                const css = key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
                values.set(css, computed.getPropertyValue(css));
              }
            for (const key of [
              "background-image",
              "background-position",
              "background-size",
              "mask-image",
              "mask-position",
              "mask-size",
            ])
              values.set(key, computed.getPropertyValue(key));
            frozen.set(target, values);
          }
          for (const svg of doc.querySelectorAll<SVGElement>("svg, svg *")) {
            const values = frozen.get(svg) ?? new Map<string, string>();
            const computed = host.getComputedStyle(svg);
            for (const key of [
              "fill",
              "stroke",
              "stroke-width",
              "stroke-dasharray",
              "stroke-dashoffset",
              "stroke-linecap",
              "stroke-linejoin",
              "color",
              "opacity",
              "transform",
              "transform-origin",
            ])
              values.set(key, computed.getPropertyValue(key));
            frozen.set(svg, values);
          }
          for (const [target, values] of frozen) {
            const before = target.getAttribute("style");
            for (const [key, value] of values) target.style.setProperty(key, value);
            target.style.setProperty("animation", "none", "important");
            restore.push(() =>
              before === null
                ? target.removeAttribute("style")
                : target.setAttribute("style", before),
            );
          }
          try {
            const image = await toCanvas(doc.body, {
              width,
              height,
              canvasWidth: width,
              canvasHeight: height,
              pixelRatio: 1,
              fontEmbedCSS,
              skipAutoScale: true,
              includeStyleProperties: styleProperties,
              filter: (node) => !["SCRIPT", "STYLE", "LINK"].includes(node.nodeName),
            });
            return image;
          } finally {
            restore.reverse().forEach((undo) => undo());
          }
        };
        const next = queue
          .then(() => wait(`frame(${t})`, run))
          .catch((error) => {
            disposed = true;
            iframe.remove();
            throw error;
          });
        queue = next.catch(() => null);
        return next;
      },
      dispose() {
        disposed = true;
        iframe.remove();
      },
    };
  } catch (error) {
    iframe.remove();
    throw error;
  }
}
