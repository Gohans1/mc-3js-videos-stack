# ADR 0013: Tách trạng thái UI Studio, bộ trộn Web Audio và giao diện di động

## Bối cảnh

Giao diện Studio phải vẽ mượt 60 fps trên nhiều canvas timeline, hiện đồng hồ sóng màu và trộn âm thanh trực tiếp trùng khớp bản mix FFmpeg, đồng thời vẫn dùng ổn định trên điện thoại qua Tailscale.

## Quyết định

| Hạng mục | Quy tắc |
| --- | --- |
| Tách engine và React | app/core/state.ts giữ trạng thái đọc ghi mỗi khung hình hoàn toàn ngoài React để không kích hoạt render lại, trong khi app/core/store.ts ghép các lát trạng thái Zustand và máy trạng thái chọn chéo rãnh rõ ràng tại selection.ts. |
| Sóng màu không chặn luồng | app/picture/scopes.ts đọc lại khung hình bằng WebGPU mapAsync thay vì getImageData đồng bộ để đồng hồ màu không làm khựng tốc độ phát. |
| Trộn âm thanh trực tiếp | app/sound/mixer.ts, eq.ts, duck.ts, envelope.ts và brickwall.worklet.ts tái hiện đúng đường cong afade, bộ lọc Butterworth, kênh mono -3 dB và bộ giới hạn LGPL-2.1 từ FFmpeg để nghe thử khớp bản mix.py. |
| Bố cục PC và di động | Giao diện ưu tiên màn hình PC theo bố cục đa khung, còn PhoneApp và device.ts tự chuyển sang âm thanh Opus nén nhẹ, thanh trượt chạm và xử lý bàn phím ảo riêng cho trình duyệt di động. |

## Hệ quả

Phát và tua phim giữ tốc độ khung hình ổn định ngay cả khi mở nhiều bảng công cụ. Mọi thay đổi âm lượng, EQ hay cắt rãnh âm thanh đều nghe thấy ngay lập tức sát với bản xuất cuối.
