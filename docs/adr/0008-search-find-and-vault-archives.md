# ADR 0008: Tìm kiếm tài sản bằng find và đóng gói kho vault

## Bối cảnh

Agent cần tìm nhanh âm thanh, hiệu ứng và clip mocap trong kho lớn mà không phải đọc thủ công nhiều tệp JSON, đồng thời cần sao lưu và phục hồi kho tài sản bản quyền riêng tư giữa các máy.

## Quyết định

| Hạng mục | Quy tắc |
| --- | --- |
| Xếp hạng tìm kiếm | scripts/find.ts ưu tiên khớp cục bộ miễn phí bằng BM25F theo trọng số trường và độ phủ từ, chỉ leo thang sang Jev có phí khi kết quả cục bộ không đủ hoặc người dùng yêu cầu rõ. |
| Lọc và báo lỗi CLI | Lỗi dùng sai cờ hoặc giá trị trả mã thoát 2 mà không làm gì; các hàm ease bị loại khỏi vòng bỏ phiếu Jev chung trừ khi chỉ định rõ qua --kind. |
| Phân nhóm bản quyền | Bộ lọc --license phân chia theo nghĩa vụ khi tải YouTube như hướng dẫn Mojang, CC0 và ghi nguồn; phụ đề âm thanh Minecraft được ghép từ sounds.json và en_us.json. |
| Chuẩn hóa âm thanh | scripts/build_sound_vault.mjs chuẩn hóa đỉnh về -1 dBFS có giới hạn khuếch đại, thêm fade khử tiếng tách và tự cắt nhiều lượt thu dài theo khoảng lặng 5 ms. |
| Kho lưu trữ riêng tư | scripts/sound_zip.mjs dùng ZIP64 qua yazl và kiểm tra CRC32 từng luồng qua yauzl, còn scripts/mc/slim_jar.mjs lược bỏ mã Java khỏi client.jar và tạo kèm bản nén Brotli; liên kết kho riêng chỉ truyền lúc chạy và không ghi vào Git. |

## Hệ quả

Truy vấn tài sản thường ngày chạy tức thì và không tốn phí gọi mô hình ngoài. Quá trình phục hồi kho lớn trên máy mới an toàn toàn vẹn dữ liệu và giữ sạch mã nguồn công khai.
