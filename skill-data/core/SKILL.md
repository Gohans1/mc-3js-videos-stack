---
name: core
description: Hướng dẫn mc-films về tìm lệnh, dựng và kiểm chứng phim, ba đồng hồ thời gian, chi phí và các tài liệu chuyên sâu. Đọc trước khi dùng CLI của repo.
---

# mc-films

CLI và live-studio là bộ khởi đầu để dựng, xem và nhận feedback; chúng không giới hạn sáng tạo. Tự viết Three.js, công cụ hoặc kiểm tra riêng khi cần; giữ draw(t) tái hiện đúng bất kỳ thời điểm nào.

## Tìm đúng thông tin

| Cần gì                                          | Đọc ở đâu                                                   |
| ----------------------------------------------- | ----------------------------------------------------------- |
| Danh mục lệnh; trong phim có thêm bản đồ file   | bun run help                                                |
| Lệnh thuộc repo hay phim                        | bun run help <command>                                      |
| Cú pháp, tham số, ví dụ và chi phí của một lệnh | bun run <command> --help                                    |
| Quy trình chung                                 | bun run skills get core                                     |
| Một chủ đề                                      | bun run skills get core --ref sound; lặp --ref để chọn thêm |
| Toàn bộ hướng dẫn và references                 | bun run skills get core --full; không kết hợp --ref         |

Ở root dùng lệnh quản lý repo; ở films/<name> dùng lệnh của phim. -h, --help hoặc từ help đầu tiên chỉ in hướng dẫn; --ref chỉ thuộc skills get.

## Quy trình theo nhu cầu

Chọn các bước phục vụ cảnh đang dựng, không cần chạy cả chuỗi cho mọi thay đổi. Số đo và preset là gợi ý; quyết định nhịp, hình và âm thanh theo ý đồ của phim.

| Việc                            | Lệnh hoặc nơi chỉnh                                                            |
| ------------------------------- | ------------------------------------------------------------------------------ |
| Tìm chất liệu, preset           | bun run find <words>; nguồn khác hoặc tự tạo khi phù hợp, kiểm tra giấy phép   |
| Dựng cảnh và hiệu ứng riêng     | src/scene.ts; bun run skills get core --ref contract                           |
| Chỉnh dữ liệu                   | Các file timeline ghi trong package.json của phim; bun run check sau khi chỉnh |
| Xem tại giây nghe thấy          | bun run at 35.6; AT=35.6 bun run render stills; mở ảnh được in ra              |
| Xem chuyển động                 | SPAN=40,44 bun run render clip; mở video                                       |
| Xem nhiều khung hình            | bun run sheet                                                                  |
| Kiểm tra hình và nhịp của draft | bun run render clip; bun run framecheck; bun run pace                          |
| Ghép âm thanh vào draft         | bun run mix renders/draft_video.mp4; tạo renders/draft.mp4                     |
| Đo mức âm                       | bun run listen; không dùng số đo mức âm để kết luận tiếng gì hoặc có hợp cảnh  |
| Nghe và đánh giá âm             | earshot là CLI riêng; bun run skills get core --ref sound                      |
| Nhận feedback                   | bun run studio; mở link và đọc bun run notes                                   |

Các ví dụ VAR=x bun run ... dùng cú pháp shell POSIX hoặc Bun Shell. PowerShell: $env:AT='35.6'; bun run render stills; Remove-Item Env:AT (nếu biến đã có giá trị, lưu và khôi phục nó).

## Ba đồng hồ

| Đồng hồ                             | Nơi dùng                                                          |
| ----------------------------------- | ----------------------------------------------------------------- |
| Giây nghe thấy, sau Speed và Freeze | Notes, at, AT, CHECK, sheet, framecheck, pace, listen, voice:cues |
| Giây cảnh, trước Speed và Freeze    | cam.json, key files, audio.json, text.json, adjust.json           |
| Giây lời kể, trước voice.warp       | t trong shots.json và beats trong edit.json                       |

bun run at <giây nghe thấy> đổi giữa các đồng hồ và chỉ file, dòng đang phát. Giây nhận dạng 65, 1:05 hoặc 01:05.250; shots đếm từ 0.

## Sửa feedback và giao phim

