export interface FilmFeatures {
  cam: boolean;
  lights?: boolean;
  shots: boolean;
  text: boolean;
  adjustment: boolean;
  timing: boolean;
  keys: boolean;
  sound: boolean;
  voice: boolean;
  voiceMap: boolean;
  trials: boolean;
  choices: boolean;
  mix: boolean;
}

export interface StudioBootData {
  film?: { name?: string; ratio?: string; has?: FilmFeatures };
  contract?: { files?: string[] };
  hasPageProblems?: boolean;
  tags?: Record<string, string>;
}

declare global {
  interface Window {
    __STUDIO_BOOT?: StudioBootData;
  }
  var __studioAssetPatch: boolean | undefined;
}

const boot = typeof window !== "undefined" ? window.__STUDIO_BOOT : undefined;
const tags = new Map<string, string>(Object.entries(boot?.tags ?? {}));

const decodeSafe = (path: string) => {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
};

export const bootData = (): StudioBootData | undefined => boot;

export const invalidateTagPrefix = (prefix: string) => {
  for (const k of tags.keys()) if (k.startsWith(prefix)) tags.delete(k);
};

export const versionUrl = (url: string): string => {
  if (!tags.size || typeof url !== "string" || !url || url.startsWith("//")) return url;
  if (url.includes("?") || url.includes("#")) return url;
  let pathname = url;
  if (!pathname.startsWith("/")) {
    if (typeof location === "undefined") return url;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) {
      if (!url.startsWith(location.origin + "/")) return url;
      pathname = url.slice(location.origin.length);
    } else {
      pathname = new URL(url, location.href).pathname;
    }
  }
  const tag = tags.get(pathname) ?? tags.get(decodeSafe(pathname));
  return tag ? `${url}?v=${tag}` : url;
};

if (typeof globalThis !== "undefined" && !globalThis.__studioAssetPatch) {
  globalThis.__studioAssetPatch = true;
  if (typeof globalThis.fetch === "function") {
    const origFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = new Proxy(globalThis.fetch, {
      apply: (_target, _receiver, [input, init]: [RequestInfo | URL, RequestInit?]) => {
        const method = (
          init?.method ?? (input instanceof Request ? input.method : "GET")
        ).toUpperCase();
        if (method === "GET" || method === "HEAD") {
          if (typeof input === "string") {
            const next = versionUrl(input);
            if (next !== input) return origFetch(next, init);
          } else if (input instanceof URL && typeof location !== "undefined") {
            if (input.origin === location.origin && !input.search) {
              const next = versionUrl(input.pathname);
              if (next !== input.pathname) return origFetch(next, init);
            }
          } else if (input instanceof Request && typeof location !== "undefined") {
            const u = new URL(input.url, location.href);
            if (u.origin === location.origin && !u.search) {
              const next = versionUrl(u.pathname);
              if (next !== u.pathname) return origFetch(new Request(next, input), init);
            }
          }
        }
        return origFetch(input, init);
      },
    });
  }
  const desc =
    typeof HTMLImageElement !== "undefined"
      ? Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src")
      : undefined;
  if (desc?.set && desc.get) {
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      configurable: true,
      enumerable: desc.enumerable,
      get() {
        return desc.get!.call(this);
      },
      set(value: string) {
        desc.set!.call(this, versionUrl(value));
      },
    });
  }
}
