// Framing guides over the picture (Ctrl+;, as CapCut's guides): the thirds a subject's eyes sit on, the middle, and the two
// broadcast safe areas of SMPTE ST 2046-1, action safe (93%: nothing that matters past it) and title safe (90%: text inside it).
// A 9:16 film is watched on a phone, so instead of those it shades what the Shorts and TikTok buttons and captions cover
import { safe } from "film-kit/safe";
import type { PointerEvent } from "react";

import { useStudio } from "../core/store";
import { frameSize } from "./frame";
import { CROP_RATIOS, guideRect } from "./preview-model";
import { changePreview, picturePoint } from "./preview-state";

// The clear part of a 1080×1920 frame on both apps: Google's vertical video ad safe zone (288 top, 672 bottom, 48 left, 192 right)
// and TikTok's In-Feed template (240, 660, 120 each side, the right 300 from y 840 down, its like and share column). Both are
// published for ads only; an ordinary post sits under the same rails
const PHONE: [number, number][] = [
  [120, 288],
  [888, 288],
  [888, 840],
  [780, 840],
  [780, 1248],
  [120, 1248],
];

export function Guides() {
  const on = useStudio((s) => s.guides),
    tall = useStudio((s) => s.ratio === "9:16");
  const p = useStudio((s) => s.preview);
  if (!on) return null;
  const [W, H] = frameSize(1600),
    box = (k: number) => ({
      x: (W * (1 - k)) / 2,
      y: (H * (1 - k)) / 2,
      width: W * k,
      height: H * k,
    });
  const broadcast = (kind: "action" | "graphics") => {
    const [x, y, right, bottom] = safe(W, H, kind);
    return { x, y, width: right - x, height: bottom - y };
  };
  const crop = p.crops.at(-1);
  const matte = crop && guideRect(W, H, CROP_RATIOS[crop]);
  const phi = (Math.sqrt(5) - 1) / 2;
  const ruler = (axis: "rulerX" | "rulerY") => (e: PointerEvent<SVGLineElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const [x, y] = picturePoint(e, e.currentTarget.ownerSVGElement!);
    changePreview({
      [axis]: Math.round(Math.min(1, Math.max(0, axis === "rulerX" ? x : y)) * 100),
    });
  };
  const startRuler = (axis: "rulerX" | "rulerY") => (e: PointerEvent<SVGLineElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    ruler(axis)(e);
  };
  const clear = `M${PHONE.map(([x, y]) => `${(x * W) / 1080} ${(y * H) / 1920}`).join("L")}Z`;
  const lines = (
    <>
      <path d={`M${W / 3} 0V${H}M${(2 * W) / 3} 0V${H}M0 ${H / 3}H${W}M0 ${(2 * H) / 3}H${W}`} />
      <path d={`M${W / 2 - 18} ${H / 2}H${W / 2 + 18}M${W / 2} ${H / 2 - 18}V${H / 2 + 18}`} />
      {tall ? (
        <path d={clear} />
      ) : (
        <>
          <rect {...broadcast("action")} fill="none" />
          <rect {...broadcast("graphics")} fill="none" strokeDasharray="6 6" />
        </>
      )}
      {p.crops.map((ratio) => (
        <rect key={ratio} {...guideRect(W, H, CROP_RATIOS[ratio])} strokeDasharray="12 4" />
      ))}
      {p.primes &&
        [35, 50, 85].map((mm) => (
          <rect key={mm} {...box((0.94 * 35) / mm)} strokeDasharray="3 3" />
        ))}
      {p.golden && (
        <path
          d={
            "M" +
            W * phi +
            " 0V" +
            H +
            "M" +
            W * (1 - phi) +
            " 0V" +
            H +
            "M0 " +
            H * phi +
            "H" +
            W +
            "M0 " +
            H * (1 - phi) +
            "H" +
            W
          }
          strokeDasharray="5 4"
        />
      )}
    </>
  );
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden
      className="pointer-events-none absolute inset-0 z-3 size-full [&_*]:[vector-effect:non-scaling-stroke]"
    >
      {matte && p.passepartout > 0 && (
        <path
          d={
            "M0 0H" +
            W +
            "V" +
            H +
            "H0Z" +
            "M" +
            matte.x +
            " " +
            matte.y +
            "h" +
            matte.width +
            "v" +
            matte.height +
            "h-" +
            matte.width +
            "Z"
          }
          fillRule="evenodd"
          fillOpacity={p.passepartout / 100}
        />
      )}
      {tall && (
        <path
          d={`M0 0H${W}V${H}H0Z${clear}`}
          fillRule="evenodd"
          fillOpacity={0.35}
          className="fill-stage"
        />
      )}
      <g strokeOpacity={0.45} strokeWidth={3} fill="none" className="stroke-stage">
        {lines}
      </g>
      <g strokeOpacity={0.6} strokeWidth={1} fill="none" className="stroke-picture">
        {lines}
      </g>
      {p.crops.map((ratio) => {
        const r = guideRect(W, H, CROP_RATIOS[ratio]);
        return (
          <text
            key={ratio}
            x={r.x + 10}
            y={r.y + 27}
            className="fill-picture stroke-stage text-2xl"
            paintOrder="stroke"
          >
            {ratio}
          </text>
        );
      })}
      {p.primes &&
        [35, 50, 85].map((mm) => {
          const r = box((0.94 * 35) / mm);
          return (
            <text
              key={mm}
              x={r.x + r.width - 10}
              y={r.y + 27}
              textAnchor="end"
              className="fill-picture stroke-stage text-2xl"
              paintOrder="stroke"
            >
              {mm} mm
            </text>
          );
        })}
      {p.ruler && (
        <g className="stroke-primary" strokeWidth={1.5}>
          <line x1={(W * p.rulerX) / 100} x2={(W * p.rulerX) / 100} y1={0} y2={H} />
          <line x1={0} x2={W} y1={(H * p.rulerY) / 100} y2={(H * p.rulerY) / 100} />
          <line
            x1={(W * p.rulerX) / 100}
            x2={(W * p.rulerX) / 100}
            y1={0}
            y2={H}
            stroke="transparent"
            strokeWidth={12}
            className="pointer-events-auto cursor-ew-resize touch-none"
            onPointerDown={startRuler("rulerX")}
            onPointerMove={ruler("rulerX")}
          />
          <line
            x1={0}
            x2={W}
            y1={(H * p.rulerY) / 100}
            y2={(H * p.rulerY) / 100}
            stroke="transparent"
            strokeWidth={12}
            className="pointer-events-auto cursor-ns-resize touch-none"
            onPointerDown={startRuler("rulerY")}
            onPointerMove={ruler("rulerY")}
          />
        </g>
      )}
    </svg>
  );
}
