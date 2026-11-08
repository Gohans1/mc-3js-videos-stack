import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { cn } from "cn"

// origin: a two-way value (pan, roll) fills from it to the thumb, so its centre reads as nothing rather than half
function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  origin,
  "aria-label": ariaLabel,
  ...props
}: SliderPrimitive.Root.Props & { origin?: number }) {
  // A single number is one thumb; only an empty slider shows a range
  const _values = [value, defaultValue].find((v) => v != null) ?? [min, max]
  const thumbs = Array.isArray(_values) ? _values.length : 1
  // Where a thumb's centre sits, in the track: thumbAlignment "edge" keeps the 12px thumb inside it
  const at = (v: number) => { const p = ((v - min) / (max - min)) * 100; return `calc(${p}% + ${6 - p * 0.12}px)` }
  const fill = origin !== undefined && typeof _values === "number" ? [at(Math.min(origin, _values)), at(Math.max(origin, _values))] : null

  return (
    <SliderPrimitive.Root
      className={cn("data-horizontal:w-full data-vertical:h-full", className)}
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
          className="relative grow overflow-hidden rounded-md bg-slider select-none data-horizontal:h-1 data-horizontal:w-full data-vertical:h-full data-vertical:w-1"
        >
          {fill ? (
            <div data-slot="slider-range" className="absolute inset-y-0 bg-slider-fill" style={{ left: fill[0], width: `calc(${fill[1]} - ${fill[0]})` }} />
          ) : (
            <SliderPrimitive.Indicator
              data-slot="slider-range"
              className="bg-slider-fill select-none data-horizontal:h-full data-vertical:w-full"
            />
          )}
        </SliderPrimitive.Track>
        {Array.from({ length: thumbs }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            // The name belongs on the thumb: its <input type="range"> is what a screen reader lands on
            aria-label={ariaLabel}
            className="relative block size-3 shrink-0 rounded-full border border-white bg-white ring-ring/30 transition-[color,box-shadow] select-none after:absolute after:-inset-2 hover:ring-2 focus-visible:ring-2 focus-visible:outline-hidden active:ring-2 disabled:pointer-events-none disabled:opacity-50"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
