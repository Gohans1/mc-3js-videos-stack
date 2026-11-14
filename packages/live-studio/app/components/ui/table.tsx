import * as React from "react";

import { cn } from "@/lib/utils";

function Table({
  className,
  containerRef,
  containerClassName,
  ...props
}: React.ComponentProps<"table"> & {
  containerRef?: React.Ref<HTMLDivElement>;
  containerClassName?: string;
}) {
  return (
    <div
      ref={containerRef}
      data-slot="table-container"
      className={cn("relative w-full overflow-x-auto", containerClassName)}
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-xs", className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({
  className,
  sticky,
  ...props
}: React.ComponentProps<"thead"> & { sticky?: boolean }) {
  return (
    <thead
      data-slot="table-header"
      className={cn(
        "[&_tr]:border-b",
        sticky && "bg-background/95 sticky top-0 z-10 backdrop-blur-xs",
        className,
      )}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn("bg-muted/50 border-t font-medium [&>tr]:last:border-b-0", className)}
      {...props}
    />
  );
}

function TableRow({
  className,
  tone = "default",
  ...props
}: React.ComponentProps<"tr"> & {
  tone?: "default" | "open" | "check" | "done";
}) {
  return (
    <tr
      data-slot="table-row"
      data-tone={tone}
      className={cn(
        "hover:bg-white/[0.03] has-aria-expanded:bg-white/[0.03] data-[state=selected]:bg-white/[0.05] data-[tone=check]:bg-warn-bg/35 data-[tone=check]:hover:bg-warn-bg/55 data-[tone=open]:hover:bg-white/[0.03] data-[tone=done]:bg-transparent data-[tone=done]:text-foreground/78 data-[tone=done]:hover:bg-white/[0.025] border-b border-white/[0.06] transition-colors duration-150",
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "text-muted-foreground h-8 px-2 text-left align-middle text-[11px] font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn("px-2 py-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0", className)}
      {...props}
    />
  );
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("text-muted-foreground mt-4 text-xs", className)}
      {...props}
    />
  );
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
