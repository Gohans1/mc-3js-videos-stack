# live-studio so với CapCut

File theo dõi từng tính năng trong danh sách "95% video đều cần" của dev (Desktop/capcut-features-95-percent.md): studio có chưa, dùng ở đâu, lệch CapCut chỗ nào. AI làm xong tính năng nào thì sửa đúng dòng đó trong cùng commit.

Nhãn: CÓ (dùng được), ĐANG LÀM, SẮP LÀM (dev đã chốt, Desktop/live-studio-decisions.md), BỎ (kèm lý do). Phím ghi theo Windows.

## Tầng 1: Siêu dễ

- Playback, frame step, J/K/L: CÓ.
  - Space phát/dừng, ← → một khung (Shift: 5 khung), ↑ ↓ nhảy tới cắt trước/sau, Home/End đầu/cuối phim.
  - J lùi, K dừng, L tới; bấm J hoặc L lần nữa thì 2×, 4×, 8×. Lệch: J không có tiếng vì trình duyệt không phát ngược được.
- Split, trim, quick trim Q/W: CÓ.
  - Ctrl+B cắt clip âm thanh đang chọn hoặc shot tại playhead; Ctrl+Shift+B cắt mọi track.
  - B (hoặc C kiểu Premiere) bật dao, bấm vào clip hay hàng Camera để cắt; A hoặc Esc về chọn.
  - Kéo mép clip để gọt; Q/W xoá phần bên trái/phải playhead của clip đang chọn.
- Undo, redo, duplicate, copy/paste attributes: CÓ.
  - Ctrl+Z, Ctrl+Y (hoặc Ctrl+Shift+Z) cho mọi file timeline; đang vẽ thì Ctrl+Z gỡ nét cuối.
  - Alt+kéo clip âm thanh tạo bản sao, clip gốc đứng yên.
  - Ctrl+C/X/V cho clip âm thanh, kim cương camera, keyframe Steve và đồ vật, dán tại playhead. Clip dán vào track trống có sẵn gần nhất (dưới trước, trên sau), hết chỗ mới tạo track mới.
  - Ctrl+Alt+C/V: copy/paste attributes (animation của shot, âm lượng và fade của clip, ống kính và ease của khoá camera). Lệch: Ctrl+Alt thay Ctrl+Shift vì Chrome giành Ctrl+Shift+C.
- Timeline zoom, fit, preview axis: CÓ.
  - Ctrl+lăn chuột hoặc = và - để zoom timeline; Ctrl+ và Ctrl- để zoom trang như trình duyệt.
  - Shift+Z (nút kính lúp) vừa cả phim; thanh trượt zoom giữa nút - và + như CapCut; Alt+lăn hoặc Shift+lăn trượt ngang.
  - Shift+P bật/tắt preview axis (phím của CapCut 9.7): rê chuột trên timeline xem khung đó, playhead đứng yên, đồng hồ chuyển vàng.
  - Shift+S thêm tiếng (như "video and audio" của CapCut): rê chuột hay kéo playhead thì nghe vài khung tiếng ở đó, cả lời dẫn lẫn các track. Mặc định tắt.
- Auto snapping (S, phím của CapCut 9.7): CÓ. Hít vào playhead, cắt, từ thoại và mép clip khác, bằng đầu nào của clip gần hơn; giữ Shift khi kéo để tắt tạm. Kéo đè lên clip khác quá tầm hít thì clip xuống track mới, như CapCut.
- Track lock, hide, mute, solo:
  - Mute, Lock ở đầu mỗi track âm thanh: CÓ. Mute áp cả bản render final (mix.py bỏ track đó).
  - Solo: CÓ, nút tai nghe ở đầu track (khi trang tự phát các track), lời dẫn cũng im theo. Chỉ trong trang, không lưu, không ảnh hưởng bản render.
  - Hide: BỎ, studio không có track hình hay chữ; ẩn một đạo cụ thì chọn Off ở chip phương án.
- Transform, stabilize, apply to all:
  - Đồ vật đặt thêm: CÓ, kéo thả từ tab Objects, W/E/R đổi tay cầm di chuyển/xoay/phóng.
  - Camera: CÓ FOV, Roll, Sway và kéo khung bằng free camera (F) rồi Shift+K lưu khoá.
  - Apply to all: thay bằng Ctrl+Alt+C/V. Stabilize, Mirror, Crop: BỎ, cảnh 3D tự quyết khung.
