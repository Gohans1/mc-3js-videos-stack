# Transition giữa các shot

## Nguồn đã đối chiếu

[CapCut PC tutorial](https://www.youtube.com/watch?v=lvqPQSsr5h0), mốc 02:05–02:30 và 03:45: thư viện bên trái, khối xám tại điểm cắt, Name/Duration bên phải, Apply to all dưới cùng. Hình thumbnail dùng biểu tượng riêng; chỉ có bốn hiệu ứng, chưa coi là khớp toàn bộ CapCut.

[GL Transitions](https://github.com/gl-transitions/gl-transitions) 3.1.0: nhập trực tiếp Fade, FadeColor, DirectionalWipe, đều MIT của gre. Filmcraft trong Desktop/editor-refs, crates/edit/src/transitions.rs: đối chiếu ràng buộc hai đầu và kéo độ dài; không chép mã Rust.

[Three.js WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html): copyFramebufferToTexture chụp hai hình đã hậu kỳ trên GPU, FullScreenQuad ghép chúng. RenderTransitionPass nhận scene thô nên không thay được pipeline hậu kỳ hiện có.

## Nối vào phim

Shot phía sau giữ transition gồm fx và len (giây phim), tâm tại điểm cắt; len bị giới hạn bởi hai shot kề để các transition không chồng nhau. Khi split shot, chỉ nửa đầu giữ transition cũ.

film-stage/transitions bọc frame(t, shot), xuất draw.transitions cho thư viện; viewTime chỉ kẹp giờ camera vào shot, nhân vật và ánh sáng vẫn theo t. Preview, chất lượng cao và render dùng cùng hàm; Free camera bỏ qua transition.

## Bằng chứng kiểm tra

sealed-room/renders/transition-verification chứa ảnh trước/giữa/sau bốn hiệu ứng và ảnh kéo mép. Đã kiểm tra bằng trình duyệt: kéo thả, kéo độ dài, Apply to all, Delete, split, hover, lưu file và một bước undo; Black Fade/White Flash ở giữa ra toàn 0/toàn 255.
