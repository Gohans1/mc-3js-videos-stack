import { Check } from "lucide-react";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { type InlineToken, type LessonBlock, parseInlines, parseLessonBlocks } from "./markdown";

const HEAD_COLOR: Record<number, string> = {
  1: "text-md-h1 text-xl font-semibold tracking-tight mt-6 first:mt-0 pb-1.5 border-b border-border/50",
  2: "text-md-h2 text-lg font-semibold tracking-tight mt-5 first:mt-0",
  3: "text-md-h3 text-base font-semibold mt-4 first:mt-0",
  4: "text-md-h4 text-[15px] font-semibold mt-3.5 first:mt-0",
  5: "text-md-h5 text-sm font-medium mt-3 first:mt-0",
  6: "text-md-h6 text-xs font-semibold uppercase tracking-wide mt-2.5 first:mt-0",
};

function RenderInlines({
  tokens,
  allowLinks = true,
}: {
  tokens: readonly InlineToken[];
  allowLinks?: boolean;
}) {
  return (
    <>
      {tokens.map((tok, i) => {
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
              className="bg-backdrop border-border/60 text-primary rounded border px-1 py-0.5 font-mono text-xs"
            >
              {tok.text}
            </code>
          );
        if (!allowLinks)
          return (
            <span
              key={i}
              className="text-primary decoration-primary/50 underline underline-offset-3"
            >
              {tok.text}
            </span>
          );
        return (
          <a
            key={i}
            href={tok.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary decoration-primary/50 hover:decoration-primary underline underline-offset-3"
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
  const cls = HEAD_COLOR[block.depth] ?? HEAD_COLOR[4];
  const content = (
    <button
      type="button"
      onClick={() => onJumpEdit?.(block.line)}
      aria-label={`Edit "${block.title}" at line ${block.line}`}
      title={`Edit at line ${block.line}`}
      className="focus-visible:ring-ring inline-flex max-w-full cursor-pointer items-baseline gap-1.5 rounded text-left outline-none hover:opacity-85 focus-visible:ring-2"
    >
      <span className="wrap-anywhere">
        <RenderInlines tokens={block.inlines} allowLinks={false} />
      </span>
    </button>
  );
  const level = Math.min(6, Math.max(1, block.depth));
  const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  return (
    <Tag data-line={block.line} className={cls}>
      {content}
    </Tag>
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
      <div className="font-md text-muted-foreground mx-auto w-full max-w-[42rem] py-4 text-[15px]/[1.65]">
        Empty lesson file. Switch to Edit to start writing rules.
      </div>
    );
  }
  return (
    <article className="font-md text-foreground/95 mx-auto flex w-full max-w-[42rem] flex-col gap-3 text-[15px]/[1.65]">
      {blocks.map((b) => {
        if (b.type === "heading")
          return <HeadingBlock key={b.line} block={b} onJumpEdit={onJumpEdit} />;
        if (b.type === "paragraph")
          return (
            <p key={b.line} data-line={b.line} className="wrap-anywhere">
              <RenderInlines tokens={b.inlines} />
            </p>
          );
        if (b.type === "blockquote")
          return (
            <blockquote
              key={b.line}
              data-line={b.line}
              className="border-primary/50 bg-card/60 text-muted-foreground rounded-r-md border-l-2 py-1.5 pr-3 pl-3 italic"
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
                <div className="border-border/60 flex items-center justify-between border-b px-2.5 py-1">
                  <Badge variant="outline">{b.lang}</Badge>
                </div>
              )}
              <pre className="text-label overflow-x-auto p-2.5 font-mono text-xs leading-5">
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
              className={cn("flex flex-col gap-1.5 pl-4", b.ordered ? "list-decimal" : "list-disc")}
            >
              {b.items.map((item) => (
                <li
                  key={item.line}
                  data-line={item.line}
                  className={cn(
                    "wrap-anywhere",
                    item.checked !== null && "-ml-4 flex list-none items-start gap-2",
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
                            : "border-border bg-input",
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
            className="border-border bg-card/40 overflow-hidden rounded-lg border"
          >
            <Table>
              <TableHeader>
                <TableRow>
                  {b.headers.map((h, i) => (
                    <TableHead key={i} className="whitespace-normal">
                      <RenderInlines tokens={parseInlines(h)} />
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {b.rows.map((r, ri) => (
                  <TableRow key={ri}>
                    {b.headers.map((_, ci) => {
                      const cell = r[ci] ?? "";
                      return (
                        <TableCell
                          key={ci}
                          className={cn(
                            "align-top whitespace-normal",
                            cell.length > 90 && "min-w-48",
                            cell.length > 30 && cell.length <= 90 && "min-w-32",
                          )}
                        >
                          <RenderInlines tokens={parseInlines(cell)} />
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        );
      })}
    </article>
  );
}
