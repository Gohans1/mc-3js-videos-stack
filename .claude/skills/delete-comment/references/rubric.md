# Bảng tiêu chí phân loại comment

Mỗi khối comment văn xuôi xuất ra từ bun run comments list phải được đọc cùng đoạn mã xung quanh rồi gán đúng một trong năm nhãn dưới đây.

## Năm nhãn phân loại

| Nhãn | Định nghĩa | Hành động |
| --- | --- | --- |
| tautology | Lặp lại điều tên hàm, kiểu dữ liệu, cấu trúc mã, tiêu đề phân khu hoặc bài test đã tự nói rõ. | Xoá bằng strip. |
| stale | Sai lệch với mã hiện tại, nhắc đường dẫn hoặc tệp đã xoá, chú thích lịch sử vòng làm việc, ngữ cảnh một phim cũ trong gói dùng chung, hoặc mã bị comment bỏ. | Xoá bằng strip. |
| excuse | Hợp thức hóa cách làm chắp vá, nuốt lỗi âm thầm hoặc đánh đổi gây sai kết quả trong trường hợp thực tế mà chưa có cơ chế xử lý đúng. | Xoá bằng strip và ghi vào docs/comment-excuses.md sau khi kiểm chứng điều kiện kích hoạt trong mã thật. |
| decision | Giải thích một quyết định thiết kế hoặc kiến trúc khó đoán, xuyên nhiều tệp hoặc định hình hợp đồng hệ thống. | Chuyển nội dung vào docs/adr và xoá khỏi mã nguồn bằng strip. |
| constraint | Một bất biến kỹ thuật ngắn gọn, chính xác về lỗi thư viện ngoài, hệ trục tọa độ, định dạng nhị phân, chuẩn đồ họa hoặc thông báo bản quyền mà người sửa dòng mã ngay dưới sẽ phá hỏng nếu không thấy. | Giữ lại dưới trần ratchet. |

## Ngưỡng kiểm định

| Loại kiểm định | Yêu cầu |
| --- | --- |
| Để nhận nhãn decision | Phải trả lời được lựa chọn nào đã bị loại bỏ, đánh đổi nào tồn tại, và quyết định đó còn ảnh hưởng tới người đọc sau một năm; nếu không đạt thì xếp vào tautology hoặc constraint. |
| Để nhận nhãn excuse | Phải chỉ rõ dòng mã, đầu vào kích hoạt, kết quả sai quan sát được và hướng sửa cụ thể; lỗi thuộc thư viện bên thứ ba đã ghim phiên bản là constraint chứ không phải excuse. |
| Để nhận nhãn constraint | Chỉ giữ khối ngắn khoảng 1 đến 4 dòng gắn sát dòng mã chịu ràng buộc và không chứa tham chiếu lỗi thời; không giữ bài luận đầu tệp hoặc chú thích trong tệp test. |

## Định dạng tệp JSONL đầu vào cho strip

| Trường | Bắt buộc | Ý nghĩa |
| --- | --- | --- |
| file | Có | Đường dẫn tương đối dùng dấu gạch chéo xuôi tính từ root repo. |
| line | Có | Dòng bắt đầu của khối comment đúng như đầu ra của bun run comments list. |
| text | Khuyến nghị | Nguyên văn khối comment dùng để chọn đúng khối khi một dòng có nhiều khối comment. |
| cat | Tùy chọn | Nhãn phân loại để lưu vết kiểm toán trước khi lọc ra tệp doomed.jsonl. |
| why | Tùy chọn | Lý do ngắn một câu giải thích vì sao gán nhãn đó. |
| ref | Tùy chọn | Đường dẫn tới tệp ADR hoặc docs/comment-excuses.md khi áp dụng. |
