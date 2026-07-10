---
name: specrelay-workflow
description: "Điều phối quy trình SpecRelay cho thay đổi mã nguồn: làm rõ yêu cầu, trình bày plan tiếng Việt trong chat Codex, ghi plan vào artifact cục bộ và chỉ duyệt khi người dùng xác nhận rõ ràng. Dùng khi người dùng muốn lập kế hoạch, xem/sửa kế hoạch hoặc duyệt một thay đổi theo SpecRelay; không dùng để gọi Claude Code hay triển khai mã nguồn."
---

# Quy trình SpecRelay: plan và approval

Chat Codex là giao diện chính. Các file trong `.specrelay/` là artifact nền cho audit, hash và resume; không yêu cầu người dùng mở hoặc đọc Markdown.

## 1. Làm rõ và trình bày plan trong chat

1. Đọc repository trước khi kết luận về phạm vi hoặc kiến trúc.
2. Hỏi những câu hỏi thật sự cần thiết. Ghi câu chưa có câu trả lời vào `openQuestions`; phân loại `blocking` nếu không thể triển khai an toàn khi thiếu câu trả lời.
3. Hiển thị plan ngay trong chat, bằng tiếng Việt, với: mục tiêu, trong/ngoài phạm vi, ràng buộc, các bước triển khai, tiêu chí nghiệm thu và câu hỏi mở. Dùng tóm tắt dễ đọc, không yêu cầu người dùng đọc `plan.md`.
4. Không tự thêm tính năng ngoài yêu cầu. Nêu rõ mọi giả định để người dùng xác nhận.

## 2. Ghi artifact plan

Khi plan đã được trình bày và người dùng muốn lưu hoặc tiếp tục workflow:

1. Đảm bảo repo đã khởi tạo một lần:

   ```sh
   specrelay init --repo "<đường-dẫn-repo>"
   ```

2. Tạo draft run tiếng Việt:

   ```sh
   specrelay plan "<mục-tiêu>" --repo "<đường-dẫn-repo>" --language vi --json
   ```

3. Điền `plan.md` của run vừa tạo bằng nội dung plan đã hiển thị. Giữ YAML front matter là nguồn sự thật với đúng các trường: `schemaVersion`, `language`, `objective`, `inScope`, `outOfScope`, `constraints`, `implementationSteps`, `acceptanceCriteria`, `openQuestions`. Không chỉnh `plan.normalized.json` trực tiếp.
4. Chạy `specrelay show <run-id> --repo "<đường-dẫn-repo>"` và tóm tắt lại kết quả trong chat. Không in raw Markdown mặc định.

Nếu không có shell tool, hiển thị nguyên văn lệnh phù hợp ở trên để người dùng tự chạy. Không nói rằng artifact đã được tạo khi chưa có cách ghi nó.

## 3. Sửa và duyệt

- Khi người dùng góp ý, cập nhật plan, hiển thị phần thay đổi trong chat, rồi cập nhật `plan.md`. Sau khi plan từng được duyệt mà bị sửa, nói rõ approval đã `stale` và cần duyệt lại.
- Chỉ chạy lệnh dưới đây khi người dùng vừa xác nhận rõ trong cuộc trò chuyện hiện tại, ví dụ “Tôi duyệt plan này” hoặc “Approve plan này”. Không suy diễn approval từ các câu như “ổn”, “tiếp tục”, hoặc từ phản hồi cũ.

  ```sh
  specrelay approve <run-id> --yes --repo "<đường-dẫn-repo>"
  ```

- Nếu có `blocking` open question, không duyệt bình thường. Trình bày câu hỏi trong chat. Chỉ dùng override sau khi người dùng chấp nhận rõ ràng và có lý do đã được họ cung cấp:

  ```sh
  specrelay approve <run-id> --yes --accept-open-questions --reason "<lý-do-do-người-dùng-cung-cấp>" --repo "<đường-dẫn-repo>"
  ```

## 4. Triển khai cô lập sau approval

- Sau approval, báo plan đã sẵn sàng và chờ người dùng xác nhận rõ trong chat hiện tại rằng họ muốn **triển khai**. Approval plan không tự cấp quyền dùng quota Claude Code.
- Trước khi gọi executor, chạy `specrelay doctor --repo "<đường-dẫn-repo>"` và tóm tắt cảnh báo. Nhắc người dùng chỉ chạy trên repository tin cậy; executor không phải sandbox hoàn toàn.
- Chỉ sau xác nhận triển khai rõ ràng, gọi:

  ```sh
  specrelay implement <run-id> --yes --repo "<đường-dẫn-repo>"
  ```

  Có thể dùng `--dry-run` để trình bày worktree, branch, giới hạn 10 turns/20 phút và prompt hash trước khi chạy thật. Không dùng `--dangerously-skip-permissions`, không tự tăng limit, không thêm `--add-dir`.

- Khi run đang chạy, dùng `specrelay status <run-id>` và tóm tắt state/heartbeat trong chat. Nếu người dùng yêu cầu dừng, chỉ chạy `specrelay cancel <run-id> --yes`; không tự kill PID, không tự retry hoặc resume.
- Khi executor kết thúc, dùng `specrelay report <run-id>` để hiển thị outcome và worktree. Không chạy test/check, không review diff, không yêu cầu Claude sửa tiếp, không commit/push/merge. Các việc đó thuộc Phase D trở đi.
- `specrelay cleanup <run-id> --yes` chỉ thực hiện khi người dùng yêu cầu rõ. Giải thích rằng cleanup từ chối worktree có thay đổi và luôn giữ artifact audit.

## Giới hạn an toàn

- Không tự approve, tự triển khai, tự cancel, tự cleanup hoặc tự mở rộng scope.
- Executor chỉ được sửa worktree riêng; policy mặc định không cho test/build/package install/network, commit, push, publish hay auth.
- Không gọi Codex API hay model khác. Claude Code chỉ được gọi qua `specrelay implement` sau human gate nói trên.
