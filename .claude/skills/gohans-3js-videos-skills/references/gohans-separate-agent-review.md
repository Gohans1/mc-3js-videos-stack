# Separate Fresh Agent Review video
- Vì bạn (claude) không có native multimodal sẽ có những chi tiết (ví dụ: âm thanh/video/lệch/lộn-xộn/hình-ảnh/lỗi/etc...) mà bạn không thể kiểm chứng được khi "xem" video bằng các phương pháp "thủ công" "thô sơ" (ví dụ: cắt frame, nghe bằng sóng âm,etc...), và bạn nên tìm hiểu và biết sự khác-biệt/khoảng-cách/giới-hạn giữa cách "xem" video kiểu "thô sơ" so với cách xịn của AI native multimodal để biết gọi review đúng chỗ "hiểm"/quan-trọng/đặc-biệt mà chỉ có cách xịn mới có thể thấy
- Nhớ check lại mốc giờ xem có đúng không.
- Không tự ý gọi review trừ khi được cho phép
- Dùng `agy` CLI, model `gemini-4-argon-high`: AI native multimodal, xem được video và nghe được âm thanh thật sự. 
- Nếu có sửa đoạn nào, thì hãy chỉ review chỉ đúng đoạn đó
- Chỉ được phép XEM video được yêu cầu
- Chỉ kiểm duyệt bằng MẮT và TAI dưới góc nhìn của khán giả cực kì kĩ tính (review bằng "cảm nhận","cảm giác","cảm xúc",etc... mà một con người bình thường sẽ cảm nhận).
- Xem đến đâu note lại đến đó, xong khúc nào write_file nối tiếp (Append=true) ngay vào file .md tương ứng. 
- Hãy prompt cho `agy` đầy đủ dựa theo bộ luật/quy định được yêu cầu vì không nói thì nó sẽ không biết

## `agy` Review Guide
- Video được review luôn luôn phải 540p
- Chạy trong thư mục chứa video, nền (background) vì có thể mất hơn 10 phút: `agy --model gemini-4-argon-high --dangerously-skip-permissions --print-timeout 1200s -p "<prompt>"` (bắt buộc `--dangerously-skip-permissions` ) (có thể flexible time)
- Cắt sẵn thành từng (nhiều)đoạn video nhỏ(ffmpeg) 60-90 giây (ưu tiên cắt theo scene, tránh đứt câu thoại,etc...) trước khi gửi review, tổng dung lượng 1 lần review KHÔNG vượt quá 25–30 MB video/ảnh(nhớ kiểm tra dung lượng), nếu vượt -> chia làm tối đa 2 lệnh agy chạy song song ở background, xong mới được gọi tiếp. đặt tên file ghi rõ phiên bản + thời gian gốc (ví dụ `part1_00m00s_01m17s.mp4`).  (Video ~2.5 phút: Review mất 4.2 – 5.5 phút)
- Format Reviewer Response: Mốc mm:ss.sss trên dải đen dưới hình (bản nháp có sẵn) | Mức độ (Critical/Required/Optional/Nit/FYT) | lỗi gì | Đáng lẽ phải diễn ra thế nào

## CẤM
- Không chat qua lại, 1 phiên chat là 1 phiên review duy nhất độc lập
- Không chạy bất kì lệnh nào, không đọc bất kì file nào khác mà không được yêu cầu
- KHÔNG mất thời gian làm bất kì điều nào khác không liên quan (ví dụ kiểm tra bất kì lại file code/.md nào sau khi review xong.)
