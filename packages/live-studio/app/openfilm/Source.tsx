import { type ReactNode, useEffect, useState } from "react";

import { gradeOf, gradeTarget, putGrade } from "../camera/adjust";
import { setTransition } from "../camera/transitions";
import { Segmented } from "../components/inspector";
import { OpenFilmLibrary } from "./Library";
import { loadOpenFilmAssets } from "./state";

export function AssetSource({
  category,
  children,
}: {
  category: "text" | "transition" | "filter";
  children: ReactNode;
}) {
  const [source, setSource] = useState("native"),
    [error, setError] = useState("");
  useEffect(() => {
    void loadOpenFilmAssets().catch((e) => setError(e.message));
  }, []);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="px-3">
        <Segmented
          label="Asset source"
          value={source}
          onChange={setSource}
          items={[
            { id: "native", title: "Built-in & film" },
            { id: "openfilm", title: "OpenFilm" },
          ]}
        />
      </div>
      {error && (
        <p role="alert" className="text-destructive px-3 text-xs">
          {error}
        </p>
      )}
      {source === "native" ? (
        children
      ) : (
        <OpenFilmLibrary
          category={category}
          onApply={
            category === "transition"
              ? async (request) => {
                  setTransition(
                    request.shot,
                    `of:${request.asset}`,
                    request.to - request.from,
                    request.props,
                  );
                }
              : category === "filter"
                ? async (request) => {
                    const response = await fetch("/api/openfilm/lut", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ asset: request.asset }),
                    });
                    const lut = await response.json();
                    if (!response.ok) throw new Error(lut.error ?? "Cannot create LUT");
                    const target = gradeTarget();
                    await putGrade(target, { ...gradeOf(target), lut: { ...lut, amount: 100 } });
                  }
                : undefined
          }
        />
      )}
    </div>
  );
}
