// The column beside the key rows (keys/keyrows.ts draws them): each key file's heading, which folds its rows away, then the
// rows' names, line for line as keys/keys.ts lines() lays them out. The row of the object selected on the picture is lit and
// scrolled into sight, as CapCut lights the clip of what is picked; a click on an object's row selects it back
import { ChevronRight } from "lucide-react";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

import { S } from "../core/state";
import { useStudio } from "../core/store";
import { select } from "../objects/placed";
import {
  files,
  fileTitle,
  fold,
  HEAD_H,
  isFolded,
  labelSteps,
  lines,
  litRow,
  type Row,
  ROW_H,
  rowsOf,
} from "./keys";

// "typing › tries": the owner dim, and in a narrow column the first to give way, so the row's own name stays readable
function RowName({ row }: { row: Row }) {
  const [a, b] = labelSteps(row);
  if (b === undefined) return <span className="truncate">{a}</span>;
  return (
    <span className="flex min-w-0">
      <span className="text-muted-foreground min-w-0 shrink-[999] truncate">{a}</span>
      <span aria-hidden className="text-muted-foreground mx-1 flex-none">
        ›
      </span>
      <span className="min-w-0 truncate">{b}</span>
    </span>
  );
}

export function KeyHeads() {
  useStudio((s) => s.keysRev);
  const object = useStudio((s) => s.object),
    list = useRef<HTMLUListElement>(null);
  const lit = litRow(),
    placedFile = files.findIndex((x) => x.edit === S.tools?.placed?.key);
  const placedFolded = placedFile >= 0 && isFolded(placedFile);
  useEffect(() => {
    if (!object || placedFile < 0) return;
    if (placedFolded) {
      fold(placedFile, false);
      return;
    } // drawn unfolded next time, then scrolled to
    list.current?.querySelector('[data-lit="true"]')?.scrollIntoView({ block: "nearest" });
  }, [object, lit, placedFile, placedFolded]);
  return (
    <ul
      ref={list}
      aria-label="Keyframe tracks"
      className="border-track-line bg-track-head border-e"
    >
      {lines().map((l) =>
        l.kind === "file" ? (
          <li key={`f${l.f}`} style={{ "--row-h": `${HEAD_H}px` }} className="bg-card h-(--row-h)">
            <button
              type="button"
              aria-expanded={!isFolded(l.f)}
              aria-label={`${fileTitle(l.f)}, ${rowsOf(l.f).length} row${rowsOf(l.f).length === 1 ? "" : "s"}`}
              title={files[l.f].file}
              onClick={() => fold(l.f, !isFolded(l.f))}
              className="group/head text-ui text-label hover:text-foreground focus-visible:ring-ring flex h-full w-full items-center gap-1 ps-1 pe-2 text-start font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset"
            >
              <ChevronRight
                aria-hidden
                className={cn(
                  "text-muted-foreground group-hover/head:text-foreground size-3.5 flex-none motion-safe:transition-transform",
                  !isFolded(l.f) && "rotate-90",
                )}
              />
              <span className="min-w-0 flex-1 truncate">{fileTitle(l.f)}</span>
              <span className="text-tag text-muted-foreground flex-none tabular-nums">
                {rowsOf(l.f).length}
              </span>
            </button>
          </li>
        ) : l.row.f === placedFile && l.row.path.at(-1) === "keys" ? (
          <li
            key={l.row.id}
            data-lit={l.row.id === lit}
            style={{ "--row-h": `${ROW_H}px` }}
            className="group data-[lit=true]:bg-tint h-(--row-h)"
          >
            <button
              type="button"
              title={`${l.row.label}: click to select it on the picture`}
              onClick={() => select(l.row.path[0])}
              className="text-label hover:text-foreground focus-visible:ring-ring group-data-[lit=true]:text-primary flex h-full w-full items-center ps-5.5 pe-2 text-start text-xs outline-none group-data-[lit=true]:font-semibold focus-visible:ring-2 focus-visible:ring-inset"
            >
              <RowName row={l.row} />
            </button>
          </li>
        ) : (
          <li
            key={l.row.id}
            style={{ "--row-h": `${ROW_H}px` }}
            title={l.row.label}
            className="text-label flex h-(--row-h) items-center ps-5.5 pe-2 text-xs"
          >
            <RowName row={l.row} />
          </li>
        ),
      )}
    </ul>
  );
}
