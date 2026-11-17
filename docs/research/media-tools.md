# Công cụ media cho AI

Ưu tiên miễn phí, chạy local trên Windows với RTX 2060 6 GB; CLI giúp AI tự do sáng tạo, số đo không quyết định thay ý đồ phim. Giữ nguồn và bằng chứng từng lượt, không tự xóa dữ liệu.

## Triển khai

| Hạng mục | Kết quả | Giới hạn |
| --- | --- | --- |
| Tổng kết | Đã nối 19 profile media và PySceneDetect, chạy tại cả worktree lẫn Desktop bằng môi trường riêng | Công cụ tùy chọn, không ép quy trình sáng tạo hay tự sửa timeline |
| CLI cho AI | list/doctor/setup, native config/model, help/catalog/skill đồng bộ; mỗi run có log/artifact riêng và timeout dọn cây process | Model/cache giữ lại, không upload media; setup có thể dùng mạng để tải nguồn đã pin |
| Hình và chuyển động | OCR giữ chữ/vùng/score/frame; TAPIR bám điểm; RF-DETR/ByteTrack giữ box/ID theo timestamp thật; PySceneDetect dò cut/fade | OCR có lỗi dấu Việt, detector chưa chứng minh nhận Minecraft; tự dựng Three.js thì đọc tọa độ trực tiếp |
| Âm thanh | Beat/downbeat, VAD, melody/MIDI, tách stems, effects, denoise, fingerprint và định vị âm đã chạy CPU | Số đo/logit không phải xác suất đúng; chưa chấm chất lượng nghe tổng quát |
| Voice và mô tả | Kokoro tạo WAV local; MiDashengLM/SmolVLM2 trả text qua API local và dọn server sau job | Kokoro chưa có voice Việt; model mô tả từng bịa nội dung, luôn giữ nhãn chưa xác minh |
| Kho và trao đổi | Foley index/search/status/describe có SQLite tiếp tục được; BWF xuất XML giữ nguồn; OTIO giữ clip/range/metadata | Foley alpha tùy chọn, license từng asset riêng; OTIO core chỉ xuất .otio, không tự dịch shader/speed ramp |
| Kiểm tại Desktop | 24 lượt CLI hoàn tất, doctor 19/19; kiểm 17 hash nguồn và 6 file âm; test CLI/skill/catalog, lint và typecheck 375 file đạt | Chưa chạy lại toàn bộ CI; smoke ngắn không chứng minh hiệu năng video dài hoặc kho lớn |
| Review | Mỗi nhóm và phần tích hợp đều có hai review độc lập PASS; đã sửa Optional setup --minutes/--out và regression fail trước/pass sau | Các lỗi ghi đè, resume, kiểu dữ liệu, âm im lặng và VFR đã có hồi quy tương ứng |
| Tích hợp | Đã ghép 43 file về Desktop bằng bản sao/đối chiếu từng file, giữ index và thay đổi đồng thời | Không bulk commit/reset/stash; nhánh feature giữ riêng các commit của công việc này |
| ACE-Step | Ba lượt INT8/offload trên RTX 2060/16 GB đều không tạo WAV, kể cả tắt DCW; đã loại khỏi bộ hỗ trợ | OOM hoặc native thoát mã 5, nguyên nhân chưa xác định đủ; giữ model/log, dùng BGM có phép hoặc MIDI local |

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
| Kiểm tra code | Lượt đầu TSC có 55 lỗi baseline; kiểm chính thức hiện tại bằng Bun check tại Desktop đạt 375 file, CLI/help/skill/catalog và lint đạt |
| Toàn bộ test | Lượt đầu dừng ở 240 giây và thấy lỗi notes.test.mjs baseline; chưa chạy lại full suite, không coi toàn repo đã pass |
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

## Các lựa chọn đã triển khai

Số sao và lịch sử dưới đây là ảnh chụp ngày 17/11/2026, không phải điểm chất lượng. 19 profile media và PySceneDetect đã chạy; model tùy chọn, không tự tải khi dùng lệnh khác.

