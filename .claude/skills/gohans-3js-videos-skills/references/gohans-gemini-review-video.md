# gohans-gemini-review-video
- Không tự ý gọi review trừ khi được cho phép
- Dùng AI Studio để soi hình qua JPEG có timecode. Nghe và đo âm thanh trên file gốc bằng công cụ local.

## Review Guide

Với scene có REF khớp, chạy [recipe Compare](../../compare-video/references/stills-field-audit.md#recipe) ngay khi render xong. Render với ít nhất 8 shutter samples khi cần soi motion blur. Lệnh `bun run reference frames` đóng gói REF trái, OURS phải, timecode phim ở 15 fps và tối đa 450 JPEG mỗi list (20 giây ra khoảng 300 ảnh).

Gửi từng list qua `ask.ts --batch --files-from` với `gemini-4-hydrogen`, `--thinking High`, `--media High` và `--tool search=off`. Dùng prompt tổng quát để quét nhanh, hoặc [tách mỗi field cần soi kỹ thành một lượt](../../compare-video/references/stills-field-audit.md#prompt-template) trên cùng bộ ảnh.

Lưu report cạnh list theo đúng bản render và kiểm chứng lỗi trên frame gốc. Với cut hoặc pop ngắn, đóng gói lại đoạn cần soi bằng `--fps native`.

Review cả phim bằng cùng luồng ảnh. Gửi hết các list theo thứ tự, gộp report theo timecode phim và đánh dấu đoạn còn thiếu. Nếu phim gốc không có REF khớp, đóng gói [ảnh một nguồn](../../compare-video/references/stills-field-audit.md#single-source-stills) và review theo skill sản xuất của phim.

## Các dấu hiệu cần để ý
- Motion
- Motion Blur (Samples)
- DOF & Focus
- (Very Fast)Transition & Pacing
- Sound SFX LipSync có khớp với cảnh/nhận vật ko
- Nhấp nháy/Chớp nhoáng
- Particles
- Stroboscopic / Judder
- Temporal aliasing
