// The AI as a collaborator under the picture: a dot that is lit while it works, its latest line beside it, and on a click
// the lines before (activity.ts). A line names seconds or a note: clicking it there takes the playhead to them, as any jump
// the creator asks for; the AI's lines alone never move anything
import { Bot, Check, CircleX, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { Tip } from "../components/Tip";
import { get, useStudio } from "../core/store";
import { stamp } from "../core/time";
import { noteAt } from "../notes/notes";
import { seek } from "../playback/transport";
import { busy, type Seen, useActivity } from "./activity";

const ago = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 10
    ? "now"
    : s < 60
      ? `${s} s`
      : s < 3600
        ? `${Math.round(s / 60)} min`
        : `${Math.round(s / 3600)} h`;
};
// redrawn every few seconds, so "now" grows old and the dot goes idle without a new line
const useNow = (every: number) => {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [every]);
  return now;
};
// the second a line is about: its own, else its first note's
const secondOf = (a: Seen) => {
  if (a.at !== undefined) return a.at;
  const n = a.notes?.length ? get().notes.find((x) => x.id === a.notes![0]) : undefined;
  return n ? noteAt(n) : null;
};

// how a check or a render came out, beside its line; its words say it too
function Outcome({ level }: { level: Seen["level"] }) {
  const Icon = level === "fail" ? CircleX : level === "warn" ? TriangleAlert : Check;
  return level ? (
    <Icon
      aria-hidden
      className={cn(
        "size-3.5 flex-none self-center",
        level === "fail"
          ? "text-destructive"
          : level === "warn"
            ? "text-warn-text"
            : "text-ok-text",
      )}
    />
  ) : null;
}

function Line({ a, now }: { a: Seen; now: number }) {
  const t = secondOf(a),
    body = (
      <>
        <span className="text-muted-foreground w-12 flex-none text-xs tabular-nums">
          {ago(now - a.seen)}
        </span>
        <Outcome level={a.level} />
        <span className="min-w-0 flex-1 wrap-anywhere">{a.say}</span>
        {t !== null && (
          <span className="text-muted-foreground flex-none text-xs tabular-nums">{stamp(t)}</span>
        )}
      </>
    );
  const row = "flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left";
  return (
    <li>
      {t === null ? (
        <div className={row}>{body}</div>
      ) : (
        <button
          type="button"
          className={cn(
            row,
            "hover:bg-muted focus-visible:ring-ring outline-none focus-visible:ring-2",
          )}
          onClick={() => seek(t)}
        >
          {body}
        </button>
      )}
      {/* what a check found, each a jump to its second, as the ruler lights them */}
      {a.marks?.length ? (
        <ul aria-label="What it found" className="flex flex-wrap gap-1 ps-16 pe-2 pb-1.5">
          {a.marks.map((m, i) => (
            <li key={i}>
              <Button variant="quiet" size="sm" onClick={() => seek(m.at)}>
                <span className="tabular-nums">{stamp(m.at)}</span>
                {m.say}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

// off in Settings, nothing of it runs
export function AiPresence({ className }: { className?: string }) {
  return useStudio((s) => s.aiActivity) ? <Presence className={className} /> : null;
}

function Presence({ className }: { className?: string }) {
  const state = useActivity((s) => s),
    now = useNow(5000);
  const { items } = state,
    last = items.at(-1);
  const live = busy(state, now);
  const statusLabel = last ? last.say : live ? "AI working" : "AI idle";
  return (
    <Popover>
      <Tip
        label={
          last ? `The AI: ${last.say} (${ago(now - last.seen)})` : "The AI: nothing from it yet"
        }
      >
        <PopoverTrigger
          render={
            <Button
              variant={live ? "ai" : "subtle"}
              size="md"
              aria-label={`${statusLabel} — What the AI is doing`}
              className={cn(
                "max-w-[min(22rem,36cqw)] min-w-11 shrink overflow-hidden @[900px]:max-w-[min(28rem,44cqw)]",
                className,
              )}
            />
          }
        >
          <span
            aria-hidden
            className="relative flex size-2.5 flex-none items-center justify-center"
          >
            {live && (
              <span className="bg-ai absolute inset-0 rounded-full opacity-60 motion-safe:animate-ping" />
            )}
            <span
              className={cn(
                "relative size-2 rounded-full",
                live ? "bg-ai" : "bg-muted-foreground/50",
              )}
            />
          </span>
          <Bot
            data-icon="inline-start"
            className={cn(live ? "text-ai-text" : "text-muted-foreground")}
          />
          {!live && !last && (
            <span className="text-muted-foreground @max-[560px]:hidden">AI idle</span>
          )}
          {last && <Outcome key={`o${last.id}`} level={last.level} />}
          {last && (
            <span
              key={last.id}
              className={cn(
                "motion-safe:animate-in motion-safe:fade-in-0 min-w-0 truncate duration-500 @max-[760px]:hidden",
                live ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {last.say}
            </span>
          )}
        </PopoverTrigger>
      </Tip>
      <PopoverContent
        variant="flush"
        side="top"
        align="start"
        sideOffset={8}
        className="max-h-[min(480px,var(--available-height))] w-[min(420px,calc(100vw-24px))]"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-1 p-1.5">
          <p className="text-muted-foreground px-2 pt-1 text-xs">
            {live
              ? "The AI is at work"
              : last
                ? `The AI, quiet for ${ago(now - last.seen)}`
                : "Nothing from the AI yet"}
            . Its latest first; a line with a time jumps there.
          </p>
          <ul
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
            aria-label="What the AI did"
          >
            {items.toReversed().map((a) => (
              <Line key={a.id} a={a} now={now} />
            ))}
          </ul>
        </div>
      </PopoverContent>
      {/* how the AI's latest check or render came out, said to a screen reader as a status: politely, never moving the
          focus; every line would talk over the film at each rebuild */}
      <span role="status" className="sr-only">
        {items.findLast((a) => a.level)?.say ?? ""}
      </span>
    </Popover>
  );
}
