# Phim mới, dữ liệu và vault

## Tạo và kết nối

Máy mới chạy bun run setup tại thư mục gốc trước; thiếu kho ngoài thì lệnh thoát 1 và chỉ cách khôi phục. Máy đã sẵn sàng chỉ cần bun run new-film cave-escape 47920 rồi chuyển vào films/cave-escape, chạy bun run check và bun run studio.

new-film tự sao template, cài dependency, nối vault và dựng picked.zip; không cần chạy setup:vault hoặc link lần nữa. Cổng có thể bỏ qua, mặc định cao hơn cổng đã gán cho các phim; chỉ xem là chạy được sau khi mở URL Studio và thấy cảnh.

## Chọn đúng lệnh

| Lệnh tại thư mục gốc | Vai trò |
| --- | --- |
| bun run setup | Chuẩn bị máy: bun install, setup:vault, link; tải tài nguyên và tái sử dụng kết quả khi chạy lại. |
| bun run setup:vault | Chỉ tải và dựng vault; cần cài dependency trước bằng bun install. |
| bun run new-film cave-escape | Tạo phim mới hoàn chỉnh từ template, không ghi đè phim đã có. |
| bun run link cave-escape | Nối lại vault và dựng picks sau khi đổi kho hoặc pack/picks.json; không cài dependency hay tải tài nguyên. |
| bun packages/live-studio/init.mjs PROJECT | Nối project mới hoặc có sẵn vào Studio và cài dependency; không nối vault hay dựng picks. Xem trước bằng --dry-run; phim trong repo ưu tiên new-film. |

## Tiếp tục khi lỗi

Phim đã được sao nhưng bước sau thất bại: giữ thư mục, sửa lỗi rồi chạy bun packages/live-studio/init.mjs films/cave-escape và bun run link cave-escape tại thư mục gốc. Sau đó vào phim chạy bun run check và bun run studio; không chạy new-film cùng tên để ghi đè.

Thiếu kho nhẹ: bun run setup:vault; thiếu kho ngoài: khôi phục vào externalRoot trong vault.json hoặc đặt MC_VAULT_EXTERNAL trong cùng terminal trước khi chạy link. Kho ngoài gồm dữ liệu riêng không đi cùng Git; INSTALL.md ghi cách chuẩn bị và giấy phép.

PowerShell: chuyển thư mục và chạy từng lệnh riêng; để đổi kho dùng $env:MC_VAULT_EXTERNAL='D:/mc_vault'. Bun cài dependency cho toàn bộ workspace và cập nhật bun.lock ở gốc; không tạo lockfile riêng trong phim.

## Dữ liệu phim

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

## Try a command on a copy, never on a real film

On Windows, from the repo root:

```bash
robocopy films/sealed-room films/_try /E /XD node_modules renders   # then copy renders/draft_video.mp4 and cuts.json if needed
cmd /c mklink /J films\_try\node_modules films\sealed-room\node_modules
cmd /c rmdir films\_try\node_modules         # when done: unlink the junction first, so the real modules stay
rm -rf films/_try
```
