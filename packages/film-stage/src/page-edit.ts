export interface PageOverride {
  selector: string;
  text?: string;
  style?: Record<string, string>;
  translate?: [number, number];
  scale?: number;
  rotate?: number;
}

export interface PageElement {
  selector: string;
  label: string;
  kind: "text" | "shape" | "image" | "box";
  text?: string;
  rect: [number, number, number, number];
  style: Record<string, string>;
  translateMatrix: [number, number, number, number] | null;
}

const properties = [
  "color",
  "background-color",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-align",
  "letter-spacing",
  "line-height",
  "opacity",
  "fill",
  "stroke",
  "stroke-width",
  "border-radius",
  "text-shadow",
  "box-shadow",
  "width",
  "height",
];
const ignored = new Set(["script", "style", "link", "meta", "br", "defs", "title", "desc"]);
const ownText = (el: Element) => [...el.childNodes].filter((n) => n.nodeType === 3);
const words = (el: Element) =>
  [...el.childNodes]
    .map((n) => (n.nodeType === 3 ? n.textContent : (n as Element).localName === "br" ? "\n" : ""))
    .join("");

function translateParts(value: string) {
  const parts: string[] = [];
  let depth = 0,
    part = "";
  for (const char of value) {
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (/\s/.test(char) && depth === 0) {
      if (part) parts.push(part);
      part = "";
    } else part += char;
  }
  if (part) parts.push(part);
  return parts;
}

function translateMatrix(el: Element): PageElement["translateMatrix"] {
  const view = el.ownerDocument.defaultView!;
  const svgParent = el.parentElement as
    (Element & { getScreenCTM?: () => DOMMatrix | null }) | null;
  let matrix = svgParent?.getScreenCTM?.() ?? new DOMMatrix();
  if (!svgParent?.getScreenCTM) {
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      const css = view.getComputedStyle(parent);
      if (css.perspective !== "none") return null;
      const rotate = css.rotate.split(/\s+/);
      const rotation =
        css.rotate === "none"
          ? new DOMMatrix()
          : new DOMMatrix(
              rotate.length === 1
                ? `rotate(${rotate[0]})`
                : rotate.length === 2
                  ? `rotate${rotate[0].toUpperCase()}(${rotate[1]})`
                  : `rotate3d(${rotate.join(",")})`,
            );
      const scale = css.scale === "none" ? [1, 1, 1] : css.scale.split(/\s+/).map(Number);
      const local = rotation
        .scale(scale[0], scale[1] ?? scale[0], scale[2] ?? 1)
        .multiply(new DOMMatrix(css.transform === "none" ? undefined : css.transform));
      matrix = new DOMMatrix()
        .scale(Number(css.zoom) || 1)
        .multiply(local)
        .multiply(matrix);
    }
  }
  if (!matrix.is2D) return null;
  const inverse = matrix.inverse();
  const values: [number, number, number, number] = [inverse.a, inverse.b, inverse.c, inverse.d];
  return values.every(Number.isFinite) ? values : null;
}

export function pageSelector(el: Element) {
  const parts: string[] = [];
  const doc = el.ownerDocument;
  for (let node: Element | null = el; node && node !== doc.body; node = node.parentElement) {
    if (node.id) {
      const id = `#${CSS.escape(node.id)}`;
      if (doc.querySelectorAll(id).length === 1) {
        parts.unshift(id);
        break;
      }
    }
    const siblings = [...(node.parentElement?.children ?? [])].filter(
      (n) => n.localName === node!.localName,
    );
    parts.unshift(`${node.localName}:nth-of-type(${siblings.indexOf(node) + 1})`);
  }
  return parts.join(" > ");
}

