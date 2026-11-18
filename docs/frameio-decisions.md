# Quyết định từ Frame.io

## Đã xong

| Quyết định | Lý do và tiến độ |
| --- | --- |
| Tách báo note, nhảy khung và Review | Báo qua SSE giữ playhead. Nhảy và quay lại đã kiểm trên Chrome, kể cả clip lặp nguồn và đổi thứ tự. |
| Hiện trạng thái bản preview | Review báo khi bản mới chờ nạp. Note đã sửa và bản preview đã nạp là hai tín hiệu riêng. |
| Chia sẻ link nội bộ theo ID note | Mở đúng note qua bộ lọc, giữ khung khi note mất. Chrome đã kiểm cả link đến lúc đang phát. |
| Xuất Notes dạng JSON | Giữ bộ lọc, sắp xếp và giới hạn của CLI. 50 test phạm vi và hai reviewer mỗi nhóm đã pass tại 70e3e746. |
| Liệt kê và khôi phục note đã xoá từ CLI | Khôi phục theo ID sau khi Undo hết hạn, kể cả note thiếu mốc timeline, và giữ nguyên dữ liệu của các dòng kho khác. Đã qua 41 test liên quan và 3 review độc lập. |

## Để sau

| Quyết định | Lý do |
| --- | --- |
| Phát riêng đoạn của note | Note cũ lưu đầu cuối theo thời gian nghe. Cần mốc nguồn đáng tin sau retime để tránh phát sai. |
| Hiện dấu ghim của note đã duyệt trên preview | Chỉ đáng làm khi dấu ghim đặt đúng phiên bản và góc nhìn. Review đã có ảnh và đối chiếu Then/Now. |
| Xem thay đổi trước khi khôi phục phiên bản | Có thể đọc manifest lịch sử hiện tại. Chờ một lượt riêng vì thao tác khôi phục tác động nhiều file. |

## Bỏ qua

| Quyết định | Lý do |
| --- | --- |
| Chia sẻ cloud, phân quyền doanh nghiệp, Camera to Cloud | Studio phục vụ luồng creator–AI trên phim cục bộ. Các hướng này mở rộng vận hành và quyền truy cập. |
| Nhân đôi version stack và công cụ so sánh | Studio đã có lịch sử mã nguồn và Then/Now. So sánh pixel từ ảnh note nén, ghim hoặc nét vẽ dễ gây nhiễu. |

## Nguồn

https://help.frame.io/en/articles/9105251-commenting-on-your-media

https://help.frame.io/en/articles/9105278-comments-panel-overview

https://help.frame.io/en/articles/9105309-comment-printing-and-comment-exporting

https://help.frame.io/en/articles/10513996-recovering-recently-deleted-assets
