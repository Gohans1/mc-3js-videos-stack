---
name: delete-comment
description: Rà soát, phân loại và xoá comment văn xuôi thừa theo cơ chế ratchet của oxlint (mc-comments/no-comments) trong repo mc-films. Phân loại từng comment thành tautology, stale, excuse, decision hoặc constraint, chuyển quyết định kiến trúc vào docs/adr, ghi lỗi chắp vá đã kiểm chứng vào docs/comment-excuses.md, xoá an toàn giữ nguyên AST bằng bun run comments strip và siết trần ratchet tại scripts/lint/comment-ratchet.json. Use whenever asked to clean comments, delete comments, tighten the comment ratchet, audit comments in a package or folder, or run /delete-comment.
---

# delete-comment

Quy trình dọn comment văn xuôi từng đợt trong repo mc-films mà không đổi token mã nguồn. Mọi bước chạy từ root repo bằng bun.

Tiêu chí phân loại chi tiết và định dạng JSONL nằm tại references/rubric.md. Đọc trước khi gán nhãn.

## Lệnh CLI

| Việc | Lệnh |
| --- | --- |
| Xem tổng quan còn lại toàn repo | bun run comments stats |
| Xuất danh sách khối comment trong phạm vi | bun run comments list [paths...] --out verdicts-input.jsonl |
| Xoá an toàn theo tệp JSONL | bun run comments strip doomed.jsonl |
| Siết trần ratchet sau khi xoá | bun run comments ratchet [paths...] |
| Kiểm tra ratchet không lệch | bun run comments ratchet --check |
| Kiểm tra luật lint và kiểu | bun run lint && bun run --cwd packages/live-studio lint && bun run typecheck |

## Quy trình từng đợt

| Bước | Hành động |
| --- | --- |
| 1. Chọn phạm vi | Chạy bun run comments stats để chọn một gói hoặc thư mục cụ thể, không ôm toàn repo một lượt. |
| 2. Xuất khối comment | Chạy bun run comments list với phạm vi đã chọn để lấy danh sách khối comment liên tiếp theo số dòng. |
| 3. Đọc mã thật và phân loại | Đọc mã xung quanh từng khối comment rồi gán một trong năm nhãn tại references/rubric.md gồm tautology, stale, excuse, decision hoặc constraint. |
| 4. Ghi ADR cho decision | Chuyển mọi quyết định kiến trúc đạt chuẩn vào docs/adr theo số thứ tự tiếp theo và giữ văn phong ngắn gọn không bold, italic hay code block. |
| 5. Ghi nhận excuse | Kiểm chứng trực tiếp trong mã rằng đó là lối tắt gây sai thực sự rồi ghi vào docs/comment-excuses.md kèm điều kiện kích hoạt và hướng sửa; không tự tạo issue GitHub công khai khi chưa có lệnh. |
| 6. Xoá bằng công cụ an toàn | Ghi mọi khối có nhãn khác constraint ra tệp JSONL rồi chạy bun run comments strip để xoá nguyên tử và đối chiếu băm SHA-256 token mã nguồn trước và sau. |
| 7. Siết ratchet và kiểm định | Chạy bun run comments ratchet, sau đó chạy bun run lint, bun run --cwd packages/live-studio lint, bun run typecheck và các bộ test thuộc phạm vi vừa chạm. |

## Quy tắc cứng

| Quy tắc | Lý do |
| --- | --- |
| Không sửa tay khi có thể dùng strip | bun run comments strip dùng parser oxlint cho JS/TS, tokenize và ast.parse cho Python, cùng bộ quét cân ngoặc cho CSS để đảm bảo 0 thay đổi ngữ nghĩa. |
| Không chạy ratchet --init trong đợt dọn | Cờ --init chỉ dùng khi khởi tạo lại từ đầu; lệnh ratchet thường từ chối nâng trần file nào lên cao hơn mức cũ và bun run lint kiểm tra ratchet cho cả JS/TS, Python lẫn CSS. |
| Giữ nguyên directive và ghi chú bản quyền | Công cụ tự miễn directive JS/TS (@ts-nocheck, @ts-expect-error, oxlint-disable, biome-ignore, v8 ignore, vite-ignore, JSDoc kiểu JS thuần) và Python (shebang, type: ignore, noqa, ruff, pyright); luôn giữ comment bản quyền LGPL, Apache hoặc MIT bắt buộc. |
| Không chạm thư mục films | films bị gitignore và nằm ngoài phạm vi kiểm tra của repo gốc. |
| Không chạy bun fmt lên file markdown skill | Tự căn bảng gọn tay khi cập nhật tài liệu trong .claude/skills. |
