// Asking the studio's server for files and sending it changes
export const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

// A phone line drops for seconds at a time: a file the page can't do without is asked for again until it comes
export const getFile = async (url: string) => {
  for (;;) {
    try { const r = await fetch(url); if (r.ok || r.status === 404) return r; } catch {}
    await wait(2000);
  }
};
export const postJson = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
