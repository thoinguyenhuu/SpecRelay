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

## Giới hạn Phase B

- Không gọi `claude`, Claude Code, Codex API hay bất kỳ model nào khác.
- Không tự approve, không tạo worktree, không chạy target test, không sửa code mục tiêu, không commit/push/merge repository mục tiêu.
- Sau approval, dừng ở trạng thái `approved` và báo cho người dùng biết plan đã sẵn sàng cho phase executor sau này.
