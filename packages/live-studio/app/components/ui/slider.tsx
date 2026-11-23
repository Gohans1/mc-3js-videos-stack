import { Slider as SliderPrimitive } from "@base-ui/react/slider";

import { cn } from "@/lib/utils";

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  origin,
  appearance = "default",
  thumbLabels,
  "aria-label": ariaLabel,
  ...props
}: SliderPrimitive.Root.Props & {
  origin?: number;
  appearance?: "default" | "adjust" | "scrub" | "accent";
  thumbLabels?: string[];
}) {
  const _values = [value, defaultValue].find((v) => v != null) ?? [min, max];
  const thumbs = Array.isArray(_values) ? _values.length : 1;
  const at = (v: number) => {
    const p = ((v - min) / (max - min)) * 100;
    return `calc(${p}% + ${6 - p * 0.12}px)`;
  };
  const fill =
    origin !== undefined && typeof _values === "number"
      ? [at(Math.min(origin, _values)), at(Math.max(origin, _values))]
      : null;

  return (
    <SliderPrimitive.Root
      className={cn(
        "data-horizontal:w-full data-vertical:h-full",
        appearance === "adjust" && "adjust-slider",
        className,
      )}
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      thumbAlignment="edge"
      {...props}
    >
      <SliderPrimitive.Control className="relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="bg-slider relative grow overflow-hidden rounded-md select-none data-horizontal:h-1 data-horizontal:w-full data-vertical:h-full data-vertical:w-1"
        >
          {fill ? (
            <div
              data-slot="slider-range"
              className="bg-slider-fill absolute inset-y-0 left-(--fill-left) w-(--fill-w)"
              style={{ "--fill-left": fill[0], "--fill-w": `calc(${fill[1]} - ${fill[0]})` }}
            />
          ) : (
            <SliderPrimitive.Indicator
              data-slot="slider-range"
              className={cn(
                "select-none data-horizontal:h-full data-vertical:w-full",
                appearance === "scrub" || appearance === "accent" ? "bg-primary" : "bg-slider-fill",
              )}
            />
          )}
        </SliderPrimitive.Track>
        {Array.from({ length: thumbs }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            aria-label={thumbLabels?.[index] ?? ariaLabel}
            className={cn(
              "ring-ring/30 border-slider-thumb bg-slider-thumb has-[:focus-visible]:ring-ring relative block shrink-0 rounded-full border transition-[color,box-shadow] select-none after:absolute after:-inset-2 hover:ring-2 focus-visible:ring-2 focus-visible:outline-hidden active:ring-2 disabled:pointer-events-none disabled:opacity-50 has-[:focus-visible]:ring-2",
              appearance === "scrub" ? "size-2.5" : "size-3",
            )}
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider };
