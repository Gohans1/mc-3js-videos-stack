import { frameAt, playRanges } from "./timing.mjs";

const EPSILON = 1e-8;
const inside = (t, from, to, edge) =>
  edge === "before" ? t > from && t <= to : t >= from && t < to;

const shotRanges = (clock, start, end) => {
  const stills = clock.segments.flatMap((segment) => {
    const frame = segment.frame ?? segment.sourceFrom;
    if (segment.kind !== "freeze" || segment.blank || frame < start || frame >= end) return [];
    return [{ from: segment.from, to: segment.to, sourceFrom: undefined, sourceTo: undefined }];
  });
  const pieces = [...playRanges(clock, start, end), ...stills].sort((a, b) => a.from - b.from);
  const ranges = [];
  for (const piece of pieces) {
    const last = ranges.at(-1);
    if (
      last &&
      Math.abs(last.to - piece.from) < EPSILON &&
      (piece.sourceFrom === undefined ||
        last.sourceTo === undefined ||
        piece.sourceFrom >= last.sourceTo - EPSILON)
    ) {
      last.to = piece.to;
      last.sourceFrom ??= piece.sourceFrom;
      last.sourceTo = piece.sourceTo ?? last.sourceTo;
    } else ranges.push({ ...piece });
  }
  return ranges.map((range) =>
    range.sourceFrom !== undefined ? range : { ...range, sourceFrom: start, sourceTo: end },
  );
};

export const canPlaceCameraCut = (picture, at) => {
  const source = picture.sourceAt(at);
  return (
    Math.abs(picture.outputAt(source, "before") - at) < EPSILON &&
    Math.abs(picture.sourceAt(at, "before") - source) < EPSILON &&
    frameAt(picture, at) >= source - EPSILON
  );
};

// a camera key's cut this close to a shot's start (seconds) is that shot's own cut
export const SHOT_CUT_NEAR = 0.5 / 30;
export const cameraShotAtBoundary = (clock, time) =>
  clock.cameraShotStarts?.findIndex((start) => Math.abs(start - time) < SHOT_CUT_NEAR) ?? -1;

export const compileCameraClock = (picture, shots) => {
  const cameraShotStarts = shots.map((shot) => shot.t);
  const spans = shots.flatMap((shot, i) =>
    shot.cameraClock === "output"
      ? shotRanges(picture, shot.t, shots[i + 1]?.t ?? picture.sourceDuration)
      : [],
  );
  if (!spans.length) return { ...picture, cameraShotStarts };
  const ordered = spans.sort((a, b) => a.from - b.from);
  const atOutput = (t, edge) => ordered.find((span) => inside(t, span.from, span.to, edge));
  const rateOf = (span) => (span.sourceTo - span.sourceFrom) / (span.to - span.from);
  return {
    ...picture,
    cameraShotStarts,
    cameraPicture: picture,
    cameraSpans: ordered,
    visible: (t) =>
      picture.visible(t) || ordered.some((s) => inside(t, s.sourceFrom, s.sourceTo, "after")),
    sourceAt(t, edge = "after") {
      const span = atOutput(t, edge);
      return span ? span.sourceFrom + (t - span.from) * rateOf(span) : picture.sourceAt(t, edge);
    },
    outputAt(t, edge = "after") {
      const span = ordered.find((s) => inside(t, s.sourceFrom, s.sourceTo, edge));
      return span ? span.from + (t - span.sourceFrom) / rateOf(span) : picture.outputAt(t, edge);
    },
    cameraOutputsAt(t, edge) {
      return ordered
        .filter((s) => inside(t, s.sourceFrom, s.sourceTo, edge))
        .map((s) => s.from + (t - s.sourceFrom) / rateOf(s));
    },
    cameraRateAt(t) {
      const span = atOutput(t, "after");
      return span && rateOf(span);
    },
  };
};
