# Write or change a CLI

Commands help an AI discover capabilities, locate results and verify its work. Reuse an existing command when it fits; custom tools and film code remain valid ways to create.

## Information for an AI

| Surface                       | Content                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| help                          | Commands grouped by job, one line each; working directory and separate CLIs          |
| help --json                   | Brief inventory from the same catalog Studio uses, plus this folder's custom scripts |
| help <id> --json              | Full catalog definition for one command; executable --help remains authoritative     |
| skills get core               | Short workflow, clocks, costs and routes to focused topics                           |
| skills get core --ref <topic> | When to use the workflow, selected steps, outputs, verification and recovery         |
| <command> --help              | Current syntax, runnable examples, written files, output, costs and follow-ups       |
| skills path <name>            | Absolute guide/skill directory; open SKILL.md and resolve its references there       |

Load details on demand, following agent-browser skills get core. Keep discovery stubs thin and avoid copying complete flag lists into workflow guides.

| Native backend        | How to use it                                                                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verify a film         | Run bun run skills get core --ref review to choose a check. framecheck --json returns measurements, and sheet frames reports decoded timestamps.                     |
| Unified QC check      | Run bun run qc FILE --json to inspect video specs, audio loudness/sync, camera motion, and text readability. Run bun run qc --help for box, compare, and motion subcommands. |
| Discover FFmpeg tools | Use media ffmpeg list --json for the tool list, schema <tool> for its native arguments, and contract -- --static for the full contract.                              |
| Pass native arguments | The catalog forwards options only through fields marked as passthrough. Other positionals reject hidden flags. Arguments go directly to the process without a shell. |
| Update the backend    | Keep LICENSE, upstream.json, and the source hash. Update the upstream pin without editing vendor files, then rerun tests and check representative media.             |

Với at --json, scene là giây nguồn của ảnh, cam.time là giây lấy mẫu camera và cam.clock cho biết đồng hồ đang dùng. Cam.evaluation đánh dấu ước tính từ dữ liệu lưu sẵn, với FOV và mm là null nếu Dolly Zoom thiếu tọa độ anchor.

## Contract

| Part                    | Requirement                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Help before work        | Bun entry points use cliArgs from packages/live-studio/src/cli.mjs; -h, --help or a leading help prints usage and exits 0                                    |
| Input                   | Validate positionals, flags, values and combinations before writes or service requests; usage errors exit 2 with a correction                                |
| Numbers and time        | Reuse numberArg and secondArg; convert heard seconds to the destination timeline's clock                                                                     |
| JSON input              | Use jsonFile; identify the broken file and how to check it                                                                                                   |
| JSON output             | Support --json where structured results help; stdout contains one JSON value, diagnostics go to stderr                                                       |
| Results                 | Name findings, times, files/rows or artifact paths; add next: only for useful follow-ups                                                                     |
| Missing data            | Name the command or action that supplies it                                                                                                                  |
| Language                | Write CLI help, diagnostics, and guides in plain English. Preserve user text and provider data                                                               |
| Costs                   | Help states credits, downloads and long work; voice generation and assets:semantic build preview until --yes; voice --dry-run always previews                |
| Small external searches | Ordinary find may query OpenFilm; --offline uses its cache. find --jev uses paid quota without --yes; do not extend these exceptions to unrelated operations |
| Long work               | Set a timeout and checkpoint completed results when resuming is possible                                                                                     |
| Exit codes              | 0 completed, 1 job/data failure, 2 usage/preconditions; report completed work after partial failure                                                          |

Python uses its existing parser for the same guarantees. Test root and film invocation; wrong-place.mjs directs callers to the correct folder.

## Update the existing surfaces

| Location                                | Content                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Command HELP                            | Full syntax, examples, outputs and cost; authoritative flags                                      |
| package.json                            | Root, template and affected film scripts; redirect stubs for commands belonging elsewhere         |
| packages/live-studio/help.mjs           | Job grouping and one-line descriptions for package scripts                                        |
| packages/live-studio/src/cli-catalog.ts | Shared CLI/Studio inventory: invocation, fields, directory, effects, cost and actual help support |
| skill-data/core                         | Only affected workflow/reference sections; route any new reference from SKILL.md                  |
| .claude/skills/mc-films/SKILL.md        | Discovery stub pointing to skills get core                                                        |

Keep AI-facing CLI guidance in concise English and match each file's structure. Compatibility wrappers such as openfilm, pick.py and the catalog shell scripts forward to canonical implementations; prefer find for 2D/3D discovery and asset (pick/unpick/use/edit) for pack cherry-picking, 3D prop copy and timeline placement.

## Verify

| Step                 | Command or action                                                                                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Behavior change      | Reproduce with a meaningful failing test, make the smallest fix, then observe it pass; follow test-driven-development                                                                                                                                        |
| Direct invocation    | Exercise valid and invalid input in an isolated test film; do not spend credits to test a parser                                                                                                                                                             |
| Format touched files | bun fmt --no-script <files>                                                                                                                                                                                                                                  |
| Repo checks          | bun run ci runs lint, typecheck and the full parallel test suite together; Studio build tests are included. Prepared vault assets and local test tools remain required                                                                                       |
| Test workers         | bun run test:parallel uses two isolated workers; bun run test runs serially with per-file isolation. Native Bun test flags remain available                                                                                                                  |
| Timing history       | bun run test:parallel --timings <history.json> --update-timings records per-file durations; keep machine-generated timing files outside tracked source                                                                                                       |
| Balanced shards      | Give every shard the same frozen history inputs, --shard <index>/<count>, and its own first --timings <next-shard.json> output followed by --timings <history.json> --update-timings. Never read another shard's current output while scheduling             |
| Changed tests        | --changed=<base> follows imports; it misses Python subprocesses, data files and configuration. Run the full suite before merging                                                                                                                             |
| React diagnostics    | bun run doctor scans Studio locally, advisory with a 120-second budget and no telemetry or supply-chain requests. Confirm diagnostics in source/runtime before edits; --json exposes project complete/skippedChecks, --blocking error enables a failure gate |
| Requested review     | Independent reviewers verify results; resolve Critical and Required findings                                                                                                                                                                                 |

packages/live-studio/test/skills.test.mjs checks reference routing and named commands. It cannot prove every example or workflow; compare the implementation and run the relevant command.

## Preserve Studio edits

Studio protects human-edited fields against unacknowledged direct file writes; arrays without stable IDs are protected as a whole, and withheld input is retained in .studio/collaboration/notices.jsonl.
Use bun run collab --film films/<name> read cam, then write cam FILE with base and data for intentional changes; Studio must be running and its response identifies the persisted result.
