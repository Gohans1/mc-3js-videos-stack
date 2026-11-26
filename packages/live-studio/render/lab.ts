// @ts-nocheck
export const post = async (url, body) => {
  const response = await fetch(url, { method: "POST", body });
  if (!response.ok) throw new Error(`POST ${url}: HTTP ${response.status}`);
  return response;
};
let said = Promise.resolve();
export const log = (m) =>
  (said = said.then(() => post("/log", String(m))).catch((error) => console.error(m, error)));
window.onerror = (m, s, l, c, e) => {
  log("ERROR " + String(e?.stack ?? (typeof m === "string" ? m : "script error")));
};
window.onunhandledrejection = (e) => {
  log("ERROR " + (e.reason?.stack ?? e.reason));
};

export const config = async () => (await fetch("/config")).json();
export const canvas = () => document.getElementById("gl");
export const still = async (name, from, quality = 0.92) =>
  post(
    `/still/${name}`,
    await new Promise((res) =>
      /\.png$/i.test(name)
        ? from.toBlob(res, "image/png")
        : from.toBlob(res, "image/jpeg", quality),
    ),
  );
export const done = (chunks?: number) =>
  said.then(() => post("/done", chunks === undefined ? "" : String(chunks)));