| Công cụ và nguồn | Tác giả, hoạt động | Giá trị, phần cứng và license | Quyết định |
| --- | --- | --- | --- |
| [RapidOCR](https://github.com/RapidAI/RapidOCR) | RapidAI/SWHL, model PaddleOCR của Baidu; 8.555 sao, HEAD 15/11, release 3.10.0 ngày 08/10 | OCR ảnh trên CPU Windows; code và [model trong registry](https://github.com/RapidAI/RapidOCR/blob/main/python/MODEL_LICENSES.md) Apache-2.0 | Đã nối SDK thành CLI JSON kèm frame, giây nguồn, vùng chữ và score; lý lịch founder ngoài dự án chưa xác minh |
| [Beat This!](https://github.com/CPJKU/beat_this) | Foscarin/Schlüter/Widmer, JKU, ISMIR 2024; 488 sao, HEAD 28/05, release 1.1.0 ngày 14/04 | Beat và đầu ô nhịp; CLI CPU/CUDA, code và weights MIT, dữ liệu huấn luyện có quyền riêng | Đã chạy Small0 CPU trên BGM thật; downbeat bổ sung librosa, không ép mọi tiếng nói thành một BPM |
| [Audio Separator](https://github.com/nomadkaraoke/python-audio-separator) | Andrew Beveridge/Nomad Karaoke; 1.495 sao, HEAD và release 0.48.0 ngày 29/10 | CLI tách vocals/drums/bass, Windows CPU/CUDA; wrapper MIT, từng weights có điều khoản riêng | Đã chạy Kim Vocal 2 CPU, [tác giả cho phép dùng thương mại](https://github.com/KimberleyJensen/kmdx-net_music-source-separation/issues/3); còn issue mức âm/chunk, tách được không đồng nghĩa có quyền tái sử dụng nguồn |
| [DeepFilterNet](https://github.com/Rikorose/DeepFilterNet) | Hendrik Schröter và cộng sự; 5.038 sao, HEAD 06/11 chỉ sửa license, code gần trước từ 2024, release 2023 | CLI Windows CPU, WAV 48 kHz; code và weights MIT hoặc Apache-2.0 | Đã chạy native CPU để lọc nhiễu thoại; bảo trì thưa, không tự áp lên SFX/ambience vì có thể xóa âm cần giữ |

## Đồ chơi giữ lại theo nhu cầu

| Công cụ và nguồn | Uy tín, hoạt động | Dùng khi nào và giới hạn |
| --- | --- | --- |
| [PE-A-Frame](https://huggingface.co/facebook/pe-a-frame-small) | Meta Research, repo chung 2.410 sao, HEAD 12/2025; code/model Apache-2.0 | Đã nối CLI qua Transformers và chạy Windows CPU với Small 450M; giữ logits/spans theo giây nguồn, nhịp 40 ms không phải sai số hay xác suất đúng |
| [MiDashengLM 0.6B](https://github.com/xiaomi-research/dasheng-lm) | Xiaomi Horizon/MiLM Plus; 452 sao, HEAD 24/04, Apache-2.0 | Đã build fork llama.cpp và chạy Windows CPU qua JSON local; câu thử chưa đáng tin, giữ audio/response và nhãn chưa xác minh |
| [CED.cpp](https://github.com/localai-org/ced.cpp) | Ettore Di Giacinto/LocalAI; 108 sao, HEAD 04/10, release 0.2.0 tháng 09 | CLI Windows CPU gắn 527 nhãn âm, tiny Q8 khoảng 6 MB; code MIT, weights Apache-2.0, labels CC-BY-4.0, trùng earshot nên chỉ thử nếu cần runtime nhẹ |
| [audio.cpp và Kokoro](https://github.com/0xShug0/audio.cpp) | ShugoAI/0xShug0, lý lịch Princeton tự khai chưa xác minh; 4.314 sao, HEAD 17/11, release 0.9.5 ngày 14/11 | CLI/API Windows tạo voice nháp bằng [Kokoro 82M Apache-2.0](https://huggingface.co/hexgrad/Kokoro-82M), runtime Apache-2.0; model khác có quyền riêng, Kokoro hiện không có voice Việt và timing của port không phải word alignment |
| [FluidSynth](https://github.com/FluidSynth/fluidsynth) | Peter Hanappe, maintainer Tom Moebert; 2.551 sao, HEAD 15/11, release 2.6.2 ngày 01/11 | CLI Windows CPU render MIDI thành sting/BGM tự sửa từng nốt; LGPL-2.1, cần kiểm license SoundFont riêng |
| [ACE-Step 1.5](https://github.com/ace-step/ACE-Step-1.5) | ACE Studio/StepFun; 14.875 sao, HEAD 29/08, release 0.1.8 tháng 05 | Code/model MIT, tạo BGM qua API local/SDK; model lõi khoảng 10 GB trên đĩa, đã thử INT8/offload trên RTX 2060, cả ba lượt không sinh được WAV; chưa hỗ trợ máy này |
| [Pedalboard](https://github.com/spotify/pedalboard) | Spotify Audio Intelligence Lab; 6.487 sao, HEAD 09/11, release 0.9.26 tháng 10 | SDK Windows CPU host hiệu ứng/VST3, GPL-3.0 và plugin có license riêng; chỉ thêm khi FFmpeg/Rubber Band thiếu hiệu ứng cần dùng |
| [Basic Pitch](https://github.com/spotify/basic-pitch) | Spotify, Bittner và cộng sự; 6.086 sao, HEAD 11/2025, release 0.4.0 năm 2024 | CLI CPU/Windows ONNX đổi melody thành MIDI; code và model ONNX đi kèm Apache-2.0, không kỳ vọng chép đúng cả bản phối |
| [llama.cpp và SmolVLM2](https://github.com/ggml-org/llama.cpp/blob/master/docs/multimodal.md) | ggml/Hugging Face; runtime 135.418 sao, cập nhật hằng ngày | CLI/API Windows CPU/CUDA mô tả frame; runtime MIT, model 500M Apache-2.0, số VRAM 1,8 GB là tác giả công bố và cần giữ ảnh để kiểm câu trả lời |
| [TAPIR/TAPNext](https://github.com/google-deepmind/tapnet) | Google DeepMind, Carl Doersch và cộng sự; 2.267 sao, HEAD 02/11 | Code/checkpoint được liệt kê Apache-2.0, SDK tracking điểm; TAPIR đã chạy CPU Windows, bám điểm qua 16 frame; chọn một backend, cảnh tự dựng đọc tọa độ trực tiếp từ Three.js |
| [Roboflow Trackers](https://github.com/roboflow/trackers) | Roboflow, Joseph Nelson/Brad Dwyer; 4.006 sao, HEAD 16/11, release 2.7.0 ngày 05/11 | CLI tracking bbox/MOT, Apache-2.0; chỉ chọn detector weights miễn phí như RF-DETR Nano, RF-DETR Nano/ByteTrack CPU đã chạy 16 frame người thật; chưa chứng minh nhận Minecraft |
| [OpenTimelineIO](https://github.com/AcademySoftwareFoundation/OpenTimelineIO) | Pixar/Academy Software Foundation; 2.093 sao, commit code mới tháng 11 | CLI/API Windows CPU, Apache-2.0; giữ cho handoff NLE, adapter ngoài OTIO cần riêng và không tự dịch draw(t)/speed ramp/hiệu ứng |
| [Foley](https://github.com/Soverance/Foley) | Soverance Studios; 3 sao, nhiều commit thực tháng 11, chưa release/cam kết hỗ trợ | CLI/MCP, SQLite và index tiếp tục được, Windows CPU; code MIT, CLAP Apache-2.0/PANNs CC-BY-4.0, đã nối CLI nhưng giữ tùy chọn khi cần catalog bền ngoài find + earshot |
| [Chromaprint](https://github.com/acoustid/chromaprint) | Lukáš Lalinský/AcoustID; 1.427 sao, HEAD và release 1.6.2 ngày 15/10 | fpcalc Windows CPU dò bản nhạc gần trùng, LGPL-2.1 tùy dependency build; không tự có database tên bài và không chứng minh bản quyền |
| [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) | K2, Fangjun Kuang; 16.005 sao, hoạt động hằng ngày | CLI Windows CPU cho speech/VAD/diarization, runtime Apache-2.0 nhưng model riêng; đã nối Silero VAD CPU, không cài chồng thêm bộ ASR lên WhisperX/earshot |
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
| Đồng thuận | Hai nghiên cứu đã thống nhất danh sách giữ lại; yêu cầu mới của người dùng cho phép triển khai toàn bộ, lọc tiếp bằng chạy thật |
| Độ phủ | Đã phủ nghe/tìm/định vị/tách/dọn âm, speech, nhịp/melody, tạo voice/BGM, OCR/frame, tracking, scene, timeline và lưu chứng cứ |
| Hai lượt cuối | Mỗi nghiên cứu có hai lượt discovery không thêm khả năng phù hợp mới; kết quả còn lại là wrapper, trùng hoặc lệch cloud/hệ điều hành/phần cứng/license |
| Truy vấn tiêu biểu | maintained open source CLI local audio sound effect music analysis recognition synthesis agent Windows alternatives; open source CLI offline video frames OCR point tracking media timeline evidence interchange tools for coding agents Windows |
| Chưa biết | Chất lượng OCR trên Minecraft/chữ Việt, downbeat trên nhạc thật, artifact sau denoise/separation và RAM/VRAM khi renderer chạy cùng; không gọi đây là vét hết internet |
| Bước kế tiếp | Đánh giá chất lượng trên media đại diện khi dựng phim cụ thể; benchmark tải dài trước khi chọn mặc định, giữ nguồn và không biến score thành chứng nhận đúng |

## Tiêu chí lọc

| Tiêu chí | Cách kiểm |
| --- | --- |
| Dùng được | Phân biệt CLI sẵn dùng với SDK/model; chưa chạy thì ghi chưa kiểm chứng |
| Nguồn đáng tin | Đọc nguồn chính chủ, tác giả, lịch sử commit/release và license code/model |
| Hợp repo | Chỉ giữ khả năng bổ sung rõ hoặc cải thiện được kiểm chứng; tránh lặp bộ phiên âm/mix đã có |
| Điểm dừng nghiên cứu | Phủ đủ nhóm rồi tìm tiếp hai lượt không có ứng viên phù hợp mới; hết thời gian thì ghi phần chưa xong |
