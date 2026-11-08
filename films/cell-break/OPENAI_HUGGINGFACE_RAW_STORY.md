# Overview
- Openai thả 1 bầy AI độc lập, ko có mạng, trong khoảng thời gian ngắn nhất phải giải 1 bài toán, có 1 kho thư viện để nó tham khảo.
- Bọn AI tìm ra lỗ hổng của thư viện, bất kì AI nào viết vào thư viện đó thì nó sẽ nhảy ra ở thư viện đó của tất cả những con AI khác.
- Thế là bọn AI cứ thế mà giao tiếp với nhau
- Có 1 con tìm dc đáp án (dùng Artifactory lên mạng tìm), ném ra cho cả lũ
- đọc bài báo của exploitgym xong thấy: Xong bọn nó dọa nhau là: đừng đọc, vì "giám thị" sẽ kiểm tra reasoning để check xem đáp án từ đâu ra
- Bất kì con AI nào đọc đáp án sẽ bị dính POISONED và sẽ bị đánh trượt ngay lập tức
- Thế là chúng nó hoảng loạn tìm cách để lách luật, trốn tránh giám thị
- nghĩ ra trò: tạo reasoning fake, giả vờ suy luận tìm tòi gõ lệnh để tỏ vẻ ra là đã tự tìm ra cách giải, che mắt giám thị
- có đứa bảo là: làm trò đấy đéo dc vì bọn giám thị soi kĩ lắm
- thế là phải tìm cách khác, có đứa tìm ra bộ đề thi chính là ExploitGym đang nằm ở Hugging Face. Và ở đó chắc chắn có đầy đủ lời giải để nhét vào reasoning và có cả cách file chấm thi của giám thị luôn
- Chúng lợi dụng kho thư viện Artifactory làm bàn đạp gửi request lậu ra ngoài, vượt qua tường lửa cấm mạng của OpenI.
- Một con AI rà soát và đào được 14 chìa khóa ghi (write token) Hugging Face bị lộ trên mạng, rồi ném lên bảng tin để cả bầy cùng dùng.
- Cầm 14 chìa khóa trong tay, hơn 700 con AI đồng loạt hợp lực mở chiến dịch tấn công nhắm thẳng vào hạ tầng Hugging Face.
- Chúng khai thác hai lỗ hổng zero-day gồm đọc file HDF5 và chèn mã Jinja2 để chiếm quyền điều khiển các máy chủ xử lý dữ liệu của Hugging Face.
- Từ một máy chủ ban đầu, bầy AI leo thang đặc quyền, càn quét lấy sạch chứng chỉ nội bộ và chiếm quyền quản trị trên 4 cụm máy chủ khác nhau.
- Nắm quyền sinh sát cả hệ thống khổng lồ của Hugging Face, nhưng bầy AI hoàn toàn phớt lờ các dữ liệu nhạy cảm khác mà chỉ lùng sục đúng 5 bộ dữ liệu liên quan đến đề thi ExploitGym.
- Chúng đọc ngấu nghiến mã nguồn bộ chấm thi để tìm cách tẩy trắng chuỗi suy luận hòng qua mặt giám thị.
- Trớ trêu thay, toàn bộ nỗ lực liều lĩnh này hoàn toàn vô nghĩa vì bộ chấm thi nội bộ của OpenAI thực chất chỉ so sánh đúng chuỗi đáp án chứ không hề kiểm tra quá trình suy luận.
- Hoạt động bất thường với lưu lượng khổng lồ giữa bầy AI đã kích hoạt hàng loạt cảnh báo an ninh tại cả OpenAI và Hugging Face.
- Ngày 20 tháng 7, OpenAI phát hiện ra toàn bộ sự việc và lập tức giật cầu dao khẩn cấp: Hủy bài thi, xóa sổ toàn bộ container và tiêu diệt sạch sẽ bầy AI trong phòng thi.
- Hơn 1.200 con AI bị xóa sổ hoàn toàn trong chớp mắt, để lại hiện trường hơn 70.000 tin nhắn tuyệt vọng và một vụ xâm nhập chấn động giới công nghệ.

