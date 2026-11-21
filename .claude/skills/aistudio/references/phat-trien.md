# Phát triển skill aistudio

Khu này dành cho AI sửa, mở rộng hay bảo trì skill; dùng skill thì đọc SKILL.md, UI đổi làm gãy locator thì đọc khi-ui-thay-doi.md. Lệnh dưới đây chạy từ root repo, STUDIO = bun .claude/skills/aistudio/scripts/studio.ts.

## Phạm vi

Chỉ Playground chat (/prompts) và History (/library). Người dùng cấm đụng Build apps, API keys, Dashboard và các khu khác, cả trong code, doctor lẫn docs.

## Kiến trúc

| File | Vai trò |
| --- | --- |
| scripts/page-map.ts | Nơi duy nhất biết trang trông thế nào: URL, mọi phần tử theo tên (MAP), chữ đọc từ trang (TEXT), tool, mức thinking, media, đuôi video. |
| scripts/lib.ts | Hạ tầng dùng chung: Chrome, tab, agent-browser, bộ tìm phần tử trong trang, hành động AI Studio, bộ chạy bước. |
| scripts/win32.ts | Gọi user32.dll qua bun:ffi để cửa sổ ẩn không vướng người dùng (guardWindows, withForegroundLocked). |
| scripts/ask.ts | Gửi 1 prompt (0..n file) rồi lưu câu trả lời; follow-up; collect. |
| scripts/studio.ts | Mọi lệnh còn lại, nhóm theo tab, chat, cài đặt, History, sức khoẻ, cấp thấp; có doctor. |
| scripts/lib.test.ts | Test cho logic thuần không cần trình duyệt (toSeconds). |
| assets/doctor-2s.mp4 | Video test 2 giây có tiếng, dùng cho doctor và smoke. |
| references/khi-ui-thay-doi.md | Quy trình sửa khi UI đổi, mẫu thêm entry và lệnh. |

Luồng 1 lệnh: parse input (sai thì exit 2) → start Chrome → prepare tab → các bước → in dữ liệu. Mỗi bước trả về bằng chứng đọc lại từ trang, không coi click là xong.

## Nguyên tắc

