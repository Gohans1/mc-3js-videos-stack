export function equalJson(a: unknown, b: unknown): boolean;
export function mergeEdits<T>(
  base: T,
  person: T,
  incoming: T,
  orderedRows?: boolean,
): { data: T; retained: string[] };
