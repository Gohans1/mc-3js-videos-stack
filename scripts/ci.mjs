import { cliArgs } from "../packages/live-studio/src/cli.mjs";

cliArgs(
  `Run repository checks concurrently from the repo root.
  bun run ci
Runs lint, typecheck and test:parallel, including Studio build tests.
Reports all checks and exits nonzero if any fail. Requires the prepared test tools and vault.
Use bun run test:parallel --help for native timing and shard options.`,
  [],
  0,
);

process.exit(
  await Bun.spawn(
    [
      process.execPath,
      "run",
      "--parallel",
      "--no-exit-on-error",
      "--no-orphans",
      "lint",
      "typecheck",
      "test:parallel",
    ],
    { stdin: "inherit", stdout: "inherit", stderr: "inherit" },
  ).exited,
);
