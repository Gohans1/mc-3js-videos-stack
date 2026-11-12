# Dùng Studio

| Việc                | Lệnh                                                                                                                                                                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tạo phim            | bun run new-film ten-phim ở thư mục gốc.                                                                                                                                                                                                        |
| Mở Studio           | bun run studio.                                                                                                                                                                                                                                 |
| Ảnh nháp            | AT=1,4 bun run render stills.                                                                                                                                                                                                                   |
| Video               | bun run render clip.                                                                                                                                                                                                                            |
| Kiểm video          | bun run framecheck.                                                                                                                                                                                                                             |
| Ghi chú             | bun run notes; trả lời bằng bun run note done, ask hoặc learned (máy trạng thái ở src/note-state.mjs). Done chỉ đưa note sang chờ duyệt, người duyệt mới xong.                                                                                  |
| Lời dẫn             | Sinh take vào voice/takes và voice/try bằng bun run voice:gen (chạy trần chỉ xem trước, --yes mới gửi và tốn credit), ghép bằng bun run voice:assemble, lấy mốc từ bằng bun run voice:cues.                                                     |
| Kho tiếng và mẫu UI | Studio tự quét vault/sound/bgm, vault/sound/sfx và sound/sfx kèm SOURCES.json, còn ảnh mẫu CapCut nằm tại vault/references/capcut/manifest.json.                                                                                                |
| Kho tiếng Minecraft | vault/mc-sound/mc/<mục> chứa .ogg kèm SOURCES.json, take cùng tiếng chung family và đánh variant. Trong audio.json chỉ ghi tên tiếng, bài có contentId sẽ bị YouTube claim.                                                                     |
| EQ và track         | filters của clip trong audio.json là chuỗi ffmpeg highpass, lowpass, lowshelf, highshelf, equalizer, extrastereo do Inspector ghi, còn tracks[].gain là volume cả track. Studio nghe trước khớp bản render, xem app/sound/eq.ts.                |
| Tìm tài nguyên      | bun run find từ khóa ở thư mục gốc hoặc trong phim tìm tiếng, nhạc, chuyển cảnh, anim, chữ, font, adjust, mỗi kết quả kèm nguồn và chỗ ghi trong src/timeline. Đọc bun run find --help để lọc, tìm theo nghĩa bằng Jev và biết hướng đi khi bí. |

## Phim phải có

| Thành phần             | Quy ước                                                                                                                                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| src/scene.ts           | Xuất SHOTS, danh sách cảnh đầu ra, DURATION, applyEdit và buildScene(canvas, W, H, draft) trả về hàm draw(t). Hàm draw(t) phải vẽ đúng tại mọi mốc thời gian độc lập, không phụ thuộc khung trước.                               |
| src/edit.ts và dữ liệu | Gộp bằng setEdit, src/edit.json giữ voice và beats, còn các tệp json trong src/timeline giữ cam, shots, key, text, adjust, audio. Tệp package.json khai live-studio.sound cùng ratio, và sound.py tạo bản mix.                   |
| Schema mở cho AI       | Mọi schema dùng z.looseObject nên trường riêng của phim luôn được giữ nguyên. Chuyển cảnh, giọng chữ, hình chú thích, đường cong và hiệu ứng nhịp vận tốc đều mở định danh chuỗi để AI tự định nghĩa thêm mà không bị khóa cứng. |

## Mốc thời gian và Hook tùy chọn

| Nhóm                | Quy ước                                                                                                                                                                                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Giờ gốc và giờ phim | Mục shots và beats dùng giờ lời dẫn gốc, còn cam, key, audio, text, adjust dùng giờ phim trước Speed hoặc Freeze và hàm fromSource áp voice.warp. Sửa Speed hoặc Freeze qua timing.json thay vì dịch hàng loạt key.                                                                                              |
| Hook gắn thêm       | Hỗ trợ camTimeline, shotsTimeline, textTimeline kèm tools.titles, adjustmentTimeline kèm adjustments.prepare, transitions, anims kèm eases và keyEases. Ngoài ra có tools.placed kèm keyFiles, tools.targets kèm target.transform và tools.renderer, draw.velocity bằng true kèm velocityEffects, cùng variants. |

## Luật và Tài liệu liên quan

| Mục                  | Nội dung                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Ghi chú và âm thanh  | Không sửa tay tệp notes.jsonl. Không vẽ sóng âm giả khi thiếu tệp WAV hoặc gặp khoảng im lặng.                                                               |
| Giới hạn và phim mẫu | Thao tác kéo hoặc chép nguyên shot và keyframe màu chưa hoàn thiện. Thư mục sealed-room chỉ là phim thử nên không chép scene hoặc timing.json sang phim mới. |
| Đọc thêm             | Xem README.md ở thư mục gốc để nắm tổng quan, packages/live-studio/render.mjs cho tham số xuất hình, và INSTALL.md cho cài đặt.                              |
