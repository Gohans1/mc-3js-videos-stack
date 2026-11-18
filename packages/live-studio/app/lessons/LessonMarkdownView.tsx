import { Check, Pencil } from "lucide-react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

import { type InlineToken, type LessonBlock, parseInlines, parseLessonBlocks } from "./markdown";

const HEADING_STYLE: Record<number, string> = {
  1: "text-2xl/[1.4] font-semibold tracking-[-0.015em] mt-6 first:mt-0 pb-2 border-b border-border/50",
  2: "text-xl/[1.4] font-semibold tracking-[-0.01em] mt-5 first:mt-0",
  3: "text-lg/[1.4] font-semibold mt-4 first:mt-0",
  4: "text-base/[1.4] font-semibold mt-3.5 first:mt-0",
  5: "text-base/[1.4] font-medium mt-3 first:mt-0",
  6: "text-label text-base/[1.4] font-medium tracking-[0.05em] mt-2.5 first:mt-0",
};

function RenderInlines({ tokens }: { tokens: readonly InlineToken[] }) {
  return (
    <>
      {tokens.map((tok, i) => {
        if (tok.kind === "break") return <br key={i} />;
        if (tok.kind === "text") return <span key={i}>{tok.text}</span>;
        if (tok.kind === "strong")
          return (
            <strong key={i} className="text-foreground font-semibold">
              {tok.text}
            </strong>
          );
        if (tok.kind === "em")
          return (
            <em key={i} className="italic">
              {tok.text}
            </em>
          );
        if (tok.kind === "del")
          return (
            <del key={i} className="text-muted-foreground line-through">
              {tok.text}
            </del>
          );
        if (tok.kind === "code")
          return (
            <code
              key={i}
              className="bg-backdrop border-border/60 text-primary-text rounded border px-1 py-0.5 font-mono text-sm"
            >
              {tok.text}
            </code>
          );
        return (
          <a
            key={i}
            href={tok.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-text decoration-primary/50 hover:decoration-primary underline decoration-from-font underline-offset-2"
          >
            {tok.text}
          </a>
        );
      })}
    </>
  );
}

function HeadingBlock({
  block,
  onJumpEdit,
}: {
  block: Extract<LessonBlock, { type: "heading" }>;
  onJumpEdit?: (line: number) => void;
}) {
  const cls = HEADING_STYLE[block.depth] ?? HEADING_STYLE[4];
  const level = Math.min(6, Math.max(1, block.depth));
  const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  return (
    <div className={cn("text-lesson-heading flex items-start gap-2", cls)}>
      <Tag data-line={block.line} className="min-w-0 flex-1 text-balance wrap-anywhere">
        <RenderInlines tokens={block.inlines} />
      </Tag>
      {onJumpEdit && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Edit “${block.title}” at line ${block.line}`}
          title={`Edit at line ${block.line}`}
          onClick={() => onJumpEdit(block.line)}
        >
          <Pencil aria-hidden />
        </Button>
      )}
    </div>
  );
}

export function LessonMarkdownView({
  text,
  onJumpEdit,
}: {
  text: string;
  onJumpEdit?: (line: number) => void;
}) {
  const blocks = useMemo(() => parseLessonBlocks(text), [text]);
  if (!blocks.length) {
    return (
      <div className="font-md text-muted-foreground mx-auto w-full max-w-[33rem] py-4 text-base/[1.6]">
        Empty lesson file. Switch to Edit to start writing rules.
      </div>
    );
  }
  return (
    <article className="font-md text-foreground mx-auto flex w-full max-w-[33rem] flex-col gap-3.5 text-base/[1.6]">
      {blocks.map((b) => {
        if (b.type === "heading")
          return <HeadingBlock key={b.line} block={b} onJumpEdit={onJumpEdit} />;
        if (b.type === "paragraph")
          return (
            <p key={b.line} data-line={b.line} className="text-pretty wrap-anywhere">
              <RenderInlines tokens={b.inlines} />
            </p>
          );
        if (b.type === "blockquote")
          return (
            <blockquote
              key={b.line}
              data-line={b.line}
              className="border-hairline-strong bg-card/60 text-label rounded-e-md border-s px-3.5 py-2 text-pretty wrap-anywhere italic"
            >
              <RenderInlines tokens={b.inlines} />
            </blockquote>
          );
        if (b.type === "hr") return <Separator key={b.line} data-line={b.line} className="my-1" />;
        if (b.type === "code")
          return (
            <div
              key={b.line}
              data-line={b.line}
              className="bg-backdrop border-border overflow-hidden rounded-lg border"
            >
              {b.lang && (
                <div className="border-border/60 flex items-center justify-between border-b px-3 py-1.5">
                  <span className="text-muted-foreground font-mono text-xs">{b.lang}</span>
                </div>
              )}
              <pre className="text-label overflow-x-auto p-3 font-mono text-sm/[1.55]">
                <code>{b.code}</code>
              </pre>
            </div>
          );
        if (b.type === "list") {
          const Tag = b.ordered ? "ol" : "ul";
          return (
            <Tag
              key={b.line}
              data-line={b.line}
              className={cn("flex flex-col gap-1.5 pl-5", b.ordered ? "list-decimal" : "list-disc")}
            >
              {b.items.map((item) => (
                <li
                  key={item.line}
                  data-line={item.line}
                  className={cn(
                    "text-pretty wrap-anywhere",
                    item.checked !== null && "-ml-5 flex list-none items-start gap-2",
                  )}
                >
                  {item.checked !== null && (
                    <>
                      <span className="sr-only">{item.checked ? "Done: " : "Todo: "}</span>
                      <span
                        aria-hidden
                        className={cn(
                          "mt-1 grid size-4 shrink-0 place-items-center rounded border",
                          item.checked
                            ? "bg-primary border-primary text-primary-foreground"
                            : "border-input bg-backdrop",
                        )}
                      >
                        {item.checked && <Check className="size-3" />}
                      </span>
                    </>
                  )}
                  <span className={item.checked ? "text-muted-foreground line-through" : undefined}>
                    <RenderInlines tokens={item.inlines} />
                  </span>
                </li>
              ))}
            </Tag>
          );
        }
        return (
          <div
            key={b.line}
            data-line={b.line}
            className="border-border bg-card/40 overflow-x-auto rounded-lg border"
          >
            <table className="w-full caption-bottom border-collapse text-sm/[1.5]">
              <thead className="border-border bg-card/60 border-b">
                <tr>
                  {b.headers.map((h, i) => (
                    <th
                      key={i}
                      scope="col"
                      className="text-foreground border-border/60 px-3 py-2 text-start align-middle font-semibold whitespace-normal [&+th]:border-s"
                    >
                      <RenderInlines tokens={parseInlines(h)} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, ri) => (
                  <tr key={ri} className="border-border/50 hover:bg-surface-subtle border-t">
                    {b.headers.map((_, ci) => {
                      const cell = r[ci] ?? "";
                      return (
                        <td
                          key={ci}
                          className={cn(
                            "border-border/40 px-3 py-2 align-top whitespace-normal [&+td]:border-s",
                            cell.length > 90 && "min-w-48",
                            cell.length > 30 && cell.length <= 90 && "min-w-32",
                          )}
                        >
                          <RenderInlines tokens={parseInlines(cell)} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </article>
  );
}
