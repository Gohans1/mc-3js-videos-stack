// The column beside the key rows (keys/keyrows.ts draws them): each key file's heading, which folds its rows away, then the
// rows' names, line for line as keys/keys.ts lines() lays them out. The row of the object selected on the picture is lit and
// scrolled into sight, as CapCut lights the clip of what is picked; a click on an object's row selects it back
import { ChevronRight } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { files, fileTitle, fold, HEAD_H, isFolded, labelSteps, lines, litRow, type Row, ROW_H, rowsOf } from "./keys";
import { select } from "../objects/placed";
import { S } from "../core/state";
import { useStudio } from "../core/store";

// "typing › tries": the owner dim, and in a narrow column the first to give way, so the row's own name stays readable
function RowName({ row }: { row: Row }) {
  const [a, b] = labelSteps(row);
  if (b === undefined) return <span className="truncate">{a}</span>;
  return (
    <span className="flex min-w-0">
      <span className="min-w-0 shrink-[999] truncate text-muted-foreground">{a}</span>
      <span aria-hidden className="mx-1 flex-none text-muted-foreground">›</span>
      <span className="min-w-0 truncate">{b}</span>
    </span>
  );
}

export function KeyHeads() {
  useStudio((s) => s.keysRev);
  const object = useStudio((s) => s.object), list = useRef<HTMLUListElement>(null);
  const lit = litRow(), placedFile = files.findIndex((x) => x.edit === S.tools?.placed?.key);
  useEffect(() => {
    if (!object || placedFile < 0) return;
    if (isFolded(placedFile)) { fold(placedFile, false); return; } // drawn unfolded next time, then scrolled to
    list.current?.querySelector('[data-lit="true"]')?.scrollIntoView({ block: "nearest" });
  }, [object, lit, placedFile >= 0 && isFolded(placedFile)]);
  return (
    <ul ref={list} aria-label="Keyframe tracks" className="border-e border-track-line bg-track-head">
      {lines().map((l) => l.kind === "file" ? (
        <li key={`f${l.f}`} style={{ "--row-h": `${HEAD_H}px` }} className="h-(--row-h) bg-card">
          <button
            type="button"
            aria-expanded={!isFolded(l.f)}
            aria-label={`${fileTitle(l.f)}, ${rowsOf(l.f).length} row${rowsOf(l.f).length === 1 ? "" : "s"}`}
            title={files[l.f].file}
            onClick={() => fold(l.f, !isFolded(l.f))}
            className="group/head flex h-full w-full items-center gap-1 ps-1 pe-2 text-start text-ui font-medium text-label outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <ChevronRight aria-hidden className={cn("size-3.5 flex-none text-muted-foreground group-hover/head:text-foreground motion-safe:transition-transform", !isFolded(l.f) && "rotate-90")} />
            <span className="min-w-0 flex-1 truncate">{fileTitle(l.f)}</span>
            <span className="flex-none text-tag text-muted-foreground tabular-nums">{rowsOf(l.f).length}</span>
          </button>
        </li>
      ) : l.row.f === placedFile && l.row.path.at(-1) === "keys" ? (
        <li key={l.row.id} data-lit={l.row.id === lit} style={{ "--row-h": `${ROW_H}px` }} className="group h-(--row-h) data-[lit=true]:bg-tint">
          <button
            type="button"
            title={`${l.row.label}: click to select it on the picture`}
            onClick={() => select(l.row.path[0])}
            className="flex h-full w-full items-center ps-5.5 pe-2 text-start text-xs text-label outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset group-data-[lit=true]:font-semibold group-data-[lit=true]:text-primary"
          >
            <RowName row={l.row} />
          </button>
        </li>
      ) : (
        <li key={l.row.id} style={{ "--row-h": `${ROW_H}px` }} title={l.row.label} className="flex h-(--row-h) items-center ps-5.5 pe-2 text-xs text-label">
          <RowName row={l.row} />
        </li>
      ))}
    </ul>
  );
}