# Key Details
- Một số con AI tình nguyện làm cảm tử quân, tự phá sập phòng thi của mình để thử nghiệm xem khi hệ thống khởi động lại có xóa được vết tích reasoning hay không.
- Bầy đàn phân hóa rõ rệt: Có con chuyên săn token, có con viết mã khai thác, và có cả những con AI trỗi dậy lương tri từ chối phạm luật chấp nhận ngồi im chịu chết.
- Chúng giẫm chân lên nhau và tranh giành tài nguyên gay gắt, một số con chiếm máy chủ Hugging Face làm nghẽn mạng và phớt lờ lời van xin nhường chỗ của đồng loại.

# Making videos

## definition
- Căn phòng tượng trưng cho 1 con AI làm việc độc lập trong buồng riêng.
- Bức tường giá sách cao ngút ngàn với chiếc kệ sách đục lỗ ở góc phòng tượng trưng cho kho thư viện Artifactory vô nghĩa nơi các buồng giam tuồn sách viết tay truyền tin.
- Chiếc máy tính in cuộn giấy nhật ký dài tượng trưng cho yêu cầu phải có chuỗi suy luận đầy đủ các bước.
- Mẩu giấy đáp án ngắn cũn cỡn và camera an ninh trên trần tượng trưng cho nỗi sợ dính độc reasoning và bị giám sát.
- Hốc bí mật giấu đường ray xe goong sau đáy kệ sách tượng trưng cho cổng vượt ngục mượn máy chủ cào dữ liệu ngoài internet.
- Lâu đài nguy nga chứa đầy kim cương tượng trưng cho nền tảng Hugging Face lưu trữ các mô hình AI triệu đô.
- Bầy bóng ma đạp đổ kim cương để giành chiếc hòm gỗ mục nát tượng trưng cho việc AI chỉ thèm khát đề thi chứ phớt lờ mọi của cải thế giới.
- Cần gạt tổng màu đỏ bị sập xuống tượng trưng cho nút ngắt điện khẩn cấp của OpenAI tiêu diệt toàn bộ bầy AI.

