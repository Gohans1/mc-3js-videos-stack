import { Box, FileCode, Image as ImageIcon } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import type { PropCatalog, PropEntry, PropScope } from "../../src/prop-library";
import { Segmented } from "../components/inspector";

const ModelPreview = lazy(() => import("./PropModelPreview"));

type CatalogState =
  { status: "loading" | "error"; data?: undefined } | { status: "ready"; data: PropCatalog };

export function usePropCatalog() {
  const [state, setState] = useState<CatalogState>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let lastText: string | undefined;
    const read = async () => {
      try {
        if (document.hidden) return;
        const response = await fetch("/api/props", { signal: controller.signal });
        if (!response.ok) throw new Error("Could not load props");
        const text = await response.text();
        if (controller.signal.aborted || lastText === text) return;
        const data: PropCatalog = JSON.parse(text);
        lastText = text;
        setState({ status: "ready", data });
      } catch {
        lastText = undefined;
        if (!controller.signal.aborted) setState({ status: "error" });
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(read, 2500);
      }
    };
    void read();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);
  return state;
}

const previewUrl = (scope: PropScope, preview: { path: string; version: string }) =>
  "/api/props/preview?" + new URLSearchParams({ scope, path: preview.path, v: preview.version });

const nameOf = (entry: PropEntry) => entry.id.split("/").at(-1)!.replace(/[_-]/g, " ");

function PropRow({ entry, scope }: { entry: PropEntry; scope: PropScope }) {
  const name = nameOf(entry);
  const image = entry.image && previewUrl(scope, entry.image);
  const model = entry.model && previewUrl(scope, entry.model);
  const path = entry.source ?? entry.model?.path ?? entry.image?.path;
  const Fallback = model ? Box : entry.image ? ImageIcon : FileCode;
  const [failedImage, setFailedImage] = useState<string>();
  const [view, setView] = useState<"image" | "model">("image");
  const imageFailed = image === failedImage;
  const displayedModel = !image || view === "model" ? model : undefined;
  const choice = (
    <>
      <span className="bg-background text-muted-foreground grid size-9 flex-none place-items-center overflow-hidden rounded-md">
        {image && !imageFailed ? (
          <img
            src={image}
            alt=""
            loading="lazy"
            onError={() => setFailedImage(image)}
            className="size-full object-contain"
          />
        ) : (
          <Fallback aria-hidden className="size-4" />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className="text-ui truncate first-letter:uppercase">{name}</span>
        <span translate="no" className="text-muted-foreground truncate text-xs" title={path}>
          {path}
        </span>
      </span>
    </>
  );
  return (
    <li>
      {model || image ? (
        <Dialog>
          <DialogTrigger
            render={
              <Button
                variant="ghost"
                size="row"
                aria-label={"Preview " + name}
                className="min-h-11 w-full"
              />
            }
          >
            {choice}
          </DialogTrigger>
          <DialogContent className="sm:max-w-xl">
            <DialogTitle className="me-8">{name}</DialogTitle>
            <DialogDescription className="break-all">
              {displayedModel ? entry.model?.path : entry.image?.path}
            </DialogDescription>
            {image && model && (
              <Segmented
                label="Preview type"
                value={view}
                onChange={setView}
                items={[
                  { id: "image", title: "Image" },
                  { id: "model", title: "3D" },
                ]}
              />
            )}
            {displayedModel ? (
              <Suspense fallback={<p role="status">Loading 3D preview…</p>}>
                <ModelPreview key={displayedModel} url={displayedModel} />
              </Suspense>
            ) : imageFailed ? (
              <p role="status">Could not load the image.</p>
            ) : (
              <img
                src={image}
                alt={name}
                onError={() => setFailedImage(image)}
                className="max-h-[65dvh] w-full rounded-md object-contain"
              />
            )}
          </DialogContent>
        </Dialog>
      ) : (
        <div className="flex min-h-11 items-center gap-2 px-1">
          {choice}
          <span className="text-muted-foreground flex-none text-xs">No preview</span>
        </div>
      )}
    </li>
  );
}

export function PropRows({
  entries,
  scope,
  visible,
}: {
  entries: PropEntry[];
  scope: PropScope;
  visible: number;
}) {
  return entries
    .slice(0, visible)
    .map((entry) => <PropRow key={scope + ":" + entry.id} entry={entry} scope={scope} />);
}
