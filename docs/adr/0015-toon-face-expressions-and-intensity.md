# ADR 0015: Mặt toon vector, thư viện biểu cảm và thang cường độ

## Bối cảnh

Mặt hoạt hình vẽ bằng Canvas2D lên đầu khối của mc-actor phải giống kênh mẫu và giữ vibe dễ thương ở mọi cảm xúc. AI làm phim cần chọn, chỉnh và trộn biểu cảm tự do mà không vẽ lại từ đầu.

## Quyết định

| Hạng mục | Quy tắc |
| --- | --- |
| Biểu cảm là dữ liệu | Mỗi biểu cảm là một FaceSpec chỉ ghi phần khác mặt nghỉ, theo mô hình preset cộng custom của VRM 1.0. Thư viện nằm ở packages/mc-actor/src/toon-expressions.ts, chia nhóm trong EXPRESSION_GROUPS. |
| Thang cường độ | FEELINGS là thang ba bậc nhẹ, vừa, mạnh của Plutchik cho mỗi họ cảm xúc. Hàm feel nội suy từ neutral qua ba bậc như in-between target của blendShape Maya, nên 1/3 và 2/3 ra đúng mặt đã vẽ tay. |
| Thang đi một chiều | Mắt đã nhắm ở một bậc thì bậc sau không được mở lại, nếu không lúc kéo cường độ lên mặt sẽ chớp mắt giữa chừng. Có test chặn điều này cho mọi họ cảm xúc. |
| Trọng số và trộn lớp | Cường độ là trọng số 0 đến 1 bị kẹp như VRM. Hàm mix cộng phần chênh so với mặt nghỉ của từng lớp như morph target, để ghép cảm xúc kép kiểu Plutchik. |
| Giữ vibe dễ thương | CuteRange kẹp mọi mặt lúc vẽ. Mọi biểu cảm trong thư viện phải nằm sẵn trong vùng này và có test chặn, nên nội suy giữa hai mặt cute vẫn cute. |
| Ký hiệu manga | Ký hiệu là registry mở trong toon-shapes.ts, chia ba lớp dưới mặt, trên mặt và quanh đầu theo bảng manpu. Lớp quanh đầu vẽ lên một sprite luôn quay về camera đặt ở mặt phẳng mặt trước, để đầu xoay không che ký hiệu. |
| Miệng và mắt dạng hình | Miệng 3, mèo, gợn sóng, nghiến răng, lè lưỡi và mắt tim, sao, kim cương, xoáy, X, nhắm chặt, chấm là registry mở. Nói chuyện tự chuyển về miệng thường, giống overrideMouth của VRM. |
| Chuyển mặt theo key | Key không ghi blend chuyển mềm theo smoothstep trong FACE_BLEND 0,2 giây, vì lông mày và miệng cần 3 đến 10 khung hình để đổi (AnimSchool). Blend 0 chỉ dành cho key nằm đúng điểm cắt cảnh. |
| Mốc mặt cho máy bắt giật | toonLandmarks trả điểm lông mày, mí, đồng tử và khóe miệng theo face px ở tư thế mắt mở, nhìn thẳng, ngậm miệng, nên chớp mắt, khẩu hình và liếc mắt không làm mốc nào nhúc nhích. Máy pops đọc chúng qua userData.landmarks của mesh mặt, nên render final chặn mặt đổi biểu cảm trong 1 đến 2 khung hình giữa một cảnh. |
| Hòa trộn màu | Canvas được tải lên dạng premultiplied và trộn One, OneMinusSrcAlpha. Bật premultipliedAlpha của material sẽ nhân hai lần và làm bẩn má hồng. |

## Hệ quả

AI chọn mặt bằng tên, chỉnh độ mạnh bằng một số, trộn lớp hoặc thêm ký hiệu, miệng, mắt mới qua toonStyle mà không sửa lõi. Trang packages/film-kit-demo/faces.html là nơi duyệt toàn bộ thư viện bằng mắt.