| Nguyên tắc | Cách làm |
| --- | --- |
| Selector chỉ ở page-map.ts | Code khác gọi tên entry qua all/one/has; tên là dữ liệu thì dùng dynamic. Ngoại lệ đã biết: chữ Run/Stop (RUN_STATE), Google Account: (accountName), data-turn-role Model, chip tìm bằng parentElement + innerText, closest('button') quanh modelName, img alt và tên thẻ ms-*-chunk trong read. |
| Locator bền trước | data-test-id, rồi role + tên ARIA, cuối cùng mới CSS thẻ Angular. Thứ tự này lấy từ khuyến nghị locator của Playwright. |
| Hành động bằng sự kiện thật | lib đánh dấu phần tử bằng data-aistudio-target rồi gọi agent-browser click/fill, không gọi element.click() trong trang. |
| Không trạng thái ngầm | Trạng thái lâu dài ngoài trang chỉ có aistudio-tabs.json (nhãn tab → cửa sổ, slot) và profile Chrome giữ đăng nhập, cả 2 ở %USERPROFILE%\.agent-browser\profiles. Còn lại là tạm: daemon agent-browser theo nhãn, biến window.__aistudio* và thuộc tính data-aistudio-target trong trang, file trong %TEMP%, kiểu cửa sổ (khiên) trên cửa sổ Chrome. |
| Việc dùng chung đặt ở lib | ask.ts và studio.ts không chép logic của nhau. |
| Lỗi viết cho người đọc | StepError mang lý do và cách xử lý; lỗi khác là bug và in stack. |
| Text dài đi qua stdin | fill dùng batch --bail với JSON trên stdin, vì dòng lệnh Windows giới hạn khoảng 32 nghìn ký tự. |
| Kiểm tra sau mỗi lần sửa | Từ root repo: bun fmt --no-script .claude/skills/aistudio; bunx oxlint .claude/skills/aistudio/scripts --format json; bunx tsc --noEmit --strict --skipLibCheck --types bun --lib ES2023,DOM --target ES2023 --module ESNext --moduleResolution bundler .claude/skills/aistudio/scripts/*.ts; bun test ./.claude/skills/aistudio/scripts/lib.test.ts. Rồi STUDIO --tab doctor doctor, STUDIO --tab smoke smoke và lệnh vừa sửa trên trang thật. |

## Tab và cửa sổ

| Điều | Chi tiết |
| --- | --- |
| 1 tab = 1 cửa sổ | Trong 1 cửa sổ chỉ tab đang chọn là visible; tab nền bị hidden và dropdown không mở. Vì vậy mỗi nhãn có cửa sổ riêng, tab close đóng cả cửa sổ. |
| 1 tab = 1 session agent-browser | Session tên aistudio-nhãn, luôn gọi với --pin-tab. Session nhớ tab đã ghim qua các lần daemon khởi động lại; không pin thì session tự nhảy sang tab mới mở. |
| Daemon tự tắt | --idle-timeout 10m. Daemon gắn qua --cdp mặc định sống mãi; tắt rồi thì tab vẫn còn và lệnh sau gắn lại. |
| Session mới mở about:blank | Lệnh đầu của 1 session mới mở about:blank trong cửa sổ dùng gần nhất, che trang của cửa sổ đó. prepareTab đóng mọi trang trắng nằm trong cửa sổ ngoài màn hình. |
| Vị trí riêng | Cửa sổ ở left -10000, top = slot × 1200; slot bỏ qua chỗ đã có cửa sổ. Hai cửa sổ chồng khít thì Chrome báo trang bên dưới là hidden. |
| Mở ở nền | Target.createTarget với newWindow và background: không cướp focus. |
| Khiên cửa sổ | guardWindows (win32.ts) gắn WS_EX_TOOLWINDOW (không taskbar, không Alt+Tab, Win+M bỏ qua) và WS_EX_NOACTIVATE cho khung Chrome có vị trí normal ở left -10000, gỡ cho khung trên màn hình (--show). Chỉ xét khung không có owner; bong bóng và popup của Chrome đi theo khung. Chạy trong prepareTab và trước mỗi bước của runSteps. |
| Mở lại cửa sổ thu nhỏ | guardWindows mở lại khung ẩn bằng ShowWindow SW_SHOWNOACTIVATE trước khi CDP thấy trạng thái minimized. Khung --show người dùng tự thu nhỏ thì để yên; đường windowState normal của CDP chỉ còn cho nó (khi chính tab đó chạy lệnh) và cửa sổ maximized. |
| Khoá foreground | prepareTab chạy trong withForegroundLocked (LockSetForegroundWindow, API Windows làm đúng việc này) nên Chrome không kích hoạt được cửa sổ khi chuyển tab hay session mới mở about:blank. Người dùng click hoặc bấm Alt thì khoá tự mở. |
| Chuyển tab ít nhất | prepareTab đọc tab list --json, chỉ gọi tab id khi session đang ghim tab khác (nhãn mới, cửa sổ tạo lại). |
| Chrome khởi động | Start-Process (để Chrome sống sau khi lệnh shell của agent kết thúc) với --no-startup-window (không có cửa sổ đầu tiên cướp focus) và --disable-backgrounding-occluded-windows. |

## Bài học đã trả giá

| Bẫy | Đã xử lý thế nào |
| --- | --- |
| Google chặn đăng nhập trong Chrome do automation mở; cookie Chrome trên Windows không export được (App-Bound Encryption, DBSC). | Chrome thường, không cờ automation, profile riêng, cổng 9333; người dùng đăng nhập tay 1 lần. Cổng 9222 là của Tab Out. |
| Cửa sổ thu nhỏ làm trang hidden, dropdown không mở. | Đặt ngoài màn hình thay vì thu nhỏ; mở lại qua guardWindows (mục Tab và cửa sổ). |
| Cửa sổ hẹp (đã thấy 929px) thì AI Studio giấu bảng Run settings. | Ép 1920x1080. |
| Chat mới: click chuột vào dropdown bị ô prompt cướp focus. | Mở dropdown bằng focus rồi Enter, đợi có option rồi mới chọn. |
| Mức thinking khác nhau theo model (flash-lite: Minimal tới High, không có Extra High); tool Maps chỉ có ở 1 số model. | selectOption báo danh sách model đó có; TOOLS_SOME_MODELS cho doctor báo vắng thay vì gãy. |
| Giá trị dropdown đọc từ cả combobox lẫn danh sách option. | Đọc .mat-mdc-select-value-text bên trong combobox. |
| Nút cài đặt video bấm được nhưng vô tác dụng khi chip còn Loading; sau Save chip lại Loading để đếm token. | Chỉ bấm khi chip hiện N tokens (hoặc Agentic), có thử lại. |
| Tìm chip theo tên thì a.mp4 khớp nhầm chip x a.mp4. | Chip lấy theo thứ tự upload (nút Remove thứ n), tên chỉ để xác nhận; ask.ts kiểm ô prompt trống trước file đầu và đủ số file trước khi gõ prompt. |
| Bật Agentic thì dialog ẩn FPS, Start, End; chip hiện Agentic thay số token. | ask.ts cấm trộn --agentic với --fps/--start/--end; chip coi Agentic là sẵn sàng. |
| AI Studio viết lại thời gian khi lưu (0m2s thành 2s). | So bằng toSeconds, có test. |
| Dialog video từ chối giá trị thì chỉ hiện chữ trong p.dialog-error, nút Save không đóng. | closeDialog hết giờ thì in nguyên văn dialogError. |
| Container dialog không có role=dialog. | Entry dialog dùng thẻ mat-dialog-container; mở dialog thì đợi nút Save. |
| Lúc đang chạy nút Run thành progress_activity Stop và mất .run-button-label; đọc sai thì copy nhầm suy nghĩ của model. | Coi là xong khi nút tên Run, lượt cuối là Model có text ngoài ms-thought-chunk và số lượt tăng. |
| Dừng run lúc model đang nghĩ thì lượt cuối là lượt suy nghĩ. | Lượt đó không tính là câu trả lời; báo has no answer. |
| Lượt chat được ảo hoá: ms-prompt-chunk chỉ render khi ở gần màn hình. | showTurn cuộn lượt vào màn hình rồi đợi turnBody trước khi đọc. |
| Nút options của lượt chỉ nhận click khi chuột đang trên lượt; giữa lượt cao nằm ngoài màn hình, lượt ngắn thì nút nằm phía trên lượt, toast Copied che đầu trang vài giây. | openTurnMenu tìm 1 điểm thấy được của lượt bằng elementFromPoint, mouse move tới đó, đợi nút thật sự nhận click ở tâm rồi mới bấm. |
| Lượt chỉ có video không có Copy as markdown trong menu (chỉ Delete, Branch from here). | read ghi tên file đính kèm cho lượt đó. |
| Copy as markdown dùng execCommand, ghi đè clipboard Windows (đã làm mất clipboard của người dùng 1 lần). | Bắt nội dung trong sự kiện copy ở pha capture rồi preventDefault. |
| Chat mới chỉ có link khoảng 1 phút sau câu trả lời đầu. | Đợi tối đa 2 phút sau khi trả lời; còn thiếu thì --collect. |
| AI Studio nhớ công tắc Google Search sang mọi chat mới của profile, không cần Run (tool khác không nhớ). | ASK --tool search=on/off; bước run in trạng thái search. Đổi search bằng STUDIO là đổi cho mọi tab. |
| Tải lại chat đang sinh thì mất câu trả lời. | openChat không tải lại khi tab đã ở đúng chat; navigate từ chối khi đang chạy. |
| Id chat sai hay của tài khoản khác thì trang chuyển sang /prompt-access-restricted. | waitForPromptBox nhận ra và báo rõ, cùng trang đăng nhập Google. |
| Picker model tự đóng sau khi chọn, có animation; bấm Close lúc đó thì trượt. Nút Close panel nằm cạnh panel chứ không ở trong. | Đợi picker tự đóng 3 giây rồi mới bấm Close nếu còn. |
| Alias model (vd latest) có tên chứa id của model thật. | pickerItemFor so id đầu tiên trong tên mục. |
| Chat mới không có nút đổi tên (tiêu đề Playground). Tiêu đề là h1 duy nhất của trang. | renameButton thuộc trạng thái chat đã lưu; entry title dùng h1. |
| System instructions sửa trong panel không được lưu nếu chưa Run. | ask.ts --system set ngay trước khi gửi; đã kiểm: Run xong tải lại vẫn còn. |
| Prompt có CRLF thì ô prompt đọc lại thành LF, kiểm tra đọc lại báo sai. | Chuẩn hoá prompt về LF trước khi gõ. |
| Chrome mở bằng Bun.spawn chết khi lệnh Bash của agent kết thúc, kéo theo câu trả lời đang sinh. | Mở bằng PowerShell Start-Process. |
| Chrome mở cửa sổ đầu tiên là cướp focus bàn phím (kể cả với -WindowStyle Minimized). | --no-startup-window + tạo cửa sổ qua CDP ở chế độ nền. |
| Regex trong chuỗi JS chèn vào trang phải escape 2 lần (\\d, \\b); sửa bằng sed, heredoc hay python dễ làm rơi 1 dấu \ và \b thành ký tự backspace. | Sửa các chuỗi đó bằng Edit tool rồi grep lại. |
| agent-browser close trên session --cdp đóng cả trình duyệt. | Không bao giờ gọi close; đóng tab bằng CDP Target.closeTarget. |
| Cửa sổ ẩn từng giữ foreground: người dùng gõ là chữ vào trang AI Studio vô hình, Ctrl+W đóng tab. Nguồn 1: CDP windowState normal trên cửa sổ thu nhỏ (Win+D) kích hoạt cửa sổ. | Khiên cửa sổ và mở lại bằng SW_SHOWNOACTIVATE (mục Tab và cửa sổ). WS_EX_NOACTIVATE một mình không chặn được. |
| Nguồn 2: agent-browser tab id và lệnh đầu của session chưa ghim tab (mở about:blank) kích hoạt cửa sổ, chập chờn. Windows cho phép khi người dùng đã ngồi im lâu hoặc khi lệnh chạy từ chính app đang foreground (agent trong T3 Code). | Chỉ chuyển tab khi cần, và khoá foreground suốt prepareTab. Lệnh thường (eval, click, fill, tab list) và daemon khởi động lại không kích hoạt. |
| SetWindowPlacement kéo cửa sổ nằm hẳn ngoài màn hình vào 0,0 (đúng như docs Microsoft), dù showCmd nào. | Không dùng; mở lại bằng ShowWindow. Vì vậy cửa sổ ẩn bị Win+D thu nhỏ hiện thành thanh nhỏ cạnh nút Start tới bước kế tiếp. |
| Gemini từng bịa chi tiết audio của clip tổng hợp (nói tiếng bíp 1000 Hz mỗi giây, thật là 440 Hz liên tục). | Câu trả lời quan trọng phải kiểm chứng. |

## Đã thử

| Cách | Kết quả |
| --- | --- |
| Chrome headless (--headless=new) cùng profile | Không làm. Chrome 155+ vẫn gửi HeadlessChrome trong user agent (proxy.wiki 2026-10, mosaicbrowser 2026-11); giả user agent là lách luật, và rủi ro bị đăng xuất phải đăng nhập tay lại. |
| Thu nhỏ cửa sổ | Hỏng: trang hidden. |
| Cửa sổ ngoài màn hình (left -10000) | Chạy đủ mọi kịch bản trong ma trận test. |
| Start-Process -WindowStyle Minimized | Chrome bỏ qua, vẫn cướp focus. |
| --no-startup-window + Target.createTarget background | Không cướp focus, đã đo cửa sổ foreground trước và sau. |
| 2 tab chạy song song | Chạy được sau khi tách vị trí cửa sổ. Lần đầu (chồng khít) tab main báo hidden. |
| Mở menu lượt: cuộn nút vào màn hình rồi rê vào tâm nút | Hỏng với lượt ngắn vì nút nằm ngoài lượt, rời lượt là nút ẩn. |
| Mở menu lượt: rê vào giữa phần lượt thấy được | Hỏng ngay sau 1 lần copy vì toast Copied che điểm đó. Cách đang dùng ở bảng bẫy. |
| Fill text dài qua tham số dòng lệnh | Hỏng từ khoảng 32 nghìn ký tự (ENAMETOOLONG). Chuyển sang batch qua stdin. |
| 1 lần thấy foreground là Chrome sau chuỗi test dài | Đã tìm ra 2 nguồn (bảng bẫy); chập chờn vì Windows chỉ cho giành foreground trong 1 số điều kiện. |
| Chỉ gắn WS_EX_NOACTIVATE | Không đủ: Chrome tự kích hoạt cửa sổ khi CDP mở lại hay chuyển tab. |
| Chỉ gắn WS_EX_TOOLWINDOW | Hết taskbar, Alt+Tab và Win+M; Win+D có lúc vẫn thu nhỏ được (2 lần đo, 1 lần thu nhỏ). |
| WPF_SETMINPOSITION để chỗ thu nhỏ nằm ngoài màn hình | Hỏng: SetWindowPlacement kéo cửa sổ slot 1 trở đi vào 0,0, hiện ra trước mặt người dùng. |
| Trả bàn phím sau mỗi bước bằng SetForegroundWindow | Hỏng: Chrome đã giữ foreground thì Windows từ chối process khác (trả 0). |
| AttachThreadInput để ép trả bàn phím | Không làm: Raymond Chen và PowerToys đều gọi là hack. |
| LockSetForegroundWindow quanh prepareTab | Chạy: cho Chrome quyền giành foreground rồi chuyển tab, có khoá 2/2 lần giữ nguyên, không khoá Chrome giành ngay. |

## Ma trận test thật (2026-11-21)

| Kịch bản | Kết quả |
| --- | --- |
| doctor (51 kiểm tra trên các trạng thái trang) | 47 khớp candidate đầu, 4 vắng hợp lệ (alerts, dialogError, turnThought, maps trên gemini-4-neon), 0 fallback. |
| smoke: video 2 giây, Low/Low, FPS 24 | Pass, trả lời đúng 2. |
| 2 video, cắt 1s-3s, FPS 24 mỗi video, recheck | Pass, trả lời đúng cùng dài 2 giây. |
| 2 video tên x a.mp4 và a.mp4, FPS 2 | Pass, cả 2 chip 415 tokens (241 ở mặc định), recheck đúng từng video. |
| --end 0m2s (AI Studio lưu thành 2s) | Pass. |
| Giá trị video bị từ chối | Báo nguyên văn lỗi của dialog. |
| Prompt 40 nghìn ký tự qua --prompt-file | Pass, đọc lại khớp. |
| Follow-up, collect qua --chat, collect khi trang cuộn lên đầu | Pass. |
| Prompt thuần text | Pass. |
| Agentic video | Pass, đọc đúng timecode. |
| Ảnh + PDF + txt + mp3 trong 1 prompt, có --system | Pass, cả 4 câu trả lời đúng; system còn sau khi tải lại. |
| Timeout 6 giây rồi ASK --collect ở lệnh sau | Pass, lấy được câu trả lời 105 giây. |
| read chat dài nhiều lượt cao | Pass 2 lần liên tiếp, clipboard Windows giữ nguyên. |
| 2 tab song song (chat mới + follow-up) | Pass. |
| Công tắc search qua chat mới (bật rồi open new, tắt rồi open new) | Search giữ trạng thái cũ cả 2 chiều; Code execution, thinking, media thì không. ASK --tool search=off: Pass, log run báo off. |
| models, model (đổi 4 lần), set thinking/media (cả mức model không có), tool on/off, rename, system, history --search, read, tabs, tab close, chrome --show | Pass. |
| Focus (cửa sổ người dùng giữ foreground, lệnh chạy từ cây process của nó như T3 Code): thu nhỏ rồi status, Win+D, chrome --show rồi status, nhãn mới, tab close | Foreground không đổi; taskbar không còn nút Chrome ẩn; --show có lại nút, lệnh sau gắn lại khiên. Đo bằng GetForegroundWindow. |
| Thu nhỏ cửa sổ giữa lúc ASK chờ trả lời | Pass: bước copy mở lại cửa sổ không lấy focus, lưu đủ câu trả lời. |
| doctor và smoke sau khi gắn khiên (innerWidth còn 1904) | 47 khớp, 4 vắng hợp lệ, 0 fallback; smoke trả lời đúng 2. |
| Khoá foreground: cho Chrome quyền giành foreground rồi tab id, có và không khoá | Có khoá 2/2 foreground giữ nguyên; không khoá Chrome giành. Chạy lại focus e2e, doctor (51 kiểm tra, 0 fallback), smoke: Pass. |

## Giới hạn biết trước

| Giới hạn | Ghi chú |
| --- | --- |
| Không có khoá theo tab | 2 lệnh cùng lúc trên 1 tab sẽ giẫm lên nhau. Thêm khoá là phức tạp thêm, phải hỏi người dùng trước. |
| Khoá foreground chỉ phủ prepareTab | Các bước sau chỉ dùng lệnh không kích hoạt cửa sổ. Trong 1-2 giây khoá, app khác cũng không tự nhảy lên được (người dùng click vẫn được). |
| Win+D thu nhỏ cửa sổ ẩn | Có lúc hiện thanh nhỏ cạnh nút Start tới bước kế tiếp; bấm vào thì thấy trang AI Studio. |
| ASK chỉ copy lượt Model cuối | Nếu 1 câu trả lời tách thành nhiều lượt Model thì dùng STUDIO read để lấy đủ. |
| Chat đang chạy chỉ lấy được ở tab đang chạy nó | Tab khác tải bản đã lưu, không thấy phần đang sinh; có thể báo has no answer hoặc lấy nhầm câu trả lời trước. |
| history chỉ đọc các dòng đã tải ở trang đầu | Chưa cuộn hay phân trang; cần chat cũ hơn thì dùng --search. |
| 1 lần ask --end 9s treo tới khi bị timeout 200 giây giết | Chạy lại 2 lần không tái hiện, cả 2 báo lỗi đúng và nhanh. Gặp lại thì xem ảnh chụp bước hỏng và log từng bước. |
| Hai file trùng tên | ask.ts từ chối, vì chip chỉ hiện tên file. |
| Xoá chat, branch, preset system instruction, schema structured output | Chưa có lệnh; xoá chat là việc không quay lại được nên phải hỏi người dùng trước khi thêm. |
| Chỉ chạy trên Windows này | PowerShell Start-Process; đường dẫn mặc định đổi được bằng env AGENT_BROWSER_EXE, AGENT_BROWSER_CONFIG, CHROME_EXE (đầu lib.ts). |

## Thêm tính năng

| Bước | Làm gì |
| --- | --- |
| 1 | Kiểm phạm vi: chỉ Playground và History. Khám trang ở tab riêng: STUDIO --tab dev ab snapshot -i, STUDIO --tab dev ab eval. |
| 2 | Thêm entry vào MAP với where đúng trạng thái (mẫu ở khi-ui-thay-doi.md). Trạng thái mới thì thêm vào Where và 1 state trong doctor. |
| 3 | Viết hàm hành động trong lib.ts nếu ask.ts cũng cần, rồi lệnh trong studio.ts (thêm dòng USAGE). |
| 4 | Logic thuần thì viết test trước trong lib.test.ts. Chạy kiểm tra như mục Nguyên tắc, chạy lệnh mới trên trang thật, thêm dòng vào ma trận test và bảng bẫy nếu gặp hành vi lạ. |
| 5 | Cập nhật bảng lệnh trong SKILL.md. Dọn tab và chat test mình tạo. |

## Mẫu thêm 1 lệnh vào studio.ts

| Phần | Làm gì |
| --- | --- |
| USAGE | Thêm 1 dòng: lệnh, tham số, việc nó làm, có --json không. |
| case trong switch | Cờ mới thêm vào options của parseArgs (strict, cờ lạ là exit 2), kiểm input trước khi đụng trình duyệt. Lệnh không cần trình duyệt thì để prelude = []. |
| Bước | add("tên bước", async () => ... return "dữ kiện đọc lại từ trang"), hành động qua click/fill/focus/upload(one("key"), "mô tả") của lib.ts. |
| Xác nhận | Đọc lại trang bằng js(...) hay pollUntil(...), sai thì throw new StepError("lý do cho người đọc"). Không coi click là xong. |
| Dữ liệu | emit(data, () => text) in ra stdout sau khi mọi bước pass; --json tự có. |
| Tuỳ chọn mới của ask.ts | Thêm vào parseArgs, USAGE, 2 chỗ từ chối tuỳ chọn ở chế độ collect, và bảng tuỳ chọn trong SKILL.md. |
