export declare const cliArgs: (
  help: string,
  options?: string[] | null,
  words?: number,
  argv?: string[],
) => string[];
export declare const numberArg: (
  name: string,
  text: string | undefined,
  limits?: { min?: number; max?: number; int?: boolean },
) => number;
export declare const needFilm: (dir?: string) => string;
export declare const envTypos: (known: string[], env?: Record<string, string | undefined>) => void;
export declare const jsonFile: (file: string, root?: string) => any;
