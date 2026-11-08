# Soi tính năng các phần mềm dựng phim, chọn cái cho live-studio

Mục tiêu: live-studio thành "CapCut cho 3js": dễ như CapCut, nhưng không bỏ tính năng khó mà quan trọng. AI dựng phim, dev xem và góp ý, dev được tự sửa mọi thứ.

## Cách đọc

- Nhãn: ĐÃ CÓ (studio có rồi), LÀM (làm trong đợt này), SAU (đáng làm, để đợt sau), BỎ (không cần cho phim 3js của mình).
- Độ khó dùng: dễ, vừa, khó (khó học nhưng đáng học).
- Mỗi dòng: tên tiếng Việt (tên tiếng Anh trong phần mềm) — nó làm gì — dễ hay khó — vì sao chọn hay bỏ.

## Nguồn đã soi

- OpenCut classic: trình dựng web giống CapCut nhất, TypeScript/React, giấy phép MIT. Mã ở `C:\Users\ADMIN\Desktop\editor-refs\opencut-classic`.
- FilmCraft: bản viết lại Adobe Premiere bằng Rust (ArtCraft), MIT/Apache, 279 lệnh. Mã ở `editor-refs\filmcraft`.
- EffectCraft: bản viết lại Adobe After Effects bằng Rust (ArtCraft), Apache-2.0, 670 lệnh. Mã ở `editor-refs\effectcraft`.
- Theatre.js: bộ keyframe chuyên cho three.js, Apache-2.0. Mã ở `editor-refs\theatre`.
- CapCut 8.5 cài trên máy, chụp bằng agent-desktop (Vercel). Xem mục CapCut.
- 6 video Atrium trong Downloads, đo nhịp cắt bằng ffmpeg. Xem mục Atrium.
- Tất cả đã đánh chỉ mục bằng codegraph (thư mục `.codegraph` trong từng repo) để tra nhanh.

## Studio đang có gì (để khỏi làm lại)

- Góp ý: ghim lên hình, vẽ tay (D), danh sách góp ý, đánh dấu Done, chip chọn phương án (phím 0-9).
- Dòng thời gian: hàng shot, hàng chữ thoại, hàng camera, hàng keyframe nhân vật/đạo cụ, các track âm thanh kiểu CapCut (tắt tiếng, khoá), chọn nhiều bằng kéo khung, hít (snap) vào playhead/từ/cắt, Shift để tắt hít.
- Âm thanh: kéo từ thư viện vào track, âm lượng dB, fade in/out từng clip, nghe trực tiếp trên trang không cần mix lại.
- Camera: camera bay tự do kiểu Minecraft (F; WASD đi ngang, Space lên, Shift xuống, bấm W 2 lần để chạy nhanh; tốc độ bay ở Settings > Camera), thêm keyframe từ góc nhìn (Shift+K), đường cong ease có sẵn (Easy Ease, Blender, Unreal...) và tự vẽ đường cong bezier, FOV/Roll/Sway, cắt shot (Ctrl+B), xoá cắt để gộp shot, kéo vạch cắt.
- Đạo cụ/mob: thả từ thư viện kiểu Unreal, tay cầm W/E/R, tự đặt keyframe ở playhead.
- Hoàn tác/làm lại cho mọi file, AI sửa file thì trang tự cập nhật, mở nhiều tab vẫn đồng bộ.
- Tự kiểm: CHECK=motion/seen/touch/slide, framecheck video.

## Nhu cầu của dev và tính năng đáp ứng