export function makePageEditor(doc: Document) {
  let undo: (() => void)[] = [];
  let current: readonly PageOverride[] = [];
  const restore = () => {
    undo.reverse().forEach((fn) => fn());
    undo = [];
  };
  const apply = (overrides: readonly PageOverride[]) => {
    current = overrides;
    for (const change of overrides) {
      for (const el of doc.querySelectorAll<HTMLElement | SVGElement>(change.selector)) {
        if (!("style" in el)) continue;
        const set = (key: string, value: string) => {
          const old = el.style.getPropertyValue(key),
            priority = el.style.getPropertyPriority(key);
          undo.push(() =>
            old ? el.style.setProperty(key, old, priority) : el.style.removeProperty(key),
          );
          el.style.setProperty(key, value, "important");
        };
        for (const [key, value] of Object.entries(change.style ?? {})) set(key, value);
        if (change.translate) {
          const source = doc.defaultView!.getComputedStyle(el).translate;
          const [x = "0px", y = "0px", z] = source === "none" ? [] : translateParts(source);
          set(
            "translate",
            [`calc(${x} + ${change.translate[0]}px)`, `calc(${y} + ${change.translate[1]}px)`, z]
              .filter(Boolean)
              .join(" "),
          );
        }
        if (change.scale !== undefined) set("scale", String(change.scale));
        if (change.rotate !== undefined) set("rotate", `${change.rotate}deg`);
        if (change.text !== undefined) {
          if ([...el.children].every((child) => child.localName === "br")) {
            const before = [...el.childNodes];
            el.replaceChildren(
              ...change.text
                .split("\n")
                .flatMap((line, i) =>
                  i
                    ? [doc.createElement("br"), doc.createTextNode(line)]
                    : [doc.createTextNode(line)],
                ),
            );
            undo.push(() => el.replaceChildren(...before));
          } else {
            const nodes = ownText(el).filter((n) => n.textContent?.trim());
            const before = nodes.map((n) => n.textContent);
            nodes.forEach((n, i) => {
              n.textContent = i === 0 ? change.text! : "";
            });
            undo.push(() =>
              nodes.forEach((n, i) => {
                n.textContent = before[i];
              }),
            );
          }
        }
      }
    }
  };
  const elements = (): PageElement[] => {
    const view = doc.defaultView!;
    return [...doc.body.querySelectorAll<HTMLElement | SVGElement>("*")].flatMap((el) => {
      if (ignored.has(el.localName) || !("style" in el)) return [];
      const css = view.getComputedStyle(el),
        r = el.getBoundingClientRect();
      const changes = current.filter((change) => el.matches(change.selector));
      if (
        r.width <= 0 ||
        r.height <= 0 ||
        css.display === "none" ||
        css.visibility === "hidden" ||
        Number(css.opacity) === 0
      ) {
        if (!changes.length) return [];
      }
      const text = words(el),
        hasText = !!text.trim() || changes.some((change) => change.text !== undefined);
      const kind = hasText
        ? "text"
        : ["img", "canvas", "video"].includes(el.localName)
          ? "image"
          : el.namespaceURI === "http://www.w3.org/2000/svg"
            ? "shape"
            : "box";
      return [
        {
          selector: pageSelector(el),
          label: el.id || text.trim().slice(0, 48) || el.localName,
          kind,
          ...(hasText ? { text } : {}),
          rect: [r.x, r.y, r.width, r.height],
          style: Object.fromEntries(properties.map((key) => [key, css.getPropertyValue(key)])),
          translateMatrix: translateMatrix(el),
        } as PageElement,
      ];
    });
  };
  const hitTest = (x: number, y: number) => {
    for (const el of doc.elementsFromPoint(x, y)) {
      if (el === doc.body || el === doc.documentElement || ignored.has(el.localName)) continue;
      let visible = true;
      for (let parent: Element | null = el; parent; parent = parent.parentElement) {
        const css = doc.defaultView!.getComputedStyle(parent);
        if (Number(css.opacity) === 0) {
          visible = false;
          break;
        }
      }
      if (!visible) continue;
      const css = doc.defaultView!.getComputedStyle(el);
      const graphic =
        el.namespaceURI === "http://www.w3.org/2000/svg" && !["svg", "g"].includes(el.localName);
      const pseudo = ["::before", "::after"].some((part) => {
        const style = doc.defaultView!.getComputedStyle(el, part);
        return style.display !== "none" && !["none", "normal"].includes(style.content);
      });
      if (
        !words(el).trim() &&
        !graphic &&
        !pseudo &&
        !["img", "canvas", "video"].includes(el.localName) &&
        ["rgba(0, 0, 0, 0)", "transparent"].includes(css.backgroundColor) &&
        css.backgroundImage === "none" &&
        css.boxShadow === "none" &&
        ![
          css.borderTopWidth,
          css.borderRightWidth,
          css.borderBottomWidth,
          css.borderLeftWidth,
        ].some((width) => parseFloat(width) > 0)
      )
        continue;
      return pageSelector(el);
    }
    return null;
  };
  const variables = () => {
    const css = doc.defaultView!.getComputedStyle(doc.documentElement);
    return Object.fromEntries(
      [...css]
        .filter((key) => key.startsWith("--") && key !== "--clip-length")
        .map((key) => [key, css.getPropertyValue(key).trim()]),
    );
  };
  return { apply, restore, elements, variables, hitTest };
}
