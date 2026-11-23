# ADR 0007: Diễn hoạt cử chỉ sinh học trong film-kit và xếp hạng clip

## Bối cảnh

Nội suy smoothstep đồng đều làm nhân vật trông cứng như máy, trong khi tìm kiếm clip bằng một danh sách quá dài khiến mô hình chọn sai hoặc bỏ qua khi không có mục phù hợp.

## Quyết định

| Hạng mục | Quy tắc |
| --- | --- |
| Cơ sở hành vi và sinh học | packages/film-kit lấy nhịp thời gian và cấu trúc cử động từ nghiên cứu thực nghiệm như Hoffmann 2010, Pollick 2003, Caffier 2003, Evinger 1994, Kwok 2015, Provine 1986, Winter 2009 và Laban Effort. |
| Đường cong và chuyển pha | Dùng spline đơn điệu PCHIP trong curve.ts để giữ tốc độ không vọt lố, inertialization của Bollo trong transition.ts để nối pha không giật, và vật lý 20 tick gốc trong mcmotion.ts. |
| Rung máy và vùng an toàn | Dùng dữ liệu rung tay CC0 Camera Shakify đã khử trôi trung bình trong handheld.ts, chấn động theo trauma bình phương kiểu Eiserloh trong shake.ts và khung an toàn EBU R 95 trong safe.ts. |
| Xếp hạng clip bằng Jev | packages/clip-catalog/jev.ts trộn vòng loại bằng bộ sinh Park-Miller cố định hạt giống rồi tách bước kiểm tra khớp nhị phân độc lập thay vì thêm phương án không chọn vào vòng bỏ phiếu. |

## Hệ quả

Nhân vật có phản xạ mắt, tay, thở, tư thế và nhịp chuyển tự nhiên mà vẫn tái lập chính xác theo thời gian. Kết quả xếp hạng clip ổn định giữa các lần truy vấn và hạn chế chọn bừa khi kho không có clip khớp.
