# Phim mới, dữ liệu và vault

## Tạo và kết nối

Máy mới chạy bun run setup tại thư mục gốc trước; thiếu thư mục vault tại máy thì lệnh thoát 1 và chỉ cách khôi phục. Máy đã sẵn sàng chỉ cần bun run new-film cave-escape 47920 rồi chuyển vào films/cave-escape, chạy bun run check và bun run studio.

new-film tự sao template, cài dependency, nối vault và dựng picked.zip; không cần chạy setup:vault hoặc link lần nữa. Cổng có thể bỏ qua, mặc định cao hơn cổng đã gán cho các phim; chỉ xem là chạy được sau khi mở URL Studio và thấy cảnh.

## Chọn đúng lệnh

| Lệnh tại thư mục gốc                      | Vai trò                                                                                                                                               |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| bun run setup                             | Chuẩn bị máy: bun install, setup:vault, link; tải tài nguyên và tái sử dụng kết quả khi chạy lại.                                                     |
| bun run setup:vault                       | Chỉ tải và dựng vault; cần cài dependency trước bằng bun install.                                                                                     |
| bun run new-film cave-escape              | Tạo phim mới hoàn chỉnh từ template, không ghi đè phim đã có.                                                                                         |
| bun run link cave-escape                  | Cập nhật bản sao asset thật từ vault và dựng picks sau khi đổi kho hoặc pack/picks.json; không cài dependency hay tải tài nguyên.                     |
| bun packages/live-studio/init.mjs PROJECT | Nối project mới hoặc có sẵn vào Studio và cài dependency; không nối vault hay dựng picks. Xem trước bằng --dry-run; phim trong repo ưu tiên new-film. |

## Tiếp tục khi lỗi

Phim đã được sao nhưng bước sau thất bại: giữ thư mục, sửa lỗi rồi chạy bun packages/live-studio/init.mjs films/cave-escape và bun run link cave-escape tại thư mục gốc. Sau đó vào phim chạy bun run check và bun run studio; không chạy new-film cùng tên để ghi đè.

Thiếu tài nguyên có nguồn tải: bun run setup:vault; motion, packs và tools riêng phải chép thành thư mục thật vào vault trên C:. externalRoot chỉ chứa sound-raw, gói tải gốc và backup; INSTALL.md ghi giấy phép và cách chuẩn bị.

PowerShell: chuyển thư mục và chạy từng lệnh riêng; MC_VAULT_EXTERNAL chỉ đổi nơi giữ gói thô và backup. Bun cài dependency cho toàn bộ workspace và cập nhật bun.lock ở gốc; không tạo lockfile riêng trong phim.

## Worktree trên Windows

Asset và code phải là file/thư mục thật trên C:, không tạo junction hay symlink; chỉ link node_modules do Bun quản lý được giữ. Mỗi WT tự cài dependency bằng Bun, tránh nối cả node_modules sang checkout chính.

Dùng Git for Windows từ 2.54 trở lên; bản cũ có thể xoá đích junction khi dọn WT, kể cả cùng ổ C:. Trước khi xoá WT, duyệt không theo link và gỡ từng link không đệ quy, rồi kiểm tra dữ liệu đích vẫn nguyên; chỉ xoá branch đã merge hoặc đã sao lưu xác thực.

## Lưu các hướng dựng

Film → Versions lưu bản đặt tên và các bản tự lưu; trước khi khôi phục luôn có bản dự phòng của trạng thái hiện tại.
Lệnh bun run history --film films/tên list, save hoặc restore giữ code, timeline được cấu hình và lựa chọn pack/picks.json; media và package chung không được đóng băng nên đây không phải bản render tái lập tuyệt đối.

Lịch sử cục bộ nằm trong .studio/history.sqlite; đóng Studio rồi sao lưu cả .studio khi chuyển máy.

## Dữ liệu phim

A Shorts film sets `"ratio": "9:16"` under `"live-studio"` in its `package.json`: drafts at 720x1280, the final at 1080x1920.

## What each file holds

`bun run help` inside a film prints this film's own map (its timeline file names come from `package.json` `"live-studio"`). Shots count from 0 everywhere: notes, the studio, `bun run at`, the draft's strip.

| File                                    | Holds                                                                                                 | Clock     |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------- |
| `src/scene.ts`                          | The film's code: `buildScene` returns `draw(t)`, which must draw any `t` on its own                   | Scene     |
| `src/edit.json`                         | Narration takes and script, `voice.warp`, beats, the film's own settings                              | Narration |
| `src/timeline/shots.json`               | Shots: start `t`, name, framing, `transition` into it, `anim`; shot N is row N                        | Narration |
| `src/timeline/cam.json`                 | Camera keys and cuts                                                                                  | Scene     |
| `src/timeline/audio.json`               | Beds, sound effects, the narration's place, gains, tracks, filters                                    | Scene     |
| `src/timeline/text.json`, `adjust.json` | On-screen text, colour and look layers                                                                | Scene     |
| `src/timeline/timing.json`              | Speed, Freeze, velocity: what turns scene seconds into heard seconds                                  | Scene     |
| Key files (`"live-studio".keyFiles`)    | Keyed rows for characters and props                                                                   | Scene     |
| `renders/`                              | Everything render, sheet, framecheck and listen write (ignored by git)                                |           |
| `notes/`                                | The creator's notes; read them with `bun run notes`                                                   |           |
| `lessons/`                              | This film's lessons (`../../lessons/` for every film, nested `.md` ok); `bun run notes ID` picks both |           |

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

