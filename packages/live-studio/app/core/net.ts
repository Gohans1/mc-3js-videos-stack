export const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

const prefetched = new Map<string, Promise<Response>>();
const fetchFile = async (url: string) => {
  for (;;) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status === 404) return r;
    } catch {}
    await wait(2000);
  }
};
const takeBootPrefetch = (url: string): Promise<Response> | null => {
  const map =
    typeof window !== "undefined"
      ? (window as { __PREFETCH?: Record<string, Promise<Response | null>> }).__PREFETCH
      : undefined;
  const hit = map?.[url];
  if (!hit) return null;
  delete map[url];
  return hit.then((r) => r ?? fetchFile(url));
};
export const prefetchFile = (url: string) => {
  if (!prefetched.has(url)) prefetched.set(url, takeBootPrefetch(url) ?? fetchFile(url));
};
export const clearPrefetch = (url?: string) => {
  if (url) prefetched.delete(url);
  else prefetched.clear();
};

export const getFile = async (url: string) => {
  const hit = prefetched.get(url);
  if (hit) {
    prefetched.delete(url);
    return hit;
  }
  return takeBootPrefetch(url) ?? fetchFile(url);
};
export const postJson = (url: string, body: unknown) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
