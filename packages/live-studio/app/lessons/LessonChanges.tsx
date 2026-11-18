import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { type lessonChanges } from "./changes";

/** Word-diff viewer for external/AI updates that have already been adopted. */
export function LessonChanges({
  news,
  goTo,
  onRead,
}: {
  news: ReturnType<typeof lessonChanges>;
  goTo: (line: number) => void;
  onRead: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-none px-3 pt-2 pb-2">
        <div className="mx-auto flex w-full max-w-[42rem] flex-wrap items-center gap-2">
          <span className="text-muted-foreground flex-1 text-sm">
            Latest file changes (already applied)
          </span>
          <Button variant="ghost" size="sm" onClick={onRead}>
            Mark as read
          </Button>
        </div>
      </div>
      <div className="scroll-fade min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-2">
        <div className="mx-auto w-full max-w-[42rem]">
          {news.hunks.map((h) => {
            let lineCursor = h.line;
            return (
              <section key={h.line} className="mb-2 overflow-hidden rounded-md">
                <button
                  type="button"
                  onClick={() => goTo(h.line)}
                  className="bg-card text-muted-foreground hover:text-foreground focus-visible:ring-ring studio-press text-ui w-full px-3 py-1.5 text-start font-medium tabular-nums outline-none focus-visible:ring-2"
                >
                  Go to line {h.line}
                </button>
                {h.rows.map((r, i) => {
                  const targetLine = lineCursor;
                  if (r.kind !== "removed") lineCursor++;
                  return (
                    <button
                      key={i}
                      type="button"
                      aria-label={`Line ${targetLine}${r.kind === "same" ? "" : `, ${r.kind}`}: ${r.text || "blank line"}`}
                      onClick={() => goTo(targetLine)}
                      className={cn(
                        "font-md focus-visible:ring-ring flex w-full gap-2 px-3 py-0.5 text-start text-base/[1.6] wrap-anywhere whitespace-pre-wrap transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-inset motion-reduce:transition-none",
                        r.kind === "added" && "bg-ok/12 hover:bg-ok/20",
                        r.kind === "removed" && "bg-destructive/12 hover:bg-destructive/20",
                        r.kind === "same" && "text-muted-foreground hover:bg-muted/40",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "w-2.5 flex-none font-mono select-none",
                          r.kind === "added" ? "text-ok-text" : "text-destructive-text",
                        )}
                      >
                        {r.kind === "added" ? "+" : r.kind === "removed" ? "−" : ""}
                      </span>
                      <span className="min-w-0 flex-1">
                        {r.kind !== "same" && (
                          <span className="sr-only">
                            {r.kind === "added" ? "Added: " : "Removed: "}
                          </span>
                        )}
                        {r.parts
                          ? r.parts.map((p, k) =>
                              p.changed ? (
                                <mark
                                  key={k}
                                  className={cn(
                                    "text-foreground rounded-xs",
                                    r.kind === "added"
                                      ? "bg-ok/35"
                                      : "bg-destructive/35 line-through",
                                  )}
                                >
                                  {p.text}
                                </mark>
                              ) : (
                                p.text
                              ),
                            )
                          : r.text || " "}
                      </span>
                    </button>
                  );
                })}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
