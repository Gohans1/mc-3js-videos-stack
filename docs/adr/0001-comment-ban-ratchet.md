# ADR 0001: Cấm comment văn xuôi theo cơ chế ratchet

## Bối cảnh

Comment văn xuôi trong mã nguồn nhanh lỗi thời, lặp lại điều tên hàm và kiểu đã thể hiện, hoặc che đậy các đoạn xử lý chắp vá cho AI đời sau bắt chước.

## Quyết định

| Hạng mục | Quy tắc |
| --- | --- |
| Luật lint | Bật plugin mc-comments/no-comments trong .oxlintrc.json và packages/live-studio/.oxlintrc.json cho JS/TS, đồng thời gắn bun run comments ratchet --check vào bun run lint để kiểm soát cả Python và CSS. |
| Cơ chế ratchet | Lưu trần số token comment cũ theo từng tệp JS/TS, Python và CSS tại scripts/lint/comment-ratchet.json; vượt trần, trần cao hơn thực tế hoặc còn khóa tệp đã xóa đều báo lỗi. |
| Ngoại lệ được phép | Chỉ miễn directive công cụ chuẩn như @ts-expect-error, oxlint-disable, biome-ignore, v8 ignore, vite-ignore, JSDoc kiểu trong JS thuần, shebang và directive Python như type: ignore, noqa, ruff, pyright. |
| Ghi chú ràng buộc | Comment constraint ngắn mô tả bất biến kỹ thuật, lỗi thư viện ngoài hoặc ghi chú bản quyền bắt buộc được giữ dưới trần ratchet. |
| Quy trình dọn dần | Dùng bun run comments list, strip, ratchet và skill .claude/skills/delete-comment để dọn từng đợt trên JS/TS, Python và CSS với xác minh AST và cú pháp tự động. |

## Hệ quả

Mọi file mới hoặc file đã dọn về 0 đều không cho phép thêm comment văn xuôi. Các quyết định kiến trúc lâu dài chuyển vào docs/adr còn các lỗi chắp vá ghi vào docs/comment-excuses.md.
