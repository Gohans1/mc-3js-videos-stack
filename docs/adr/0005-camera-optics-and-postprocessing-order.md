# ADR 0005: Quang học ống kính và thứ tự hậu kỳ hình ảnh

## Bối cảnh

Các phim cần tiêu cự khớp cảm biến điện ảnh, giữ màu trung thực khi bám khung tham chiếu và tránh các lỗi pha màu của EffectComposer trên Three.js r187. MSAA 4x trên texture da nhân vật cũng dễ kéo lem texel lân cận dọc mép khối.

## Quyết định

| Hạng mục | Quy tắc |
| --- | --- |
| Ống kính và sắc thái | Quy đổi tiêu cự theo chiều ngang cảm biến full-frame 36 mm trong packages/film-kit/src/lens.ts; mặc định dùng AgX để giữ màu phim cũ và chuyển Khronos PBR Neutral khi cần khớp màu tham chiếu. |
| Thứ tự hậu kỳ | Hiệu ứng velocity và lớp chỉnh màu dùng chung đặt trên cả chuyển cảnh và chữ, đọc ảnh màn hình qua FramebufferTexture thay vì qua EffectComposer trung gian hoặc đọc ngược về CPU. |
| Thứ tự ống kính và nhịp | Trong velocity.ts, hiệu ứng quang học chạy trước lớp nhấn nhịp để chớp sáng hoặc tách màu không bị làm mờ nuốt mất. |
| Chuyển cảnh WebGL | packages/film-stage/src/transitions.ts biên dịch shader lười trên ảnh đã tone-map để không làm khựng lúc khởi động, đồng thời để cảnh dừng ở tư thế shot hiện hành cho thao tác chọn trong studio. |
| Chống lem UV khi MSAA | Hàm centroidUv trong packages/mc-actor/src/player.ts vá từ khóa GLSL centroid cho UV bản đồ da để tránh ngoại suy tràn texel dưới MSAA 4x. |

## Hệ quả

Chuỗi hậu kỳ giữ nguyên độ chuẩn màu trên Three.js r187 mà không phát sinh thêm chi phí tải CPU. Thời gian khởi động studio nhanh hơn vì chỉ biên dịch những shader chuyển cảnh thực sự được dùng.
