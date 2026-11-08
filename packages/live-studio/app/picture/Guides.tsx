// Framing guides over the picture (Ctrl+;, as CapCut's guides): the thirds a subject's eyes sit on, the middle, and the two
// broadcast safe areas of SMPTE ST 2046-1, action safe (93%: nothing that matters past it) and title safe (90%: text inside it)
import { useStudio } from "../core/store";
import { frameSize } from "./frame";

export function Guides() {
  const on = useStudio((s) => s.guides);
  if (!on) return null;
  const [W, H] = frameSize(1600), box = (k: number) => ({ x: (W * (1 - k)) / 2, y: (H * (1 - k)) / 2, width: W * k, height: H * k });
  const lines = (
    <>
      <path d={`M${W / 3} 0V${H}M${(2 * W) / 3} 0V${H}M0 ${H / 3}H${W}M0 ${(2 * H) / 3}H${W}`} />
      <path d={`M${W / 2 - 18} ${H / 2}H${W / 2 + 18}M${W / 2} ${H / 2 - 18}V${H / 2 + 18}`} />
      <rect {...box(0.93)} fill="none" />
      <rect {...box(0.9)} fill="none" strokeDasharray="6 6" />
    </>
  );
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden className="pointer-events-none absolute inset-0 z-3 size-full [&_*]:[vector-effect:non-scaling-stroke]">
      <g stroke="black" strokeOpacity={0.45} strokeWidth={3} fill="none">{lines}</g>
      <g stroke="white" strokeOpacity={0.6} strokeWidth={1} fill="none">{lines}</g>
    </svg>
  );
}