| Việc                 | Lệnh và luồng                                                                                                                                                                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Đo catalogue         | python ../../packages/clip-catalog/batch.py catalog mixamo --limit 1; đọc vault/motion và ghi catalog/<lib>.jsonl dùng chung toàn repo. Chạy lại để tiếp tục hoặc thử lại clip lỗi; tên clip giữ nguyên khoảng trắng.                                             |
| Kiểm tên và tư thế   | python ../../packages/clip-catalog/catalog_check.py; bất đồng là gợi ý xem lại, không phải lệnh cấm động tác. --fights mở cả clip chiến đấu; lỗi tải cần sửa trước khi đánh giá.                                                                                  |
| Review bằng mắt      | Chạy batch.py sheets rồi catalog_review.py; mở trang JPG được pages.json liệt kê, ghi desc/mood/prop/style từng ô và nộp bằng --page 0 --notes notes.json. Trang đếm từ 0, ô từ 1; giữ nguyên pages.json tới khi review xong, --fix chỉ sửa một clip đã tồn tại.  |
| Từ vựng review       | --help của catalog_review.py liệt kê nhãn tìm kiếm; desc và flaw mô tả tự do. Ảnh chỉ có tám thời điểm nên cần xem thêm chuyển động bằng lab/clip.ts khi nghi ngờ.                                                                                                |
| So sánh tìm kiếm     | python ../../packages/clip-catalog/catalog_eval.py renders/picks-v1.txt --limit 1; gửi mô tả tới Jev, có thể dùng quota trả phí. Mỗi cảnh lưu checkpoint .txt.jsonl, --resume tiếp tục cùng dữ liệu/tham số; đổi code hoặc catalogue thì dùng tên đầu ra mới.     |
| Quét retarget        | python ../../packages/clip-catalog/batch.py sweep mixamo --limit 1 rồi sweep_report.py mixamo; --diff OLD.jsonl so với bản cũ. Ngưỡng chỉ gợi ý kiểm hình, không kết luận chất lượng diễn xuất.                                                                   |
| Giới hạn và chạy lại | Batch tối đa 600 giây mỗi nhóm, --limit giới hạn tổng clip; log nằm trong vault/motion/catalog/logs. Lỗi/ngắt giữ kết quả hoàn tất; sau đổi code đo/retarget, cất JSONL và sheets cũ trước khi đo lại để không dùng dữ liệu cũ.                                   |
| Bash cũ              | catalog.sh, sweep.sh và catalog_review.sh chuyển tới cùng batch.py tương ứng catalog, sweep, sheets. Windows chạy Python trực tiếp, không cần Bash hay GNU timeout.                                                                                               |
| Xem một clip         | LAB_CLIP=lib/name ENTRY=lab/clip.ts bun run render stills rồi python ../../packages/clip-catalog/sheet_clip.py. PowerShell đặt biến qua $env:LAB_CLIP và $env:ENTRY, xóa chúng sau khi chạy.                                                                      |
| Nhặt asset           | Sửa pack/picks.json rồi bun ../../packages/mc-assets/pick.mjs hoặc bun run link <phim> ở gốc; pick.py chỉ chuyển tiếp cho cùng bộ dựng Bun. picked.zip giữ namespace/model/texture và không được đưa lên Git khi giấy phép chưa cho phép.                         |
| Runtime renderer     | bun ../../packages/mc-assets/vendor.mjs sao chép WASM và entity pack đã cài vào assets/public; postinstall của phim tự gọi. Chạy lại sau nâng cấp block-model-renderer, không sửa file vendor bằng tay.                                                           |
| Format tùy chọn      | bun ../../scripts/timeline_fmt.ts hoặc python ../../scripts/timeline_fmt.py giữ bố cục gọn 140 cột; đều đọc hết JSON trước khi ghi. Hàm load/save/dump vẫn import được, schema mở và code riêng vẫn dùng bình thường.                                             |
| Lệnh riêng phim      | bun run help đọc scripts từ package.json của phim; đọc --help và file thực thi trước khi chạy lệnh như bake:physics. Bake phải nói rõ file bị ghi và giây scene/narration/heard; đây là bước chuẩn bị riêng của phim, không phải quy trình bắt buộc cho mọi phim. |
| Dữ liệu và công cụ   | Vault không nằm trong Git; chép motion từ máy cũ vào vault/motion thật trên C: rồi chạy link, không có bước tự tải motion. Python tạo ảnh cần Pillow, cài bằng uv pip install pillow vào venv đang dùng; đánh giá Jev cần route/key riêng như jev.py chỉ rõ.      |

## Thử lệnh riêng

Thử lệnh trên WT riêng, cài dependency bằng Bun và sao các asset cần dùng thành file thật; không chia sẻ node_modules thủ công. Trước khi dọn bản thử, tuân thủ mục Worktree trên Windows ở trên.

## Thử lệnh riêng biệt

Từ root, dùng bun run new-film <tên-thử-chưa-tồn-tại> để tạo phim thử độc lập, hoặc sao chép đúng phim cần tái hiện lỗi. Không dùng một tên thư mục cố định rồi mặc định rằng có thể xóa nó.

| Cần gì                     | Cách làm                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Thử parser và schema       | Dùng template trong phim thử, chỉ chép dữ liệu tối thiểu cần thiết                                              |
| Tái hiện lỗi của phim thật | Sao chép src, cấu hình và media cần thiết; không chép hay dùng chung notes có thể ghi về bản gốc                |
| Cần render có sẵn          | Sao chép riêng video và cuts.json vào renders của phim thử                                                      |
| Dữ liệu bản thử            | Dùng file thật trên C:; node_modules do Bun cài trong WT, không dùng chung với checkout gốc                     |
| Dọn phim thử               | Chỉ xóa đúng thư mục do phiên này tạo, sau khi xác minh đường dẫn và các junction; giữ kết quả cần review trước |
