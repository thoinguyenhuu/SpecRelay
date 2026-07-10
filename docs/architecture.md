# SpecRelay architecture

## Phase D boundaries

SpecRelay is a single Node.js ESM package. The CLI is the enforcement layer;
the bundled Codex skill is a chat-first adapter. It never replaces state,
approval, check, or review gates with prompt-only behavior.

```text
Codex chat ─────┐
Terminal user ─┼──> SpecRelay CLI ──> core schemas / state / artifact store
               │          │
               │          ├──> owned Git worktree ──> Claude Code worker
               │          └──> approved checks ──> diff + review packet
               └──────────────────────────────────> structured review decision
```

Codex plans and reviews; Claude Code is the isolated executor. There is no
direct model-to-model channel. Handoff occurs through plan-bound artifacts and
explicit CLI state transitions.

## Lifecycle and gates

```text
draft_plan → awaiting_approval → approved → implementing → checking
                                                        │
                                              checks fail ──> failed
                                                        │
                                              checks pass
                                                        ▼
                                                ready_for_review
                                                  │            │
                                    minor/no finding            blocking/important
                                                  ▼            ▼
                                               complete    needs_human
```

`plan.md` is canonical. Approval records SHA-256 over its complete byte
sequence; all executor, check, review-packet, and record-review gates require
the hash to remain current.

## Approved checks

`checks` is optional for backward-compatible plan parsing, but `specrelay
check` rejects a plan without it using `NO_CHECKS_CONFIGURED`. Each definition
has an explicit `argv`, a display/validation preset (`node`, `python`, or
`go`), and a timeout. Commands are spawned with `shell: false`, always use the
owned worktree as `cwd`, run sequentially, and stop after the first failure.

The runner caps each check at ten minutes and one MiB of redacted output. It
does not infer commands or install dependencies. `checks.json` records the
argv, preset, timing, exit code, output/truncation, and aggregate outcome.

## Review artifacts

After successful checks, `review-packet` combines approved normalized plan,
acceptance criteria, executor summary, check results, Git diff stat/hash, and
the owned worktree path. `diff` runs Git with `--no-ext-diff`, a base commit
from `execution.json`, safe pathspecs after `--`, and a two MiB output cap.

Codex presents findings in chat before calling `record-review`. The canonical
`review.json` contains `decision`, `summary`, and structured findings. A
`blocking` or `important` finding requires `needs_human`; only minor/no
findings may be `complete`. `final-report.json` consolidates execution,
checks, review, state, branch, and worktree. No final-report Markdown exists.

## Persistent run artifacts

```text
request.md              Original objective
plan.md                 Canonical plan with YAML front matter and checks
state.json              Atomic state snapshot
events.jsonl            Append-only audit events
plan.normalized.json    Approved derived executor/check input
approval.json           SHA-256-bound approval record
policy.json             Immutable executor policy snapshot
executor-prompt.md      Contract passed to Claude Code
execution.json          Worktree ownership, heartbeat, and outcome
executor-events.jsonl   Bounded redacted Claude stream events
executor-summary.json   Executor outcome and changed-file summary
checks.json             Approved check results
review-packet.json      Structured Codex review evidence
review.json             Structured review decision
final-report.json       Canonical combined report
```

Mutating commands take a short per-run exclusive lock and use atomic JSON
writes. Event logs are append-only. Worker execution intentionally does not
hold the lock for its full lifetime.

## Safety boundary

The executor operates in an owned worktree, with a narrowed Claude permission
policy and no shell invocation by SpecRelay. Checks and Git diff also use
argument arrays. This is defense in depth rather than an OS sandbox: a trusted
repository requirement and human review before any merge remain essential.

Phase D deliberately excludes auto-fix, retries/resume, commit, push, merge,
deploy, publishing, and model API calls.