- Góp ý chuẩn chỉ: đã có ghim+vẽ+danh sách. Thêm vùng lặp để xem đi xem lại một đoạn, so sánh trước/sau (A/B), lưới bố cục.
- Camera mượt: đã có bezier. Thêm mẫu chuyển động camera một chạm, hiện đường bay camera trong 3D, khung hình camera thật khi bay tự do.
- Fade in/out hình: thêm hàng hiệu ứng (tối dần, sáng dần, chớp đen giữa hai cảnh) chỉnh được độ dài và đường cong.
- Chọn SFX/BGM: đã có thư viện. Thêm tự hạ nhạc nền khi có giọng (ducking), tay nắm fade trên clip, cắt clip âm thanh.
- Sửa giọng ElevenLabs: cắt, kéo dài, chỉnh khoảng nghỉ. Cần quyết định thiết kế, xem mục Câu hỏi.
- Tính năng "quốc dân" kiểu CapCut: keyframe (đã có), cắt (Ctrl+B), xoá trái/phải playhead, hít, phím tắt.

## OpenCut (giống CapCut nhất)

Phát lại và di chuyển
- [ĐÃ CÓ] Phát/dừng (Space), lùi/tiến 1 khung (mũi tên), nhảy 5 giây (Shift+mũi tên).
- [BỎ] Nhảy về đầu/cuối phim (Home/End): phim dài 2-10 phút thì kéo thanh là đủ, thêm phím chỉ tốn chỗ nhớ.

Cắt ghép
- [ĐÃ CÓ] Cắt shot camera ở playhead (Ctrl+B).
- [LÀM] Cắt clip âm thanh ở playhead (Ctrl+B khi đang chọn clip): CapCut ai cũng dùng, dễ.
- [LÀM] Xoá phần trái/phải playhead của clip (split-left/right, CapCut là Q/W): cắt bớt đầu đuôi nhạc trong một phím, dễ.
- [ĐÃ CÓ] Xoá, chọn tất cả (Ctrl+A), bỏ chọn (Esc).
- [SAU] Sao chép/dán clip ở playhead, nhân đôi (duplicate): hữu ích khi lặp một tiếng động, vừa.
- [SAU] Chế độ gợn (ripple editing): xoá một đoạn thì mọi thứ sau dồn lên. Khó với phim 3js vì keyframe nhân vật cũng phải dồn theo.
- [ĐÃ CÓ] Bật/tắt hít (snap), giữ Shift để tạm tắt.
- [BỎ] Tách tiếng khỏi video nguồn (extract audio): phim mình không có video nguồn.

Âm thanh
- [ĐÃ CÓ] Âm lượng, fade in/out từng clip.
- [LÀM] Tay nắm fade vẽ trên clip (kéo góc trên clip để fade): thấy ngay độ dài fade, dễ.
- [SAU] Đường âm lượng kéo lên xuống trên clip (volume line), nhiều điểm (rubber band): tinh hơn một mức dB, vừa.
- [SAU] Đổi tốc độ giữ cao độ (soundtouchjs PitchShifter): dùng cho kéo giãn giọng, vừa.
- [ĐÃ CÓ] Dạng sóng (waveform) trên clip.

Keyframe và đường cong
- [ĐÃ CÓ] Keyframe vị trí/xoay/cỡ, đường cong bezier từng đoạn kèm mẫu có sẵn.
- [SAU] Mở rộng keyframe thành từng hàng theo thuộc tính (Expand keyframes): khó nhìn hơn với newbie, để sau.
- [SAU] Sao chép/dán keyframe giữa các vật: vừa.

Khung hình và hướng dẫn
- [LÀM] Lưới 1/3 và vùng an toàn (layout guides, safe areas): giúp đặt nhân vật đúng bố cục, chữ không bị lẹm. Dễ.
- [BỎ] Khung an toàn TikTok/Reels/Shorts: kênh làm phim dài 16:9.
- [SAU] Phóng to/kéo khung xem (preview zoom/pan): soi chi tiết nhỏ, vừa.

Khác
- [BỎ] Sticker, mặt nạ (mask), làm mờ nền, nhập phụ đề srt/ass, tạo phụ đề tự động: phim 3js tự vẽ mọi thứ, phụ đề YouTube tự làm.
- [SAU] Chữ trên hình (text): Atrium hay ghi địa danh, ngày tháng. Cần thiết kế chung với film, xem Câu hỏi.
- [BỎ] Xuất video trong trình duyệt: mình đã có render riêng chất lượng cao.

