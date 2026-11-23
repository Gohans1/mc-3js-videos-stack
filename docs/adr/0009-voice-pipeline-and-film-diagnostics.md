# ADR 0009: Quy trình lồng tiếng tuần tự và chẩn đoán nhịp phim

## Bối cảnh

Sinh giọng nói tự động tốn chi phí tín dụng và cần ngữ điệu liền mạch giữa các câu thoại kế nhau, trong khi kiểm tra khung hình, nhịp cắt và bài đo hiệu năng cần đọc đúng đồng hồ nghe mà không chạy mã dựng cảnh.

## Quyết định

| Hạng mục | Quy tắc |
| --- | --- |
| Cổng chi phí và ngữ điệu | scripts/voice/gen.ts và genvoice.ts sinh từng câu theo thứ tự kể chuyện để truyền ngữ cảnh câu trước sau, chỉ cho phép tiêu tín dụng khi có cờ --yes và tự bỏ trường mở rộng nếu proxy GenVoice từ chối. |
| Ghép thoại và khẩu hình | scripts/voice/assemble.ts ghép full_voice.wav, chia Phrase Bricks kéo thả được và đồng bộ khẩu hình Rhubarb, còn cues.ts tính mốc từ và khoảng lặng theo đồng hồ của timing.json. |
| Thanh tra theo giây nghe | scripts/at.ts tổng hợp toàn bộ sự kiện âm thanh, máy quay, chuyển cảnh và ghi chú tại một giây nghe qua đồng hồ chuẩn của studio mà không thực thi mã cảnh của phim. |
| Đo nhịp và đối chiếu mẫu | scripts/review/pace.ts đo thời lượng giữ khung theo điểm cắt và ngưỡng biến thiên hình ảnh; scripts/review/reference.mjs quy đổi chuyển động quay từ video mẫu qua đồng hồ dựng vào camTimeline. |
| Đánh giá độc lập | Các bộ eval trong scripts/evals/find và scripts/evals/load chạy trên ngữ cảnh trình duyệt hoặc CLI tách biệt để đo độ chính xác tìm kiếm và thời gian tải lạnh ấm. |

## Hệ quả

Việc chạy thử hoặc xem trước không làm mất tín dụng ngoài ý muốn và giữ ngữ điệu nhân vật ổn định. Các công cụ thanh tra và đánh giá phản ánh đúng thứ tự thời gian người xem thực sự nghe và thấy.
