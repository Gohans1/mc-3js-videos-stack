export const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

const RETRY_DELAYS_MS = [250, 750, 2000, 4000, 8000, 16000];
const MAX_RETRY_DELAY_MS = 30_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
type RetryMode = "persistent" | "interactive";

export class FileRequestError extends Error {
  constructor(
    url: string,
    readonly status: number | null,
  ) {
    super(`Couldn't load ${url}${status === null ? "" : ` (HTTP ${status})`}`);
    this.name = "FileRequestError";
  }

  get retryable() {
    return this.status === null || RETRYABLE.has(this.status);
  }
}

const retryDelay = (response: Response | null, backoff: number) => {
  const header = response?.headers.get("retry-after");
  if (!header) return backoff;
  const delay = /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
  return Number.isFinite(delay) ? Math.max(delay, backoff) : backoff;
};

const fetchFile = async (
  url: string,
  initial: Promise<Response | null> | undefined,
  retry: RetryMode,
) => {
  for (let attempt = 0; ; attempt++) {
    const request = attempt === 0 && initial ? initial : fetch(url);
    const response = await request.catch(() => null);
    if (response) {
      if (response.ok || response.status === 404) return response;
      void response.body?.cancel().catch(() => {});
      if (!RETRYABLE.has(response.status)) throw new FileRequestError(url, response.status);
    }
    const backoff = RETRY_DELAYS_MS[attempt] ?? MAX_RETRY_DELAY_MS;
    const delay = retryDelay(response, backoff);
    if (retry === "interactive" && (attempt >= 2 || delay > 5000))
      throw new FileRequestError(url, response?.status ?? null);
    await wait(Math.min(delay, MAX_TIMER_DELAY_MS));
  }
};

const prefetched = new Map<
  string,
  { request: Promise<Response | null>; controller?: AbortController }
>();
const bootPrefetch = () =>
  typeof window !== "undefined"
    ? (window as { __PREFETCH?: Record<string, Promise<Response | null>> }).__PREFETCH
    : undefined;

const takeBootPrefetch = (url: string) => {
  const map = bootPrefetch();
  const hit = map?.[url];
  if (map) delete map[url];
  return hit;
};
export const prefetchFile = (url: string) => {
  if (prefetched.has(url)) return;
  const early = takeBootPrefetch(url);
  const controller = early ? undefined : new AbortController();
  prefetched.set(url, {
    request: early ?? fetch(url, { signal: controller?.signal }).catch(() => null),
    controller,
  });
};
export const clearPrefetch = (url?: string) => {
  const boot = bootPrefetch();
  if (url) {
    prefetched.get(url)?.controller?.abort();
    prefetched.delete(url);
    if (boot) delete boot[url];
    return;
  }
  for (const { controller } of prefetched.values()) controller?.abort();
  prefetched.clear();
  if (boot) for (const key of Object.keys(boot)) delete boot[key];
};

export const getFile = (url: string, retry: RetryMode = "persistent") => {
  const hit = prefetched.get(url);
  prefetched.delete(url);
  return fetchFile(url, hit?.request ?? takeBootPrefetch(url), retry);
};
export const postJson = (url: string, body: unknown) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
