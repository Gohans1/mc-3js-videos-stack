import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const textareaVariants = cva(
  "flex field-sizing-content min-h-16 w-full resize-none rounded-md border transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
  {
    variants: {
      variant: {
        default: "border-input bg-input/20 px-2 py-2 text-ui/relaxed focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30",
        note: "border-primary bg-background px-2.5 py-2 text-title/normal focus-visible:ring-1 focus-visible:ring-primary pointer-coarse:text-base sideways:px-2 sideways:py-1.5",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

function Textarea({ className, variant = "default", ...props }: React.ComponentProps<"textarea"> & VariantProps<typeof textareaVariants>) {
  return <textarea data-slot="textarea" className={cn(textareaVariants({ variant }), className)} {...props} />
}

export { Textarea, textareaVariants }
