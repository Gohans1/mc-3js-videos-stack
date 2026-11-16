import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "@/lib/utils";

function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default" | "comfortable";
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch focus-visible:border-ring focus-visible:ring-ring/30 aria-invalid:border-destructive/50 aria-invalid:ring-destructive/40 data-checked:bg-primary data-unchecked:border-input data-unchecked:bg-backdrop relative inline-flex shrink-0 items-center rounded-full border border-transparent transition-colors duration-150 outline-none group-has-[:focus-visible]/field-label:border-transparent group-has-[:focus-visible]/field-label:ring-0 after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-2 aria-invalid:ring-2 data-disabled:cursor-not-allowed data-disabled:opacity-50 data-[size=comfortable]:h-6 data-[size=comfortable]:w-10 data-[size=default]:h-[16.6px] data-[size=default]:w-[28px] data-[size=sm]:h-[14px] data-[size=sm]:w-[24px] motion-reduce:transition-none",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="data-checked:bg-primary-foreground data-unchecked:bg-foreground pointer-events-none block rounded-full ring-0 transition-transform duration-200 ease-out group-data-[size=comfortable]/switch:size-5 group-data-[size=default]/switch:size-3.5 group-data-[size=sm]/switch:size-3 group-data-[size=comfortable]/switch:data-checked:translate-x-[calc(100%-3px)] group-data-[size=default]/switch:data-checked:translate-x-[calc(100%-2px)] group-data-[size=sm]/switch:data-checked:translate-x-[calc(100%-2px)] group-data-[size=comfortable]/switch:data-unchecked:translate-x-px group-data-[size=default]/switch:data-unchecked:translate-x-0 group-data-[size=sm]/switch:data-unchecked:translate-x-0 motion-reduce:transition-none"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
