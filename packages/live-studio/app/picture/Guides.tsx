// Framing guides over the picture (Ctrl+;, as CapCut's guides): the thirds a subject's eyes sit on, the middle, and the two
// broadcast safe areas of SMPTE ST 2046-1, action safe (93%: nothing that matters past it) and title safe (90%: text inside it).
// A 9:16 film is watched on a phone, so instead of those it shades what the Shorts and TikTok buttons and captions cover
import { useStudio } from "../core/store";
import { frameSize } from "./frame";

// The clear part of a 1080×1920 frame on both apps: Google's vertical video ad safe zone (288 top, 672 bottom, 48 left, 192 right)
// and TikTok's In-Feed template (240, 660, 120 each side, the right 300 from y 840 down, its like and share column). Both are
// published for ads only; an ordinary post sits under the same rails
const PHONE: [number, number][] = [[120, 288], [888, 288], [888, 840], [780, 840], [780, 1248], [120, 1248]];

export function Guides() {
  const on = useStudio((s) => s.guides), tall = useStudio((s) => s.ratio === "9:16");
  if (!on) return null;
  const [W, H] = frameSize(1600), box = (k: number) => ({ x: (W * (1 - k)) / 2, y: (H * (1 - k)) / 2, width: W * k, height: H * k });
  const clear = `M${PHONE.map(([x, y]) => `${(x * W) / 1080} ${(y * H) / 1920}`).join("L")}Z`;
  const lines = (
    <>
      <path d={`M${W / 3} 0V${H}M${(2 * W) / 3} 0V${H}M0 ${H / 3}H${W}M0 ${(2 * H) / 3}H${W}`} />
      <path d={`M${W / 2 - 18} ${H / 2}H${W / 2 + 18}M${W / 2} ${H / 2 - 18}V${H / 2 + 18}`} />
      {tall ? <path d={clear} /> : <>
        <rect {...box(0.93)} fill="none" />
        <rect {...box(0.9)} fill="none" strokeDasharray="6 6" />
      </>}
    </>
  );
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden className="pointer-events-none absolute inset-0 z-3 size-full [&_*]:[vector-effect:non-scaling-stroke]">
      {tall && <path d={`M0 0H${W}V${H}H0Z${clear}`} fillRule="evenodd" fillOpacity={0.35} className="fill-black" />}
      <g strokeOpacity={0.45} strokeWidth={3} fill="none" className="stroke-black">{lines}</g>
      <g strokeOpacity={0.6} strokeWidth={1} fill="none" className="stroke-white">{lines}</g>
    </svg>
  );
}
