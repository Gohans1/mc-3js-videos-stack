# FFmpeg cho CLI của AI

## Phạm vi và quyết định

Đối chiếu ngày 18/11/2026 bằng ba research độc lập, clone mã nguồn và Exa; tư vấn cũ đúng hướng nhưng bỏ sót nhiều cờ nhỏ. Dùng backend tùy chọn media ffmpeg, giữ CLI phim và quyền viết code tự do.

| Mục | Quyết định |
| --- | --- |
| Nguồn | [v3.10.1](https://github.com/kajisho5/ffmpeg-skill/tree/v3.10.1), commit f1c97cbffeac71b8fdfca2f790ceb00db3bcce65, MIT. Mã sửa cục bộ có hash riêng trong upstream.json |
| Không nhập | SKILL.md, installer npm, MCP server và quy trình bắt buộc; description/examples lấy từ SKILL trong contract vì thế rỗng |
| Tổ chức | Một backend chứa 42 công cụ gốc, không tạo 42 alias cấp cao; adoption.json ghi rõ từng công cụ bổ sung hay trùng |
| CLI | media ffmpeg list --json cho bảng gọn; contract -- --static --tool cut đọc parser thật; tool --help giữ help gốc |
| Giảm context | schema <tool> chỉ trả một ToolSpec, giữ input schema/reencode/dry-run/unverified mà bỏ phần global dài |
| Đầu vào | Sau dấu -- là toàn bộ argv gốc; --out/--minutes trước dấu -- chỉ điều khiển bằng chứng và hạn giờ |
| Bằng chứng | Mỗi job có thư mục riêng, native.json giữ stdout nguyên bản, process.log giữ stderr; giữ cả thất bại và file đã hoàn thành |
| Đầu ra | Native -o/--output theo help từng tool; mặc định có thể nằm cạnh nguồn, không hứa tất cả file nằm trong thư mục bằng chứng |
| Kiểm chứng | Chưa coi exit 0 là đúng hình/âm; đọc verified, verification, unverified, warnings, fallbacks, skipped và source_carry |

## Đồ chơi đáng dùng

| Nhóm | Giá trị lớn và chi tiết nhỏ | Giữ đường chính |
| --- | --- | --- |
| probe/check/look/report | HDR/SAR/rotation/stream, keyframe gần điểm cắt, dotted field, SSIM/PSNR, vùng/thời gian được phép đổi, safe/title guides, HTML trước/sau | reference inspect, sheet, framecheck, deliver |
| export/color | ProRes/DNxHR, alpha thẳng/premultiplied, key-fill, HDR→SDR, đổi matrix, legalize, đo YUV từng cửa sổ, size target hai pass, repair đếm lỗi | Render/mix phim |
| cut/join/silence | Smart GOP H264, VFR guard, de-click, snap theo độ tin cậy, missing/silent policy, timemap, lề trước/sau và khoảng nghỉ theo câu | Ba clock và timeline phim |
| sync/multicam | Đo offset, confidence, drift ppm; sửa trôi của hai recording, chuyển camera theo mức tiếng | Không suy ra lip-sync hoặc danh tính người nói |
| audio/loudness/waveform | Tempo kèm length-samples, chọn channel/sample-rate, downmix, waveform/spectrum tách kênh | mix/listen/earshot và model âm thanh hiện có |
| render/batch | Plan có fingerprint input và side-input, cache stage, dừng/tiếp stage, rough-cut FCPXML/EDL/OTIO | Không dịch Three.js/shader/speed curve thành project NLE |
| caption/metadata | Subtitle bật/tắt và đa ngôn ngữ, kiểm glyph/font, chapter/tag/language, gợi ý chapter | Transcript sẵn có, title Three.js và BWF hiện có |
| cropdetect/proxy/sequence | Motion centroid từng giây, black bars, proxy rẻ để decode, ghép chuỗi frame có kiểm tra | Tracking và PySceneDetect khi cần đối tượng/cut |
| fit/crop/straighten/sphere/deinterlace/denoise/stabilize/redact | Sửa footage nhập ngoài theo nhu cầu; mỗi cờ vẫn truy cập được qua backend | Không tự xử lý render sạch hay hủy chuyển động có chủ ý |
| background/broll/freeze/graphics/grid/insert/loop/overlay/pad/reverse/speedramp | Tiện ích footage/A-B/layer alpha; giữ cả cải tiến nhỏ trong backend | Scene code/timeline vẫn editable; speedramp gốc là từng đoạn tốc độ hằng |
| scenes/verify | scenes bổ sung tín hiệu motion/energy; verify là harness thử engine với media | Không biến thành detector mặc định hay preflight |

## Giới hạn đã thấy trong code

| Điểm | Sự thật |
| --- | --- |
| Contract | Input schema lấy từ parser; role/verification/capability metadata vẫn khai báo tay, không tự đồng bộ mọi thông tin |
| Dry-run | Có tool vẫn decode; verify bỏ qua dry-run; ASR tùy chọn có thể tải model, không dùng native dry-run làm preflight |
| JSON | json-brief giảm probe dài; export --list, probe --compact hoặc nhiều --field có thể không trả một JSON duy nhất |
| Transport nhỏ | nativeFormat phân biệt json/jsonl/text/empty; giữ stdout nguyên bản, không gán text hợp lệ thành lỗi parse |
| Bảo toàn | source_carry đo count/presence, không so từng byte/nội dung; nhiều nguồn có thể không báo; mất dữ liệu phụ có thể không đổi verified |
| Màu/âm | Retag không đổi pixel; nhiều thao tác hình reencode cả audio; loudnorm linear có thể fallback dynamic |
| GPU | --hw dùng VideoToolbox Apple; doctor liệt kê NVENC không chứng minh engine dùng RTX hay driver chạy được |
| Mắt/tai | Số đo và ảnh PNG không tự hiểu nội dung; giữ OCR/vision/caption/CED/locate/Foley/earshot cho AI cần diễn giải |
| Tài liệu lệch code | gotchas/cut còn mô tả chọn audio nhiều channel, nhưng helper mới chọn V:0/a:0 ở nhiều đường; đọc lệnh FFmpeg thực tế thay vì hứa một policy chung |
| Timestamp ảnh | look gắn thời điểm yêu cầu, không hứa đó là PTS decode chính xác; giữ reference inspect cho đối chiếu mốc thật |
| Fingerprint cache | Plan lấy mẫu hai đầu 8 MiB, batch lấy mẫu 1 MiB cùng size/mtime; không gọi đó là hash toàn nội dung |
| Nguồn gốc | 7.656 sao/704 fork, tạo 03/09/2026; dự án trẻ, capability ghi experimental; sao và CI không thay kiểm media thực tế |
| CI | [15 job thành công](https://github.com/kajisho5/ffmpeg-skill/actions/runs/43775372898) thuộc commit sửa bcbe51bf; release bump skip CI, PR khác có action_required |
| Máy | FFmpeg 8.1.1 trước bản vá 8.1.2 trong [security chính chủ](https://ffmpeg.org/security.html); dev đã cho phép cập nhật, chưa coi doctor là audit đầy đủ |

## Ngoài upstream và điểm dừng research

| Nguồn | Quyết định |
| --- | --- |
| [qc-skill 1.4.0](https://github.com/kajisho5/qc-skill/tree/v1.4.0) | Đã chọn backend tùy chọn media qc, commit 9c61ed7d239b60061b164782e93c5a1008a8be91, MIT và standard library; loop seam âm/hình, subtitle/word timing, alpha/key-fill, delivery package có rule riêng |
| [media-analysis-skill](https://github.com/kajisho5/media-analysis-skill) | Style diff/highlight signal phần lớn trùng reference/pace/earshot, không hiểu ngữ nghĩa |
| audio-production/video-editing/production-agent | Không nhập typed graph/orchestrator mới vì trùng timeline/mix và áp quy trình ngoài |
| Bao phủ | Đã phân loại toàn bộ 42 parser, common runner/emit/alpha/timeline, tests, references và repo anh em gần nhất; không tuyên bố đã vét mọi công cụ media trên Internet |

## Kiểm chứng triển khai

| Batch | Bằng chứng |
| --- | --- |
| Transport/discovery | Test fail trước/pass sau; giữ native JSON riêng khỏi stderr; 72 hash vendor khớp; lint và typecheck 210+375 file đạt |
| Review R1.1 + R1.2 | Cả hai cùng bắt một Required: catalog chặn dấu --; đã thêm passthrough rõ ràng riêng field native, regression fail trước sửa và giữ guard lệnh thường |
| Môi trường | Đã cập nhật FFmpeg/ffprobe 9.0.2 qua Scoop, SHA256 khớp manifest; giữ bản 8.1.1 để đối chiếu khi cần |
| Tương thích mixer | CI bắt lỗi cờ filter_complex_script bị bỏ ở FFmpeg 9; đổi sang -/filter_complex chính chủ, năm regression mix fail trước/pass sau, giữ limiter/gain |
| Review R2.1 + R2.2 | Cả hai PASS batch 1; chạy catalog→CLI với path có dấu cách, mutation bắt lỗi guard và 29 test đạt |
| Media native | ProRes và alpha đọc lại đạt; âm đúng 96.000 sample, sync đo đúng +0,25 giây, smart cut copy 48/encode 24 frame, FCPXML/EDL/OTIO xuất có verified |
| Bằng chứng | renders/ffmpeg-verification/run-OHD1xF/verification.json và smart-result.json giữ các lượt, kể cả lần gõ nhầm --from/--to bị parser từ chối trước khi sửa thành --start/--end |
| QC | Regression native phân biệt WAV loop liên tục PASS với wrap bị click FAIL; subtitle overlap FAIL nhưng process completed, source giữ nguyên |
| QC trên Windows | R4.1 và R4.2 tái hiện request có BOM pass dry-run rồi fail khi chạy; đã thống nhất nội dung parser và giữ nguyên byte/hash request. Adapter đo mới mỗi lần, không dùng cache_policy only. |
| Review R5.1 + R5.2 | Cả hai PASS batch 2; chạy test BOM và mutation trong thư mục tạm, xác minh byte và SHA256 từng blob vendor. |
| Nguồn vendor | Đã lấy đúng byte của 72 blob ffmpeg-skill và 31 blob qc-skill tại commit pin; gitattributes giữ nguyên byte qua các checkout. |
| Phim thật | Rapier wall draft giữ nguyên SHA256 sau probe, cut chính xác 1–3 s, A/B ảnh cùng 60 frame, report HTML và ảnh guide/ink; bằng chứng tại renders/ffmpeg-verification/film-p0jWFL. |
| Mất dữ liệu đã đo | MKV có attachment cắt sang MP4 trả verified=true nhưng source_carry báo dropped attachments, SHA256 nguồn giữ nguyên; bằng chứng tại renders/ffmpeg-verification/source-carry. |
| Mốc phụ đề đã đo | QC chỉ đúng cue mở ở 1,200 s, nằm 0,200 s trong từ Hello; job completed, phép đo FAIL. Request có BOM và bằng chứng ở renders/ffmpeg-verification/qc-subtitle. |
| Doctor | FFmpeg 9.0.2 có capability yêu cầu của 42/42 tool trên máy dev; xem native.json tại renders/ffmpeg-verification/runtime-doctor. |
| Kiểm tra repo | Lint và typecheck đạt. CI song song hết hạn 15 phút; chạy lại phần thiếu và nhóm lỗi tuần tự đạt 701 pass, 1 fail, sau đó nhóm render đạt 13/13 với Chrome Headless. |
| Lỗi ngoài phạm vi | Test Notes từ chối dark: ở sidebar.tsx, đã có nguyên trạng tại snapshot trước thay đổi. Các ca timeout từ lượt song song đều pass khi chạy lại. |
| Phạm vi đo | Đã chạy các ca đại diện và film thật. Chưa chạy toàn bộ 42 operation hay mở project timeline trong NLE. |

## Rà lại công cụ kiểm phim

| Chỗ dễ lẫn | Quyết định |
| --- | --- |
| Clock và cut | Sheet, framecheck và pace dùng cùng quy ước render. File ngoài hoặc bản cũ vẫn soi được ảnh, còn các kết luận dựa trên timeline bị chặn. |
| Âm và hình nguồn | Mix tách preview khỏi draft/final và cắt audio ở mốc phim. Listen đo stem hiện tại; lệnh nghe tiếp dựa trên audio thực sự có trong draft. |
| Kết luận giao file | Deliver chọn đúng stream audio khi đo và gọi chuẩn upload là profile dự án. Khuyến nghị YouTube phân biệt với các ngưỡng thiết kế của repo. |
| Nhóm trùng | Giữ các công cụ gốc để nối timeline/Studio, giữ FFmpeg/QC để xử lý file và rule theo yêu cầu. Guide review ghi cách phối hợp mà không thêm quy trình bắt buộc. |
| Mux và track lệch | Fixture cả ba lượt thử bắt mất hình khi âm ngắn, và edit list bị gỡ làm dời A/V. Mux giờ đệm đuôi, kiểm số packet, thời lượng và clock hình trước khi thay file. |
| Bằng chứng bị lẫn | Preview AV1 mới có thư mục riêng, các lệnh soi cut dùng sidecar gắn với file. Giữ mtime_ns chính xác dạng chuỗi trong kết quả JS nếu vượt giới hạn số nguyên an toàn. |
| Nguồn để nghe lại | Listen và mix dùng chung cách tìm file âm, theo cả file đang dùng và bản ưu tiên mới trong thư mục con hoặc vault. |
| Đọc đúng hình | Dùng khoảng PTS của track hình cho MKV có đuôi audio, kích thước hiển thị cho MP4 xoay, và chặn MP4 thiếu dữ liệu trước khi báo sẵn sàng. |
| Footage MPEG-TS | Chọn strip và cửa sổ preview theo PTS kể cả GOP dài. Kiểm bằng flash đỏ–trắng–đỏ và cảnh đổi màu ở hai mốc đã biết. |
| Đo clip dưới 400 ms | Giữ true peak và báo tích hợp LUFS không khả dụng khi thiếu cửa sổ qua cổng EBU. So mức WAV và AAC theo từng file, báo rõ đuôi âm được giữ riêng hoặc bản AAC im lặng. |
| Khi file có byte hỏng | Deliver giải mã toàn bộ track hình chính và track âm được chọn, kể cả frame giữa keyframe. Mix kiểm nguồn trước khi thay draft/final, pace và framecheck dừng với packet hỏng. |
| Đo cadence và âm nhỏ | Deliver dùng PTS giải mã để tìm VFR và phân biệt clip quá ngắn với track nằm dưới cổng loudness. |
| Giữ phép đo trước | Listen chỉ thay stem và stamp sau khi tạo thành công. Mix đo điểm cuối từng track hình để preview MKV không kéo dài theo phụ đề. |
| Nguồn MPEG đời cũ | MPEG Program Stream dùng mốc giải mã cho giới hạn clip, preview và đề xuất điểm chuyển cảnh. CAMBI cần ít nhất một chiều từ 216 px; video preview vẫn được giữ nếu nhỏ hơn. |
| Dữ liệu đính kèm track | Mix đọc JSON từ ffprobe để nhận đúng MP4 có góc xoay và MPEG-2 có side data. Deliver xác định khoảng audio MPEG từ timestamp packet. |
| Nguồn thiếu packet PTS | Sheet đọc timestamp từ frame giải mã nếu packet không cung cấp đủ mốc, đã đối chiếu bằng AVI và MPEG-2 Program Stream. |
| Tìm lời và mở hình | Chế độ chỉ transcript vẫn sinh lệnh mở frame nếu đọc được mốc hình. Cận đầu và cuối in ra dùng được cho sheet và reference. |
| Lời sau khi hình kết thúc | Reference dùng khoảng file để tìm lời và chỉ lấy ảnh trong phần hình. Cue sau hình vẫn giữ nguyên lời; cận file lấy từ các track thực để không nhầm thời lượng MKV/MPEG. |
| Tìm điểm chuyển cảnh | Scenes tìm PTS khớp mốc detector trong sai số làm tròn, lọc theo khoảng yêu cầu và giữ CSV gốc. JSON ghi chỉ số frame thật tại cận đã xác minh. |
| Ngữ cảnh detector | Scenes quét toàn file để giữ quyết định về khoảng cách tối thiểu và gộp flash. Cận yêu cầu lọc cut và ảnh sau khi quét. |
| Ảnh từng cảnh | Gallery lấy frame đang hiển thị theo PTS trong phần cảnh được yêu cầu. Nếu chưa xác minh được cận cảnh, JSON giữ ước lượng và ghi lý do thiếu ảnh. |
| Chạy lại bằng chứng | Lệnh tiếp nối của reference kiểm SHA-256 để không ghép lời đã lưu với file mới cùng đường dẫn. Cửa sổ tìm cut đọc đủ hai frame trước cận đầu để giữ lịch sử độ đổi hình. |
| Nguồn lỗi | Scenes kiểm packet và giải mã toàn track hình chính bằng FFmpeg trước khi nhận cut. Khi có lỗi, JSON giữ chẩn đoán và bằng chứng đã tạo. |
| Đo sát mốc | Sheet/reference chọn frame theo PTS ở độ chính xác của mốc in ra. Kiểm onset trên audio thật nếu cần xác nhận lệch nhỏ hơn một frame. |
| Đường dẫn Unicode | Scenes in đường dẫn và ghi log PySceneDetect bằng UTF-8, kể cả Windows đang dùng bảng mã ANSI. |
| Đuôi hình VFR | Mix, sheet, reference và deliver dùng mốc packet khi duration của track nằm trước frame cuối. Ca stream copy giữ tiếng hit ở giây preview 1,870 sau khi bù trễ limiter. |
| LUFS quanh mốc | Listen ghi rõ mỗi dòng gộp phép đo LUFS lăn 400 ms, có thể chứa âm trước cận dòng. Đo trên đoạn audio đã encode để chốt mốc bắt đầu. |
| Cue sát cuối phim | Limiter bù độ trễ và xả hết mẫu giữ trong bộ đệm. Ca hit trong 5 ms cuối được kiểm trên WAV master và AAC. |
| Mốc đầu và tỷ lệ hình | Mốc đầu lấy từ PTS thực; tỷ lệ pixel lấy từ metadata frame giải mã. Overview và strip đệm viền trước khi ghép để giữ tỷ lệ hiển thị qua từng mốc đổi format. |
| Fixture CAMBI | Gradient đứng yên và seed cố định cho hạt nhiễu. Hai lần đo có cùng hash nguồn, preview và mức tăng 8,9 điểm. |
| Preview đổi format | Deliver báo PTS cần chia khoảng khi nguồn đổi kích thước, tỷ lệ pixel hoặc format màu. Cửa sổ một phía được tách lossless trước khi lấy mẫu và kiểm đủ các mốc của lưới. |
| Kiểm hình qua remux | Mix so PTS và số packet, giữ cả ảnh bìa. Framecheck xác định flash theo khoảng giữa các PTS lân cận. |
| Pin ngoài khoảng hình | Reference giữ mốc, cue và lý do thiếu ảnh bên cạnh các ảnh hợp lệ. Với Matroska, duration của track chỉ sửa sai số khi khớp khoảng packet trong một đơn vị timestamp. |
| Audio đổi format giữa file | PCM trung gian giữ các kênh và đọc qua gói sau khoảng im để giữ mốc MPEG-TS. ADTS và MP3 thô dùng mốc theo thứ tự mẫu khi đổi rate. |
| Đường dẫn Unicode | Preflight, worker và SDK chạy trực tiếp đều xuất UTF-8, kể cả khi Python thừa kế code page CP1252. |
| Bảo toàn khi replay audio | Lệnh replay giải mã vào file tạm rồi chỉ xuất sang đích chưa tồn tại. Đối chứng đổi đích thành file nguồn trả lỗi và giữ nguyên byte. |
| Lát effects cực ngắn | Đệm mẫu 0 khi số mẫu không lớn hơn số kênh để Pedalboard nhận đúng trục, rồi cắt theo độ dài yêu cầu. Highpass stereo 1 mẫu và quad 3 mẫu khớp từng kênh với cửa sổ dài hơn. |
| Nhãn loa mono/stereo | effects đóng gói WAVEX khi FFmpeg chọn header float không có mask. Replay decode chạy cả bước đóng gói để giữ PCM và nhãn loa. |
| Headroom qua plugin | Pedalboard nhận PCM float trước khi xuất 24 bit, giữ được đỉnh vượt 0 dBFS để plugin giảm gain. |
| JSON config SDK | Chấp nhận UTF-8 BOM từ PowerShell và giữ nguyên byte config khi lưu bằng chứng. |
| Mức mono qua điểm đổi format | Giới hạn tổng hệ số downmix PCM float để SDK không khuếch đại tín hiệu stereo cùng pha. Đối chứng MPEG-TS giữ mức âm và cue khi đổi 32/96/44,1 kHz. |
| Thứ tự loa | Layout chuẩn giữ vị trí loa qua PCM trung gian, WAV bằng chứng và effect.wav. Hồi quy surround kiểm cả nhãn layout lẫn tần số từng kênh. |
| Phạm vi bằng chứng âm | audioCoverage xuất cả đoạn yêu cầu và đoạn giải mã, có partial/empty khi track hết sớm. Khoảng ngắt PTS tới 2 ms có thể được gộp như jitter. |
| Nhịp từ track vào muộn | SDK đổi tần số lấy mẫu trên đồng hồ file trước khi cắt WAV bằng chứng theo số mẫu. Ca TS giữ peak ở 3,150 giây, ca MP3 44,1/48 kHz khớp từng mẫu PCM ở đầu ra 16/48 kHz. |
| Remux TS VFR | Nếu mix chặn vì đổi frame hoặc PTS, thử stream copy sang MKV và đối chiếu hình trước khi mix với cùng mốc audio. Ca thử giữ 37 frame qua MKV, đường TS sang MP4 trực tiếp chỉ giữ 36. |
| Giới hạn hình MKV/WebM | Lấy mốc kết thúc từ packet hình. Đuôi còn tiếng vẫn giữ transcript. |
| Cắt và giải mã | Cắt MP4, xuất WAV và ghép đoạn giữ tiếng trước frame hình đầu. Kiểm giải mã dùng cửa sổ riêng từng track. |
| So phạm vi thay đổi | Check --expect-changed yêu cầu cùng mốc hiển thị cho từng frame và cùng điểm hết hình. SSIM và PSNR ghép theo thứ tự frame. |
