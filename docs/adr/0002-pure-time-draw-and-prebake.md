# ADR 0002: Hàm thuần theo thời gian t và bake trước trạng thái

## Bối cảnh

Studio cho phép tua nhảy tới bất kỳ khung hình nào và bộ render có thể dựng lại từng khung không theo thứ tự. Mọi logic giữ trạng thái tích lũy trong draw sẽ cho ra kết quả khác nhau giữa tua thẳng và tua ngược.

## Quyết định

| Thành phần | Cách làm |
| --- | --- |
| Nguồn ngẫu nhiên | Dùng hàm băm cố định theo chỉ số trong packages/film-kit/src/hash.ts thay vì Math.random để mỗi khung luôn cho cùng giá trị. |
| Lò xo và quán tính | Tính nghiệm đóng hoặc bake trước một lần rồi đọc mẫu theo t trong spring.ts, overlap.ts và idle.ts. |
| Mocap và khóa chân | Retarget và giải bám sàn theo thứ tự phát đúng một lần khi nạp trong packages/mc-actor/src/clips.ts và feet.ts rồi đọc lại bằng at(t). |
| Vật thể và ánh sáng | Tắt vòng lặp texture tự động mặc định trong packages/mc-assets/src/model.ts và đánh giá ánh sáng, nhấp nháy đèn hoàn toàn thuần theo t trong lights-meta.ts. |
| Chữ giải mã | Lượng tử hóa bước giải mã ký tự trong packages/film-stage/src/titles-text.ts để khử bóng ma khi render đa mẫu mờ chuyển động. |

## Hệ quả

Mọi khung hình chỉ phụ thuộc vào tham số thời gian t và dữ liệu đầu vào bất biến. Khi chỉnh key hoặc nguồn clip, bộ bake chỉ cần chạy lại một lần ngoài vòng vẽ chính.
