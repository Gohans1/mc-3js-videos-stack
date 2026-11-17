# Sound: place, mix, and hear it in numbers

An AI cannot hear, so it has two kinds of ears. `bun run listen` measures the mix: the narration against everything else in LU (EBU R128), each fault with its heard second. `earshot`, a CLI of its own, says what a sound is, how well it fits words, and where hits land on the picture (below).

## The sound loop

Inside a film:

```bash
bun run find rain --kind sfx                 # also bgm, mc (Minecraft) or sound (all three)
bun run sfx:get find "cat meow"              # a Freesound CC0 sound the vault lacks: pin its id in sound/sfx_list.json
bun run sfx:get                              # then fetch every pinned sound
                                             # place rows in src/timeline/audio.json (beds, sfx; scene seconds, gain in dB)
bun run check                                # wrong sound names, misspelt keys (gian for gain), lufs outside -20..-12, drive over +12
bun run mix renders/draft_video.mp4          # sound/mix.wav, and renders/draft.mp4 with it
bun run listen                               # every fault, also in renders/listen.json with what plays there
bun run at 12.4                              # the rows playing at a fault; change a gain, then:
bun run listen --at 12.4                     # the 2 s around it, next to the last listen (after a sound edit it renders the stems again first)
```

The first `listen` renders two stems at about a second per film second; later runs reuse `renders/listen_stems/` until `src/` or the film's sounds change. After a vault sound changes, run `bun run listen --fresh`.

In `audio.json`, `tracks[].gain` is a whole track and a clip's `filters` is an ffmpeg EQ chain (the studio's Inspector writes it).

