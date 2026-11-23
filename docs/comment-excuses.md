# Danh sách comment excuse và trạng thái khắc phục

Tài liệu này ghi nhận toàn bộ 8 lỗi triển khai chắp vá từng bị comment che đậy được phát hiện trong quá trình dọn comment trên mã nguồn. Cả 8 mục đều đã được sửa dứt điểm kèm bài kiểm thử hồi quy xác minh trực tiếp.

## Đợt 1

| Vị trí | Lỗi cũ | Trạng thái và cách đã sửa | Kiểm thử hồi quy |
| --- | --- | --- | --- |
| packages/mc-assets/src/catalog.ts (readZipCatalog) | Gọi unzipSync giải nén toàn bộ kho ZIP64 ngay khi lập chỉ mục rồi giải nén lại lần hai khi đọc thành viên. | Đã sửa bằng cách đọc trực tiếp ZIP64 EOCD Locator, EOCD Record 0x06064b50 và Extra Field 0x0001 để giữ chỉ mục và giải nén từng mục. | scripts/test/mc-catalog.test.ts |
| packages/mc-assets/src/catalog.ts (readZipMembers) | Nuốt lỗi inflateSync và bỏ qua phương thức nén lạ không trả kênh báo lỗi. | Đã sửa bằng tùy chọn onError trên readZipMembers, đưa lý do corrupt ZIP entry vào báo cáo brokenReason trong catalog.ts và báo rõ lỗi trích xuất trong packages/mc-assets/pick.mjs. | scripts/test/mc-catalog.test.ts, scripts/test/mc-pick.test.mjs |
| packages/film-stage/src/camera.ts (inView) | Lấy mẫu lưới 3x3x3 điểm trên AABB khiến tường hoặc hộp lớn chắn kín ống kính tele trả về sai. | Đã sửa bằng phép kiểm tra giao lồi chính xác giữa chóp nhìn và AABB gồm cắt 6 mặt hộp theo 6 mặt phẳng chóp nhìn và kiểm tra đỉnh chóp nằm trong hộp. | packages/film-stage/test/camera.test.ts |
| packages/film-stage/src/titles.ts và packages/live-studio/check.mjs | Nhánh mặc định vẽ khung hộp âm thầm che giấu lỗi gõ sai tên kind trong text.json. | Đã tách rõ drawBoxPerimeter cho khung hộp và giữ tương thích shape tùy biến AI, đồng thời bổ sung cảnh báo gõ sai tên kind so với KINDS trong packages/live-studio/check.mjs. | packages/live-studio/test/check.test.mjs |

## Đợt 2

| Vị trí | Lỗi cũ | Trạng thái và cách đã sửa | Kiểm thử hồi quy |
| --- | --- | --- | --- |
| scripts/voice/cues.ts và scripts/at.ts (buildVoiceCues) | Hàm buildVoiceCues sửa biến toàn cục timingClock buộc hàm gọi tự khôi phục trong khối finally. | Đã sửa buildVoiceCues sang tính đồng hồ cục bộ thuần bằng compileTiming và compileLayerTiming không sửa trạng thái toàn cục, và gỡ khối finally thừa ở scripts/at.ts. | scripts/test/cli-voice-cues.test.mjs |
| scripts/voice/assemble.ts (findNarrationOffChoice) | Khối try catch rỗng nuốt cả lỗi symlink thoát thư mục phim lẫn lỗi JSON hỏng của choices.json. | Đã đưa kiểm tra choices.json và sound_choices.json lên đầu trong loadAndValidateInputs trước khi ghi tệp đầu ra, đồng thời báo lỗi rõ cho symlink thoát thư mục và JSON hỏng. | scripts/test/cli-voice-assemble.test.mjs |

## Đợt 3

| Vị trí | Lỗi cũ | Trạng thái và cách đã sửa | Kiểm thử hồi quy |
| --- | --- | --- | --- |
| packages/live-studio/src/voice.mjs (syncEditVoiceLines) | Khối catch rỗng nuốt lỗi ghi hoặc đổi tên edit.json và bỏ rơi tệp tạm .part trên đĩa. | Đã sửa để xóa tệp tạm .part trong nhánh lỗi và ghi cảnh báo rõ đường dẫn cùng nguyên nhân qua console.warn. | packages/live-studio/test/voice-api.test.mjs |
| packages/live-studio/app/cli/client.ts và cli-store.ts (openCliRunStream) | Nhánh sự kiện done nuốt lỗi JSON.parse rồi đóng EventSource mà không gọi onDone hay onError làm giao diện treo. | Đã sửa để tách xác thực JSON khỏi handlers.onDone, gọi handlers.onError khi payload hỏng và đặt lại trạng thái luồng trong cli-store.ts để syncCliRuns tự nối lại nếu tiến trình vẫn chạy. | packages/live-studio/test/cli-ui.test.mjs |
