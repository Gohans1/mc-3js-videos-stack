import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { XIcon } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

const instant = "motion-safe:data-closed:animate-none motion-safe:data-open:animate-none";

const confirmationFade =
  `${instant} transition-opacity duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] data-ending-style:opacity-0 data-ending-style:duration-150 motion-reduce:duration-100 motion-reduce:data-ending-style:duration-100`;

const overlayVariants = cva("", {
  variants: {
    variant: {
      default: "",
      settings: "bg-transparent supports-backdrop-filter:backdrop-blur-none",
      workbench: instant,
      confirmation: "duration-200 data-closed:duration-150",
    },
    motion: { default: "", none: instant, confirmation: confirmationFade },
  },
  defaultVariants: { variant: "default", motion: "default" },
});
function DialogOverlay({
  className,
  variant,
  motion,
  ...props
}: DialogPrimitive.Backdrop.Props & VariantProps<typeof overlayVariants>) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      data-motion={motion}
      className={cn(
        "motion-safe:data-open:animate-in data-open:fade-in-0 motion-safe:data-closed:animate-out data-closed:fade-out-0 bg-scrim-strong fixed inset-0 isolate z-50 duration-100 supports-backdrop-filter:backdrop-blur-xs",
        overlayVariants({ variant, motion }),
        className,
      )}
      {...props}
    />
  );
}

const dialogVariants = cva("", {
  variants: {
    variant: {
      default: "data-open:zoom-in-95 data-closed:zoom-out-95",
      settings: "bg-background data-open:zoom-in-95 data-closed:zoom-out-95 gap-0 rounded-sm p-0",
      workbench:
        "bg-background gap-0 rounded-sm p-0 motion-safe:data-closed:animate-none motion-safe:data-open:animate-none",
      confirmation:
        "data-open:zoom-in-97 data-closed:zoom-out-97 duration-200 data-closed:duration-150",
    },
    font: { default: "", md: "font-md" },
    motion: { default: "", none: instant, confirmation: confirmationFade },
  },
  defaultVariants: { variant: "default", font: "default", motion: "default" },
});

function DialogContent({
  className,
  children,
  showCloseButton = true,
  variant,
  font,
  motion,
  ...props
}: DialogPrimitive.Popup.Props &
  VariantProps<typeof dialogVariants> & {
    showCloseButton?: boolean;
  }) {
  return (
    <DialogPortal>
      <DialogOverlay variant={variant} motion={motion} />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        data-variant={variant ?? "default"}
        data-motion={motion}
        className={cn(
          "bg-popover text-ui/relaxed text-popover-foreground ring-foreground/10 motion-safe:data-open:animate-in data-open:fade-in-0 motion-safe:data-closed:animate-out data-closed:fade-out-0 fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overscroll-contain rounded-xl p-4 ring-1 duration-100 outline-none sm:max-w-sm",
          dialogVariants({ variant, font, motion }),
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={<Button variant="ghost" className="absolute top-2 right-2" size="icon-sm" />}
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="dialog-header" className={cn("flex flex-col gap-1", className)} {...props} />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>Close</DialogPrimitive.Close>
      )}
    </div>
  );
}

const dialogTitleVariants = cva("", {
  variants: {
    variant: {
      default: "",
      reading: "text-xl outline-none",
      compact: "text-xs font-normal",
      workbench: "text-base font-semibold tracking-tight",
    },
  },
  defaultVariants: { variant: "default" },
});
function DialogTitle({
  className,
  variant,
  ...props
}: DialogPrimitive.Title.Props & VariantProps<typeof dialogTitleVariants>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-title font-semibold",
        dialogTitleVariants({ variant }),
        className,
      )}
      {...props}
    />
  );
}

const dialogDescriptionVariants = cva("", {
  variants: { variant: { default: "", compact: "text-xs", comfortable: "text-sm leading-normal" } },
  defaultVariants: { variant: "default" },
});
function DialogDescription({
  className,
  variant,
  ...props
}: DialogPrimitive.Description.Props & VariantProps<typeof dialogDescriptionVariants>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-ui/relaxed text-muted-foreground *:[a]:hover:text-foreground *:[a]:underline *:[a]:underline-offset-3",
        dialogDescriptionVariants({ variant }),
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
