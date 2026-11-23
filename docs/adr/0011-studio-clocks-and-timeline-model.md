# ADR 0011: Hệ đồng hồ dựng phim, đường cong tốc độ và khẩu hình

## Bối cảnh

Thao tác cắt, tăng giảm tốc độ, đóng băng khung hình hoặc đổi chỗ đoạn trên rãnh chính làm thời gian người xem nghe khác hoàn toàn thời gian gốc trong tệp nguồn của cảnh và thoại.

## Quyết định

| Hạng mục | Quy tắc |
| --- | --- |
| Tách đồng hồ nguồn và nghe | timing.mjs, timing-state.mjs, timing-data.mjs và warp.mjs tách biệt giây nguồn với giây nghe để mọi lớp đặt mốc không phải viết lại dữ liệu chuyển động gốc khi cắt dựng. |
| Đường cong tốc độ đơn điệu | packages/live-studio/src/speed-curve.mjs cài đặt hệ số tiếp tuyến đơn điệu Steffen khớp d3-shape nhưng không kéo thư viện vào gói khởi động, giới hạn sai số tuyến tính hóa dưới 1 ppm cho xem trước, xuất video và Rubber Band. |
| Rãnh chính kiểu OTIO | main-track.mjs, layer-timing.mjs và linkage.mjs mô hình hóa đoạn và khoảng trống trên rãnh chính để dịch vị trí lớp phụ theo cùng phép biến đổi mà giữ nguyên đồng hồ nguồn gốc. |
| Khẩu hình và nhận diện mảng | lips.ts và narration.ts giữ mốc Rhubarb gắn theo mẫu âm thanh gốc rồi đặt lên đồng hồ cảnh qua clip thoại; merge-edits.mjs coi mảng không có định danh bền vững là một đơn vị chỉnh sửa nguyên khối. |

## Hệ quả

Người dựng thoải mái chèn Freeze, đổi tốc độ hay dịch đoạn mà khẩu hình, chữ và các đường key vẫn bám đúng khung hình. Sai lệch thời gian giữa bản xem trước trên trình duyệt và bản render cuối được triệt tiêu.
