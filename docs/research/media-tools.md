# Công cụ media cho AI

Ưu tiên miễn phí, chạy local trên Windows với RTX 2060 6 GB; CLI giúp AI tự do sáng tạo, số đo không quyết định thay ý đồ phim. Giữ nguồn và bằng chứng từng lượt, không tự xóa dữ liệu.

## Triển khai

| Hạng mục | Tình trạng | Còn lại |
| --- | --- | --- |
| PySceneDetect | Đã nối CLI, help/skill; test cut, fade, đoạn riêng, không cut, hết giờ và giữ dữ liệu cũ đạt | Hai reviewer vòng 6 đều PASS, không còn Critical/Required |
| Nghiên cứu công cụ | Hai nghiên cứu độc lập và thảo luận đã thống nhất chọn lọc bên dưới | Benchmark riêng trước khi thêm backend/model |
| Triển khai mở rộng | Đang xử lý toàn bộ danh sách giữ lại theo yêu cầu mới, không dừng ở báo cáo | Hoàn tất từng công cụ hoặc ghi bằng chứng không phù hợp; hai review mỗi nhóm |
| RapidOCR | Đã cài CPU, nối CLI/help/skill/catalog; clip thật, ảnh Việt/Anh và blank đã kiểm; hai review vòng 2 PASS, mỗi bên 67 test | Giữ frame/score vì dòng Việt bị mất dấu/chữ, không coi OCR là nhãn chuẩn |
| Nền media CLI | Đã có list/doctor/setup, môi trường riêng, timeout dọn cây process và bằng chứng mỗi lượt; hai review PASS | Mở rộng backend kế tiếp, không dừng ở nhóm OCR |
| Native CPU | Đã nối media CLI cho DeepFilterNet, CED, FluidSynth, Chromaprint, Kokoro; chạy source thật, MIDI và voice; installer kiểm SHA-256 và giữ notices | Đồng bộ catalog/help, review nhóm native |
| Caption/vision local | MiDashengLM Q4 và SmolVLM2 Q8 đã chạy CPU qua API JSON local, server tắt sau job | Model nhỏ trả câu chưa chắc đúng và đã bịa tên game; chỉ là gợi ý chưa xác minh, không thay bằng chứng gốc |
| Review native vòng 1 | Reviewer 1 bắt ghi đè khi gọi worker trực tiếp, reviewer 2 bắt clone HEAD trùng pin chưa checkout; đã sửa và thêm regression fail trước/pass sau | CED truyền threads thật, fingerprint từ chối length 0; đang review lại độc lập |
| Review native vòng 2 | Reviewer 2 PASS; reviewer 1 bắt resume clone chưa checkout và file giải nén dở chặn lần sau | Đã sửa checkout và giải nén atomic từng file; regression gây ngắt thật rồi chạy tiếp, tăng test validation theo góp ý reviewer 2 |
| Review native vòng 3 | Hai reviewer đều PASS, mỗi bên 42 test và nhiều probe native; hash nguồn và deadline/server đã kiểm | Đã sửa thêm Optional của reviewer 1: doctor kiểm receipt hoàn tất và kích thước asset, không báo sẵn sàng vì file tải dở tồn tại |
| SDK âm thanh | Đã cài riêng Beat This, Pedalboard, OTIO, sherpa-onnx, Basic Pitch, Audio Separator và PE-A qua Transformers | Nối adapter, model và kiểm dữ liệu thật; chưa gọi là đã tích hợp xong |

## Đã kiểm chứng

