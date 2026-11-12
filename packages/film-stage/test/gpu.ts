// Runs a test page in headless Chrome (Bun.WebView over CDP; Edge or Chrome, software WebGL via SwiftShader) so a test drives
// the real shaders instead of a JavaScript copy of them. The entry is bundled for the browser and served on a free port.
export async function openPage(entry: string) {
  const built = await Bun.build({ entrypoints: [entry], target: "browser" });
  if (!built.success) throw new AggregateError(built.logs, `could not bundle ${entry}`);
  // CSS the page imports (fonts arrive inlined as data URLs) comes out as its own asset
  const files = new Map(built.outputs.map((o) => [o.path.replace(/^\.\//, "/"), o]));
  const entryJs = built.outputs.find((o) => o.kind === "entry-point")!.path.replace(/^\.\//, "/");
  const links = [...files.keys()]
    .filter((p) => p.endsWith(".css"))
    .map((p) => `<link rel="stylesheet" href="${p}">`);
  const server = Bun.serve({
    port: 0,
    fetch: (req) => {
      const file = files.get(new URL(req.url).pathname);
      if (file) return new Response(file);
      return new Response(
        `<!doctype html>${links.join("")}<script type="module" src="${entryJs}"></script>`,
        {
          headers: { "content-type": "text/html" },
        },
      );
    },
  });
  const view = new Bun.WebView({
    backend: { type: "chrome", argv: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] },
  });
  await view.navigate(server.url.href);
  return {
    run: <T>(expr: string) => view.evaluate(expr) as Promise<T>,
    close: () => {
      view.close();
      server.stop(true);
    },
  };
}
