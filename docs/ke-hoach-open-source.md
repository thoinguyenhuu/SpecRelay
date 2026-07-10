# Kế hoạch phát triển open-source: SpecRelay

> Tên làm việc: **SpecRelay** (viết tắt `specrelay`).  
> Mục tiêu phát hành đầu tiên: `v0.1.0` local-first, một người dùng, một repository mỗi run.

## 1. Kết luận thiết kế

Không nên chỉ làm một plugin Codex gọi trực tiếp `claude`. Cách đó khó test,
khó dùng ngoài Codex, và khiến phần có quyền cao bị giấu trong hook/prompt.

Sản phẩm nên có hai lớp:

```text
Người dùng trong Codex                 Người dùng terminal / CI sau này
          |                                           |
          v                                           v
    Codex plugin (mỏng) --------------------> CLI `specrelay` (lõi sản phẩm)
                                                        |
                                                        +-- quản lý run + state machine
                                                        +-- Git worktree + artifact
                                                        +-- gọi Claude Code CLI
                                                        +-- kiểm tra + review handoff
```

**`specrelay` CLI là nguồn sự thật.** Plugin Codex chỉ đưa các thao tác đó vào giao
diện chat và hướng dẫn Codex sử dụng đúng workflow. Nhờ vậy:

- Người dùng vẫn chạy được `specrelay` khi không có Codex app.
- Mọi hành vi nhạy cảm đều nằm trong TypeScript có test, thay vì chỉ nằm trong prompt.
- Có thể thêm adapter cho VS Code hoặc GitHub Action sau này mà không đổi core.
- Người dùng open-source có thể audit đúng lệnh và dữ liệu mà công cụ gửi cho Claude Code.

## 2. Tuyên ngôn sản phẩm

`specrelay` không phải là “một agent tự làm mọi thứ”. Nó là **quality-controlled
handoff workflow**:

1. Codex cùng người dùng biến yêu cầu mơ hồ thành plan có thể nghiệm thu.
2. Người dùng duyệt phiên bản plan cụ thể.
3. Claude Code là executor bị giới hạn bởi plan, workspace và policy.
4. Codex review độc lập dựa trên diff, test output và acceptance criteria.
5. Người dùng luôn giữ quyền approve, commit, push và merge.

Điểm khác biệt cần bảo vệ là **plan approval có thể kiểm chứng**, **artifact
có thể audit**, và **permission an toàn mặc định** — không phải chỉ là một
wrapper gọi hai CLI.

## 3. Personas và use case đầu tiên

| Persona                    | Nhu cầu                                                | Workflow                                                           |
| -------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------ |
| Lập trình viên cá nhân     | Muốn Claude Code code nhanh nhưng vẫn có kiểm soát.    | Tạo plan trong Codex, duyệt, nhận branch/worktree và final report. |
| Tech lead                  | Muốn review rõ yêu cầu trước khi agent sửa nhiều file. | Chỉnh plan, đặt risk/acceptance criteria, review kết quả.          |
| Người đóng góp open-source | Muốn tool minh bạch, không gửi secret/telemetry ngầm.  | Cài local, đọc artifact, chạy test fixture và gửi PR.              |

**Không hỗ trợ trong v0.1:** nhiều agent song song, tự merge, truy cập GitHub,
cloud worker, dashboard web, hoặc chạy tool trên remote repository.

## 4. Phạm vi phát hành theo phiên bản

| Phiên bản | Bắt buộc có                                                       | Không làm                                      |
| --------- | ----------------------------------------------------------------- | ---------------------------------------------- |
| `v0.1.0`  | Plan → approve → Claude implement → kiểm tra → report.            | Vòng lặp review tự động, CI cloud, multi-user. |
| `v0.2.0`  | Codex review handoff, tối đa hai vòng fix có xác nhận.            | Tự merge/push, GitHub App.                     |
| `v0.3.0`  | Policy file, resume/cancel tin cậy, nhiều preset test.            | Nhiều worker song song.                        |
| `v1.0.0`  | API/CLI ổn định, test đa nền tảng, docs an toàn, release process. | Tính năng enterprise.                          |