| Công cụ | Dùng làm gì | Chọn và giới hạn | Nguồn |
| --- | --- | --- | --- |
| PySceneDetect 0.7.3 | Dò cut hoặc fade từ video để AI đọc mốc và xem cảnh | Giữ tùy chọn: CPU, không cần model; bổ sung detector chuyên dụng, không thay earshot hay đo nhịp âm thanh | [CLI chính chủ](https://www.scenedetect.com/docs/latest/cli.html), [mã nguồn BSD-3-Clause](https://github.com/Breakthrough/PySceneDetect/tree/v0.7.3) |

## Bằng chứng triển khai

| Việc | Kết quả ngày 17/11/2026 |
| --- | --- |
| Nguồn và hoạt động | Brandon Castellano tự giới thiệu làm Google Fuchsia; GitHub API ghi 5.524 sao, HEAD 17/11, release 0.7.3 ngày 08/11 |
| Video thật | 30 giây đầu clip 0_vDVpEMPEQ: adaptive gợi ý 6 cut, content 5; đã mở ảnh và HTML, chưa có bộ nhãn chuẩn để chấm độ chính xác |
| Ca biết trước | Cut tại 1 và 2 giây đúng; khoảng 1,2–2,8 giây giữ cut tại 2; fade qua đen tại 2,033 giây, đoạn không cut trả một cảnh |
| Bảo toàn | Chạy từ phim, không đổi nguồn hay kết quả lượt trước; timeout giữ status và log, bỏ cảnh 0 frame khỏi JSON nhưng giữ CSV gốc |
| Artifact | vault/references/scenedetect/verification.json và các thư mục run-* trong worktree; dữ liệu local không commit |
| Kiểm tra code | Test CLI/help/skill/catalog liên quan đạt; lint đạt, typecheck có 55 lỗi ở file Studio không sửa trong đợt này |
| Toàn bộ test | Đã chạy nhưng dừng ở mốc 240 giây; thấy lỗi notes.test.mjs có sẵn về refs rỗng, không được coi toàn repo đã pass |
| Review vòng 5 | Reviewer 1 tìm lỗi threshold vượt 255 tạo output rồi mới báo; đã thêm regression và từ chối trước khi ghi, adaptive không bị chặn 255 |
| Góp ý cài đặt | Reviewer 2 PASS và chỉ ra extra opencv không tồn tại ở 0.7.3; đã đổi thành scenedetect==0.7.3, OpenCV vốn là dependency thường |
| Review vòng 6 | Cả hai PASS; mỗi bên chạy 31 test, mutation trong bản TEMP và CLI native với video thật, range, ảnh/không ảnh, timeout/file hỏng |
| Coverage còn lại | Reviewer 2 ghi Optional: suite mặc định chưa bắt mutation nhánh ảnh của main; giữ kiểm chứng native riêng để bộ test thường không bắt cài PySceneDetect tùy chọn |

## Repo đã có và còn thiếu

| Nhu cầu | Tình trạng và quyết định |
| --- | --- |
| Tai cho AI | Giữ earshot: tìm đoạn, nhận diện, so sánh, timeline và ảnh âm–hình; số đo mức âm không chứng minh âm gì hoặc hay dở |
| Lời nói và mix | Đã có WhisperX, GenVoice, TTS, FFmpeg, librosa và Rubber Band; không cài thêm bộ ASR chỉ vì tên mới |
| Video tham khảo | Cây Desktop đã có reference inspect giữ frame, transcript và mốc nguồn; chưa nằm trong HEAD của worktree này |
| Video không có caption | reference inspect hiện không chạy speech model; voice:align chỉ xử lý take phim, cần nối backend hiện có trước khi thêm whisper.cpp |
| Khoảng thiếu rõ | OCR có vùng chữ và timestamp, downbeat, mô tả/định vị âm local, tracking footage ngoài và trao đổi timeline; mỗi món cần media đại diện để đánh giá |

## Ưu tiên thử tiếp

Số sao và lịch sử dưới đây là ảnh chụp ngày 17/11/2026, không phải điểm chất lượng. Đã chạy PySceneDetect và RapidOCR; model tùy chọn, không tự tải khi dùng lệnh khác.

| Công cụ và nguồn | Tác giả, hoạt động | Giá trị, phần cứng và license | Quyết định |
| --- | --- | --- | --- |
| [RapidOCR](https://github.com/RapidAI/RapidOCR) | RapidAI/SWHL, model PaddleOCR của Baidu; 8.555 sao, HEAD 15/11, release 3.10.0 ngày 08/10 | OCR ảnh trên CPU Windows; code và [model trong registry](https://github.com/RapidAI/RapidOCR/blob/main/python/MODEL_LICENSES.md) Apache-2.0 | Ưu tiên kế tiếp: SDK xuất JSON kèm frame, thời điểm nguồn, vùng chữ và điểm model; CLI hiện in đối tượng Python, lý lịch founder ngoài dự án chưa xác minh |
| [Beat This!](https://github.com/CPJKU/beat_this) | Foscarin/Schlüter/Widmer, JKU, ISMIR 2024; 488 sao, HEAD 28/05, release 1.1.0 ngày 14/04 | Beat và đầu ô nhịp; CLI CPU/CUDA, code và weights MIT, dữ liệu huấn luyện có quyền riêng | Thử trên BGM thật để so với librosa; không ép mọi tiếng nói thành một BPM |
| [Audio Separator](https://github.com/nomadkaraoke/python-audio-separator) | Andrew Beveridge/Nomad Karaoke; 1.495 sao, HEAD và release 0.48.0 ngày 29/10 | CLI tách vocals/drums/bass, Windows CPU/CUDA; wrapper MIT, từng weights có điều khoản riêng | Thử model nhỏ/batch 1 khi cần stems; chưa đo VRAM và có issue về mức âm/chunk, không đồng nhất tách được với có quyền tái sử dụng |
| [DeepFilterNet](https://github.com/Rikorose/DeepFilterNet) | Hendrik Schröter và cộng sự; 5.038 sao, HEAD 06/11 chỉ sửa license, code gần trước từ 2024, release 2023 | CLI Windows CPU, WAV 48 kHz; code và weights MIT hoặc Apache-2.0 | Thử để lọc nhiễu thoại; bảo trì thưa, không chạy mặc định lên SFX/ambience vì có thể xóa âm cần giữ |

## Đồ chơi giữ lại theo nhu cầu

| Công cụ và nguồn | Uy tín, hoạt động | Dùng khi nào và giới hạn |
| --- | --- | --- |
| [PE-A-Frame](https://huggingface.co/facebook/pe-a-frame-small) | Meta Research, repo chung 2.410 sao, HEAD 12/2025; code/model Apache-2.0 | Tìm khoảng có âm mô tả, model Small 450M; SDK cần CLI mỏng, Windows/6 GB chưa thử và embedding mỗi 40 ms không có nghĩa sai số 40 ms |
| [MiDashengLM 0.6B](https://github.com/xiaomi-research/dasheng-lm) | Xiaomi Horizon/MiLM Plus; 452 sao, HEAD 24/04, Apache-2.0 | Đã build fork llama.cpp và chạy Windows CPU qua JSON local; câu thử chưa đáng tin, giữ audio/response và nhãn chưa xác minh |
| [CED.cpp](https://github.com/localai-org/ced.cpp) | Ettore Di Giacinto/LocalAI; 108 sao, HEAD 04/10, release 0.2.0 tháng 09 | CLI Windows CPU gắn 527 nhãn âm, tiny Q8 khoảng 6 MB; code MIT, weights Apache-2.0, labels CC-BY-4.0, trùng earshot nên chỉ thử nếu cần runtime nhẹ |
| [audio.cpp và Kokoro](https://github.com/0xShug0/audio.cpp) | ShugoAI/0xShug0, lý lịch Princeton tự khai chưa xác minh; 4.314 sao, HEAD 17/11, release 0.9.5 ngày 14/11 | CLI/API Windows tạo voice nháp bằng [Kokoro 82M Apache-2.0](https://huggingface.co/hexgrad/Kokoro-82M), runtime Apache-2.0; model khác có quyền riêng, Kokoro hiện không có voice Việt và timing của port không phải word alignment |
| [FluidSynth](https://github.com/FluidSynth/fluidsynth) | Peter Hanappe, maintainer Tom Moebert; 2.551 sao, HEAD 15/11, release 2.6.2 ngày 01/11 | CLI Windows CPU render MIDI thành sting/BGM tự sửa từng nốt; LGPL-2.1, cần kiểm license SoundFont riêng |
| [ACE-Step 1.5](https://github.com/ace-step/ACE-Step-1.5) | ACE Studio/StepFun; 14.875 sao, HEAD 29/08, release 0.1.8 tháng 05 | Code/model MIT, tạo BGM qua API local/SDK; model lõi khoảng 10 GB trên đĩa, guide ≤6 GB yêu cầu DiT-only/INT8/offload, chưa hứa chạy mượt cùng renderer |
| [Pedalboard](https://github.com/spotify/pedalboard) | Spotify Audio Intelligence Lab; 6.487 sao, HEAD 09/11, release 0.9.26 tháng 10 | SDK Windows CPU host hiệu ứng/VST3, GPL-3.0 và plugin có license riêng; chỉ thêm khi FFmpeg/Rubber Band thiếu hiệu ứng cần dùng |
| [Basic Pitch](https://github.com/spotify/basic-pitch) | Spotify, Bittner và cộng sự; 6.086 sao, HEAD 11/2025, release 0.4.0 năm 2024 | CLI CPU/Windows ONNX đổi melody thành MIDI; code Apache-2.0, cần kiểm riêng artifact weights, không kỳ vọng chép đúng cả bản phối |
| [llama.cpp và SmolVLM2](https://github.com/ggml-org/llama.cpp/blob/master/docs/multimodal.md) | ggml/Hugging Face; runtime 135.418 sao, cập nhật hằng ngày | CLI/API Windows CPU/CUDA mô tả frame; runtime MIT, model 500M Apache-2.0, số VRAM 1,8 GB là tác giả công bố và cần giữ ảnh để kiểm câu trả lời |
| [TAPIR/TAPNext](https://github.com/google-deepmind/tapnet) | Google DeepMind, Carl Doersch và cộng sự; 2.267 sao, HEAD 02/11 | Code/checkpoint được liệt kê Apache-2.0, SDK tracking điểm; Windows/6 GB chưa thử, cảnh tự dựng nên đọc tọa độ trực tiếp từ Three.js |
| [Roboflow Trackers](https://github.com/roboflow/trackers) | Roboflow, Joseph Nelson/Brad Dwyer; 4.006 sao, HEAD 16/11, release 2.7.0 ngày 05/11 | CLI tracking bbox/MOT, Apache-2.0; chỉ chọn detector weights miễn phí như RF-DETR Nano, chưa chứng minh nhận Minecraft hay mức RAM thực tế |
| [OpenTimelineIO](https://github.com/AcademySoftwareFoundation/OpenTimelineIO) | Pixar/Academy Software Foundation; 2.093 sao, commit code mới tháng 11 | CLI/API Windows CPU, Apache-2.0; giữ cho handoff NLE, adapter ngoài OTIO cần riêng và không tự dịch draw(t)/speed ramp/hiệu ứng |
| [Foley](https://github.com/Soverance/Foley) | Soverance Studios; 3 sao, nhiều commit thực tháng 11, chưa release/cam kết hỗ trợ | CLI/MCP, SQLite và index tiếp tục được, Windows CPU; code MIT, CLAP Apache-2.0/PANNs CC-BY-4.0, chỉ thử nếu kho lớn làm find + earshot bất tiện |
| [Chromaprint](https://github.com/acoustid/chromaprint) | Lukáš Lalinský/AcoustID; 1.427 sao, HEAD và release 1.6.2 ngày 15/10 | fpcalc Windows CPU dò bản nhạc gần trùng, LGPL-2.1 tùy dependency build; không tự có database tên bài và không chứng minh bản quyền |
| [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) | K2, Fangjun Kuang; 16.005 sao, hoạt động hằng ngày | CLI Windows CPU cho speech/VAD/diarization, runtime Apache-2.0 nhưng model riêng; giữ làm backend dự phòng, tránh cài chồng WhisperX/earshot |
| [BWF MetaEdit](https://github.com/MediaArea/BWFMetaEdit) | MediaArea/RiceCapades, FADGI/Library of Congress; 72 sao, HEAD tháng 09 | CLI Windows CPU đọc metadata/checksum âm, code hướng public domain và notices riêng; dùng đọc/export trước, không tự sửa cả vault |

## Hoãn hoặc bỏ khỏi mặc định

| Nhóm | Lý do cụ thể |
| --- | --- |
| [Music Evidence Engine](https://github.com/ALittleLov/music-evidence-engine) | 0 sao, release 0.1.5 ngày 15/11, background chưa xác minh và nhiều phép đo trùng; manifest ghi Demucs weights MIT nhưng [upstream nói quyền weights chưa rõ](https://github.com/adefossez/demucs#license), notices YAMNet cũng lệch registry |
| Demucs gốc, AudioSep, All-In-One | Demucs gốc đã archive; AudioSep HEAD 2024, All-In-One HEAD 2023 và build Windows phức tạp, không chọn làm nền tích hợp mới |
| [SAM Audio](https://github.com/facebookresearch/sam-audio), SAM3, Stable Audio Open Small | Custom/gated/community terms và phần cứng chưa chứng minh phù hợp; không suy license weights từ code MIT/Apache |
| CoTracker3, Samsone, Essentia | CoTracker phần lớn CC-BY-NC; Samsone chưa có LICENSE rõ; Essentia AGPL và model có điều khoản riêng, phần DSP hiện trùng |
| Cerul, Vindex, timecode-agent | Mặc định cloud, Apple hoặc tính năng Windows thiếu; không hợp đường miễn phí/local hiện tại |
| video-watch | Mặc định xóa audio/work sau 24 giờ trái mục tiêu giữ chứng cứ; chỉ học ý tưởng, không lấy retention |
| Sureshot Lite, Klaket, Talkthrough, VSift, Ripple, Soundbox và wrapper tương tự | Chủ yếu lặp ASR/frame/OCR/FFmpeg hoặc thêm một lớp studio; học checkpoint/provenance hữu ích, không nhập cả framework |
| Dataset/Freesound/SoundFont | Quyền từng file độc lập, có bộ gồm cả NC; model/code được dùng miễn phí không biến đầu vào thành asset được phép phát hành |

## Điểm dừng và bước sau

| Việc | Kết luận |
| --- | --- |
| Đồng thuận | Parent và hai nghiên cứu thống nhất PySceneDetect hiện tại, OCR tiếp theo; còn lại thử theo nhu cầu, không cài cả danh sách |
| Độ phủ | Đã phủ nghe/tìm/định vị/tách/dọn âm, speech, nhịp/melody, tạo voice/BGM, OCR/frame, tracking, scene, timeline và lưu chứng cứ |
| Hai lượt cuối | Mỗi nghiên cứu có hai lượt discovery không thêm khả năng phù hợp mới; kết quả còn lại là wrapper, trùng hoặc lệch cloud/hệ điều hành/phần cứng/license |
| Truy vấn tiêu biểu | maintained open source CLI local audio sound effect music analysis recognition synthesis agent Windows alternatives; open source CLI offline video frames OCR point tracking media timeline evidence interchange tools for coding agents Windows |
| Chưa biết | Chất lượng OCR trên Minecraft/chữ Việt, downbeat trên nhạc thật, artifact sau denoise/separation và RAM/VRAM khi renderer chạy cùng; không gọi đây là vét hết internet |
| Bước kế tiếp | Benchmark OCR trên frame thật và nối SDK vào workflow reference hiện có; giữ nguồn, timestamp, vùng chữ, score và model/version, không biến score thành chứng nhận đúng |

## Tiêu chí lọc

| Tiêu chí | Cách kiểm |
| --- | --- |
| Dùng được | Phân biệt CLI sẵn dùng với SDK/model; chưa chạy thì ghi chưa kiểm chứng |
| Nguồn đáng tin | Đọc nguồn chính chủ, tác giả, lịch sử commit/release và license code/model |
| Hợp repo | Chỉ giữ khả năng bổ sung rõ hoặc cải thiện được kiểm chứng; tránh lặp bộ phiên âm/mix đã có |
| Điểm dừng nghiên cứu | Phủ đủ nhóm rồi tìm tiếp hai lượt không có ứng viên phù hợp mới; hết thời gian thì ghi phần chưa xong |
