# Viết hoặc sửa CLI

Lệnh giúp AI biết đang có gì, kết quả nằm đâu và kiểm chứng bằng cách nào. Dùng lại lệnh đang có khi hợp lý; không ép mọi ý tưởng thành một lệnh hay một tính năng studio.

## Hợp đồng

| Phần                 | Yêu cầu                                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Help trước công việc | Dùng cliArgs từ packages/live-studio/src/cli.mjs; -h, --help hoặc từ help đầu tiên in help rồi thoát 0                             |
| Đầu vào              | Kiểm tra đủ vị trí, flag, giá trị và tổ hợp trước khi ghi hoặc gọi dịch vụ; sai thì thoát 2 kèm cách sửa                           |
| Số và thời gian      | Dùng numberArg, secondArg; giây người xem nghe thấy phải đổi đúng đồng hồ trước khi chỉnh timeline                                 |
| JSON                 | Dùng jsonFile; lỗi phải chỉ file và cách kiểm tra                                                                                  |
| Kết quả              | Nêu phát hiện, thời điểm, file/dòng hoặc đường dẫn artifact; bước tiếp hữu ích thì thêm next:                                      |
| Thiếu dữ liệu        | Chỉ lệnh hoặc thao tác tạo dữ liệu đó                                                                                              |
| Chi phí              | Help nêu credits, tải dữ liệu và thời gian dài; lệnh tạo voice xem trước mặc định, chỉ gửi khi --yes, --dry-run luôn chỉ xem trước |
| Dịch vụ nhỏ          | find --jev là ngoại lệ có gọi ngoài/quota mà không cần --yes; không tự suy rộng ngoại lệ cho lệnh khác                             |
| Thời gian dài        | Có timeout và lưu từng kết quả khi có thể tiếp tục lần sau                                                                         |
| Mã thoát             | 0 thành công, 1 lỗi công việc/dữ liệu, 2 lỗi gọi lệnh/điều kiện; lỗi sau khi chạy phải nói phần đã hoàn tất                        |

Python giữ cùng hành vi bằng parser hiện có. Kiểm tra cả vị trí chạy root/phim; wrong-place.mjs giúp chỉ đúng thư mục.

## Nơi cập nhật

| Nơi                              | Nội dung                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------ |
| HELP của lệnh                    | Cú pháp đầy đủ, ví dụ, đầu ra, chi phí; nguồn chính của flag                                     |
| package.json                     | Script ở root hoặc template và phim liên quan; stub cho lệnh thuộc nơi khác                      |
| packages/live-studio/help.mjs    | Một dòng mô tả đúng việc, đúng nhóm                                                              |
| skill-data/core                  | Chỉ sửa quy trình/reference bị ảnh hưởng; thêm reference thì thêm dòng định tuyến trong SKILL.md |
| .claude/skills/mc-films/SKILL.md | Chỉ giữ vai trò dẫn tới skills get core; không nhét nội dung tính năng                           |

## Kiểm chứng

| Bước                    | Lệnh hoặc hành động                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| Sửa lỗi hành vi         | Viết test tái hiện, thấy fail, sửa tối thiểu rồi thấy pass; theo skill test-driven-development     |
| Kiểm tra trực tiếp      | Gọi lệnh với dữ liệu thật và dữ liệu sai trên phim thử riêng; không tiêu credits chỉ để thử parser |
| Format đúng phạm vi     | bun fmt --no-script <files>                                                                        |
| Kiểm tra repo           | bun run lint; bun run typecheck; bun run test                                                      |
| Review khi được yêu cầu | Reviewer độc lập kiểm chứng lại kết quả; giải quyết Critical và Required trước khi kết thúc        |

packages/live-studio/test/skills.test.mjs kiểm tra đường dẫn reference và tên lệnh được guide nhắc tới. Test này chưa chứng minh mọi ví dụ hoặc workflow đều đúng; vẫn phải đối chiếu code và chạy lệnh tương ứng.
