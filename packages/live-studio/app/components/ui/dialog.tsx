import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { XIcon } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const InstantDialog = React.createContext(false);

function Dialog({
  instantForKeyboard = false,
  onOpenChange,
  ...props
}: DialogPrimitive.Root.Props & { instantForKeyboard?: boolean }) {
  const [instant, setInstant] = React.useState(false);
  return (
    <InstantDialog.Provider value={instant}>
      <DialogPrimitive.Root
        data-slot="dialog"
        {...props}
        onOpenChange={
          instantForKeyboard
            ? (open, details) => {
                const event = details.event;
                setInstant(
                  details.reason === "escape-key" ||
                    event instanceof KeyboardEvent ||
                    (event instanceof MouseEvent && event.detail === 0),
                );
                onOpenChange?.(open, details);
              }
            : onOpenChange
        }
      />
    </InstantDialog.Provider>
  );
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

const overlayVariants = cva("", {
  variants: {
    variant: {
      default: "",
      settings: "bg-transparent supports-backdrop-filter:backdrop-blur-none",
      workbench: "",
    },
  },
  defaultVariants: { variant: "default" },
});
const fadeDialog =
  "transition-opacity duration-100 ease-out data-starting-style:opacity-0 data-ending-style:opacity-0";

function DialogOverlay({
  className,
  variant,
  motion,
  ...props
}: DialogPrimitive.Backdrop.Props &
  VariantProps<typeof overlayVariants> & { motion?: "fade" | "instant" }) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "bg-scrim-strong fixed inset-0 isolate z-50 supports-backdrop-filter:backdrop-blur-xs",
        motion === "fade"
          ? fadeDialog
          : motion !== "instant" &&
              "motion-safe:data-open:animate-in data-open:fade-in-0 motion-safe:data-closed:animate-out data-closed:fade-out-0 duration-100",
        overlayVariants({ variant }),
        className,
      )}
      {...props}
    />
  );
}

const dialogVariants = cva("", {
  variants: {
    variant: {
      default: "",
      settings: "bg-background gap-0 rounded-sm p-0",
      workbench: "bg-background gap-0 rounded-sm p-0",
    },
    font: { default: "", md: "font-md" },
  },
  defaultVariants: { variant: "default", font: "default" },
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
    motion?: "fade";
  }) {
  const presentation = React.useContext(InstantDialog) && motion === "fade" ? "instant" : motion;
  return (
    <DialogPortal>
      <DialogOverlay variant={variant} motion={presentation} />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "bg-popover text-ui/relaxed text-popover-foreground ring-foreground/10 fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overscroll-contain rounded-xl border border-transparent p-4 ring-1 outline-none sm:max-w-sm forced-colors:border-[CanvasText]",
          presentation === "fade"
            ? fadeDialog
            : presentation !== "instant" &&
                "motion-safe:data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 motion-safe:data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 duration-100",
          dialogVariants({ variant, font }),
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
