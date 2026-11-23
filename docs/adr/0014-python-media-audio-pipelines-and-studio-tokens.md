# ADR 0014: Đường ống xử lý media âm thanh Python và bảng màu Studio CSS

## Bối cảnh

Các tập lệnh Python trong clip-catalog, scripts/media, scripts/review, scripts/sound và tệp CSS chủ đề của Studio chứa nhiều ngưỡng thực nghiệm, lựa chọn công cụ bên ngoài và cam kết tương phản giao diện.

## Quyết định

| Hạng mục | Quy tắc |
| --- | --- |
| Lọc và xếp hạng clip Python | packages/clip-catalog/catalog.py xếp clip một khung hình và clip có lỗi xuống sau clip chuyển động hợp lệ, dùng ngưỡng yes 0.7 và no 0.3 đồng bộ với jev.ts, còn jev.py ưu tiên tuyến OpenCode Zen miễn phí trước OpenRouter trả phí với trần chi phí mỗi lượt chạy. |
| Giải mã media và OCR | scripts/media/audio_sdk.py chuẩn hóa nguồn âm thanh đổi định dạng sang tệp trung gian cố định trước khi cắt, scripts/media/camera.py tính độ lệch chuẩn theo cửa sổ trượt float32 thay vì nạp cả video vào RAM, còn scripts/media/ocr.py dùng ngưỡng tin cậy 0.8 và độ giống 0.9 để lọc chữ đang phóng to. |
| Kiểm định xuất bản và bảng so sánh | scripts/review/deliver.py mô phỏng lại mã hóa YouTube AV1 với ngưỡng CAMBI 5.0 dễ thấy và cộng thêm 3.0 do mã hóa lại, còn scripts/review/sheet_view.py luôn ghi nhãn nguồn trên từng khung so sánh để tránh nhầm bản mẫu với bản dựng. |
| Trộn âm thanh và chuẩn hóa độ lớn | scripts/sound/mix.py và listen.py dùng nén thoại 4:1 trước giới hạn đỉnh, nâng độ lớn bằng bước tuyến tính tới -14 LUFS với trần -1.5 dBTP theo AES TD1008 để tránh AAC vọt đỉnh và tránh bộ chuẩn hóa động kéo nhiễu nền lên, cùng ngưỡng suy hao gộp mono 1.5 dB cho giọng và 6.0 dB cho phần còn lại. |
| Co giãn thời gian ngoại tuyến | scripts/sound/process.py gọi trực tiếp tiện ích dòng lệnh Rubber Band R3 thay cho bộ lọc R2 thời gian thực trong FFmpeg để bảo toàn chính xác độ dài clip. |
| Hệ màu và tương phản Studio CSS | packages/live-studio/app/index.css dùng bảng màu Flexoki Dark 2.0 theo không gian OKLCH đạt chuẩn tương phản WCAG AA tối thiểu 4.5:1 cho chữ chính, 4.7:1 cho chữ phụ hoặc cảnh báo và 3.3:1 cho viền điều khiển; mọi tên cỡ chữ tùy biến mới phải khai báo đồng bộ trong packages/live-studio/app/lib/cn-tables.ts. |

## Hệ quả

Mọi ngưỡng đo lường âm thanh, video, OCR và bảng màu có điểm tra cứu tập trung thay vì rải rác trong comment mã nguồn, đồng thời loại bỏ ghi chú lỗi thời về tệp lib/utils.ts cũ.
