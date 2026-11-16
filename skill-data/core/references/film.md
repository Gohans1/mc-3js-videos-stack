# A film: making one, what each file holds, the vault

## Create and connect

At the repo root:

```bash
bun run new-film cave-escape 47920           # templates/film -> films/cave-escape, studio port optional
bun run setup:vault                          # a new machine: the light vault, every file verified
bun run link                                 # connect the vault to every film (or: bun run link sealed-room)
```

A Shorts film sets `"ratio": "9:16"` under `"live-studio"` in its `package.json`: drafts at 720x1280, the final at 1080x1920.

## What each file holds

`bun run help` inside a film prints this film's own map (its timeline file names come from `package.json` `"live-studio"`). Shots count from 0 everywhere: notes, the studio, `bun run at`, the draft's strip.

| File                                    | Holds                                                                                    | Clock     |
| --------------------------------------- | ---------------------------------------------------------------------------------------- | --------- |
| `src/scene.ts`                          | The film's code: `buildScene` returns `draw(t)`, which must draw any `t` on its own      | Scene     |
| `src/edit.json`                         | Narration takes and script, `voice.warp`, beats, the film's own settings                 | Narration |
| `src/timeline/shots.json`               | Shots: start `t`, name, framing, `transition` into it, `anim`, `adjust` (`look`), `hits` | Narration |
| `src/timeline/cam.json`                 | Camera keys and cuts: `p`, `l`, `fov` or `mm`, `fstop`/`focus` DOF, `handheld` rig       | Scene     |
| `src/timeline/audio.json`               | Beds, sound effects, the narration's place, gains, tracks, filters                       | Scene     |
| `src/timeline/text.json`, `adjust.json` | On-screen text, colour sliders and named `look` presets                                  | Scene     |
| `src/timeline/timing.json`              | Speed, Freeze, velocity: what turns scene seconds into heard seconds                     | Scene     |
| Key files (`"live-studio".keyFiles`)    | Keyed rows for characters and props                                                      | Scene     |
| `renders/`                              | Everything render, sheet, framecheck and listen write (ignored by git)                   |           |
| `notes/`                                | The creator's notes; read them with `bun run notes`                                      |           |

After every JSON edit run `bun run check`: the studio's own schemas, every sound name, misspelt keys, an off-target `lufs` or a runaway `drive`. The full contract: `bun run skills get core --ref contract`.

## What a film can name

```bash
bun run find impact --kind sfx -n 20         # by words: free, offline, instant
bun run find --kind look                     # named grades (teal-amber, noir-slate); --kind lens, --kind shake too
bun run find --show dissolve                 # one entry in full, with a line to paste
bun run find --jev --kind transition "a memory slipping away"   # by meaning, when words miss
bun run find sit --from stand --to sitFloor  # mocap by posture
```

Every schema is open (`looseObject`): a film may make its own objects, transitions, anims and checks. Where each goes: `bun run skills get core --ref contract`.

## Thử lệnh riêng biệt

Từ root, dùng bun run new-film <tên-thử-chưa-tồn-tại> để tạo phim thử độc lập, hoặc sao chép đúng phim cần tái hiện lỗi. Không dùng một tên thư mục cố định rồi mặc định rằng có thể xóa nó.

| Cần gì | Cách làm |
| --- | --- |
| Thử parser và schema | Dùng template trong phim thử, chỉ chép dữ liệu tối thiểu cần thiết |
| Tái hiện lỗi của phim thật | Sao chép src, cấu hình và media cần thiết; không chép hay dùng chung notes có thể ghi về bản gốc |
| Cần render có sẵn | Sao chép riêng video và cuts.json vào renders của phim thử |
| node_modules hoặc vault là junction | Kiểm tra đích trỏ trước khi chạy lệnh ghi; file dự án và đầu ra phải thuộc phim thử |
| Dọn phim thử | Chỉ xóa đúng thư mục do phiên này tạo, sau khi xác minh đường dẫn và các junction; giữ kết quả cần review trước |
