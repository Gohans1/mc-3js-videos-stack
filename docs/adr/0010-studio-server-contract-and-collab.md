# ADR 0010: Máy chủ Studio, hợp đồng dữ liệu và đồng bộ cộng tác

## Bối cảnh

Studio chạy cục bộ cho từng phim mà không dùng mật khẩu, đồng thời phục vụ cả người dùng trên trình duyệt lẫn các lệnh CLI agent cùng ghi vào tệp JSON và tệp ghi chú.

## Quyết định

| Hạng mục | Quy tắc |
| --- | --- |
| An toàn mạng cục bộ | packages/live-studio/src/live.mjs chỉ lắng nghe nội bộ trừ khi bật --lan, kiểm tra Host để chặn DNS rebinding và chỉ tự cho phép tên miền Tailscale khớp đúng cổng. |
| Hợp đồng tệp phim | packages/live-studio/src/contract.ts định nghĩa toàn bộ lược đồ JSON bằng Zod, tách danh sách khóa nhẹ sang contract-keys.ts để gói trình duyệt không kéo Zod hay Three.js vào lượt tải đầu. |
| Ghi an toàn và chống ghi đè | Mọi thao tác lưu timeline, lesson và notes.jsonl qua timeline_file.mjs, lesson-files.mjs và notes.mjs đều ghi nguyên tử và đối chiếu nhãn phiên bản để trả 409 khi agent vừa sửa bên ngoài; chỉ một phiên Studio giữ quyền ghi notes.jsonl cho mỗi phim. |
| Tối ưu gói trang và mạng | packages/live-studio/src/page.mjs và api.mjs nén trước tài sản _studio theo mã băm bằng Brotli và Gzip, đồng thời tải duy nhất một bản sao three theo tên gói trong vite_film.mjs để không gãy exports map. |

## Hệ quả

Người dùng và agent sửa chung một dự án phim mà không làm hỏng tệp JSON hay mất ghi chú. Trình duyệt và điện thoại qua Tailscale tải lại nhanh khi các chunk thư viện không đổi mã băm.
