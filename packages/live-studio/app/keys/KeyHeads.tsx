// The column beside the key rows (keys/keyrows.ts draws them): each key file's name, which folds its rows away, then the
// rows' names, line for line as keys/keys.ts lines() lays them out. The row of the object selected on the picture is lit and
// scrolled into sight, as CapCut lights the clip of what is picked; a click on an object's row selects it back
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useRef } from "react";
import { files, fold, HEAD_H, isFolded, lines, litRow, ROW_H, shortLabel } from "./keys";
import { select } from "../objects/placed";
import { S } from "../core/state";
import { useStudio } from "../core/store";

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
    <ul ref={list} aria-label="Keyframe tracks" className="bg-background">
      {lines().map((l) => l.kind === "file" ? (
        <li key={`f${l.f}`} style={{ height: HEAD_H }} className="bg-raised-2/40">
          <button
            type="button"
            aria-expanded={!isFolded(l.f)}
            onClick={() => fold(l.f, !isFolded(l.f))}
            className="flex h-full w-full items-center gap-1 ps-1 text-start text-xs font-semibold text-label outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            {isFolded(l.f) ? <ChevronRight className="size-3.5 flex-none" /> : <ChevronDown className="size-3.5 flex-none" />}
            <span className="truncate">{files[l.f].file.split("/").pop()}</span>
          </button>
        </li>
      ) : l.row.f === placedFile && l.row.path.at(-1) === "keys" ? (
        <li key={l.row.id} data-lit={l.row.id === lit} style={{ height: ROW_H }} className="group data-[lit=true]:bg-tint">
          <button
            type="button"
            title={`${l.row.label}: click to select it on the picture`}
            onClick={() => select(l.row.path[0])}
            className="flex h-full w-full items-center truncate ps-4 text-start text-xs text-label outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring group-data-[lit=true]:font-semibold group-data-[lit=true]:text-primary"
          >
            {shortLabel(l.row)}
          </button>
        </li>
      ) : (
        <li key={l.row.id} style={{ height: ROW_H }} title={l.row.label} className="flex items-center truncate ps-4 text-xs text-label">
          {shortLabel(l.row)}
        </li>
      ))}
    </ul>
  );
}