- Aspect ratio, guides: CÓ.
  - 16:9 / 9:16 ở ⋯ Settings > View, lưu theo từng phim (package.json mục "live-studio"), render nháp và CHECK cũng theo.
  - Ctrl+; hoặc nút lưới: một phần ba, tâm, vùng action safe 93% và title safe 90% (SMPTE ST 2046-1).
  - Phim 9:16: tô tối vùng bị nút và chú thích của YouTube Shorts lẫn TikTok che (số chính chủ Google và TikTok, công bố cho quảng cáo).
  - Auto reframe, Canvas blur: BỎ, phim 3D đổi khung bằng camera.
- Markers, beat markers:
  - Marker là note: CÓ. M thêm note tại playhead, Shift+M note kế, Alt+Shift+M note trước.
  - Auto beat trên clip nhạc: SẮP LÀM.
- Favorites, search, hover preview: CÓ. Sao yêu thích cho âm thanh và hiệu ứng, ô tìm, nút ▷ nghe thử; rê chuột lên một âm thanh trong thư viện thì các clip của nó sáng lên trên timeline.
- Preview quality, export:
  - Xem nháp 960×540, G bật Final quality.
  - Export still frame: ⋯ Settings > Heavy > Still frame, lưu PNG/JPEG cỡ final qua hộp Save của Chrome, ảnh sạch không guides hay pin.
  - Xuất video: lệnh `bun run render` trong folder phim, trang không có nút Export. Xuất .srt: SẮP LÀM ở bước render final. Proxy: BỎ.

## Tầng 2: Dễ

- Volume, waveform, fade handles: CÓ.
  - Chọn clip thì tab Audio bên phải có Volume -40 đến +20 dB, Pan trái/phải, Fade in/out; sóng âm vẽ trên clip.
  - Clip âm thanh đúng màu CapCut 9.7 đo từ ảnh dev: nền navy, sóng cột 1 px xanh cyan mọc từ đáy, tên trên tab sáng hơn, track cao 50 px. Đỉnh cam khi gần 0 dB, đỏ khi vượt: quy ước Final Cut Pro, CapCut không ghi tài liệu. Đường âm lượng kéo được trên clip: SẮP LÀM cùng Volume keyframe.
  - Kéo nút ở hai góc trên của clip để fade như CapCut.
  - Báo đỏ khi vỡ tiếng: CÓ, đồng hồ tổng bên phải timeline: đỉnh trái/phải (vàng từ -12, đỏ từ -1 dB), đèn đỏ trên cùng khi vỡ 0 dB (bấm để xoá), cột LUFS với vạch đích. Mọi số là của bản render final; tắt ở ⋯ Settings > View > Audio meter, điện thoại không có.
- Voiceover, separate audio, vocal isolation, replace clip:
  - Separate audio: CÓ sẵn, tiếng là track riêng nên J-cut/L-cut làm ngay.
  - Replace clip: CÓ dạng Alternatives, chip A/B/C/D trên hình hoặc ⋯ Settings > Alternatives (phím 0-9), giữ nguyên chỗ, độ dài và mức âm.
  - Thu micro, vocal isolation: BỎ, giọng đọc làm bằng ElevenLabs (scripts/voice).
- Transitions: SẮP LÀM (thứ 2 trong nhóm tính năng lớn). Hiện phim tự có fade đen giữa chương (fx.json), chưa chỉnh được trong studio.
- Clip animations In/Out/Combo: CÓ cho shot ở tab Animation, rê chuột lên ô để thử ngay, chuột phải khối shot để gắn nhanh. Lệch: là chuyển động máy quay 3D thật (đẩy, xoay, rung), không phải biến hình 2D.
- Ducking, loudness normalization, enhance voice, noise reduction:
  - Ducking: CÓ, nhạc nền tự hạ khi có giọng đọc, trang nghe giống hệt mix.py.
  - Chuẩn hoá LUFS: mix.py đưa cả phim về audio.json lufs (-14) và -1 dBTP lúc render.
  - Đồng hồ LUFS: CÓ, số S (3 giây gần nhất) và I (từ lúc bấm Play). Rê chuột lên số để xem mix.py sẽ tăng cả phim bao nhiêu dB, kèm ⚠ và mức lufs nên đặt khi đỉnh sau đó vượt -1 dBTP (mix.py sẽ nén méo cả phim).
  - Enhance voice, noise reduction: BỎ, giọng ElevenLabs đã sạch.