Giới hạn `v0.1.0` là chủ ý: chỉ cần làm cho luồng phê duyệt và executor an toàn,
đáng tin cậy trước khi tối ưu autonomy.

## 5. Kiến trúc mục tiêu

### 5.1 Monorepo

```text
specrelay/
  .codex-plugin/
    plugin.json                    # manifest Codex plugin
  packages/
    core/                           # state machine, schema, policy, artifact
    cli/                            # package `specrelay`, parse command, process runner
    codex-plugin/                  # skills, hooks và adapter gọi CLI
  skills/
    specrelay-workflow/SKILL.md          # Codex tạo/chỉnh/approve plan theo quy tắc
  hooks/                            # chỉ dùng sau khi API hook được xác minh
  templates/
    plan.vi.md
    final-report.vi.md
  test/
    fixtures/                       # Git repo nhỏ phục vụ E2E offline
    fake-claude/                    # Claude CLI giả để test deterministically
  docs/
    ke-hoach-open-source.md
    kien-truc.md
    bao-mat.md
    dong-gop.md
  .github/
    workflows/ci.yml
    ISSUE_TEMPLATE/
    pull_request_template.md
  README.md
  SECURITY.md
  CONTRIBUTING.md
  CODE_OF_CONDUCT.md
  LICENSE
```

Ban đầu có thể giữ một `package.json` ở root để giảm độ phức tạp. Chỉ tách
`packages/` khi core và plugin đã có test; không cần Nx/Turborepo ở giai đoạn
đầu.

### 5.2 Ranh giới module

| Module         | Chịu trách nhiệm                                                | Không được làm                                     |
| -------------- | --------------------------------------------------------------- | -------------------------------------------------- |
| `core`         | Schema, state transition, hash approval, policy, artifact path. | Spawn process, đọc credential, gọi model.          |
| `cli`          | Parse input, khóa run, worktree, spawn Claude, log/check.       | Quyết định nội dung plan/review bằng prompt tự do. |
| `codex-plugin` | Đưa workflow vào Codex và gọi CLI có tham số rõ ràng.           | Lưu state riêng hoặc bypass policy.                |
| `templates`    | Format plan/report, contract giữa human và executor.            | Chứa secret hoặc instruction không audit được.     |

### 5.3 Lý do chọn Node.js + TypeScript

- Codex plugin hiện dùng được plugin/skills/hook và CLI; core bằng TypeScript
  đơn giản hơn khi phải quản lý JSON, process và schema.
