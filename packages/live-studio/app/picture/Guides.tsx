import type { PointerEvent } from "react";

import { useStudio } from "../core/store";
import { frameSize } from "./frame";
import { computeGuideGeometry, linesToPath } from "./guides-math";
import { CROP_RATIOS, guideRect } from "./preview-model";
import { changePreview, picturePoint } from "./preview-state";

export function Guides() {
  const on = useStudio((s) => s.guides);
  const ratio = useStudio((s) => s.ratio);
  const mode = useStudio((s) => s.guideMode);
  const showSafe = useStudio((s) => s.guideSafe);
  const p = useStudio((s) => s.preview);
  if (!on) return null;
  const [W, H] = frameSize(1600),
    box = (k: number) => ({
      x: (W * (1 - k)) / 2,
      y: (H * (1 - k)) / 2,
      width: W * k,
      height: H * k,
    });
  const crop = p.crops.at(-1);
  const matte = crop && guideRect(W, H, CROP_RATIOS[crop]);
  const g = computeGuideGeometry(W, H, ratio, mode, showSafe);
  const extraPhi =
    p.golden && g.phi.length === 0 ? computeGuideGeometry(W, H, ratio, "phi", false).phi : [];
  const reciprocalPath = linesToPath(g.diagonalsReciprocal);
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
  const lines = (
    <>
      {g.thirds.length > 0 && <path d={linesToPath(g.thirds)} />}
      {g.phi.length > 0 && <path d={linesToPath(g.phi)} />}
      {g.diagonalsMain.length > 0 && <path d={linesToPath(g.diagonalsMain)} />}
      <path d={linesToPath(g.centerCross)} />
      {g.safeBoxes.map(({ dashed, ...box }) => (
        <rect key={box.width} {...box} fill="none" strokeDasharray={dashed ? "6 6" : undefined} />
      ))}
      {g.phoneClear && <path d={g.phoneClear} />}
      {p.crops.map((ratio) => (
        <rect key={ratio} {...guideRect(W, H, CROP_RATIOS[ratio])} strokeDasharray="12 4" />
      ))}
      {p.primes &&
        [35, 50, 85].map((mm) => (
          <rect key={mm} {...box((0.94 * 35) / mm)} strokeDasharray="3 3" />
        ))}
      {extraPhi.length > 0 && <path d={linesToPath(extraPhi)} strokeDasharray="5 4" />}
    </>
  );
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      data-guide-mode={mode}
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
      {g.phoneClear && (
        <path
          d={`M0 0H${W}V${H}H0Z${g.phoneClear}`}
          fillRule="evenodd"
          fillOpacity={0.35}
          className="fill-stage"
        />
      )}
      <g strokeOpacity={0.45} strokeWidth={3} fill="none" className="stroke-stage">
        {lines}
        {reciprocalPath && <path d={reciprocalPath} strokeDasharray="6 6" />}
      </g>
      <g strokeOpacity={0.6} strokeWidth={1} fill="none" className="stroke-picture">
        {lines}
        {reciprocalPath && <path d={reciprocalPath} strokeDasharray="6 6" />}
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