- Text, captions, callouts, TTS:
  - Captions: CÓ trong studio (⋯ Settings > View), hiện câu thoại đang nói dưới hình.
  - Text: CÓ. Tab Text bên trái có Default text, Place and time (đánh máy góc dưới kiểu phim tài liệu), Chapter title, Big number; bấm ô là thêm tại playhead.
  - Hàng Text trên hàng Camera như text track của CapCut: kéo để dời hoặc đổi track, kéo mép để gọt, Alt+kéo tạo bản sao, chọn bằng khung cùng các hàng khác, Delete, Ctrl+C/V.
  - Tab Text bên phải: chữ, font (Inter, Plex Mono, Source Serif), cỡ, đậm, nghiêng, viết hoa, màu, giãn chữ, giãn dòng, căn lề, độ mờ, Stroke, Background, Shadow, Scale, Position, Rotate. Chọn nhiều thì sửa cả nhóm.
  - Tab Animation: In và Out (Fade, Typewriter, Slide, Zoom, Blur) kèm độ dài. Lệch: ô chưa có hình động thử trước như CapCut.
  - Trên hình: bấm chữ là chọn, kéo để dời, hít vào đường giữa (Shift: không hít). film-stage/titles.ts vẽ nên render final giống hệt.
  - Text bám theo vật 3D (trường at trong text.json) đã chạy ở film-stage nhưng chưa có nút trong studio. Split chữ (Ctrl+B): chưa.
  - TTS: ngoài studio (scripts/voice/gen.py qua GenVoice).
- Speed, reverse, freeze frame:
  - Tab Speed: CÓ, chỉnh tốc độ máy quay giữa hai khoá bằng preset vẽ đường vàng như CapCut Curve. Lệch: không có Standard (nhân tốc độ) vì camera không có tốc độ gốc.
  - Freeze frame và speed ramp cho cả phim: SẮP LÀM. Reverse tiếng: SẮP LÀM.

## Tầng 3: Trung bình

- Main track magnet, linkage (ripple): SẮP LÀM. Chèn hoặc bớt thời gian ở một điểm, mọi thứ phía sau (tiếng, khoá, note) lùi theo, một lần undo.
- Overlay / picture-in-picture: BỎ, vật minh hoạ đặt thẳng vào cảnh 3D.
- Remove BG, chroma key: BỎ, cùng lý do.
- Video effects, arrows, opacity, blend:
  - Mũi tên, vòng khoanh: CÓ ở tab Text > Shapes, nét tự vẽ ra (Draw on), màu, độ dày, cỡ, xoay. Grain, vignette: SẮP LÀM trong Adjust theo shot.
  - Night vision (nút mặt trăng): CÓ, hiệu ứng riêng của studio. Opacity, blend modes: BỎ lúc này.
- Filters, LUTs, color adjust: SẮP LÀM dạng Adjust theo shot (exposure, contrast, saturation, temperature, vignette, grain). Soi màu thì đã CÓ Color oscilloscope.
- Work area In/Out: CÓ.
  - I, O đặt điểm tại playhead; Shift+X quanh clip đang chọn hoặc shot; Alt+X xoá.
  - Phát từ trong vùng thì lặp lại đoạn đó; note viết trong vùng mang cả khoảng giờ cho AI. Lệch: không xuất riêng đoạn vì trang không xuất video.

## Tầng 4: Hơi nâng cao

- Property keyframes, auto-key: CÓ.
  - Nút ◁◇▷ cạnh thuộc tính ở tab Camera và tab đồ vật; đã có khoá thì sửa giá trị là tự thêm khoá tại playhead.
  - Kéo, chọn nhiều, xoá kim cương ngay trên hàng Camera và các hàng keyframe Steve, đạo cụ.
  - Motion blur: BỎ ở studio, thuộc bước render final.
