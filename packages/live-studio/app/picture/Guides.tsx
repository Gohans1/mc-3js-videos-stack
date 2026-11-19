// Framing guides over the picture (Ctrl+;, Alt+; to switch layout): thirds, Golden Ratio (Phi 38.2%/61.8%),
// Baroque & Sinister diagonals with Dynamic Symmetry reciprocals, center cross, and SMPTE/Shorts safe areas.
import { useStudio } from "../core/store";
import { frameSize } from "./frame";
import { computeGuideGeometry, linesToPath } from "./guides-math";

export function Guides() {
  const on = useStudio((s) => s.guides);
  const ratio = useStudio((s) => s.ratio);
  const mode = useStudio((s) => s.guideMode);
  const showSafe = useStudio((s) => s.guideSafe);
  if (!on) return null;

  const [W, H] = frameSize(1600);
  const g = computeGuideGeometry(W, H, ratio, mode, showSafe);
  const solidLines = (
    <>
      {g.thirds.length > 0 && <path d={linesToPath(g.thirds)} />}
      {g.phi.length > 0 && <path d={linesToPath(g.phi)} />}
      {g.diagonalsMain.length > 0 && <path d={linesToPath(g.diagonalsMain)} />}
      <path d={linesToPath(g.centerCross)} />
      {g.safeBoxes.map((box, idx) => (
        <rect
          key={idx}
          x={box.x}
          y={box.y}
          width={box.width}
          height={box.height}
          fill="none"
          strokeDasharray={box.dashed ? "6 6" : undefined}
        />
      ))}
      {g.phoneClear && <path d={g.phoneClear} />}
    </>
  );
  const reciprocalPath = g.diagonalsReciprocal.length > 0 ? linesToPath(g.diagonalsReciprocal) : "";

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      data-guide-mode={mode}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-3 size-full [&_*]:[vector-effect:non-scaling-stroke]"
    >
      {g.phoneClear && (
        <path
          d={`M0 0H${W}V${H}H0Z${g.phoneClear}`}
          fillRule="evenodd"
          fillOpacity={0.35}
          className="fill-stage"
        />
      )}
      <g strokeOpacity={0.45} strokeWidth={3} fill="none" className="stroke-stage">
        {solidLines}
        {reciprocalPath && <path d={reciprocalPath} strokeDasharray="6 6" />}
      </g>
      <g strokeOpacity={0.65} strokeWidth={1} fill="none" className="stroke-picture">
        {solidLines}
        {reciprocalPath && <path d={reciprocalPath} strokeDasharray="6 6" strokeOpacity={0.45} />}
      </g>
    </svg>
  );
}
