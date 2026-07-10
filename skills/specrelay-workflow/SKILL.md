---
name: specrelay-workflow
description: "Điều phối SpecRelay cho thay đổi mã nguồn: làm rõ yêu cầu, lập và duyệt plan tiếng Việt trong chat Codex, triển khai cô lập bằng Claude Code sau human gate, chạy check đã duyệt và review trực tiếp trong chat. Dùng khi người dùng muốn plan, approval, triển khai, xem trạng thái hoặc review theo SpecRelay."
---

# Quy trình SpecRelay: plan, triển khai và review chat-first

Chat Codex là giao diện chính. Các file trong `.specrelay/` chỉ là artifact nền cho audit, hash và resume; không yêu cầu người dùng mở hoặc đọc Markdown/JSON.

## 1. Làm rõ và trình bày plan trong chat

1. Đọc repository trước khi kết luận về phạm vi hoặc kiến trúc.
2. Hỏi các câu hỏi thật sự cần thiết. Ghi câu chưa có câu trả lời vào `openQuestions`; phân loại `blocking` nếu không thể triển khai an toàn khi thiếu câu trả lời.
3. Hiển thị plan bằng tiếng Việt ngay trong chat, gồm: mục tiêu, trong/ngoài phạm vi, ràng buộc, các bước triển khai, tiêu chí nghiệm thu, check cụ thể và câu hỏi mở. Dùng tóm tắt dễ đọc, không yêu cầu người dùng đọc `plan.md`.
4. Khai báo `checks` bằng `id`, `preset` (`node`, `python` hoặc `go`), `argv` rõ ràng và `timeout`; không đoán command, không thêm package install. Đây là các check sẽ chạy sau khi Claude triển khai, nên phải nằm trong plan trước approval.
5. Không tự thêm tính năng ngoài yêu cầu. Nêu rõ mọi giả định để người dùng xác nhận.

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

3. Điền `plan.md` của run vừa tạo bằng plan đã hiện trong chat. YAML front matter phải có `schemaVersion`, `language`, `objective`, `inScope`, `outOfScope`, `constraints`, `implementationSteps`, `acceptanceCriteria`, `openQuestions` và `checks`. Không chỉnh `plan.normalized.json` trực tiếp.
4. Chạy `specrelay show <run-id> --repo "<đường-dẫn-repo>"` và tóm tắt kết quả trong chat. Không in raw Markdown mặc định.

Nếu không có shell tool, hiển thị nguyên văn lệnh phù hợp để người dùng tự chạy. Không nói artifact đã được tạo khi chưa có cách ghi nó.

## 3. Sửa và duyệt plan

- Khi người dùng góp ý, cập nhật plan, hiển thị phần thay đổi trong chat rồi cập nhật `plan.md`. Nếu plan đã từng được duyệt mà bị sửa, nói rõ approval đã `stale` và phải duyệt lại.
- Chỉ chạy lệnh approval khi người dùng vừa xác nhận rõ trong cuộc trò chuyện hiện tại, ví dụ “Tôi duyệt plan này”. Không suy diễn approval từ “ổn”, “tiếp tục” hay phản hồi cũ.

  ```sh
  specrelay approve <run-id> --yes --repo "<đường-dẫn-repo>"
  ```

- Nếu có `blocking` open question, trình bày nó trong chat. Chỉ override khi người dùng chấp nhận rõ ràng và đã cung cấp lý do:

  ```sh
  specrelay approve <run-id> --yes --accept-open-questions --reason "<lý-do-do-người-dùng-cung-cấp>" --repo "<đường-dẫn-repo>"
  ```

## 4. Triển khai cô lập sau approval

- Approval plan không tự cấp quyền dùng quota Claude Code. Sau approval, chờ người dùng vừa xác nhận rõ họ muốn **triển khai**.
- Trước executor, chạy `specrelay doctor --repo "<đường-dẫn-repo>"` và tóm tắt cảnh báo. Nhắc người dùng chỉ chạy trên repository tin cậy; executor không phải sandbox tuyệt đối.
- Chỉ sau xác nhận triển khai rõ ràng, gọi:

  ```sh
  specrelay implement <run-id> --yes --repo "<đường-dẫn-repo>"
  ```

  Có thể dùng `--dry-run` để trình bày worktree, branch, giới hạn 10 turns/20 phút và prompt hash. Không dùng `--dangerously-skip-permissions`, không tự tăng limit, không thêm `--add-dir`.

- Khi run đang chạy, dùng `specrelay status <run-id>` và tóm tắt state/heartbeat trong chat. Nếu người dùng yêu cầu dừng, chỉ chạy `specrelay cancel <run-id> --yes`; không tự kill PID, retry hay resume.
- `specrelay cleanup <run-id> --yes` chỉ thực hiện khi người dùng yêu cầu rõ. Nói rõ cleanup từ chối worktree có thay đổi và luôn giữ artifact audit.

## 5. Check đã duyệt và review trong chat

1. Khi executor đã thành công và run ở `checking`, tự chạy check vì command đã có trong plan được duyệt:

   ```sh
   specrelay check <run-id> --repo "<đường-dẫn-repo>" --json
   ```

2. Nếu check fail, hiển thị tên check, lỗi đã redact và state `failed` trong chat rồi dừng. Không tạo review packet, không auto-fix, không gọi Claude tiếp.
3. Nếu check pass, tạo evidence và đọc diff:

   ```sh
   specrelay review-packet <run-id> --repo "<đường-dẫn-repo>" --json
   specrelay diff <run-id> --repo "<đường-dẫn-repo>" --stat --json
   specrelay diff <run-id> --repo "<đường-dẫn-repo>" --json
   ```

4. Review trực tiếp trong chat: nêu kết luận và từng finding trước (severity, file/line, vấn đề, bằng chứng, required fix). Không yêu cầu người dùng đọc `review-packet.json` hay `review.json`.
5. Sau khi đã hiển thị review, Codex tự tạo JSON input đúng schema rồi ghi audit artifact bằng:

   ```sh
   specrelay record-review <run-id> --input "<đường-dẫn-review-input.json>" --repo "<đường-dẫn-repo>"
   ```

   Không ghi tay trực tiếp vào `review.json`. Nếu có finding `blocking` hoặc `important`, bắt buộc ghi `decision: "needs_human"`; chỉ `minor` hoặc không finding mới ghi `decision: "complete"`.

6. Dùng `specrelay report <run-id>` để tóm tắt execution, checks, review decision, worktree và branch trong chat. `final-report.json` là artifact canonical, không tạo report Markdown.

## Giới hạn an toàn

- Không tự approve, tự triển khai, tự cancel, tự cleanup hay tự mở rộng scope.
- Không auto-fix, resume executor, commit, push, merge, deploy hoặc publish sau review. `needs_human` luôn chờ người dùng quyết định ở phase sau.
- Executor chỉ sửa worktree riêng; policy mặc định không cho test/build/package install/network, commit, push, publish hay auth. Check chỉ chạy `argv` đã có trong plan approved, không qua shell.
- Không gọi Codex API hay model khác. Claude Code chỉ được gọi qua `specrelay implement` sau human gate ở trên.
