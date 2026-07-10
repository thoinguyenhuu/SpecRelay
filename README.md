# SpecRelay

> Plan approval and review workflow for Codex and Claude Code.

SpecRelay is a local-first CLI and Codex plugin foundation for a safer agentic
development workflow:

1. A human reviews and approves an implementation plan.
2. An executor implements only the approved plan in a controlled workspace.
3. A separate reviewer evaluates the diff and the evidence.
4. A human keeps control of commit, push, merge, deployment, and destructive work.

Phase C adds the first controlled executor: **draft plan → explicit human
approval → explicit execution confirmation → isolated Claude Code worktree**.
Codex chat remains the primary interface for reviewing plans and lifecycle
summaries. The files under `.specrelay/` are audit artifacts, not a document UI
users are expected to read.

[Đọc bằng tiếng Việt](README.vi.md) · [Architecture](docs/architecture.md) ·
[Vietnamese project plan](docs/ke-hoach-open-source.md)

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- Git

`codex` is optional. Claude Code is only required by `specrelay implement`;
`doctor` reports the required local capabilities before an execution starts.

## Development

```bash
npm install
npm run validate
```

Run the development CLI directly:

```bash
npm run dev -- doctor --json
npm run dev -- init --repo path/to/a/git-repository --dry-run
npm run dev -- plan "Add education management" --repo path/to/a/git-repository --json
```

Build the distributable CLI:

```bash
npm run build
node dist/cli/index.js --help
```

## Phase C workflow

1. In Codex chat, clarify the request and review the Vietnamese plan. The
   bundled `specrelay-workflow` skill keeps this chat-first workflow explicit.
2. Create a draft artifact with `specrelay plan`. Codex writes the reviewed plan
   to the run's `plan.md`; its YAML front matter is the canonical source.
3. Use `specrelay show <run-id>` for a compact summary—objective, scope, step
   count, acceptance criteria, open questions, and approval state.
4. Only after a direct, current-chat confirmation from a person, run
   `specrelay approve <run-id> --yes`. The command validates the plan, hashes
   every byte of `plan.md`, and writes derived audit artifacts.
5. Approval alone does not start Claude Code. After a separate explicit
   confirmation, run `specrelay implement <run-id> --yes`. It rejects a dirty
   base repository, creates an owned worktree and branch, then starts a local
   background worker.

Blocking open questions reject normal approval. An explicit override requires
both `--accept-open-questions` and `--reason "..."`; the accepted question IDs
and reason are recorded. If `plan.md` changes after approval, `show` reports
`approval: stale`; future executor phases must refuse it until it is approved
again.

Use `specrelay implement --dry-run` to inspect the exact worktree, branch,
policy, resource limits and prompt hash without creating files or starting a
process. `status`, `cancel --yes`, `report`, and `cleanup --yes` operate on the
run lifecycle. Cleanup retains artifacts and refuses to remove a changed
worktree.

## Commands available in Phase C

```text
specrelay doctor [--repo <path>] [--json]
specrelay init [--repo <path>] [--dry-run] [--json]
specrelay plan <objective> [--repo <path>] [--language vi] [--json]
specrelay show <run-id> [--repo <path>] [--json]
specrelay approve <run-id> --yes [--approved-by <label>] [--accept-open-questions --reason <text>] [--repo <path>] [--json]
specrelay implement <run-id> --yes [--repo <path>] [--max-turns <1..10>] [--timeout <duration>] [--dry-run] [--json]
specrelay status <run-id> [--repo <path>] [--follow] [--json]
specrelay cancel <run-id> --yes [--repo <path>] [--json]
specrelay cleanup <run-id> --yes [--repo <path>] [--json]
specrelay report <run-id> [--repo <path>] [--json]
```

`doctor` is read-only. `init` writes `.specrelay/config.json` and
`.specrelay/runs/` inside an existing Git repository, then adds `.specrelay/`
to that repository's local `.git/info/exclude`. It never changes `.gitignore`.

`plan` creates `request.md`, `plan.md`, `state.json`, and append-only
`events.jsonl` inside a new run. `approve` additionally creates
`plan.normalized.json` and `approval.json`; neither JSON file is a source users
should edit directly.

`implement` additionally writes a policy snapshot, executor prompt, execution
state, bounded redacted event log, and an executor summary. It uses `claude -p`
with stream JSON, a 10-turn/20-minute default limit, `acceptEdits`, a narrow
Git-read policy, and no dangerous permission bypass.

## Safety defaults

- SpecRelay has no telemetry and makes no network request itself. Claude Code is
  a separate local process that requires its own authentication and network
  access.
- No API keys or credentials are read, stored, or sent.
- `init` refuses an unmanaged `.specrelay/` directory and does not overwrite a
  valid configuration.
- Mutating run commands take a short exclusive lock and use atomic JSON state
  snapshots. The event log is append-only.
- `implement` rejects dirty base repositories and never uses shell execution,
  `--add-dir`, or `--dangerously-skip-permissions`.
- This is defense in depth, not a sandbox. Run only on repositories you trust
  and inspect the worktree before any later merge.
- The CLI uses structured error codes for automation and troubleshooting.

## Not in Phase C

Phase C does not run target test/build/package commands, expose a public diff
command, review code, auto-fix findings, commit, push, merge, publish, deploy,
or resume an interrupted executor. Those capabilities belong to later phases.

## Open source

SpecRelay is licensed under [Apache-2.0](LICENSE). Please read
[CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and the
[Code of Conduct](CODE_OF_CONDUCT.md) before participating.

SpecRelay is not affiliated with, endorsed by, or sponsored by OpenAI or
Anthropic. Codex and Claude Code are trademarks of their respective owners.
