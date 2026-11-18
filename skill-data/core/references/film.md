# New films, data and vault

## Create and connect

On a new machine run bun run setup at the root; a missing local vault exits 1 with recovery instructions. On a prepared machine run bun run new-film cave-escape 47920, enter films/cave-escape, then run bun run check and bun run studio.

new-film copies the template, installs dependencies, copies vault assets and builds picked.zip; setup:vault and link need not run again. The port is optional and defaults above assigned film ports; verify by opening the Studio URL and seeing the scene.

## Choose the right command

| Root command | Role |
| --- | --- |
| bun run setup | Prepare a machine: bun install, setup:vault and link; downloads assets and reuses completed work |
| bun run setup:vault | Download/build only the vault; install dependencies with bun install first |
| bun run new-film cave-escape | Create a complete film from the template without replacing an existing film |
| bun run link cave-escape | Refresh real asset copies and picks after changing the vault or pack/picks.json; no installs or downloads |
| bun packages/live-studio/init.mjs PROJECT | Connect a new/existing project to Studio and install dependencies; does not copy vault assets or build picks. Preview with --dry-run; prefer new-film within this repo |

## Recover after failure

If copying succeeded but a later step failed, keep the film, fix the error, then run bun packages/live-studio/init.mjs films/cave-escape and bun run link cave-escape at the root. Enter the film, run bun run check and bun run studio; do not recreate the same film name.

Use bun run setup:vault for assets with known download sources; copy private motion, packs and tools into real vault directories on C:. externalRoot holds only sound-raw, original downloads and backups; read INSTALL.md for preparation and licenses.

In PowerShell change directory and run commands separately; MC_VAULT_EXTERNAL only changes raw-download/backup storage. Bun installs the workspace together and updates the root bun.lock; do not create film lockfiles.

## Windows worktrees

Keep assets and code as real files/directories on C:, without junctions or symlinks; retain dependency links managed by Bun. Install dependencies independently in each worktree instead of linking its whole node_modules to the main checkout.

Use Git for Windows 2.54 or newer; older versions can delete junction targets during worktree removal, even on the same drive. Before removal, enumerate without following links, detach each link nonrecursively and verify targets remain intact; retire branches only after verified integration or backup.

## Keep edit directions

Film → Versions saves named and automatic versions; restoring first retains the current state as a backup. bun run history --film films/<name> list, save or restore keeps configured source/timeline files and pack/picks.json, while media and shared packages remain current.

Local history lives in .studio/history.sqlite; stop Studio before copying .studio to another machine.

## Film data

A Shorts film sets "ratio": "9:16" under "live-studio" in package.json: drafts at 720x1280 and final at 1080x1920.

## What each file holds

`bun run help` inside a film prints this film's own map (its timeline file names come from `package.json` `"live-studio"`). Shots count from 0 everywhere: notes, the studio, `bun run at`, the draft's strip.

| File                                    | Holds                                                                                                 | Clock     |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------- |
| `src/scene.ts`                          | The film's code: `buildScene` returns `draw(t)`, which must draw any `t` on its own                   | Scene     |
| `src/edit.json`                         | Narration takes and script, `voice.warp`, beats, the film's own settings                              | Narration |
| `src/timeline/shots.json`               | Shots: start `t`, name, framing, `transition` into it, `anim`; shot N is row N                        | Narration |
| `src/timeline/cam.json`                 | Camera keys and cuts                                                                                  | Scene     |
| ID dòng camera | Giữ nguyên id khi sửa dòng cũ và dùng id mới cho dòng mới. Studio cấp id khi đọc dòng cũ. | Camera và shot |
| Đường camera | motion trên key sau chọn smooth, linear, hold hoặc orbit. Bước chân theo độ dài đường bay trong shot. | Camera |
| Neo camera | p và l có thể dùng target cùng offset. Thêm space local để lấy hệ trục của đối tượng. | Camera |
| Ghi chú key camera | reason hiện lý do chọn góc máy, locked bảo vệ thao tác Studio. focus nhận mét, target hoặc point theo tọa độ cảnh. | Camera |
| Thời gian camera | Đặt cameraClock output trên shot để camera chạy đều qua thời lượng xuất dù cảnh Freeze hoặc Speed Ramp. | Camera |
| `src/timeline/audio.json`               | Beds, sound effects, the narration's place, gains, tracks, filters                                    | Scene     |
| `src/timeline/text.json`, `adjust.json` | On-screen text, colour and look layers                                                                | Scene     |
| `src/timeline/openfilm.json` | HTML/CSS/canvas effects, stickers and animated text; optional `openfilmTimeline` overrides this path | Layer timebase |
| `src/timeline/timing.json`              | Speed, Freeze, velocity: what turns scene seconds into heard seconds                                  | Scene     |
| Key files (`"live-studio".keyFiles`)    | Keyed rows for characters and props                                                                   | Scene     |
| `renders/`                              | Everything render, sheet, framecheck and listen write (ignored by git)                                |           |
| `notes/`                                | The creator's notes; read them with `bun run notes`                                                   |           |
| `lessons/`                              | This film's lessons (`../../lessons/` for every film, nested `.md` ok); `bun run notes ID` picks both |           |

