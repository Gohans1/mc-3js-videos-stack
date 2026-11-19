import process from "node:process";

import { cameraAt } from "film-stage/camera";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const { keys, times, aspect }: { keys: unknown[]; times: number[]; aspect: number } =
  JSON.parse(input);

process.stdout.write(
  JSON.stringify(
    times.map((t) => {
      const { p, l, roll } = cameraAt(t, keys, { aspect }).base;
      return { p: p.toArray(), l: l.toArray(), roll };
    }),
  ),
);