- Claude Code hỗ trợ `claude -p` cho non-interactive execution, có JSON hoặc
  stream JSON, giới hạn số turn, và cấu hình tool allow/deny. Đây là nền tảng
  phù hợp cho runner có kiểm soát. [Claude Code CLI reference](https://docs.anthropic.com/en/docs/claude-code/cli-usage)
- Không cần OpenAI API key trong `specrelay` core: Codex là interface/reviewer của
  người dùng, còn executor dùng đăng nhập Claude Code sẵn có.

## 6. Hợp đồng dữ liệu

### 6.1 Thư mục artifact

Mọi run lưu trong repo mục tiêu, không lưu trong thư mục plugin:

```text
<target-repo>/.specrelay/runs/<run-id>/
  request.md
  plan.md
  approval.json
  state.json
  policy.snapshot.json
  executor-prompt.md
  executor-events.jsonl
  checks.json
  review-packet.json
  review.json
  final-report.json
```

Thư mục `.specrelay/` mặc định phải được thêm vào `.git/info/exclude`.
`specrelay` **không tự sửa `.gitignore`** nếu người dùng chưa yêu cầu.

### 6.2 `state.json`

Định nghĩa bằng Zod/JSON Schema, có version để migrate an toàn:

```json
{
  "schemaVersion": 1,
  "id": "run_20260710_abc123",
  "state": "awaiting_approval",
  "targetRepo": "D:/projects/example",
  "baseRef": "main",
  "worktreePath": null,
  "branch": null,
  "reviewRound": 0,
  "createdAt": "2026-07-10T12:00:00.000Z",
  "updatedAt": "2026-07-10T12:00:00.000Z"
}
```

Trạng thái hợp lệ:

```text
draft_plan -> awaiting_approval -> approved -> implementing
implementing -> checking | failed | interrupted
checking -> ready_for_review | failed | interrupted
ready_for_review -> complete | needs_human | fixing
fixing -> checking | failed | interrupted
draft_plan | awaiting_approval | approved | implementing | checking |
ready_for_review | fixing | interrupted -> cancelled
interrupted -> needs_human
```

Mọi transition phải đi qua một hàm `transition(run, event)` thuần, có test
table-driven. Không được set chuỗi `state` rải rác trong code. `failed` nghĩa
là runner biết chắc lệnh đã thất bại; `interrupted` nghĩa là tiến trình hoặc
trạng thái không còn đủ bằng chứng để kết luận (mất điện, crash, hết đĩa). Run
`interrupted` không được tự resume hoặc cleanup; người dùng phải inspect rồi
chọn report, retry bằng run mới, hoặc cancel.

### 6.2.1 Migration artifact schema

Khi `specrelay status` hoặc `specrelay report` đọc state cũ, core kiểm tra
`schemaVersion` trước mọi thao tác. Migration thêm/đổi tên field là hàm thuần
`vNtoNPlus1`, chạy trên bản copy và chỉ replace snapshot bằng atomic write sau
khi schema mới pass validation. Migration không được xóa artifact/history. Nếu
migration cần đổi semantics hoặc không thể khôi phục dữ liệu, tool dừng ở
`needs_human`, tạo backup read-only và yêu cầu người dùng chạy một lệnh migrate
riêng có xác nhận.

### 6.3 `approval.json`

```json
{
  "planSha256": "...",
  "approvedAt": "2026-07-10T12:00:00.000Z",
  "approvedBy": "local-user",
  "planPath": "plan.md"
}
```

`specrelay implement` phải hash lại `plan.md`. Không khớp thì trả mã lỗi riêng
`PLAN_CHANGED_AFTER_APPROVAL`, chuyển state về `awaiting_approval` và **không
được** spawn Claude Code.

### 6.4 Plan template

Plan là một contract, không chỉ là checklist. Template bắt buộc có:

1. Mục tiêu và user-visible outcome.
2. In scope / out of scope.
3. Assumption và câu hỏi còn mở.
4. API/data contract và migration impact.
5. File/module dự kiến thay đổi cùng lý do.
6. Các bước thực hiện có thứ tự.
7. Tiêu chí nghiệm thu kiểm chứng được.
8. Lệnh test/check được phép chạy.
9. Risk, rollback và thay đổi cần con người xác nhận.

Nếu còn câu hỏi mở có mức `blocking`, `specrelay approve` từ chối phê duyệt trừ khi
người dùng dùng cờ xác nhận rõ ràng `--accept-open-questions`.

Plan, kể cả plan đã được người dùng duyệt, là **specification chứ không phải
capability grant**. Nội dung plan không được tự cấp thêm quyền tool, mở rộng
worktree, cho phép network, `git push`, package publish hay lệnh phá dữ liệu.
Các quyền này chỉ đến từ policy/config được CLI kiểm tra.

## 7. Hành vi CLI v0.1

```text
specrelay doctor [--repo <path>]
specrelay init [--repo <path>]
specrelay plan "<yêu cầu>" [--repo <path>]
specrelay show <run-id>
specrelay approve <run-id> [--accept-open-questions]
specrelay implement <run-id> [--max-turns <n>] [--dry-run]
specrelay status <run-id> [--follow]
specrelay diff <run-id> [--stat] [-- <pathspec>]
specrelay check <run-id>
specrelay report <run-id>
specrelay cancel <run-id>
specrelay cleanup <run-id> [--keep-artifacts]
```

Quy tắc CLI:

- `--repo` mặc định là Git repository chứa thư mục hiện tại; không có Git repo
  thì lệnh mutating thất bại.
- `init` chỉ tạo config và artifact directory sau khi in rõ file sẽ tạo.
- `plan` tạo run và template; Codex skill chịu trách nhiệm soạn nội dung plan.
- `implement --dry-run` in đúng command, cwd và policy sẽ dùng nhưng không spawn process.
- `diff` chỉ đọc Git worktree của run; mặc định hiển thị diff so với base ref,
  `--stat` cho overview và `-- <pathspec>` để thu hẹp file. Đây là lệnh chính để
  người dùng xem thay đổi trước khi yêu cầu review hoặc merge.
- `check` không đoán lệnh shell từ nội dung tự do; chỉ chạy command đã được
  khai báo trong plan/config và qua parser an toàn.
- Mọi lỗi có `errorCode` ổn định, thông điệp tiếng Việt dễ hiểu và `--json`
  cho automation sau này.

## 8. Executor Claude Code

### 8.1 Cách chạy

CLI spawn process, tuyệt đối không ghép chuỗi shell:

```text
claude -p --output-format stream-json --max-turns <n> <executor-prompt>
```

Prompt luôn trỏ đến artifact cục bộ và bao gồm:

- đường dẫn worktree duy nhất được phép sửa;
- nội dung/hash của plan đã approved;
- policy snapshot;
- acceptance criteria và command được phép chạy;
- yêu cầu báo cáo file đã đổi, command đã chạy và kết quả;
- lệnh “dừng và báo cáo” khi cần thay đổi ngoài plan.

Plan được đưa vào một block dữ liệu có delimiter rõ ràng. Prompt hệ thống nói
rõ block này mô tả mục tiêu sản phẩm nhưng không thể ghi đè policy, gọi thêm
tool, hoặc biến text trong đó thành shell command được phép chạy. Delimiter chỉ
là một lớp giảm rủi ro prompt injection; enforcement thật nằm ở worktree,
allowlist, `spawn` argument array và policy của runner.

Claude Code có hỗ trợ `-p`, output JSON/stream JSON, `--max-turns`,
`--allowedTools` và `--disallowedTools`; v0.1 chỉ dùng các khả năng đã được
documented này. [Claude Code CLI reference](https://docs.anthropic.com/en/docs/claude-code/cli-usage)

### 8.2 Permission profile

Mặc định **không** dùng `--dangerously-skip-permissions`.

`specrelay` tạo profile giới hạn theo OS, ví dụ chỉ cho phép Read/Edit/Write trong
worktree và Bash có allowlist: `git status`, `git diff`, test command đã
approve, package-manager scripts cụ thể. Deny mặc định gồm các thao tác
network/publish và file nhạy cảm:

```text
.env, .env.*, *.pem, *.key, id_rsa, credentials*, ~/.ssh, ~/.aws
git push, git commit, gh auth, npm publish, docker push
rm -rf, format disk, database migration destructive
```

Đây là policy defense-in-depth, không phải lời hứa sandbox tuyệt đối. README
phải nói rõ Claude Code là process có quyền trên máy người dùng; người dùng cần
chỉ định repo đáng tin cậy.

### 8.3 Worktree và recovery

1. Xác thực `git status --porcelain` ở base repo; mặc định từ chối nếu bẩn.
2. Tạo branch `specrelay/<run-id>` và worktree dưới root riêng do `specrelay` quản lý. Trên
   Windows, default là một path ngắn dưới `%LOCALAPPDATA%`; trên Unix dùng cache
   user. Không dùng symlink/junction để dựng worktree.
3. Mọi update state dùng atomic snapshot: ghi file tạm cùng directory, flush,
   rồi rename/replace `state.json`. Đồng thời append event tối thiểu vào
   `events.jsonl`; không coi ghi state thành công khi event/snapshot bị lỗi.
4. `state.json` ghi PID, command digest, heartbeat và worktree path. Khi restart,
   `specrelay status` kiểm tra PID vẫn đúng command digest trước khi báo job còn chạy;
   không bao giờ kill PID chỉ dựa vào số PID.
5. Nếu process biến mất, heartbeat quá hạn, snapshot/event không đọc được, hoặc
   không thể ghi vì hết đĩa, run chuyển sang `interrupted` và giữ nguyên artifact.
   Tool không suy đoán executor đã thành công hoặc tự cleanup.
6. `cancel` gửi signal nhẹ trước, timeout rồi mới terminate; artifact luôn giữ lại.
7. `cleanup` chỉ xóa worktree mà nó tạo, sau khi realpath kiểm tra path nằm trong
   root `specrelay` quản lý và branch chưa có commit chưa được người dùng xác nhận.

`specrelay doctor` chuẩn hóa path theo OS, cảnh báo khi path worktree dự kiến quá dài
và kiểm tra Git có hỗ trợ `worktree`. Không kiểm tra `core.symlinks`: cấu hình
đó không phải điều kiện để `git worktree` hoạt động và có thể gây cảnh báo sai.

## 9. Review và quality gates

`v0.1` không cố mô phỏng Codex review bằng API. Nó chuẩn bị một review packet:

```text
approved plan + acceptance criteria + git diff + check results + executor report
```

Codex skill yêu cầu Codex review ngay trong chat trước, rồi ghi finding vào
`review.json` theo schema:

```json
{
  "decision": "needs_human",
  "summary": "...",
  "findings": [
    {
      "id": "F-001",
      "severity": "important",
      "file": "src/service.ts",
      "line": 42,
      "category": "maintainability",
      "problem": "...",
      "evidence": ["..."],
      "requiredFix": "..."
    }
  ]
}
```

**Gate v0.1:** có `blocking`/`important` thì report là `needs_human`, không tự
fix. Điều này cho người dùng cơ hội duyệt finding trước.

**Gate v0.2:** người dùng chọn `specrelay fix <run-id> --findings F-001,F-002`.
Runner tạo prompt mới cho Claude Code chỉ được sửa finding đã chọn, tối đa hai
vòng. Không có lệnh `--auto-fix-all` trong `v1.0`.

## 10. Codex plugin UX

Plugin dùng skill để **hướng dẫn** Codex theo chuỗi:

```text
Nhận yêu cầu -> phân tích -> viết plan.md -> hỏi người dùng chỉnh/duyệt
-> chỉ sau approve mới gọi `specrelay implement`
-> hiển thị report và yêu cầu người dùng quyết định.
```

Không giả định ngay rằng Codex plugin có custom slash command hoặc hook API ổn
định. `v0.1` hỗ trợ hai cách tương tác tương đương:

```text
1. Trong Codex: người dùng yêu cầu tự nhiên, skill hướng dẫn Codex gọi `specrelay ...`
   nếu shell tool đang được môi trường Codex cho phép.
2. Fallback chuẩn: user chạy các lệnh `specrelay plan`, `specrelay approve`, `specrelay implement`,
   `specrelay diff`, `specrelay check`, `specrelay report` trong terminal.
```

Khả năng Codex session gọi shell phụ thuộc vào surface, version và policy đang
chạy; `specrelay doctor`/plugin setup phải phát hiện và nói rõ capability thực tế,
không hứa hẹn custom command chưa được xác minh. Nếu không có shell tool, core
CLI vẫn dùng đầy đủ, chỉ mất UX “một cửa sổ”. CLI là enforcement layer; kể cả
Codex không theo prompt, `specrelay implement` vẫn từ chối plan chưa approved. Codex
khuyến khích đóng gói workflow lặp lại thành skills và dùng CLI composable cho
API/log/export/workflow riêng. [Codex use cases](https://developers.openai.com/codex/use-cases)

Không đưa custom GUI/webview vào `v0.1`. Người dùng xem/sửa `plan.md` bằng IDE
hoặc bảo Codex sửa trong chat; đây là UX ổn định, portable và dễ review bằng Git.

## 11. Testing strategy

### 11.1 Unit (bắt buộc, chạy không cần API key)

- Parse/config/schema validation.
- Tất cả state transition hợp lệ và không hợp lệ.
- SHA-256 approval và invalidation.
- Path traversal/realpath guard.
- Command allowlist parser.
- Redaction log (token/key/đường dẫn home).
- Generate prompt snapshot: plan và policy phải được ghép đúng.
- Plan chứa câu lệnh độc hại không được mở rộng tool permission hoặc bypass policy.
- Atomic state write, corrupted snapshot/event và stale heartbeat.
- Artifact schema migration theo version cũ/mới.

### 11.2 Integration (bắt buộc, không gọi Claude thật)

Dùng `fake-claude` executable, mô phỏng stream JSON, exit code, timeout,
malformed output và child process. Repo fixture có Git history nhỏ để test:

- worktree isolated;
- dirty worktree bị từ chối;
- resume/cancel;
- artifact được giữ khi fail;
- cleanup không chạm path ngoài root;
- plan bị sửa sau approve không tạo child process.
- executor timeout/crash/reboot mô phỏng chuyển run sang `interrupted`;
- Windows path normalization và worktree path dài được cảnh báo, không tạo path nguy hiểm.

### 11.3 E2E có credential (manual / nightly opt-in)

Không chạy Claude thật trên PR của contributor và không đưa key vào CI public.
Workflow manual dành cho maintainer dùng repo fixture không nhạy cảm, chạy một
task vô hại, kiểm tra report và cleanup.

### 11.4 Ma trận CI

| Job                        | Linux                   | macOS  | Windows    |
| -------------------------- | ----------------------- | ------ | ---------- |
| Lint/typecheck/unit        | Có                      | Có     | Có         |
| Fake-CLI integration       | Có                      | Có     | Có         |
| Plugin manifest validation | Có                      | Có     | Có         |
| Claude thật                | Manual, maintainer-only | Manual | Manual/WSL |

Claude Code hỗ trợ Windows qua WSL hoặc Git for Windows; docs cũng nêu WSL là
một lựa chọn Windows được hỗ trợ. Vì vậy docs phải test native Windows và WSL
riêng, không tuyên bố chúng hoàn toàn tương đương. [Claude Code setup](https://docs.anthropic.com/en/docs/claude-code/getting-started)

## 12. Security, privacy và trust

Đây là phần quyết định người khác có dám cài plugin hay không.

### Bắt buộc trước `v0.1.0`

- `v0.1.0` là **zero telemetry**: không analytics, error reporting remote,
  background ping hoặc opt-in telemetry. Mọi log ở local. Mọi proposal telemetry
  chỉ được xem xét sau `v1.0.0`, opt-in rõ ràng và có tài liệu dữ liệu gửi đi.
- Không đọc, in, gửi hoặc lưu API key/token; child process kế thừa môi trường
  tối thiểu cần thiết thay vì toàn bộ `process.env`.
- Không `shell: true`; dùng `spawn` argument array.
- Không tải remote script, không `curl | sh`, không dynamic dependency download
  ở runtime.
- Lockfile được commit, Dependabot/Renovate và dependency review bật trong GitHub.
- Logs redact biến có tên nhạy cảm và giới hạn kích thước output.
- Xác minh realpath trước mọi thao tác tạo/xóa/move worktree/artifact.
- Public `SECURITY.md` có private disclosure contact và thời hạn phản hồi.
- Dùng CodeQL, secret scanning và dependency scanning trong CI/repo settings.

### Những điều phải nói rõ trong README

- Công cụ **không phải sandbox** và không loại bỏ hoàn toàn rủi ro prompt
  injection từ code/document trong repository hoặc plan do người dùng sửa.
- Chỉ chạy trên repo bạn tin cậy; xem diff trước merge.
- Claude Code và Codex có quota/chi phí riêng; `specrelay` không che giấu chi phí đó.
- Không dùng cho production deploy hoặc migration destructive trong v1.

## 13. Open-source readiness

Trước public repository cần có:

- `LICENSE`: khuyến nghị **Apache-2.0**, vì nó có grant patent rõ ràng; chọn MIT
  chỉ khi muốn tối giản tối đa. Phải quyết định một loại trước commit public đầu tiên.
- `NOTICE` nếu tái sử dụng code/asset từ project khác.
- `CODE_OF_CONDUCT.md` theo Contributor Covenant.
- `CONTRIBUTING.md`: setup, test, cách thêm command/schema, policy review, PR checklist.
- `SECURITY.md`: không báo lỗ hổng qua public issue.
- GitHub issue templates: bug, security redirect, feature proposal, integration report.
- PR template: test đã chạy, OS, thay đổi quyền/process, ảnh hưởng privacy/security.
- `CHANGELOG.md` theo Keep a Changelog; version semantic.
- GitHub Actions: required checks, least-privilege `permissions: read`, pin action theo commit SHA.
- Release: signed tag, provenance/SBOM nếu registry hỗ trợ, checksum các artifact.

Tên dự án phải có disclaimer: “Not affiliated with, endorsed by, or sponsored
by OpenAI or Anthropic.” Tránh dùng logo/thương hiệu làm icon package nếu chưa
có quyền.

## 14. Lộ trình triển khai chi tiết

### Phase A — Foundation

**Mục tiêu:** contributor clone được, hiểu được architecture, chạy test offline.

1. Chọn tên public, license và package scope (không publish npm vội).
2. Thêm Node LTS, TypeScript strict, ESLint, Prettier, Vitest và GitHub CI.
3. Tạo `core` với schemas, error codes, state machine và test table-driven.
4. Viết `specrelay doctor` và `specrelay init` read-only/safe-default.
5. Viết docs security/contributing/architecture.

**Definition of done:** `npm ci && npm test && npm run lint && npm run typecheck`
chạy được ở clone mới, không cần Codex/Claude credentials.

### Phase B — Plan approval

**Mục tiêu:** giải quyết phần quan trọng nhất trước khi có agent write code.

1. `specrelay plan`, `show`, `approve` và artifact layout.
2. Template plan tiếng Việt; cho phép `--language en` sau này, chưa làm i18n engine.
3. Approval SHA-256 và lock file per-run để tránh hai process sửa state.
4. Test plan invalidation, corrupted JSON, path traversal, crash recovery.
5. Codex skill tạo/chỉnh plan nhưng core luôn là bên enforcement.

**Definition of done:** demo được plan chỉnh bằng tay; `implement` bị chặn
trước approve và bị chặn lại khi plan thay đổi sau approve.

### Phase C — Isolated executor

**Mục tiêu:** chạy Claude Code có kiểm soát và phục hồi được khi hỏng.

1. Adapter Git: detect repo, base ref, clean tree policy, worktree lifecycle.
2. `ClaudeRunner`: spawn an toàn, JSONL log, timeout, signal/cancel, redaction.
3. Prompt builder deterministic, policy snapshot, dry-run.
4. Fake Claude integration suite.
5. `specrelay status`, `specrelay report`, `specrelay cleanup`.

**Definition of done:** fake worker “sửa” fixture trong worktree; base repo không
đổi; kill/restart không làm xóa nhầm file.

### Phase D — Check và human review

**Mục tiêu:** không chỉ biết agent nói “xong”.

1. Test-command schema/preset (`node`, `python`, `go`), command runner safe.
2. Ghi exit code, duration, truncated/redacted output vào `checks.json`.
3. Generate `review-packet.json`, diff/hash có giới hạn và `review.json` có schema.
4. Codex skill review theo plan, diff, checks; report không tự merge.
5. `final-report.json` rõ trạng thái: complete/needs_human/failed.

**Definition of done:** người dùng nhìn report biết chính xác đã đổi gì, test
nào pass/fail, finding nào còn lại, và cách lấy worktree/branch để review.

### Phase E — Codex plugin và beta

**Mục tiêu:** UX không terminal nhưng không tạo logic thứ hai.

1. Skills/commands chỉ gọi `specrelay` CLI; không duplicate workflow trong prompt.
2. Setup docs cho Codex plugin và Claude Code CLI.
3. 5–10 beta user dùng repo nhỏ không nhạy cảm, thu bug report không telemetry.
4. Threat-model review độc lập trước public release.
5. Viết quickstart, video/GIF không chứa secret, troubleshooting Windows/WSL.

**Definition of done:** một người chưa biết dự án có thể cài, chạy sample fixture
và hiểu tại sao tool chặn/cho phép từng bước.

### Phase F — v0.1.0 public

**Mục tiêu:** phát hành nhỏ nhưng đáng tin.

1. Freeze command/data schemas documented.
2. Full CI green, manifest validation, license/security docs, dependency audit.
3. Changelog và migration note `0.x`.
4. Create GitHub release, publish package chỉ khi install path đã được test.
5. Theo dõi issue, patch security nhanh, không thêm tính năng lớn trong tuần đầu.

## 15. Rủi ro và quyết định chống rủi ro

| Rủi ro                          | Tác động                             | Giảm thiểu                                                                                      |
| ------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Prompt injection trong codebase | Agent chạy lệnh/sửa ngoài ý muốn.    | Repo trusted-only, worktree, permission profile, plan/policy snapshot, không skip permissions.  |
| CLI upstream thay đổi           | Plugin hỏng sau update Codex/Claude. | Adapter mỏng, feature detection qua `doctor`, pin/compatibility matrix, fake CLI contract test. |
| Agent loop tốn quota            | Chi phí cao, tạo thay đổi lặp.       | Không auto-fix ở v0.1; cap `max-turns`, review rounds, timeout, human gate.                     |
| Làm bẩn repo của người dùng     | Mất việc đang làm.                   | Từ chối dirty base mặc định, worktree riêng, không commit/push.                                 |
| Bug cleanup xóa nhầm            | Mất dữ liệu.                         | Realpath guard, ownership metadata, preview + confirm, không recursive delete tuỳ tiện.         |
| Contributor khó setup           | Cộng đồng không phát triển.          | CLI fake, fixture offline, docs 10 phút, CI đa OS.                                              |

## 16. Quyết định cần chốt trước khi code Phase A

Các quyết định dưới đây không chặn việc tạo skeleton, nhưng nên chốt trước khi
publish để tránh rename/breaking change:

1. **Tên public:** giữ tên dài hiện tại hay đổi tên ngắn, dễ tìm trên npm/GitHub.
2. **License:** Apache-2.0 (khuyến nghị) hay MIT.
3. **Ngôn ngữ tài liệu:** README song ngữ Việt/Anh hay README Anh + `README.vi.md`.
   Với open-source quốc tế, khuyến nghị README Anh là mặc định, giữ tài liệu Việt
   song song để bạn dễ maintain.
4. **Runtime support:** Node 20 LTS trở lên hay Node 22 LTS trở lên.
5. **Policy v0.1:** chỉ read/write/test trong worktree hay có cho phép package install
   khi người dùng xác nhận từng run.
6. **Codex integration:** surface đã xác minh có shell tool để gọi CLI hay chỉ
   ship skill + terminal fallback ở `v0.1`.

## 17. Definition of Done cho `v1.0.0`

- Mọi command public có help, exit code và docs.
- Không có đường đi nào khiến Claude Code sửa code trước plan approval.
- Mọi artifact/state có schema version và recovery từ crash hợp lý.
- Unit + fake-CLI integration chạy trên Linux, macOS, Windows.
- Không cần credential để test/đóng góp; E2E credential là opt-in maintainer-only.
- Security/privacy docs minh bạch; không telemetry mặc định.
- Không tự commit, push, merge, deploy hoặc chạy destructive migration.
- Release/reinstall plugin hoạt động theo documented path và được test trên máy sạch.
- Một maintainer không viết code vẫn có thể audit plan, command, diff, test output
  và final report của bất kỳ run nào.

## 18. Việc nên làm ngay sau tài liệu này

1. Xác minh capability của Codex surface thực tế: Codex có được phép gọi `specrelay`
   qua shell tool không; nếu không, chốt terminal fallback cho `v0.1`.
2. Chốt sáu quyết định ở mục 16.
3. Tạo `package.json`, TypeScript/Vitest và CI tối thiểu (Phase A).
4. Viết state machine, atomic state store và approval hash trước bất kỳ lệnh gọi
   Claude nào (Phase B).
5. Dựng fake Claude CLI và repo fixture.
6. Chỉ sau khi các test trên pass mới bắt đầu spawn `claude -p` trong Phase C.