| Việc                         | Cách làm                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| Đọc và định vị note          | bun run notes; bun run notes 3; bun run at '#3'                                           |
| Xác nhận đã sửa              | Xem/nghe kết quả mới rồi bun run note done 3 "what changed"; người tạo duyệt trong studio |
| Cần hiểu thêm                | bun run note ask 3 "your question"                                                        |
| Ghi quy tắc được yêu cầu nhớ | bun run skills get core --ref notes                                                       |
| Final khi được yêu cầu       | bun run render final; bun run mix renders/final_video.mp4; bun run deliver                |

Không chỉnh notes/notes.jsonl bằng tay. Final xuất ra renders/final.mp4; kiểm tra kỹ thuật pass chưa thay thế việc xem/nghe phim và chưa có nghĩa là đã upload.

## Chi phí và tác dụng phụ

| Việc                            | Lưu ý                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| voice:gen --yes                 | Tốn credits; chạy không --yes để xem trước, chỉ tạo lại take cần sửa                        |
| find --jev                      | Gọi dịch vụ ngoài, có quota/chi phí; tìm bằng từ khóa trước khi cần tìm theo nghĩa          |
| render final, deliver --youtube | Có thể lâu; xem --help và giới hạn đoạn cần kiểm tra                                        |
| Thử lệnh có ghi dữ liệu         | Dùng phim thử riêng; bun run skills get core --ref film                                     |
| Lệnh lỗi                        | Đọc lỗi và kiểm tra kết quả đã ghi; không mặc định mã thoát lỗi đồng nghĩa chưa thay đổi gì |

Mã 0 là lệnh thành công; 1 thường là lỗi dữ liệu hoặc công việc; 2 thường là sai cách gọi hay thiếu điều kiện. Dòng next: nếu có là gợi ý bước tiếp, không phải yêu cầu bắt buộc.

## Thiếu khả năng hoặc gặp lỗi

| Tình huống                             | Cách tiếp tục                                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| CLI thiếu khả năng                     | Tự dùng code/công cụ phù hợp rồi bun run gap "<need>" --did "<outcome>" --cmd <command>         |
| Chưa tìm được cách tiếp tục            | Ghi --did "stopped: <why>"; không bịa rằng đã xử lý được                                        |
| Đọc bun run gap                        | Đây là lịch sử báo thiếu, có thể đã được giải quyết; kiểm tra code hiện tại trước khi thêm lệnh |
| Cần schema hoặc hook chưa rõ           | bun run skills get core --ref contract; packages/live-studio/src/contract.ts                    |
| STALE                                  | Video cũ hơn dữ liệu; render lại loại video đang kiểm tra                                       |
| Âm vault đã đổi nhưng listen còn cache | bun run listen --fresh                                                                          |
| Lệnh sai thư mục                       | Chuyển tới root hoặc films/<name> theo thông báo                                                |
| earshot chưa chạy được                 | earshot doctor; xem INSTALL.md                                                                  |

Gap không phải điều kiện để được sáng tạo; số báo cáo không tự quyết định phải thêm lệnh mới. Log nằm trong checkout hiện tại, phải commit và đồng bộ riêng nếu cần chia sẻ.

## Đọc thêm đúng chủ đề

| Reference của core     | Khi cần                                         |
| ---------------------- | ----------------------------------------------- |
| references/film.md     | Tạo phim, bản đồ file, vault, phim thử          |
| references/contract.md | Scene, schema mở, hook và khả năng tự mở rộng   |
| references/review.md   | Xem, đo hình, chữ và nhịp                       |
| references/render.md   | Render, cache, cấu hình xuất và kiểm tra encode |
| references/sound.md    | Âm thanh, mix, mức âm và earshot                |
| references/voice.md    | Takes, tạo lời kể, căn từ, lip sync và ghép lời |
| references/notes.md    | Feedback, trạng thái note và lessons            |
| references/cli.md      | Thêm hoặc sửa CLI và giữ tài liệu khớp code     |

INSTALL.md ở root là file đọc trực tiếp về cài đặt, vault và giấy phép; không phải --ref. Quy tắc sáng tạo riêng nằm ở .claude/skills/gohans-3js-videos-skills/SKILL.md; đây không phải guide do skills get phục vụ.
