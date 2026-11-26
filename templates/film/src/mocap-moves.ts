type Move = { t: number; clip?: string };

const clipRefs = (moves: readonly Move[]) => [
  ...new Set(moves.flatMap(({ clip }) => (clip ? [clip] : []))),
];

export async function makeMocapMoves<Clip>(
  initial: readonly Move[],
  load: (refs: string[]) => Promise<Record<string, Clip>>,
) {
  const clips: Record<string, Clip> = Object.assign(
    Object.create(null),
    await load(clipRefs(initial)),
  );
  let visible = initial;
  let inspected: readonly Move[] | null = initial;
  let failed: readonly Move[] | null = null;
  let missing: string[] = [];

  const read = (moves: readonly Move[]) => {
    if (moves !== inspected) {
      inspected = moves;
      missing = clipRefs(moves).filter((ref) => !Object.hasOwn(clips, ref));
      if (!missing.length) visible = moves;
    }
    return visible;
  };
  const prepare = (moves: readonly Move[]) => {
    if (read(moves) === moves || moves === failed) return;
    return load(missing).then(
      (loaded) => {
        Object.assign(clips, loaded);
        inspected = null;
      },
      (error) => {
        failed = moves;
        throw error;
      },
    );
  };
  return { clips, read, prepare };
}