After every JSON edit run `bun run check`: the studio's own schemas, every sound name, misspelt keys, an off-target `lufs` or a runaway `drive`. The full contract: `bun run skills get core --ref contract`.

`openfilm.json` stores each layer's interval against its saved `timebase`; `bun run asset timeline` and `edit` use heard seconds and preserve that mapping. Audio, cuts and grades use their existing native timelines; see `bun run asset --help`.

## What a film can name

```bash
bun run find impact --kind sfx -n 20         # BM25, then OpenFilm meaning; --offline for cached-only search
bun run find --kind look                     # named grades (teal-amber, noir-slate); --kind lens, --kind shake too
bun run find --show dissolve                 # one entry in full, with a line to paste
bun run find --jev --kind transition "a memory slipping away"   # by meaning, when words miss
bun run find sit --from stand --to sitFloor  # mocap by posture
```

Every schema is open (`looseObject`): a film may make its own objects, transitions, anims and checks. Where each goes: `bun run skills get core --ref contract`.

## Direct maintenance scripts

Paths below are relative to a film. bun run help direct lists catalog IDs and help support; bun run help <id> --json describes one tool without executing it.

| Task | Command and workflow |
| --- | --- |
| Measure motion catalog | python ../../packages/clip-catalog/batch.py catalog mixamo --limit 1 reads vault/motion and writes shared catalog/<lib>.jsonl. Rerun to resume or retry failed clips; clip names retain spaces |
| Check names and postures | python ../../packages/clip-catalog/catalog_check.py; disagreements suggest inspection rather than forbid motion. --fights includes combat clips; resolve load failures before judging |
| Visual review | Run batch.py sheets, then catalog_review.py; open JPG pages listed in pages.json and submit per-cell desc/mood/prop/style with --page 0 --notes notes.json. Pages start at 0, cells at 1; keep pages.json until complete, and --fix edits an existing clip |
| Review vocabulary | catalog_review.py --help lists search labels; desc and flaw are free text. Eight sampled times can miss movement; inspect lab/clip.ts when uncertain |
| Compare search | python ../../packages/clip-catalog/catalog_eval.py renders/picks-v1.txt --limit 1 calls Jev and can spend quota. Each scene checkpoints to .txt.jsonl; --resume requires the same data/parameters, and changed code/catalog needs a new output name |
| Retarget sweep | python ../../packages/clip-catalog/batch.py sweep mixamo --limit 1, then sweep_report.py mixamo; --diff OLD.jsonl compares a baseline. Thresholds suggest visual review, not acting quality |
| Bounds and retry | Batches stop after at most 600 seconds per group; --limit caps total clips and vault/motion/catalog/logs retains logs. Interrupted runs keep completed results; archive old JSONL/sheets after changing measurement or retargeting code |
| Legacy Bash | catalog.sh, sweep.sh and catalog_review.sh forward to batch.py catalog, sweep and sheets. On Windows call Python directly; Bash/GNU timeout are unnecessary |
| Inspect one clip | LAB_CLIP=lib/name ENTRY=lab/clip.ts bun run render stills, then python ../../packages/clip-catalog/sheet_clip.py. In PowerShell set and restore/remove $env:LAB_CLIP and $env:ENTRY |
| Pick assets | Edit pack/picks.json, then bun ../../packages/mc-assets/pick.mjs, or bun run link <film> at the root. pick.py forwards to the same Bun builder; keep licensed picked.zip files out of Git unless permitted |
| Runtime renderer files | bun ../../packages/mc-assets/vendor.mjs copies installed WASM/entity packs to assets/public; film postinstall calls it. Rerun after upgrading block-model-renderer instead of editing vendor files |
| Optional formatting | bun ../../scripts/timeline_fmt.ts or python ../../scripts/timeline_fmt.py keeps compact 140-column rows; both parse all JSON before writing. Their load/save/dump APIs and open schemas remain available |
| Film-specific commands | bun run help reads the film's own scripts; inspect help and source before running a custom bake. A bake must name its written files and scene/narration/heard clock; it is preparation for that film |
| Data and dependencies | The vault is outside Git; copy old motion to real vault/motion on C: then run link, as motion is not auto-downloaded. Image tools need Pillow in the active venv via uv pip install pillow; Jev evaluation needs the route/key described in jev.py |

## Test in isolation

Use a separate worktree with its own Bun installation and real copies of required assets. Follow Windows worktree cleanup above; never share node_modules manually.

From the root, create a uniquely named test film with bun run new-film <unused-name>, or copy only the film needed to reproduce a problem. A familiar folder name does not make its contents disposable.

| Need | Approach |
| --- | --- |
| Parser or schema check | Use the template and the minimum required test data |
| Reproduce a real film issue | Copy src, configuration and required media; never share writable notes with the original |
| Existing render evidence | Copy the video and cuts.json into the test film's renders |
| Test assets | Real files on C:; Bun installs node_modules inside the test worktree |
| Cleanup | Verify the exact directory and junctions; remove only what this session created, keeping review evidence first |
