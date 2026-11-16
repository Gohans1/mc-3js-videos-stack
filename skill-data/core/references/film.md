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

## Script chạy trực tiếp

Các đường dẫn dưới đây tính từ thư mục phim; thêm --help để xem đủ tham số trước khi chạy. Đây là công cụ hỗ trợ, không bắt buộc dùng mocap, định dạng timeline hay vật lý có sẵn để sáng tạo.

| Việc | Lệnh và luồng |
| --- | --- |
| Đo catalogue | python ../../packages/clip-catalog/batch.py catalog mixamo --limit 1; đọc vault/motion và ghi catalog/<lib>.jsonl dùng chung toàn repo. Chạy lại để tiếp tục hoặc thử lại clip lỗi; tên clip giữ nguyên khoảng trắng. |
| Kiểm tên và tư thế | python ../../packages/clip-catalog/catalog_check.py; bất đồng là gợi ý xem lại, không phải lệnh cấm động tác. --fights mở cả clip chiến đấu; lỗi tải cần sửa trước khi đánh giá. |
| Review bằng mắt | Chạy batch.py sheets rồi catalog_review.py; mở trang JPG được pages.json liệt kê, ghi desc/mood/prop/style từng ô và nộp bằng --page 0 --notes notes.json. Trang đếm từ 0, ô từ 1; giữ nguyên pages.json tới khi review xong, --fix chỉ sửa một clip đã tồn tại. |
| Từ vựng review | --help của catalog_review.py liệt kê nhãn tìm kiếm; desc và flaw mô tả tự do. Ảnh chỉ có tám thời điểm nên cần xem thêm chuyển động bằng lab/clip.ts khi nghi ngờ. |
| So sánh tìm kiếm | python ../../packages/clip-catalog/catalog_eval.py renders/picks-v1.txt --limit 1; gửi mô tả tới Jev, có thể dùng quota trả phí. Mỗi cảnh lưu checkpoint .txt.jsonl, --resume tiếp tục cùng dữ liệu/tham số; đổi code hoặc catalogue thì dùng tên đầu ra mới. |
| Quét retarget | python ../../packages/clip-catalog/batch.py sweep mixamo --limit 1 rồi sweep_report.py mixamo; --diff OLD.jsonl so với bản cũ. Ngưỡng chỉ gợi ý kiểm hình, không kết luận chất lượng diễn xuất. |
| Giới hạn và chạy lại | Batch tối đa 600 giây mỗi nhóm, --limit giới hạn tổng clip; log nằm trong vault/motion/catalog/logs. Lỗi/ngắt giữ kết quả hoàn tất; sau đổi code đo/retarget, cất JSONL và sheets cũ trước khi đo lại để không dùng dữ liệu cũ. |
| Bash cũ | catalog.sh, sweep.sh và catalog_review.sh chuyển tới cùng batch.py tương ứng catalog, sweep, sheets. Windows chạy Python trực tiếp, không cần Bash hay GNU timeout. |
| Xem một clip | LAB_CLIP=lib/name ENTRY=lab/clip.ts bun run render stills rồi python ../../packages/clip-catalog/sheet_clip.py. PowerShell đặt biến qua $env:LAB_CLIP và $env:ENTRY, xóa chúng sau khi chạy. |
| Nhặt asset | Sửa pack/picks.json rồi bun ../../packages/mc-assets/pick.mjs hoặc bun run link <phim> ở gốc; pick.py chỉ chuyển tiếp cho cùng bộ dựng Bun. picked.zip giữ namespace/model/texture và không được đưa lên Git khi giấy phép chưa cho phép. |
| Runtime renderer | bun ../../packages/mc-assets/vendor.mjs sao chép WASM và entity pack đã cài vào assets/public; postinstall của phim tự gọi. Chạy lại sau nâng cấp block-model-renderer, không sửa file vendor bằng tay. |
| Format tùy chọn | bun ../../scripts/timeline_fmt.ts hoặc python ../../scripts/timeline_fmt.py giữ bố cục gọn 140 cột; đều đọc hết JSON trước khi ghi. Hàm load/save/dump vẫn import được, schema mở và code riêng vẫn dùng bình thường. |
| Lệnh riêng phim | bun run help đọc scripts từ package.json của phim; đọc --help và file thực thi trước khi chạy lệnh như bake:physics. Bake phải nói rõ file bị ghi và giây scene/narration/heard; đây là bước chuẩn bị riêng của phim, không phải quy trình bắt buộc cho mọi phim. |
| Dữ liệu và công cụ | Vault không nằm trong Git; phục hồi motion/rig/game bằng setup:vault và link nếu thiếu. Python tạo ảnh cần Pillow, cài bằng uv pip install pillow vào venv đang dùng; đánh giá Jev cần route/key riêng như jev.py chỉ rõ. |

## Try a command on a copy, never on a real film

On Windows, from the repo root:

```bash
robocopy films/sealed-room films/_try /E /XD node_modules renders   # then copy renders/draft_video.mp4 and cuts.json if needed
cmd /c mklink /J films\_try\node_modules films\sealed-room\node_modules
cmd /c rmdir films\_try\node_modules         # when done: unlink the junction first, so the real modules stay
rm -rf films/_try
```
