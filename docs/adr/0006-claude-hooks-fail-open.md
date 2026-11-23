# ADR 0006: Thiết kế fail-open cho các hook CLI của Claude Code

## Bối cảnh

Các lệnh CLI làm phim in ra chẩn đoán lỗi cùng dòng gợi ý bước tiếp theo ở cuối luồng xuất. Nếu agent tự pipe hoặc chuyển hướng ra tệp thì dễ mất thông tin lỗi hoặc bỏ sót ghi chú mới từ người dùng trong studio.

## Quyết định

| Hook | Quy tắc |
| --- | --- |
| cli-guard | Hook PreToolUse tại .claude/hooks/cli-guard.ts xóa chuỗi trong ngoặc và heredoc trước khi phân tích để chặn pipe, chuyển hướng hoặc gán biến trên các lệnh CLI làm phim có hướng dẫn. |
| note-watch | Hook PostToolUse tại .claude/hooks/note-watch.ts kiểm tra ghi chú chưa đọc sau khi lệnh chạy và chỉ báo mỗi tập ID một lần cho từng phim. |
| Xử lý lỗi đọc sự kiện | Cả hai hook đều chọn fail-open khi dữ liệu sự kiện đầu vào không phân tích được để tránh chặn cứng phiên làm việc, để lại bước đối chiếu cho lệnh bun run notes thủ công. |

## Hệ quả

Agent luôn đọc trọn vẹn báo lỗi và phản hồi studio trong quy trình bình thường. Các lỗi định dạng ngoài dự kiến từ harness sẽ không làm kẹt toàn bộ phiên chạy lệnh.
