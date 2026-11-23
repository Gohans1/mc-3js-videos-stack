export async function openPage(entry: string, extra?: (req: Request) => Response | undefined) {
  const built = await Bun.build({ entrypoints: [entry], target: "browser" });
  if (!built.success) throw new AggregateError(built.logs, `could not bundle ${entry}`);
  const files = new Map(built.outputs.map((o) => [o.path.replace(/^\.\//, "/"), o]));
  const entryJs = built.outputs.find((o) => o.kind === "entry-point")!.path.replace(/^\.\//, "/");
  const links = [...files.keys()]
    .filter((p) => p.endsWith(".css"))
    .map((p) => `<link rel="stylesheet" href="${p}">`);
  const server = Bun.serve({
    port: 0,
    fetch: (req) => {
      const response = extra?.(req);
      if (response) return response;
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
