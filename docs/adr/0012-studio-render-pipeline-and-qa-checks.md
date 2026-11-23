# ADR 0012: Quy trình render Chrome không đầu và bộ kiểm tra hình ảnh tự động

## Bối cảnh

Cảnh Three.js cần dựng ra ảnh tĩnh, video nháp và video cuối khớp hệt khung hình studio, kèm các thước đo định lượng cho chuyển động, va chạm, độ rõ chữ và lỗi khung hình mà mắt thường khó soát hết từng giây.

## Quyết định

| Hạng mục | Quy tắc |
| --- | --- |
| Render theo phân đoạn | packages/live-studio/render.mjs và render/page.ts chạy đúng hàm draw(t) trong Chrome không đầu, chia video thành từng đoạn bắt đầu bằng keyframe kèm dấu vân tay nội dung để tái sử dụng đoạn cũ và ghép lại không nén lại. |
| Mờ chuyển động 32-bit | render/accum.ts cộng dồn mẫu phụ trong ánh sáng tuyến tính 32-bit float trên GPU bằng cặp buffer ping-pong để tránh mất chi tiết 8-bit và lỗi dải màu khi làm mờ chuyển động. |
| Hồ sơ Chrome dùng lại | chrome-profile.mjs duy trì các khe hồ sơ có khóa PID trong renders/.chrome-cache để giữ cache shader ANGLE/D3D11 qua nhiều lượt render mà không tranh chấp tệp khóa trên Windows. |
| Bộ kiểm tra hình ảnh | Các kiểm tra --check probe, seen, touch, motion, text và framecheck tách lõi toán học không phụ thuộc DOM vào thư mục checks để vừa đo thật trên ảnh WebGL vừa kiểm thử đơn vị bằng Bun. |

## Hệ quả

Video cuối trùng khớp từng khung với studio và rút ngắn đáng kể thời gian render lại nhờ tái sử dụng phân đoạn lẫn cache shader. Agent nhận phản hồi định lượng tự động về xuyên vật thể, nhảy khung, khuất tầm nhìn và độ đọc chữ.