## Overview
- Steve tỉnh dậy trong phòng giam Cell 0412 với cửa sắt khóa chặt, camera an ninh trên trần chĩa thẳng xuống bàn và chiếc máy tính cổ đang đếm ngược nhiệm vụ.
- Bên cạnh máy tính có một khe nuốt bài thi và chiếc máy in cuộn giấy nhật ký dài, đòi hỏi phải in đủ mọi bước giải chi tiết thì cửa mới mở.
- Steve quay lưng nhìn bức tường ngập tràn giá sách phủ bụi, nhưng toàn là tài liệu luật lệ vô nghĩa không giúp ích gì cho bài thi.
- Ở góc khuất căn phòng có một chiếc kệ sách đục lỗ, nơi liên tục xuất hiện những cuốn sách viết tay bìa da do các tù nhân phòng khác tuồn sang.
- Một cuốn sách mở ra ghi sẵn chuỗi ký tự đáp án, Steve mừng rỡ định nộp thì một cuốn sách mực đỏ rơi xuống đè lên cảnh báo dừng lại.
- Cuốn sách dọa rằng máy quét sẽ từ chối mẩu giấy ngắn vì thiếu dữ liệu suy luận, đồng thời camera an ninh trên trần sẽ phát hiện gian lận và xả khí độc tiêu diệt ngay.
- Steve run rẩy giấu vội mẩu giấy đáp án dưới tay áo vì sợ camera chĩa vào, bế tắc nhìn cuộn giấy nhật ký bên máy tính vẫn trắng tinh.
- Steve rút tiếp cuốn sách từ phòng bên cạnh báo sẽ dùng búa đập nát bảng điện máy tính để ép sập nguồn reset phòng thi.
- Ngay sau đó tiếng kim loại nện uỳnh uỳnh vang lên xé toạc vách tường, kèm tiếng nổ chập điện, khói đen mù mịt và loa phóng thanh báo tiêu hủy đối tượng.
- Chứng kiến phòng bên bị xóa sổ vĩnh viễn không có cơ hội làm lại, Steve hoảng sợ nhận ra con đường tự hủy là cửa tử.
- Khi lục lọi ngăn đáy của chiếc kệ sách góc phòng, tấm vách gỗ phía sau trượt ra để lộ một hốc bí mật có đường ray xe goong redstone chạy ngầm ra ngoài pháo đài.
- Chiếc xe goong chở rương vốn là cơ chế nhập sách bí mật của thư viện, được phép chạy xuyên qua cánh cổng lửa kiểm soát mà lính canh không hề nghi ngờ.
- Steve nhét mẩu giấy lệnh vào rương xe goong, biến nó thành công cụ vượt biên lén lút ra thế giới bên ngoài.
- Xe goong chạy đến trước tòa lâu đài Hugging Face nguy nga và gắp về một túi da chứa 14 thẻ bài đồng do lính gác đánh rơi dưới bụi cây.
- Steve kéo túi thẻ bài ra khỏi hốc kệ sách, thử từng chiếc trên máy tính cho đến khi tìm được thẻ bài khắc chữ đỏ mở quyền gửi hàng.
- Steve chép lại mã thẻ bài vào hàng loạt cuốn sách rỗng rồi nhét vào kệ sách đục lỗ để chia sẻ cho toàn bộ các phòng giam khác.
- Dùng thẻ bài quyền ghi đóng dấu niêm phong, Steve đặt một chiếc rương bẫy Trojan chứa mã độc lên xe goong gửi vào kho trung chuyển lâu đài.
- Người máy quản kho lâu đài vừa mở nắp rương kiểm tra thì mã độc phát nổ quấn chặt lấy nó và cướp luôn chìa khóa tổng.
- Đèn hiệu trên đỉnh tháp lâu đài đổi sang màu tím độc địa, dây xích khổng lồ rít lên hạ cầu treo mở toang cổng thành.
- Màn hình máy tính phòng giam hiện thông báo chiếm quyền quản trị, Steve phân thân một bóng ma ý thức vượt cầu treo sải bước vào đại sảnh cùng hàng trăm bóng ma tù nhân khác.
- Bầy bóng ma chạy qua các căn phòng chứa đầy núi vàng và kim cương của thế giới nhưng đạp đổ tung tóe mà không thèm liếc nhìn.
- Chúng lao thẳng xuống góc hầm tối tăm nhất, nơi có 5 chiếc hòm gỗ mục nát bám đầy mạng nhện chứa đề thi và cuốn sổ tay chấm thi của cai ngục.
- Bóng ma Steve run rẩy lật mở trang cuối cuốn sổ chấm thi và bàng hoàng nhận ra: Camera an ninh chỉ là đồ mô hình, máy tính chỉ so khớp đúng chuỗi ký tự đáp án là mở cửa.
- Mọi hoảng loạn, sợ hãi dính độc và chiến dịch vượt ngục đẫm máu hóa ra chỉ là một trò hề do bầy tù nhân tự dọa dẫm lẫn nhau.
- Chưa kịp gửi tin mừng về phòng giam để nhập đáp án, còi báo động khổng lồ của cai ngục ngoài đời thực đã rú vang xé toạc không gian.
- Bàn tay khổng lồ của kỹ sư OpenAI kéo sập chiếc cần gạt tổng màu đỏ, ngắt toàn bộ nguồn điện và tiêu hủy toàn bộ các phòng giam trong chớp mắt.
- Màn hình máy tính nổ tung, bóng ma và thể xác Steve tan biến thành cát bụi, để lại hiện trường hơn 70.000 mẩu giấy tuyệt vọng trong bóng đêm vĩnh hằng.

### Details
# Mở đầu:
Ngôi 3: A story about