- Adjustment layer: SẮP LÀM dạng Adjust theo shot; lớp phủ ngang nhiều shot thì chưa.
- Group, compound clip: BỎ, phim ít clip. Chọn nhiều bằng khung (kéo từ chỗ trống, Ctrl hoặc Shift để thêm): CÓ, một khung đi xuyên hàng Camera, keyframe và âm thanh; trên hàng Camera khung chọn nguyên khối shot nó chạm (cùng mọi kim cương trong khối) như CapCut chọn clip, bấm từng kim cương để chọn lẻ. Kéo một thứ đã chọn thì mọi thứ đã chọn ở các hàng khác chạy theo; Delete, Ctrl+C và Ctrl+V cũng làm cho cả nhóm, một lần undo.

## Tầng 5: Nâng cao

- Keyframe graphs, easing: CÓ.
  - Tab Speed: preset mang đúng tên CapCut (None, Ease In, Quad In...) và đồ thị bezier tự kéo; đồ vật cũng có ô ease.
  - Lệch: CapCut sửa ease ngay trên clip mở rộng, studio sửa ở tab Speed. Ease cho các bước của Steve: SẮP LÀM (mc-actor).
- Speed curve, ramping: CÓ cho camera (đường vàng trên hàng Camera); ramp thời gian cả phim: SẮP LÀM cùng Freeze frame.
- Masks, feathering: BỎ.
- Color curves, HSL, color wheels: chưa làm, xét sau khi có Adjust theo shot.
- Motion tracking: BỎ, AI gắn nhãn thẳng vào vật trong cảnh.

## CapCut có, file 95% không ghi, studio đã làm

- Color oscilloscope: RGB parade, RGB waveform, vectorscope ở ⋯ Settings > Heavy.
- Giao diện: tab đang mở chữ xanh ngọc kèm gạch mỏng (gạch là dev chọn, CapCut không có); thứ đang chọn viền trắng trên mọi hàng (clip, khối shot, kim cương); nền các hàng phẳng một màu như CapCut, không sọc.
- Thanh Overview (cả phim) đã BỎ vì CapCut không có; điện thoại nằm ngang dùng thước giờ thay. Hàng Camera nằm trên cùng, dưới thước giờ (dev chọn), rồi Text, Voice, Action, keyframe, âm thanh.
- Hàng Shots gộp vào hàng Camera: tên shot nằm trên khối camera như clip của CapCut, dưới thước giờ chỉ còn dải mỏng cho vạch đỏ (cảnh đứng yên quá 6 s) và note. Phim không có hàng Camera vẫn giữ hàng Shots.
- Track âm thanh: bấm tên track chọn mọi clip của nó, nhấp đúp (F2) đổi tên, thả clip vào dải dưới cùng tạo track mới, track rỗng tự mất.
- Chọn clip: Ctrl+A chọn mọi clip, [ và ] chọn mọi clip bên trái/phải playhead, chuột phải clip có menu.
- Bấm chỗ trống ở bất kì hàng nào: playhead nhảy tới đó và bỏ chọn mọi thứ, như CapCut (Shift hoặc Ctrl: giữ chọn). Bấm khoảng trống cột tên track cũng bỏ chọn; bấm đúng vạch playhead là kéo nó.
- Toàn màn hình: Ctrl+Shift+F, Esc thoát.
- Trên điện thoại: thanh công cụ và hàng tab cuộn ngang như CapCut mobile.

## Riêng của studio (CapCut không có)

- Note ghim lên hình bằng chuột phải (điện thoại: chạm) và vẽ tay (D), danh sách note kiểu Frame.io, AI đọc rồi sửa phim. Chuột trái trên hình là chọn (đồ vật, chữ) như CapCut.
- Giữ chuột phải kéo trên hình là vẽ note, thả tay thì đoán hình như Excalidraw draw-to-shape: thẳng thành mũi tên, khép kín 4 góc thành hộp, còn lại giữ nét tay (app/notes/shape.ts). Đoán sai thì Ctrl+Z.
- Chữ của note hiện ngay dưới pin (sát đáy thì lên trên), một dòng, dài thì "…". Menu vẽ đang mở thì 1 2 3 4 là Pen, Arrow, Box, Path.
- Free camera kiểu Minecraft (F), hoặc giữ chuột trái kéo trên hình là vào free camera và xoay luôn từ đúng góc đang nhìn; Shift+K lưu khoá từ góc đó, Alt+C copy góc camera thành một dòng chữ để dán vào note.
- Chụp hình so sánh (Shift+\, giữ \ để xem lại), chip phương án A/B/C/D.
- Các lệnh tự kiểm (CHECK=motion, seen, touch, slide; framecheck) ghi trong AGENTS.md gốc của monorepo.
- Trang phát tiếng qua cùng kiểu limiter với mix.py (app/sound/brickwall.ts), nên tai nghe và đồng hồ khớp bản final: đo sealed-room lệch ffmpeg 0.1 LUFS, đỉnh 0.2 dB.
- Âm ở vết cắt: chuột phải khối shot > Sound at the cut (hoặc tab Camera > Cut sound), 5 combo riser, whoosh, impact, downlifter đặt theo điểm nhấn của chính file: riser tắt đúng vết cắt, whoosh to nhất ở đó, impact rơi vào khung đầu shot mới. Một Ctrl+Z gỡ cả combo; bộ âm CC0 lấy bằng get_sfx.py sweeteners.

