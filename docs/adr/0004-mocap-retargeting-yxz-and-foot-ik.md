# ADR 0004: Retarget mocap, chuẩn Euler YXZ và IK khóa bàn chân

## Bối cảnh

Rig nhân vật Minecraft có tay chân và đầu dạng khối hộp to hơn tỷ lệ người thật nên chép thẳng góc xoay mocap gây xuyên đầu, xuyên sàn và lật khớp. Pha trộn góc Euler trực tiếp giữa hai clip còn gây xoay vòng dài hoặc nhảy 180 độ.

## Quyết định

| Hạng mục | Quy tắc |
| --- | --- |
| Giải retarget | packages/mc-actor/src/mocap.ts hướng từng xương theo vector và mặt phẳng khớp nguồn, sau đó khử xuyên chân, xuyên thân và lún sàn trước khi bake. |
| Khử giật theo thời gian | Giới hạn tốc độ đổi hướng đẩy thân giữa các khung liên tiếp và xóa bộ nhớ tạm khi hông nhảy đoạn cắt, nhưng không kìm lực nâng sàn để tránh đầu lún khi ngã. |
| Pha trộn và chuẩn hóa | Dùng slerpPose nội suy quaternion và pha hông trong không gian thế giới khi ghép mocap, còn pose.ts đưa Euler YXZ về dạng chuẩn và dùng mask tắt lớp thủ tục trên đoạn clip. |
| IK khóa chân và cache | feet.ts khóa bàn chân kiểu Holden và legTo giữ nguyên mặt phẳng đầu gối của tư thế gốc để không mở tung tư thế quỳ; kết quả bake lưu vào IndexedDB theo mã băm tệp nguồn, rig và mã kịch bản. |
| Kiểm định bảng key | packages/mc-actor/src/keys.ts kiểm tra toàn bộ bảng key ngay lần đọc đầu với danh sách trường nghiêm ngặt để chặn lỗi gõ sai trước khi chạy đến khung đó. |

## Hệ quả

Chuyển động mocap giữ được dáng khối sạch xuyên suốt cảnh quay và ghép mượt với lớp diễn hoạt thủ tục. Bản cache IndexedDB giúp tải lại studio nhanh mà tự hủy khi clip hoặc mã đổi.