A sound edit never needs a new picture: `bun run mix renders/draft_video.mp4` puts it on the draft, and `render clip` keeps every chunk (the sound timeline is not in a chunk's stamp).

## Tìm theo ý cảnh

bun run assets:semantic plan chỉ đếm catalog và in mẫu key, không gọi API hay ghi vector; build cũng chỉ xem trước nếu thiếu --yes. Chọn key hoặc manifest trước khi build --yes, đặt --max-requests, --max-seconds, --rpm và --tpm theo quota; mỗi chunk hoàn tất được lưu ngay nên chạy lại tiếp tục phần thiếu hoặc lỗi.

bun run find --semantic "<ý cảnh>" ghép thứ hạng từ khóa và vector, giữ bộ lọc catalog; câu đã cache chạy offline, --yes mới cho phép gửi câu mới. Gemini là mặc định, auto cũng dùng Gemini; OpenRouter chỉ dùng khi chọn rõ, lỗi không tự đổi provider hay luân phiên key.

Thêm --json để nhận mode, query, notes và results; khi API/index lỗi, mode là keyword-fallback và đầu ra vẫn là JSON. semantic.input cho biết đã dùng media hay chỉ text, segment là giây trên nguồn gốc; score là độ gần vector, không phải xác suất đúng, cần nghe/xem để chọn đoạn chính xác hơn.

Đặt MC_SEMANTIC_DB, MC_SEMANTIC_MANIFEST và MC_SEMANTIC_QUOTA_DB trong .env.local để build và find dùng chung dữ liệu ngoài worktree; manifest đã cấu hình bị thiếu thì dừng, không quay sang catalog khác. status phân biệt toàn catalog với phần đã xếp hàng, hoàn tất hoặc cần cập nhật; chỉ build mới kiểm lại byte media.

Các đường dẫn trong biến môi trường tính từ gốc repo, còn cờ đường dẫn tính từ nơi đang đứng. Lệnh trong phim nhận mặc định dotenv của repo, giữ ưu tiên biến đã truyền và các cờ env của Bun.

MC_SEMANTIC_DAILY_LIMIT giới hạn nội bộ, mặc định 1000 lượt mỗi ngày Pacific; mọi lần gọi kể cả lỗi, retry và câu tìm mới đều giữ chỗ trước khi gửi. --retries mặc định 2 cho lỗi tạm 429/503, giữ giới hạn lượt/thời gian; quota ngày dừng ngay, còn 429 không rõ nguyên nhân không đồng nghĩa hết quota ngày.

Giữ nguyên ledger của cùng project khi đổi --db hoặc khôi phục vector; snapshot cũ không chứng minh ngân sách hôm nay còn dư. Build/query dùng --yes mới gọi API, còn xem plan/status và tìm câu đã cache không tiêu lượt.

remove bỏ mục khỏi tìm kiếm và giữ cache để thêm lại không tốn lượt; remove --purge mới xóa cả cache, redo --part N chỉ đặt lại chunk cần sửa. bun run assets:semantic backup <file-mới.sqlite> tạo snapshot index và ledger nếu đã có, không ghi đè đích; không sao chép riêng file database đang mở cùng WAL.

Để bỏ một mục khỏi các lần build sau, xóa cả dòng nguồn trong catalog hoặc manifest; remove chỉ tác động index hiện tại. Xóa vector không hoàn lại lượt gọi đã dùng.

Tên/mô tả đi cùng media của đúng asset trong một vector; audio chia tối đa 30 giây và giữ timestamp, video không chứa nhánh âm thanh. Catalog nhập dùng preview có sẵn; FBX/GLB hoặc mục thiếu preview dùng mô tả, không tự dựng hay bịa nội dung media.

Đổi model, số chiều hoặc recipe cần database riêng; file cũ được giữ nguyên, chỉ chạy một builder mỗi database. Worktree dùng MC_VAULT_ROOT trỏ tới vault thật để đọc chung asset; CLI nhận manifest riêng để AI bổ sung hoặc thử bất kỳ nguồn nào.

Gemini free tier có thể dùng đầu vào cải thiện sản phẩm; kiểm tra quyền chia sẻ theo nguồn, đặc biệt nội dung có điều khoản hạn chế AI. Pilot nhỏ không chứng minh chất lượng cả kho; [Google nêu audio tối ưu cho lời nói](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/embeddings/get-multimodal-embeddings), luôn nghe/xem trước khi chọn và dùng Jev khi cần đánh giá khác.

## Đo chất lượng tìm kiếm

bun run assets:semantic eval scripts/evals/semantic/known-item.json --out <report-mới.json> so từ khóa, vector và kết hợp; chỉ dùng câu đã cache, không gọi API. Bộ known-item có 400 asset khác nhau từ 64 nhóm loại/nguồn; đáp án dựa trên metadata nên chỉ đo tìm đúng mục, không chứng minh hợp cảnh bằng nghe/xem.

scenes-pilot.json giữ 14 ý cảnh Anh–Việt, tương đương 28 câu có tương quan, chưa đủ kết luận chất lượng toàn kho. Tăng bộ ý cảnh độc lập và đáp án đã nghe/xem trước khi tuyên bố chất lượng; không tính bản dịch thành mẫu độc lập hay suy khoảng tin cậy từ mẫu tiện tay.

Report giữ từng câu, top 10, Hit@1/5/10, MRR@10, Recall@10, nDCG@10, độ trễ p50/p95 và tách theo ngôn ngữ/nhóm. scored loại câu thiếu cache, hit5AllCases vẫn tính chúng vào mẫu số; missingCatalog/missingEmbeddings cho biết phần kho chưa sẵn sàng.

complete chỉ báo query và ID sẵn sàng, không xác nhận chất lượng hay byte media hiện tại. catalog.definitions so metadata với catalog hiện tại, có thể khác manifest có chủ đích; build kiểm lại nội dung trước khi so phiên bản.

Để bổ sung cache, dùng query --yes cho đúng query trong bộ case, giữ ledger và hạn mức của project; chạy lại eval sau mỗi đợt embedding. Đầu ra mới không ghi đè report cũ, thiếu dữ liệu vẫn lưu report và exit 1; thời gian eval không gồm API hay nạp catalog, không dùng để quảng cáo tốc độ tìm câu mới.

Chỉ số theo [Sentence Transformers](https://sbert.net/docs/package_reference/sentence_transformer/evaluation.html); nhãn chỉ liệt kê mục đã biết đúng, các lựa chọn chưa chấm vẫn có thể phù hợp. Giữ nguyên bộ case khi so hai phiên bản và ghi rõ khác biệt catalog/index khi so dịch vụ khác.

## Ears: earshot

`earshot` runs locally on the CPU (`earshot -h`, `earshot <command> -h`). Every call loads its models first, about 20-40 s, so put every candidate in one call; a file it has heard before is cached, and the same call again takes about 2 s. Quote its numbers when you report ("z +3.1 strong", "p_real 0.96"). Its own manual, with every loop and how far to trust each number, is the installed earshot agent skill; open its SKILL.md rather than requesting an mc-films guide.

| You want                                    | Run inside the film                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The best of several candidates              | `earshot rank "<what it sounds like>" <file> <file> ... --top 3`; `bun run find` prints this line with the paths                                                                                                                                                                                                                                                                                                                                                                           |
| What one sound is                           | `earshot describe <file>` (`bun run find --show <id>` prints its path)                                                                                                                                                                                                                                                                                                                                                                                                                     |
| The clean moment inside a long file         | `earshot find <file> "<what it sounds like>" --top 3`; its start and end become the row's `start` and `length`                                                                                                                                                                                                                                                                                                                                                                             |
| A real recording, or code-made              | `earshot realness <file>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| What plays when, and the hits on the cuts   | `earshot timeline renders/draft.mp4 --cues renders/cuts.json --from 25 --to 40 --detail low` (after `bun run mix renders/draft_video.mp4`; `draft_video.mp4` has no sound); `bun run listen --at <s>` prints it for `s`                                                                                                                                                                                                                                                                    |
| The same as a picture                       | `earshot sheet renders/draft.mp4 -o renders/ear_sheet.png --cues renders/cuts.json --from 25 --to 40`, then open the PNG                                                                                                                                                                                                                                                                                                                                                                   |
| Did a sound change help                     | Copy `renders/draft.mp4` to `renders/before.mp4`, `bun run mix renders/draft_video.mp4`, then `earshot ab renders/before.mp4 renders/draft.mp4 --query "<the sound you want>" --a-start 30 --a-end 36 --b-start 30 --b-end 36` (the stretch you changed: mix brings the whole film back to its `lufs`). "Nearly the same" with nothing measured means the change is small inside the mix: compare `over bed` of that hit in `earshot timeline` of both files, or `bun run listen --at <s>` |
| A sound neither the vault nor Freesound has | `earshot sfx list --kind hit`, then `earshot sfx render <id> -o sound/sfx/<name>.wav` (`--pitch E2` or Hz, `--dur` seconds): `<name>` is now this film's sound for `audio.json`. The file is written even when its `checks:` are not `clean`: then try `--dur` or another id                                                                                                                                                                                                               |
| Is earshot set up                           | `earshot doctor`; not on PATH: `INSTALL.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                |

Describe the sound, not its job, and in English: "a heavy iron door slamming in a stone room", not "the door for the chase". Its models learnt from English captions; a query in another language ranks differently and earshot does not warn. earshot says what a sound is, never whether it is right for the story: that call is the creator's. Never run `earshot llm`: it uploads the audio to Google, and only the creator can agree to that.

Pipeline mặc định dùng audio.json và bun run mix để studio và check đọc cùng dữ liệu; real-sound vẫn hữu ích cho nguồn âm, giấy phép và thiết kế cue. Có thể dùng mixer, master hoặc mux riêng, nhưng phải nối đầu ra vào cách preview của phim và tự xem/nghe, kiểm chứng phần công cụ tích hợp không đọc được.

## How mix sets the loudness

The mix goes through `drive` dB into a limiter, then one linear gain brings it to `lufs` (-14), or only as far as its true peak stays under -1.5 dBTP (room for the AAC encode). Never a dynamic loudness pass: it lifts every quiet stretch, room tone up to the voice (AES TD1004).

When mix says it stopped short, it names the `drive` value to set: the limiter takes the peaks and each dB of drive buys a third to a half of one. Raising the narration barely helps, its own limiter holds it. Past +12 the hits flatten into the bed, so `bun run check` warns; listen whether they still land. A film 2 LU under -14 only plays a little quieter on YouTube.

## Targets

| Measure                 | Target                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------- |
| Narration over the rest | 15 LU or more is clear; 8-15 thin; under 8 words get lost (AES TD1009)             |
| Beds under narration    | Narrated documentaries keep beds 24-31 LU under the voice                          |
| A sound effect          | Close to the voice, about 10 LU under, never over it                               |
| A hit you should hear   | About +6 dB over the second before it, or it is `BURIED`                           |
| Level at a cut          | A jump over 6 LU is flagged; fine when the story calls for it                      |
| One speaker (a phone)   | The narration loses at most 1.5 dB, the rest 6 dB, or it is `MONO`                 |
| The upload              | -14 LUFS, true peak -1 dBTP or under (YouTube turns louder down, never quieter up) |

## listen's faults and their fixes

| Line                           | Fix                                                                                                                   |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `LOST`, `THIN`                 | Lower the bed or sound playing there (listen names the rows), or duck the bed under the voice                         |
| `LOUDER`, `LOUD with no voice` | Lower the rest in that stretch; the voice is not the problem                                                          |
| `BURIED`                       | Raise that sound's gain, or lower the bed under it                                                                    |
| `MONO`                         | Drop a stereowiden or extrastereo filter, swap a recording with a flipped side, or lower stems driven far over 0 dBFS |
| `near silence`                 | Dead air; keep it only when meant                                                                                     |
| `abrupt end`                   | Fade the beds out before the end                                                                                      |

Âm nằm trong vault chưa đủ chứng minh quyền dùng: đọc SOURCES.json và giấy phép của đúng asset trước khi phát hành, ghi credit khi cần. Minecraft music có contentId có thể bị claim; bun run listen --sheet vẽ spectrogram và mức âm qua earshot sheet.