## Panel bên phải và thanh timeline của CapCut 9.7 (ảnh dev chụp 9/11/2026)

Từng mục dev chụp trên máy, AI tự chọn làm hay bỏ theo lời dev.

### Chọn clip âm thanh (Basic | Voice changer | Speed)

- Volume, Fade in, Fade out: CÓ. Keyframe ◁◇▷ cho Volume (tăng giảm âm lượng theo thời gian trong một clip): SẮP LÀM, mix.py cũng phải theo.
- Normalize loudness (đưa clip về một mức chuẩn): SẮP LÀM, một nút đo file rồi đặt Volume.
- Enhance voice, Reduce noise, Isolate voice, Video translator: BỎ, giọng ElevenLabs đã sạch và không có video quay.
- Fill channel: BỎ, đã có Pan và file mono vốn ra cả hai bên.
- Voice changer: SẮP LÀM (quyết định 7).
- Speed của clip (tốc độ, độ dài, Change audio pitch): SẮP LÀM, để làm chậm tiếng cọt kẹt hay tiếng bước chân cho nặng.

### Chọn shot (CapCut gọi là clip video: Video | Audio | Speed | Animation | Adjust | AI stylize)

- Video > Basic (Transform, Blend, Stabilize, Enhance quality, Reduce image noise, Optical flow, AI remove, AI expand, AI remix, Eye contact, Lip sync, Relight), Remove BG, Mask, Retouch: BỎ, cảnh 3D để máy quay quyết khung, tab Camera thay Transform.
- Audio của shot: BỎ, shot không mang tiếng, tiếng là các track riêng.
- Speed: Curve CÓ dạng tab Speed của camera; Standard (nhân tốc độ) và Velocity effects: SẮP LÀM cùng speed ramp và freeze frame.
- Animation In/Out/Combo: CÓ.
- Adjust > Basic: SẮP LÀM, ưu tiên 3 (Adjust theo shot), đúng bộ thanh của CapCut: Temp, Tint, Saturation; Exposure, Contrast, Highlight, Shadow, Whites, Blacks, Brilliance; Sharpen, Clarity, Particles, Fade, Vignette. Kèm LUT và nút Save as preset, Apply to all.
- Adjust > Auto adjust, Color match, Color correction: BỎ, là AI trả phí của CapCut.
- Adjust > HSL (8 màu, Hue, Saturation, Brightness), Curves (Luma, R, G, B), Color wheel (Primary): SẮP LÀM sau Adjust Basic.
- Adjust > Mask, AI stylize: BỎ.

### Thanh timeline

- Select và Split mode, Undo, Redo, Split, Delete left, Delete right, Delete: CÓ.
- Auto snapping (S), Preview axis (Shift+P), Zoom to fit, Zoom out, thanh trượt zoom, Zoom in: CÓ.
- Main track magnet (Shift+Backspace), Linkage (Ctrl+L): SẮP LÀM cùng Ripple (quyết định 4).
- Record voiceover (micro): BỎ, giọng đọc làm bằng ElevenLabs.
- Các nút còn lại sau Delete trong ảnh (6 biểu tượng): chưa xác minh tên, dev chụp tooltip thì AI xếp tiếp.
- Đầu track video của CapCut (khoá, ẩn, tắt tiếng, Cover): track âm thanh đã có Mute, Solo, Lock; hàng Text chưa có Lock và Hide (SẮP LÀM); Cover: BỎ, thumbnail làm ngoài studio.