## FilmCraft (Premiere)

Các nhóm lệnh: âm thanh (nghe khi kéo), clip (gain, nhóm, nest, đổi tốc độ, giữ khung), sửa (cắt, chép, dán, ripple delete), hiệu ứng (93 hình, 53 tiếng), chuyển cảnh (84), file (xuất EDL/XML/OMF), lịch sử, marker, playhead, sequence (lift/extract, đóng khoảng trống, work area), timeline (razor, roll, slip, slide, rate stretch, nudge, chọn track), trim, transcript, mixer, multicam, Lumetri màu, đọc lời thoại (Kokoro TTS).

- [ĐÃ CÓ] Razor (cắt), roll (kéo vạch cắt, hai shot nhường nhau), nudge (dịch 1 khung).
- [SAU] Slip/slide (trượt nội dung trong clip, trượt clip giữa hai clip): dân chuyên mới cần, khó.
- [LÀM] Kéo playhead tới cạnh rồi cắt bớt (Q/W extend/trim to playhead): giống mục xoá trái/phải ở trên.
- [LÀM] Vùng làm việc (work area, Alt+[ và Alt+]): chọn một đoạn để lặp khi xem. Dễ.
- [ĐÃ CÓ] Marker: ghim góp ý chính là marker có ghi chú. Thêm marker riêng sẽ trùng.
- [LÀM] Fade hình bằng chuyển cảnh Cross Dissolve/Dip to Black ở đầu cuối clip (theo docs/getting-started-fades.md). Mình làm dạng hàng hiệu ứng.
- [SAU] Đường âm lượng bằng bút (Pen, P), điểm đầu cuối về -vô cực dB để fade.
- [LÀM] Essential Sound ducking: tự hạ nhạc nền khi có giọng. Dùng mốc từng chữ có sẵn, không cần AI.
- [SAU] Sửa bằng chữ (transcript editing): xoá chữ thì cắt tiếng. Hợp với nhu cầu sửa giọng, xem Câu hỏi.
- [SAU] Giữ khung (frame hold), đổi tốc độ (speed/duration), time remap: phim 3js chỉnh keyframe là được, ít cần.
- [BỎ] Multicam, nest, proxy, xuất EDL/AAF/OMF/XML, bars and tone, counting leader: dành cho quay thật và trao đổi với hãng khác.
- [SAU] Lumetri màu và scopes (biểu đồ màu): phim đã có final look (G). Scopes giúp chỉnh sáng tối chuẩn, vừa.
- [BỎ] Đọc lời bằng Kokoro TTS: mình dùng ElevenLabs.
- Phím hay: [ ] chỉnh âm lượng clip ±1 dB, Shift+S bật nghe khi kéo, Shift+` phóng to khung đang trỏ, D chọn clip ở playhead.

## EffectCraft (After Effects)

Các nhóm lệnh: keyframe (Easy Ease F9, nội suy linear/bezier/hold, roving, smooth, wiggle, đảo ngược, velocity), camera (tạo, từ góc nhìn, orbit, pan, dolly, DOF lấy nét, tracker 3D, stereo), preset hoạt ảnh, thời gian (nhảy keyframe trước/sau, work area), xem (lưới, thước, vùng an toàn, chụp nhanh A/B, nhiều góc 3D, region of interest, exposure), thuộc tính (tách X/Y/Z, expression, pick whip), marker, phát lại (cache khi rảnh, nghe khi kéo).

- [ĐÃ CÓ] Easy Ease, nội suy bezier, hold (đứng yên giữ nguyên).
- [LÀM] Mẫu chuyển động camera (orbit, pan, dolly, crane): một chạm ra chuyển động chuẩn, dev chỉnh tiếp. Vừa.
- [LÀM] Chụp nhanh và so sánh (snapshot take/show): chụp hình trước khi sửa, bấm giữ để so với sau. Dễ.
- [LÀM] Lưới, vùng an toàn: như mục OpenCut.
- [LÀM] Nhảy keyframe trước/sau (J/K trong AE): đã có nút trong tab Camera. Thêm phím nếu không trùng.
- [SAU] Đồ thị tốc độ (speed graph) và đường bay có tay nắm (motion path, spatial bezier): hàng camera đã vẽ tốc độ. Kéo tay nắm đường bay là khó.
- [LÀM] Hiện đường bay camera trong 3D khi bay tự do: thấy camera đi đâu mà không cần phát. Vừa.
- [SAU] Lấy nét theo vật (DOF, link focus to layer): đẹp kiểu điện ảnh, cần film hỗ trợ bokeh.
- [SAU] Wiggle (rung ngẫu nhiên): film-stage đã có shakeAt và Sway.
- [BỎ] Expression, pick whip, tracker 3D, stereo rig, xuất sang Blender: mạnh nhưng dành cho dân kỹ thuật, AI làm trong code tốt hơn.
- [BỎ] Tách X/Y/Z: newbie dễ rối, gizmo đã đủ.

## Theatre.js (keyframe cho three.js)

- [ĐÃ CÓ] Dopesheet (hàng keyframe), kéo keyframe, hít vào keyframe khác (DopeSnap), hoàn tác.
- [LÀM] Vùng tập trung (focus range): kéo một đoạn trên thước thời gian, Space chỉ phát trong đoạn đó. Giống work area.
- [ĐÃ CÓ] Mẫu ease: Quad, Cubic, Quart, Quint, Sine, Expo, Circ, Back, Hold. Ta có Easy Ease và mẫu của Blender/Unreal, đủ dùng.
- [SAU] Gộp keyframe theo vật (aggregate track): hàng cha hiện mọi keyframe con, kéo một lần dời hết. Vừa.
- [SAU] Chép/dán keyframe giữ đúng thuộc tính (AGGREGATE_COPY_PASTE.md).
- [SAU] Mũi tên keyframe trước/sau ngay cạnh từng ô số trong bảng chi tiết (NextPrevKeyframeCursors): rất tiện, vừa.
- [LÀM] Ô số kéo chuột để đổi giá trị (drag-scrub) và gõ phép tính (2*3): dễ.
- [LÀM] Cửa sổ tham chiếu (ReferenceWindow): khi bay tự do vẫn thấy khung camera thật. Mình vẽ khung camera (frustum) trong 3D thay vì cửa sổ nhỏ, vì film có hậu kỳ riêng.
- [SAU] Gõ thời gian chính xác cho playhead (PlayheadPositionPopover): vừa.
- [BỎ] Ẩn toàn bộ giao diện (Alt+\): đã có chế độ xem final.

## CapCut 8.5 (máy dev)

Bố cục (ảnh dev chụp): trên cùng là thanh thư viện Media, Audio, Text, Stickers, Effects, Transitions, Captions, Filters, Adjustment, Templates. Giữa là khung xem, phải là bảng chi tiết của thứ đang chọn, dưới là thanh công cụ timeline rồi các track.

- [ĐÃ CÓ] Ba cột kiểu CapCut trên màn rộng: thư viện trái, khung xem giữa, chi tiết phải.
- [LÀM] Mỗi thuộc tính có bộ ba nút ◁ ◇ ▷ (về keyframe trước, thêm/xoá keyframe ở playhead, tới keyframe sau) và nút đặt lại (reset). Đây là cách CapCut dạy keyframe cho cả thế giới, dev học một lần dùng mọi nơi.
- [LÀM] Ô số có nút tăng giảm và kéo chuột để đổi: như ô Scale, Position, Volume của CapCut.
- [LÀM] Thanh công cụ trên timeline: hoàn tác, làm lại, cắt, xoá trái, xoá phải, xoá; bên phải là hít, phóng to thu nhỏ. Người mới nhìn icon là biết làm gì, không cần nhớ phím.
- [ĐÃ CÓ] Tab Audio của clip: Volume dB, Fade in, Fade out. Studio có đủ ba thứ này.
- [BỎ] Normalize loudness, Enhance voice, Reduce noise, Voice changer: giọng ElevenLabs đã sạch, mix.py đã chuẩn hoá -14 LUFS.
- [SAU] Animation In/Out/Combo (mẫu xuất hiện, biến mất cho clip): với phim mình là mẫu chuyển động camera và mẫu xuất hiện đạo cụ. Mẫu camera làm trước.
- [SAU] Adjust: LUT, HSL, Curves, Color wheel. Phim đã có final look; chỉnh màu từng shot để sau.
- [BỎ] Remove BG, Mask, Retouch, Stabilize, Enhance quality, AI stylize: dành cho video quay thật.
- [ĐÃ CÓ] Đầu track có khoá, mắt (ẩn), loa (tắt tiếng).
- [BỎ] Thời gian dạng 00:00:00:25 (giờ:phút:giây:khung): studio dùng mm:ss.sss khắp nơi, ghi chú và AI đều đọc theo kiểu này.

Phím tắt CapCut (tra trên editlogic.io, tutorialtactic.com, kênh YouTube chính chủ CapCut):
- Space phát, Ctrl+B cắt clip đang chọn, Ctrl+Shift+B cắt mọi track, Q/W xoá trái/phải playhead, B chế độ dao, A chế độ chọn.
- I/O điểm vào/ra, M marker, Alt+M marker màu mới, Shift+M/Alt+Shift+M marker sau/trước.
- J/K/L tua lùi/dừng/tua tới, mũi tên lên/xuống nhảy điểm cắt, [ ] chọn mọi clip bên trái/phải.
- N bật tắt hít, P nam châm track chính, S đường xem trước khi rê chuột, Shift+Z vừa khít timeline, Ctrl+= / Ctrl+- phóng to thu nhỏ.
- Ctrl+. / Ctrl+, tăng giảm âm lượng 0.1 dB, Ctrl+R bảng tốc độ, Alt+K bảng keyframe, Ctrl+; hiện đường gióng, V bật tắt clip.
- Studio đã theo phím CapCut (mục 14); phím riêng còn lại: D vẽ, F camera tự do, K chép góc camera, G chất lượng final, 0-9 chọn phương án, Ctrl+lên/xuống âm lượng.

Ducking chuẩn (capcutguide.com, scientificdev.net, capcut.com): nhạc hạ 14-18 dB khi có lời, hạ trước chữ đầu 0.2-0.4 s, lên lại sau chữ cuối 0.6-1.2 s, khoảng nghỉ dưới 1 s thì giữ nhạc thấp để khỏi "bơm" lên xuống.

## Atrium (6 video trong Downloads)

Chỉ xét camera, nhịp cắt và cách trình bày hình, chưa bàn cách viết truyện. 6 video: Rasputin (Killing Russia's Most Hated Man), Why Hitler Was Impossible To Kill, How to Escape North Korea, Mapping the Trump Shooting, The Cable That Changed The World, Inside Hitler's Secret Mansion, tổng 90 phút, 1028 shot.

Cách đo: ffmpeg chấm điểm đổi cảnh từng khung, một khung gấp đôi mọi khung trong 0.5 s quanh nó là vết cắt (giống AdaptiveDetector của PySceneDetect). Đã soi tận mắt hai đoạn để chỉnh: ngưỡng cố định 0.3 bỏ sót cắt trong cảnh 3D tối, so với trung bình thì đếm nhầm phim tư liệu và lửa hoạt hình tốc độ thấp.

- Nhịp cắt: shot trung bình 5.2 s, trung vị 3.7 s, 10% ngắn hơn 1.3 s, 10% dài hơn 9.8 s. Từng video từ 3.9 s (Bắc Triều Tiên) tới 6.9 s (Hitler).
- Shot dài: 14% dài hơn 8 s, dài nhất 30-58 s, đều là một đường máy liên tục đi qua mô hình 3D. Luật "tối đa 8 s" trong film-grammar.md không khớp kiểu này, xem Câu hỏi.
- 60 giây đầu cắt nhanh hơn chút (3.8-5 s một shot), trừ video Hitler mở bằng một đường máy dài. Vẫn chậm hơn nhịp mở đầu 1.8-2.5 s của Fern trong film-grammar.md; thân bài 3.5-5 s thì khớp.
- Bay xuyên: máy đi xuyên trần, xuyên kính xe, xuyên tường sang phòng khác thay cho một vết cắt (Rasputin 0:31, Hitler 4:33-4:38). Đây là dấu hiệu nhận ra Atrium rõ nhất.
- Nhà bổ đôi (cutaway): một mặt nhà bị cắt để thấy phòng sáng ấm bên trong, quanh là thành phố đất sét xám tối.
- Một màu nhấn cam cho tuyến đường, toà nhà, người cần chú ý; còn lại xám hoặc màu thật.
- Chữ trên hình: địa danh in hoa với năm nhỏ bên dưới ("ST PETERSBURG / 1916"), nhãn tên nền đen gắn lên ảnh tư liệu, chú thích đồ vật kiểu bảo tàng ("Voltaic pile / Alessandro Volta / 1800").
- Bản đồ cổ màu be có tuyến chấm cam chạy dần, bảng ghim ảnh nối dây đỏ, ảnh tư liệu đẩy chậm (Ken Burns), đồ vật trên nền trắng như chụp sản phẩm.
- Sang chương qua màu đen (đo độ sáng từng khung): tối dần 1.5-2 s, đen hẳn 0.7-1 s, sáng lại 0.8-1.5 s chậm dần. Tuỳ phim: Hitler 10 lần (khoảng 1.7 phút một lần), Rasputin chỉ một lần sau đoạn mở đầu, cắt cụt sang đen 1.3 s rồi cắt vào tiêu đề.
- Chuyển cảnh "lớp render": hình loé sang màu normal map của chính cảnh 3D rồi cắt (Rasputin 0:41).
- [ĐÃ CÓ] Qua đen giữa hai chương: Fade out shot trước rồi Fade in shot sau (mục 10).
- [SAU] Giữ đen một lúc giữa Fade out và Fade in (Atrium giữ 0.7-1 s): hiện phải kéo key bằng tay.
- [SAU] Mẫu camera bay xuyên tường/trần và nhà bổ đôi: cần ẩn bớt tường theo camera, vừa.
- [SAU] Hàng chữ trên hình (địa danh + năm, nhãn tên): xem Câu hỏi.

## Mẹo nhỏ nhặt được

- Shift giữ khi kéo thì tạm tắt hít (OpenCut, Theatre). Studio đã làm.
- Esc luôn là bỏ chọn/huỷ thao tác đang dở (OpenCut). Studio đã có Esc bỏ chọn, chưa có Esc huỷ lúc đang kéo.
- Đường cong bezier: tay nắm tự hít về 0 và 1 khi gần (ngưỡng 0.06), Shift tắt hít; trục dọc giới hạn -0.5..1.5 để được nảy nhẹ (OpenCut bezier-graph).
- Xem trước khi kéo, thả mới lưu (OpenCut): studio đã làm vậy. Esc trong lúc kéo thì bỏ: chưa làm.
- Ô số nhận phép tính và kéo chuột để đổi (OpenCut 0.3).
- Khe nhỏ giữa hai clip liền nhau để vẫn thấy viền chọn; viền chọn nét đứt (OpenCut).
- Dạng sóng RMS, phần quá 0 dBFS tô màu khác; chỉ vẽ phần đang thấy cho nhẹ (OpenCut).
- Đường âm lượng giữ đúng tỉ lệ dB với vị trí ở mọi độ cao track (OpenCut).
- Bấm vùng trống dưới các track cũng nhảy playhead tới đó (OpenCut).
- Hàng track sáng lên khi đang chọn clip trong nó (OpenCut).
- Lăn chuột dọc ở đâu cũng cuộn, tiêu đề cột không cuộn theo (OpenCut).
- Fade âm thanh chuẩn: điểm đầu và cuối về -vô cực dB, không phải 0 dB nhỏ (FilmCraft docs).
- Crossfade giữa hai clip tiếng = fade out clip trước chồng fade in clip sau (FilmCraft docs).
- Easy Ease của AE = tốc độ 0 tại keyframe, ảnh hưởng 33.33% (đã ghi trong CamPanel).
- Chụp nhanh A/B: giữ phím để xem hình cũ, thả ra về hình mới (AE snapshot).
- Cache khi rảnh (cache when idle): dựng trước hình khi người dùng không thao tác (AE). Studio vẽ trực tiếp nên chưa cần.
- Space chỉ phát trong vùng tập trung nếu có (Theatre).
- Fade hình nên dùng keyframe độ mờ có ease thay cho chuyển cảnh mặc định, đen tới mượt hơn (filmit.io). Fade hình thì fade cả tiếng, hình tối mà tiếng cắt cụt là lỗi hay gặp.
- Độ dài fade mang nghĩa: dưới 0.5 s là một nhịp, khoảng 1 s hết cảnh, 2-3 s hết chương, trên 3 s chỉ để kết phim (zooop.ai). Đừng fade giữa mọi shot.

## Thứ tự làm và tiến độ

Ưu tiên theo: dev cần nhất, dễ dùng, ít đụng film.

1. Lưới 1/3 và vùng an toàn: XONG. Nút lưới cạnh loa hoặc Ctrl+; (picture/Guides.tsx), vùng an toàn 93%/90% theo SMPTE ST 2046-1.
2. Chụp nhanh so sánh A/B: XONG. Nút máy ảnh hoặc Shift+\ để chụp, giữ \ hoặc giữ nút so sánh để xem ảnh cũ (picture/snapshot.ts).
3. Ô số kéo chuột và gõ phép tính: XONG. Ô Position/Rotation/Scale của Object và FOV/Roll/Sway của Camera; kéo ngang để đổi, Shift chậm lại, gõ 2*3 cũng được (components/NumberField.tsx).
4. Cắt clip âm thanh, xoá trái/phải playhead: XONG. Ctrl+B, Q, W hoặc nút trên thanh công cụ timeline; đoạn bên phải phát tiếp đúng chỗ trong file (sound/sound.ts splitClips, trimClips).
5. Thanh công cụ timeline kiểu CapCut: XONG. Hoàn tác, làm lại, cắt, xoá trái, xoá phải, xoá, hít (bật/tắt), thu nhỏ, phóng to, cả phim (timeline/TimelineBar.tsx).
6. Tự hạ nhạc nền khi có giọng (ducking): XONG. Chọn clip Bed, kéo "Ducking" (dB); trang nghe thử và mix.py cùng một công thức (sound/duck.ts, mix.py duck_expr), đã đo bằng ffmpeg: -24 dB xuống -36 dB khi có lời.
7. Fade in cho tiếng động lẻ (SFX): XONG. Trước đây chỉ Bed có fade in.
8. Mẫu chuyển động camera: XONG. Tab Camera, khu Shot move: 15 nút (push, pull, orbit, pan, tilt, slide, rise, lower, zoom, hold) với 3 mức Subtle/Medium/Strong; một chạm thay keyframe của shot đang ở playhead, Ctrl+Z để bỏ (camera/cam.ts applyMove).
9. Đường bay và khung camera khi bay tự do: XONG. Bật Free camera (F) sẽ thấy đường bay shot hiện tại màu cam kèm chấm keyframe, shot khác màu xám, và khung camera thật ở playhead (camera/campath.ts).
10. Fade hình (tối dần, sáng dần, chớp đen): XONG. Tab Camera, khu Fade: Fade in, Fade out, Dip to black, ô Length; key ghi vào hàng black của fx.json, kéo key để chỉnh, film vẽ màn đen cuối cùng nên nháp và video final đều có (film-stage/src/fade.ts, camera/fades.ts). Đã soi: dip 6.5 s đen đúng khung cắt trong studio và ảnh render nháp. Fade out shot trước rồi Fade in shot sau (thứ tự nào cũng được) nối thành một lần qua đen kiểu Atrium; bản đầu hai cái xoá nhau, đã sửa và có test.
11. Tay nắm fade trên clip âm thanh: XONG. Rê chuột lên clip (hoặc chọn clip) sẽ hiện chấm trắng ở hai góc trên, kéo vào trong để fade in/out như CapCut và Premiere, không cho hai fade chồng quá độ dài clip (sound/lanes.ts knobAt). Sửa luôn lỗi fade in của SFX không hiện trên clip.
12. Bộ ba ◁ ◇ ▷ keyframe kiểu CapCut ở bảng Object: XONG. Dòng Transform: ◁ ▷ nhảy keyframe trước/sau, ◇ rỗng thêm key giữ nguyên chỗ vật đang đứng, ◇ đặc là đang đứng trên key và bấm để xoá, nút ↺ đặt lại xoay và cỡ (keys/keynav.ts, placed.ts toggleKey). Một nút cho cả Transform vì mỗi key của vật giữ cả vị trí, xoay và cỡ; CapCut cũng có nút key chung cho Transform.
13. Hình camera gốc cạnh camera tự do: XONG. Bật Free camera (F), góc dưới phải có khung Film camera chiếu đúng hình phim ở playhead (cả fade và hậu kỳ) như camera preview của Unreal; nút đổi cỡ 3 mức, nút ẩn còn một nút nhỏ để hiện lại (picture/filmcam.ts). Chỉ bay camera thì khung không vẽ lại, nên không tốn thêm.
14. Phím tắt theo CapCut toàn app: XONG. Ctrl+B, Ctrl+Shift+B, B hoặc C bật dao cắt (bấm lên clip hay hàng camera là cắt ở đó), A về chọn, Q W, [ ] chọn clip trái/phải, lên/xuống nhảy cut, Shift+mũi tên 5 khung, Home End, N bật tắt hít, M thêm ghi chú (marker của CapCut), Shift+M ghi chú kế. Ctrl+ và Ctrl- trả lại cho trình duyệt phóng trang, timeline phóng bằng = và -.
15. Bỏ Loop shot (L) vì dev thấy vô dụng. Timeline kiểu CapCut: chỉ thanh công cụ, Overview và thước giây đứng yên, mọi hàng từ Shots tới track âm thanh cuộn chung (trước đây phần đầu cố định che gần hết track âm thanh).

Còn lại trong đợt này, chưa làm: vùng làm việc/vùng tập trung (work area, focus range: lặp một đoạn, Space chỉ phát trong đó), phím nhảy keyframe trước/sau (J/K), nút tăng giảm cạnh ô số.

## Câu hỏi cho dev

1. Phím tắt có đổi theo CapCut không? Dev đã chốt: theo CapCut toàn app, C cũng là dao cắt như thói quen của dev (xem mục 14).
2. Sửa giọng: kéo dài hay rút ngắn khoảng nghỉ giữa hai câu thì camera, nhân vật, SFX phía sau có dời theo không? Đề xuất có, vì studio đã ghi giờ theo giây gốc của giọng và có warp kéo giãn (src/edit.ts); trước khi làm phải soát file nào chưa theo warp (audio.json đang tính giây đầu ra).
3. Có làm hàng chữ trên hình kiểu Atrium (địa danh + năm, nhãn tên lên ảnh) không? Đề xuất có, film tự vẽ như fade để nháp và final cùng có, nhưng đây là phần kể truyện nên dev quyết lúc nào làm.
4. Luật "shot tối đa 8 s" trong film-grammar.md (theo Fern) có giữ không, khi Atrium có 14% shot dài hơn 8 s? Đề xuất giữ 8 s cho shot máy đứng yên, cho dài hơn khi máy đi liên tục qua nhiều thứ.
